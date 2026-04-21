package com.macradar.voice

import android.media.AudioManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import kotlin.math.max
import kotlin.math.min

class VoiceRecorderModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  private var mediaPlayer: MediaPlayer? = null
  private var mediaRecorder: MediaRecorder? = null
  private var playbackRate: Float = 1f
  private var recordingFile: File? = null
  private var recordingIsActive: Boolean = false
  private var recordingMimeType: String = "audio/mp4"
  private var recordingStartedAtMs: Long = 0L
  private val recordingAmplitudeSamples = mutableListOf<Int>()
  private val recordingAmplitudeHandler = Handler(Looper.getMainLooper())
  private var recordingAmplitudeSampler: Runnable? = null
  private val playbackProgressHandler = Handler(Looper.getMainLooper())
  private var playbackProgressSampler: Runnable? = null
  private var playbackDurationSec: Double = 0.0
  private var listenerCount = 0

  private data class RecordingConfig(
    val audioEncoder: Int,
    val audioSource: Int,
    val bitRate: Int,
    val debugName: String,
    val extension: String,
    val mimeType: String,
    val outputFormat: Int,
    val sampleRate: Int
  )

  companion object {
    private const val TAG = "MacRadarVoiceRecorder"
    private const val RECORDING_AMPLITUDE_SAMPLE_MS = 75L
    private const val PLAYBACK_PROGRESS_SAMPLE_MS = 80L
    private const val EVENT_RECORDING_LEVEL = "VoiceRecorderRecordingLevel"
    private const val EVENT_PLAYBACK_PROGRESS = "VoiceRecorderPlaybackProgress"
    private const val EVENT_PLAYBACK_STATE = "VoiceRecorderPlaybackState"
    private val RECORDING_CONFIGS = listOf(
      RecordingConfig(
        audioEncoder = MediaRecorder.AudioEncoder.AAC,
        audioSource = MediaRecorder.AudioSource.MIC,
        bitRate = 128000,
        debugName = "mic-hq/mp4",
        extension = "m4a",
        mimeType = "audio/mp4",
        outputFormat = MediaRecorder.OutputFormat.MPEG_4,
        sampleRate = 48000,
      ),
      RecordingConfig(
        audioEncoder = MediaRecorder.AudioEncoder.AAC,
        audioSource = MediaRecorder.AudioSource.VOICE_COMMUNICATION,
        bitRate = 96000,
        debugName = "voice-communication/mp4",
        extension = "m4a",
        mimeType = "audio/mp4",
        outputFormat = MediaRecorder.OutputFormat.MPEG_4,
        sampleRate = 48000,
      ),
      RecordingConfig(
        audioEncoder = MediaRecorder.AudioEncoder.AAC,
        audioSource = MediaRecorder.AudioSource.CAMCORDER,
        bitRate = 96000,
        debugName = "camcorder/mp4",
        extension = "m4a",
        mimeType = "audio/mp4",
        outputFormat = MediaRecorder.OutputFormat.MPEG_4,
        sampleRate = 44100,
      ),
      RecordingConfig(
        audioEncoder = MediaRecorder.AudioEncoder.AAC,
        audioSource = MediaRecorder.AudioSource.MIC,
        bitRate = 64000,
        debugName = "mic/mp4-fallback",
        extension = "m4a",
        mimeType = "audio/mp4",
        outputFormat = MediaRecorder.OutputFormat.MPEG_4,
        sampleRate = 32000,
      ),
      RecordingConfig(
        audioEncoder = MediaRecorder.AudioEncoder.AAC,
        audioSource = MediaRecorder.AudioSource.DEFAULT,
        bitRate = 48000,
        debugName = "default/aac",
        extension = "aac",
        mimeType = "audio/aac",
        outputFormat = MediaRecorder.OutputFormat.AAC_ADTS,
        sampleRate = 22050,
      ),
      RecordingConfig(
        audioEncoder = MediaRecorder.AudioEncoder.AAC,
        audioSource = MediaRecorder.AudioSource.MIC,
        bitRate = 32000,
        debugName = "mic/aac-low",
        extension = "aac",
        mimeType = "audio/aac",
        outputFormat = MediaRecorder.OutputFormat.AAC_ADTS,
        sampleRate = 16000,
      ),
    )
  }

  override fun getName(): String = "VoiceRecorderModule"

  @ReactMethod
  fun requestPermission(promise: Promise) {
    promise.resolve(true)
  }

  @ReactMethod
  fun addListener(eventName: String?) {
    listenerCount += 1
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    listenerCount = (listenerCount - count).coerceAtLeast(0)
  }

  @ReactMethod
  fun startRecording(promise: Promise) {
    try {
      stopPlaybackInternal(emitState = false)
      cancelRecordingInternal()

      val voiceDir = File(reactContext.cacheDir, "voice_messages")
      if (!voiceDir.exists()) {
        voiceDir.mkdirs()
      }
      val baseName = "voice_${System.currentTimeMillis()}"
      var lastError: Throwable? = null

      for (config in RECORDING_CONFIGS) {
        val outputFile = File(voiceDir, "$baseName.${config.extension}")
        if (outputFile.exists()) {
          outputFile.delete()
        }

        val recorder = createRecorder(outputFile, config)
        try {
          recorder.prepare()
          recorder.start()

          mediaRecorder = recorder
          recordingFile = outputFile
          recordingIsActive = true
          recordingMimeType = config.mimeType
          recordingStartedAtMs = System.currentTimeMillis()
          recordingAmplitudeSamples.clear()
          startAmplitudeSampling()
          Log.i(
            TAG,
            "Recording started with ${config.debugName} (${config.mimeType}) @ ${config.sampleRate}Hz / ${config.bitRate}bps",
          )

          val payload = Arguments.createMap().apply {
            putString("fileName", outputFile.name)
            putString("filePath", Uri.fromFile(outputFile).toString())
            putString("mimeType", config.mimeType)
          }
          promise.resolve(payload)
          return
        } catch (error: Throwable) {
          lastError = error
          Log.w(
            TAG,
            "Recording start failed for ${config.debugName} (${config.mimeType}) @ ${config.sampleRate}Hz",
            error,
          )
          recordingIsActive = false
          safeReleaseRecorder(recorder)
          if (outputFile.exists()) {
            outputFile.delete()
          }
        }
      }

      throw lastError ?: IllegalStateException("Voice recording failed to start.")
    } catch (error: Throwable) {
      cancelRecordingInternal()
      Log.e(TAG, "Recording start failed after all fallbacks", error)
      promise.reject(
        "voice_record_start_failed",
        error.message ?: "Voice recording failed to start.",
        error,
      )
    }
  }

  @ReactMethod
  fun stopRecording(promise: Promise) {
    val recorder = mediaRecorder
    val file = recordingFile
    if (recorder == null || file == null || !recordingIsActive) {
      promise.reject("voice_record_not_started", "Voice recording is not active.")
      return
    }

    try {
      stopAmplitudeSampling()
      emitRecordingLevel(0.0)
      recorder.stop()
      safeReleaseRecorder(recorder)
      mediaRecorder = null
      recordingIsActive = false

      val bytes = file.readBytes()
      val elapsedMs = System.currentTimeMillis() - recordingStartedAtMs
      val durationSec = if (elapsedMs <= 0L) 1 else (elapsedMs / 1000L).toInt().coerceAtLeast(1)
      val peakLevel = computePeakLevel(recordingAmplitudeSamples)
      val averageLevel = computeAverageLevel(recordingAmplitudeSamples)
      val payload = Arguments.createMap().apply {
        putDouble("averageLevel", averageLevel)
        putString("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
        putDouble("durationSec", durationSec.toDouble())
        putString("fileName", file.name)
        putString("filePath", Uri.fromFile(file).toString())
        putString("mimeType", recordingMimeType)
        putDouble("peakLevel", peakLevel)
        putDouble("sizeBytes", bytes.size.toDouble())
        putArray("waveform", normalizeWaveform(recordingAmplitudeSamples))
      }
      recordingFile = null
      recordingStartedAtMs = 0L
      recordingAmplitudeSamples.clear()
      Log.i(TAG, "Recording stopped successfully with ${bytes.size} bytes")
      promise.resolve(payload)
    } catch (error: Throwable) {
      cancelRecordingInternal()
      Log.e(TAG, "Recording stop failed", error)
      promise.reject(
        "voice_record_stop_failed",
        error.message ?: "Voice recording failed to stop.",
        error,
      )
    }
  }

  @ReactMethod
  fun cancelRecording(promise: Promise) {
    try {
      cancelRecordingInternal()
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject(
        "voice_record_cancel_failed",
        error.message ?: "Voice recording cleanup failed.",
        error,
      )
    }
  }

  @ReactMethod
  fun startPlayback(url: String, promise: Promise) {
    val trimmedUrl = url.trim()
    if (trimmedUrl.isEmpty()) {
      promise.reject("voice_playback_invalid_url", "Voice playback URL is empty.")
      return
    }

    try {
      stopPlaybackInternal(emitState = false)
      val player = MediaPlayer()
      @Suppress("DEPRECATION")
      player.setAudioStreamType(AudioManager.STREAM_MUSIC)
      if (
        trimmedUrl.startsWith("http://") ||
          trimmedUrl.startsWith("https://") ||
          trimmedUrl.startsWith("file://") ||
          trimmedUrl.startsWith("content://")
      ) {
        player.setDataSource(reactContext, Uri.parse(trimmedUrl))
      } else {
        player.setDataSource(trimmedUrl)
      }
      player.setOnPreparedListener {
        playbackDurationSec = max(0.0, it.duration.toDouble() / 1000.0)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          try {
            it.playbackParams = it.playbackParams
              .setPitch(1f)
              .setSpeed(playbackRate)
          } catch (_: Throwable) {
          }
        }
        it.start()
        startPlaybackProgressSampling()
        emitPlaybackState("playing")
        promise.resolve(true)
      }
      player.setOnCompletionListener {
        stopPlaybackInternal(emitState = false)
        emitPlaybackState("ended")
      }
      player.setOnErrorListener { _, _, _ ->
        stopPlaybackInternal(emitState = false)
        emitPlaybackState("error")
        true
      }
      mediaPlayer = player
      player.prepareAsync()
    } catch (error: Throwable) {
      stopPlaybackInternal(emitState = false)
      emitPlaybackState("error")
      promise.reject(
        "voice_playback_start_failed",
        error.message ?: "Voice playback failed to start.",
        error,
      )
    }
  }

  @ReactMethod
  fun stopPlayback(promise: Promise) {
    stopPlaybackInternal()
    promise.resolve(null)
  }

  @ReactMethod
  fun setPlaybackRate(rate: Double, promise: Promise) {
    val normalized = rate.toFloat().coerceIn(0.5f, 2f)
    playbackRate = normalized

    val player = mediaPlayer
    if (player == null) {
      promise.resolve(true)
      return
    }

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      promise.resolve(false)
      return
    }

    try {
      val wasPlaying = player.isPlaying
      player.playbackParams = player.playbackParams
        .setPitch(1f)
        .setSpeed(playbackRate)
      if (wasPlaying && !player.isPlaying) {
        player.start()
      }
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject(
        "voice_playback_rate_failed",
        error.message ?: "Voice playback rate change failed.",
        error,
      )
    }
  }

  override fun invalidate() {
    super.invalidate()
    cancelRecordingInternal()
    stopPlaybackInternal(emitState = false)
  }

  private fun cancelRecordingInternal() {
    stopAmplitudeSampling()
    emitRecordingLevel(0.0)
    val recorder = mediaRecorder
    mediaRecorder = null
    if (recorder != null) {
      if (recordingIsActive) {
        try {
          recorder.stop()
        } catch (_: Throwable) {
        }
      }
      safeReleaseRecorder(recorder)
    }

    val file = recordingFile
    recordingFile = null
    recordingIsActive = false
    recordingMimeType = "audio/mp4"
    recordingStartedAtMs = 0L
    recordingAmplitudeSamples.clear()
    if (file != null && file.exists()) {
      file.delete()
    }
  }

  private fun stopPlaybackInternal(emitState: Boolean = true) {
    stopPlaybackProgressSampling()
    val player = mediaPlayer
    mediaPlayer = null
    playbackDurationSec = 0.0
    if (player != null) {
      try {
        player.stop()
      } catch (_: Throwable) {
      }
      try {
        player.reset()
      } catch (_: Throwable) {
      }
      try {
        player.release()
      } catch (_: Throwable) {
      }
    }
    if (emitState) {
      emitPlaybackState("stopped")
    }
  }

  private fun startAmplitudeSampling() {
    stopAmplitudeSampling()
    val sampler = object : Runnable {
      override fun run() {
        val recorder = mediaRecorder ?: return
        try {
          val amplitude = recorder.maxAmplitude
          val boundedAmplitude = max(0, min(32767, amplitude))
          recordingAmplitudeSamples.add(boundedAmplitude)
          if (recordingAmplitudeSamples.size > 512) {
            val toRemove = recordingAmplitudeSamples.size - 512
            recordingAmplitudeSamples.subList(0, toRemove).clear()
          }
          emitRecordingLevel(boundedAmplitude.toDouble() / 32767.0)
        } catch (_: Throwable) {
        }

        recordingAmplitudeHandler.postDelayed(this, RECORDING_AMPLITUDE_SAMPLE_MS)
      }
    }
    recordingAmplitudeSampler = sampler
    recordingAmplitudeHandler.post(sampler)
  }

  private fun stopAmplitudeSampling() {
    val sampler = recordingAmplitudeSampler
    if (sampler != null) {
      recordingAmplitudeHandler.removeCallbacks(sampler)
    }
    recordingAmplitudeSampler = null
  }

  private fun startPlaybackProgressSampling() {
    stopPlaybackProgressSampling()
    val sampler = object : Runnable {
      override fun run() {
        val player = mediaPlayer ?: return
        val positionSec = max(0.0, player.currentPosition.toDouble() / 1000.0)
        val playerDurationSec = if (player.duration > 0) {
          player.duration.toDouble() / 1000.0
        } else {
          0.0
        }
        if (playerDurationSec > 0) {
          playbackDurationSec = playerDurationSec
        }
        emitPlaybackProgress(
          positionSec = positionSec,
          durationSec = max(positionSec, playbackDurationSec),
          isPlaying = player.isPlaying,
        )
        playbackProgressHandler.postDelayed(this, PLAYBACK_PROGRESS_SAMPLE_MS)
      }
    }
    playbackProgressSampler = sampler
    playbackProgressHandler.post(sampler)
  }

  private fun stopPlaybackProgressSampling() {
    val sampler = playbackProgressSampler
    if (sampler != null) {
      playbackProgressHandler.removeCallbacks(sampler)
    }
    playbackProgressSampler = null
  }

  private fun emitRecordingLevel(level: Double) {
    emitEvent(
      EVENT_RECORDING_LEVEL,
      Arguments.createMap().apply {
        putDouble("level", level.coerceIn(0.0, 1.0))
        putDouble("timestampMs", System.currentTimeMillis().toDouble())
      },
    )
  }

  private fun emitPlaybackProgress(
    positionSec: Double,
    durationSec: Double,
    isPlaying: Boolean,
  ) {
    emitEvent(
      EVENT_PLAYBACK_PROGRESS,
      Arguments.createMap().apply {
        putDouble("positionSec", max(0.0, positionSec))
        putDouble("durationSec", max(0.0, durationSec))
        putBoolean("isPlaying", isPlaying)
      },
    )
  }

  private fun emitPlaybackState(state: String) {
    emitEvent(
      EVENT_PLAYBACK_STATE,
      Arguments.createMap().apply {
        putString("state", state)
      },
    )
  }

  private fun emitEvent(eventName: String, payload: WritableMap) {
    if (listenerCount <= 0 || !reactContext.hasActiveReactInstance()) {
      return
    }

    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(eventName, payload)
  }

  private fun createRecorder(
    outputFile: File,
    config: RecordingConfig
  ): MediaRecorder {
    val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      MediaRecorder(reactContext)
    } else {
      @Suppress("DEPRECATION")
      MediaRecorder()
    }

    recorder.setAudioSource(config.audioSource)
    recorder.setOutputFormat(config.outputFormat)
    recorder.setAudioEncoder(config.audioEncoder)
    recorder.setAudioChannels(1)
    recorder.setAudioEncodingBitRate(config.bitRate)
    recorder.setAudioSamplingRate(config.sampleRate)
    recorder.setOutputFile(outputFile.absolutePath)
    return recorder
  }

  private fun safeReleaseRecorder(recorder: MediaRecorder) {
    try {
      recorder.reset()
    } catch (_: Throwable) {
    }
    try {
      recorder.release()
    } catch (_: Throwable) {
    }
  }

  private fun normalizeWaveform(
    samples: List<Int>,
    targetCount: Int = 48
  ): WritableArray {
    val payload = Arguments.createArray()
    if (samples.isEmpty()) {
      return payload
    }

    val boundedTarget = max(8, min(96, targetCount))
    if (samples.size <= boundedTarget) {
      samples.forEach { sample ->
        val normalized = max(0.05, min(1.0, sample.toDouble() / 32767.0))
        payload.pushDouble(normalized)
      }
      return payload
    }

    val segmentSize = samples.size.toDouble() / boundedTarget.toDouble()
    for (index in 0 until boundedTarget) {
      val start = (index * segmentSize).toInt()
      val endCandidate = ((index + 1) * segmentSize).toInt()
      val end = min(samples.size, max(start + 1, endCandidate))
      if (start >= samples.size) {
        payload.pushDouble(0.05)
        continue
      }

      var sum = 0.0
      for (cursor in start until end) {
        sum += samples[cursor].toDouble()
      }
      val avg = sum / (end - start).toDouble()
      val normalized = max(0.05, min(1.0, avg / 32767.0))
      payload.pushDouble(normalized)
    }

    return payload
  }

  private fun computeAverageLevel(samples: List<Int>): Double {
    if (samples.isEmpty()) {
      return 0.0
    }

    var sum = 0.0
    samples.forEach { sample ->
      sum += max(0, min(32767, sample)).toDouble()
    }
    return (sum / samples.size.toDouble()) / 32767.0
  }

  private fun computePeakLevel(samples: List<Int>): Double {
    if (samples.isEmpty()) {
      return 0.0
    }

    var peak = 0
    samples.forEach { sample ->
      peak = max(peak, max(0, min(32767, sample)))
    }
    return peak.toDouble() / 32767.0
  }
}
