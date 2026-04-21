import AVFoundation
import Foundation
import React

@objc(VoiceRecorderModule)
class VoiceRecorderModule: RCTEventEmitter {
  private static let playbackProgressEvent = "VoiceRecorderPlaybackProgress"
  private static let playbackStateEvent = "VoiceRecorderPlaybackState"
  private static let recordingLevelEvent = "VoiceRecorderRecordingLevel"

  private var audioPlayer: AVPlayer?
  private var audioRecorder: AVAudioRecorder?
  private var playbackRate: Float = 1.0
  private var playbackEndedObserver: NSObjectProtocol?
  private var playbackProgressTimer: Timer?
  private var recordingMeterSamples: [Float] = []
  private var recordingMeterTimer: Timer?
  private var recordingStartedAt: Date?
  private var recordingURL: URL?
  private var hasListeners = false

  @objc
  override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return [
      VoiceRecorderModule.recordingLevelEvent,
      VoiceRecorderModule.playbackProgressEvent,
      VoiceRecorderModule.playbackStateEvent
    ]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  @objc
  func requestPermission(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    AVAudioSession.sharedInstance().requestRecordPermission { granted in
      resolve(granted)
    }
  }

  @objc
  func startRecording(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      do {
        self.stopPlaybackInternal(emitState: false)
        self.cancelRecordingInternal()

        try self.activateAudioSession(
          category: .playAndRecord,
          mode: .voiceChat,
          options: [.allowBluetooth, .defaultToSpeaker]
        )

        let directoryURL = URL(fileURLWithPath: NSTemporaryDirectory())
          .appendingPathComponent("voice_messages", isDirectory: true)
        try FileManager.default.createDirectory(
          at: directoryURL,
          withIntermediateDirectories: true
        )

        let fileName = "voice_\(Int(Date().timeIntervalSince1970 * 1000)).m4a"
        let fileURL = directoryURL.appendingPathComponent(fileName)
        let settings: [String: Any] = [
          AVEncoderAudioQualityKey: AVAudioQuality.max.rawValue,
          AVEncoderBitRateKey: 128000,
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVNumberOfChannelsKey: 1,
          AVSampleRateKey: 48000.0
        ]

        let recorder = try AVAudioRecorder(url: fileURL, settings: settings)
        recorder.isMeteringEnabled = true
        recorder.prepareToRecord()
        if !recorder.record() {
          reject(
            "voice_record_start_failed",
            "Ses kaydi baslatilamadi.",
            nil
          )
          return
        }

        self.audioRecorder = recorder
        self.recordingStartedAt = Date()
        self.recordingURL = fileURL
        self.recordingMeterSamples = []
        self.startRecordingMeterTimer()
        resolve([
          "fileName": fileName,
          "filePath": fileURL.absoluteString,
          "mimeType": "audio/mp4",
        ])
      } catch {
        self.cancelRecordingInternal()
        reject(
          "voice_record_start_failed",
          error.localizedDescription,
          error
        )
      }
    }
  }

  @objc
  func stopRecording(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard let recorder = self.audioRecorder, let url = self.recordingURL else {
        reject("voice_record_not_started", "Voice recording is not active.", nil)
        return
      }

      recorder.stop()
      self.audioRecorder = nil
      self.stopRecordingMeterTimer()
      let startedAt = self.recordingStartedAt ?? Date()
      self.recordingStartedAt = nil

      do {
        let data = try Data(contentsOf: url)
        let durationSec = max(
          1,
          Int(Date().timeIntervalSince(startedAt).rounded(.up))
        )
        let response: [String: Any] = [
          "base64": data.base64EncodedString(),
          "durationSec": durationSec,
          "fileName": url.lastPathComponent,
          "filePath": url.absoluteString,
          "mimeType": "audio/mp4",
          "sizeBytes": data.count,
          "waveform": self.normalizedWaveform(from: self.recordingMeterSamples)
        ]
        self.recordingMeterSamples = []
        self.recordingURL = nil
        self.deactivateAudioSessionIfIdle()
        resolve(response)
      } catch {
        self.cancelRecordingInternal()
        reject(
          "voice_record_stop_failed",
          error.localizedDescription,
          error
        )
      }
    }
  }

  @objc
  func cancelRecording(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.cancelRecordingInternal()
      resolve(nil)
    }
  }

  @objc
  func startPlayback(
    _ urlString: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      let trimmed = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
      guard let url = URL(string: trimmed), !trimmed.isEmpty else {
        reject("voice_playback_invalid_url", "Ses dosyasi URL gecersiz.", nil)
        return
      }

      do {
        self.stopPlaybackInternal(emitState: false)
        try self.activateAudioSession(
          category: .playback,
          mode: .default,
          options: []
        )
        let player = AVPlayer(url: url)
        self.attachPlaybackEndedObserver(for: player)
        self.audioPlayer = player
        player.playImmediately(atRate: self.playbackRate)
        self.startPlaybackProgressTimer()
        self.emitPlaybackState("playing")
        resolve(true)
      } catch {
        self.stopPlaybackInternal(emitState: false)
        self.emitPlaybackState("error")
        reject(
          "voice_playback_start_failed",
          error.localizedDescription,
          error
        )
      }
    }
  }

  @objc
  func stopPlayback(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.stopPlaybackInternal()
      resolve(nil)
    }
  }

  @objc
  func setPlaybackRate(
    _ rate: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      let clamped = max(0.5, min(2.0, rate.floatValue))
      self.playbackRate = clamped
      if let player = self.audioPlayer {
        if player.timeControlStatus == .paused {
          player.rate = 0
        } else {
          player.rate = clamped
        }
      }
      resolve(true)
    }
  }

  private func cancelRecordingInternal() {
    stopRecordingMeterTimer()
    audioRecorder?.stop()
    audioRecorder = nil
    recordingStartedAt = nil
    recordingMeterSamples = []

    if let url = recordingURL {
      try? FileManager.default.removeItem(at: url)
    }
    recordingURL = nil
    deactivateAudioSessionIfIdle()
  }

  private func stopPlaybackInternal(emitState: Bool = true) {
    stopPlaybackProgressTimer()
    removePlaybackEndedObserver()
    audioPlayer?.pause()
    audioPlayer = nil
    deactivateAudioSessionIfIdle()
    if emitState {
      emitPlaybackState("stopped")
    }
  }

  private func attachPlaybackEndedObserver(for player: AVPlayer) {
    removePlaybackEndedObserver()
    guard let currentItem = player.currentItem else {
      return
    }

    playbackEndedObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime,
      object: currentItem,
      queue: .main
    ) { [weak self] _ in
      self?.stopPlaybackInternal(emitState: false)
      self?.emitPlaybackState("ended")
    }
  }

  private func removePlaybackEndedObserver() {
    guard let observer = playbackEndedObserver else {
      return
    }

    NotificationCenter.default.removeObserver(observer)
    playbackEndedObserver = nil
  }

  private func activateAudioSession(
    category: AVAudioSession.Category,
    mode: AVAudioSession.Mode,
    options: AVAudioSession.CategoryOptions
  ) throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(category, mode: mode, options: options)
    if category == .playAndRecord {
      try? session.setPreferredSampleRate(48_000)
      try? session.setPreferredInputNumberOfChannels(1)
    }
    try session.setActive(true)
  }

  private func deactivateAudioSessionIfIdle() {
    if audioRecorder != nil || audioPlayer != nil {
      return
    }

    try? AVAudioSession.sharedInstance().setActive(
      false,
      options: [.notifyOthersOnDeactivation]
    )
  }

  private func startRecordingMeterTimer() {
    stopRecordingMeterTimer()
    recordingMeterTimer = Timer.scheduledTimer(withTimeInterval: 0.075, repeats: true) {
      [weak self] _ in
      self?.sampleRecordingMeter()
    }
  }

  private func stopRecordingMeterTimer() {
    recordingMeterTimer?.invalidate()
    recordingMeterTimer = nil
  }

  private func sampleRecordingMeter() {
    guard let recorder = audioRecorder else {
      return
    }

    recorder.updateMeters()
    let averagePower = recorder.averagePower(forChannel: 0)
    let linear = pow(10.0, Double(averagePower) / 20.0)
    let normalized = max(0.0, min(1.0, linear))
    recordingMeterSamples.append(Float(normalized))
    if recordingMeterSamples.count > 512 {
      recordingMeterSamples.removeFirst(recordingMeterSamples.count - 512)
    }
    emitRecordingLevel(normalized)
  }

  private func startPlaybackProgressTimer() {
    stopPlaybackProgressTimer()
    playbackProgressTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) {
      [weak self] _ in
      self?.emitPlaybackProgress()
    }
    emitPlaybackProgress()
  }

  private func stopPlaybackProgressTimer() {
    playbackProgressTimer?.invalidate()
    playbackProgressTimer = nil
  }

  private func emitEvent(
    _ eventName: String,
    body: [String: Any]
  ) {
    guard hasListeners else {
      return
    }
    sendEvent(withName: eventName, body: body)
  }

  private func emitRecordingLevel(_ normalizedLevel: Double) {
    emitEvent(
      VoiceRecorderModule.recordingLevelEvent,
      body: [
        "level": normalizedLevel,
        "timestampMs": Int(Date().timeIntervalSince1970 * 1000)
      ]
    )
  }

  private func emitPlaybackProgress() {
    guard let player = audioPlayer else {
      return
    }

    let positionSec = player.currentTime().seconds
    let durationSec = player.currentItem?.duration.seconds ?? 0
    let safePosition = positionSec.isFinite ? max(0, positionSec) : 0
    let safeDuration = durationSec.isFinite
      ? max(0, durationSec)
      : safePosition

    emitEvent(
      VoiceRecorderModule.playbackProgressEvent,
      body: [
        "positionSec": safePosition,
        "durationSec": safeDuration,
        "isPlaying": player.rate > 0
      ]
    )
  }

  private func emitPlaybackState(_ state: String) {
    emitEvent(
      VoiceRecorderModule.playbackStateEvent,
      body: ["state": state]
    )
  }

  private func normalizedWaveform(from samples: [Float], targetCount: Int = 48) -> [Double] {
    guard !samples.isEmpty else {
      return []
    }

    let boundedTarget = max(8, min(96, targetCount))
    if samples.count <= boundedTarget {
      return samples.map { sample in
        let clamped = max(0.0, min(1.0, sample))
        return Double(max(0.05, clamped))
      }
    }

    let segmentLength = Double(samples.count) / Double(boundedTarget)
    var points: [Double] = []
    points.reserveCapacity(boundedTarget)

    for index in 0..<boundedTarget {
      let start = Int(Double(index) * segmentLength)
      let endCandidate = Int(Double(index + 1) * segmentLength)
      let end = min(samples.count, max(start + 1, endCandidate))
      if start >= samples.count {
        points.append(0.05)
        continue
      }

      let range = samples[start..<end]
      let sum = range.reduce(Float(0)) { partial, value in
        partial + value
      }
      let average = sum / Float(range.count)
      let clamped = max(0.0, min(1.0, average))
      points.append(Double(max(0.05, clamped)))
    }

    return points
  }

  override func invalidate() {
    cancelRecordingInternal()
    stopPlaybackInternal(emitState: false)
    super.invalidate()
  }
}
