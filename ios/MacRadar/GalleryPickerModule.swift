import AVFoundation
import Foundation
import Photos
import PhotosUI
import React
import UniformTypeIdentifiers
import UIKit

@objc(GalleryPickerModule)
class GalleryPickerModule: NSObject, PHPickerViewControllerDelegate {
  private var pendingResolve: RCTPromiseResolveBlock?
  private var pendingReject: RCTPromiseRejectBlock?

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }

  @objc(pickMedia:resolver:rejecter:)
  func pickMedia(
    _ mediaType: NSString?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      if self.pendingResolve != nil || self.pendingReject != nil {
        reject(
          "gallery_picker_busy",
          "Galeri secimi zaten devam ediyor.",
          nil
        )
        return
      }

      guard let presenter = self.presentingViewController() else {
        reject(
          "gallery_picker_no_view_controller",
          "Galeri secimi icin aktif ekran bulunamadi.",
          nil
        )
        return
      }

      var configuration = PHPickerConfiguration(photoLibrary: PHPhotoLibrary.shared())
      configuration.selectionLimit = 1
      let normalizedMediaType = (mediaType as String?)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased() ?? "mixed"

      switch normalizedMediaType {
      case "photo":
        configuration.filter = .images
      case "video":
        configuration.filter = .videos
      default:
        configuration.filter = .any(of: [.images, .videos])
      }

      let picker = PHPickerViewController(configuration: configuration)
      picker.delegate = self
      self.pendingResolve = resolve
      self.pendingReject = reject
      presenter.present(picker, animated: true)
    }
  }

  @objc(createVideoThumbnail:resolver:rejecter:)
  func createVideoThumbnail(
    _ uriString: NSString,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let trimmed = uriString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let url = URL(string: trimmed) else {
      resolve(nil)
      return
    }

    do {
      resolve(try self.generateThumbnail(for: url)?.absoluteString)
    } catch {
      reject(
        "gallery_picker_thumbnail_failed",
        error.localizedDescription,
        error
      )
    }
  }

  func picker(
    _ picker: PHPickerViewController,
    didFinishPicking results: [PHPickerResult]
  ) {
    let resolve = pendingResolve
    let reject = pendingReject
    pendingResolve = nil
    pendingReject = nil

    picker.dismiss(animated: true)

    guard let resolve else {
      return
    }

    guard let result = results.first else {
      resolve(nil)
      return
    }

    let provider = result.itemProvider
    if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
      loadSelection(
        provider: provider,
        typeIdentifier: UTType.movie.identifier,
        mediaType: "video",
        resolver: resolve,
        rejecter: reject
      )
      return
    }

    if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
      loadSelection(
        provider: provider,
        typeIdentifier: UTType.image.identifier,
        mediaType: "photo",
        resolver: resolve,
        rejecter: reject
      )
      return
    }

    reject?(
      "gallery_picker_unsupported",
      "Secilen medya dosya tipi desteklenmiyor.",
      nil
    )
  }

  private func loadSelection(
    provider: NSItemProvider,
    typeIdentifier: String,
    mediaType: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock?
  ) {
    provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, error in
      if let error {
        reject?(
          "gallery_picker_load_failed",
          error.localizedDescription,
          error
        )
        return
      }

      guard let url else {
        reject?(
          "gallery_picker_empty_file",
          "Galeriden medya secilemedi.",
          nil
        )
        return
      }

      do {
        let copiedUrl = try self.copySelectionToTemporaryLocation(
          sourceUrl: url,
          mediaType: mediaType,
          suggestedName: provider.suggestedName
        )
        let payload = NSMutableDictionary()
        payload["mediaType"] = mediaType
        payload["mediaUrl"] = copiedUrl.absoluteString

        let mimeType = self.mimeType(for: copiedUrl, fallbackMediaType: mediaType)
        if !mimeType.isEmpty {
          payload["mimeType"] = mimeType
        }

        payload["fileName"] = copiedUrl.lastPathComponent
        if let attributes = try? FileManager.default.attributesOfItem(
          atPath: copiedUrl.path
        ),
        let fileSize = attributes[.size] as? NSNumber {
          payload["sizeBytes"] = fileSize.doubleValue
        }

        if mediaType == "video" {
          if let thumbnailUrl = try self.generateThumbnail(for: copiedUrl)?.absoluteString {
            payload["thumbnailUrl"] = thumbnailUrl
          }
        } else {
          payload["thumbnailUrl"] = copiedUrl.absoluteString
        }

        resolve(payload)
      } catch {
        reject?(
          "gallery_picker_process_failed",
          error.localizedDescription,
          error
        )
      }
    }
  }

  private func copySelectionToTemporaryLocation(
    sourceUrl: URL,
    mediaType: String,
    suggestedName: String?
  ) throws -> URL {
    let tempDirectory = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("gallery_picker", isDirectory: true)
    try FileManager.default.createDirectory(
      at: tempDirectory,
      withIntermediateDirectories: true
    )

    let sourceExtension = sourceUrl.pathExtension.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    let fallbackExtension = mediaType == "video" ? "mp4" : "jpg"
    let preferredBaseName = (suggestedName ?? sourceUrl.deletingPathExtension().lastPathComponent)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let safeBaseName = preferredBaseName.isEmpty
      ? "media_\(Int(Date().timeIntervalSince1970 * 1000))"
      : preferredBaseName
    let outputExtension = sourceExtension.isEmpty ? fallbackExtension : sourceExtension
    let targetUrl = tempDirectory
      .appendingPathComponent("\(safeBaseName)_\(UUID().uuidString)")
      .appendingPathExtension(outputExtension)

    if FileManager.default.fileExists(atPath: targetUrl.path) {
      try FileManager.default.removeItem(at: targetUrl)
    }
    try FileManager.default.copyItem(at: sourceUrl, to: targetUrl)
    return targetUrl
  }

  private func generateThumbnail(for fileUrl: URL) throws -> URL? {
    let asset = AVAsset(url: fileUrl)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 1200, height: 1200)

    let imageRef = try generator.copyCGImage(
      at: CMTime(seconds: 0, preferredTimescale: 600),
      actualTime: nil
    )
    let image = UIImage(cgImage: imageRef)
    guard let data = image.jpegData(compressionQuality: 0.82) else {
      return nil
    }

    let tempDirectory = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("gallery_picker_thumbnails", isDirectory: true)
    try FileManager.default.createDirectory(
      at: tempDirectory,
      withIntermediateDirectories: true
    )

    let targetUrl = tempDirectory
      .appendingPathComponent("thumb_\(UUID().uuidString)")
      .appendingPathExtension("jpg")
    try data.write(to: targetUrl, options: .atomic)
    return targetUrl
  }

  private func mimeType(for fileUrl: URL, fallbackMediaType: String) -> String {
    let pathExtension = fileUrl.pathExtension.trimmingCharacters(in: .whitespacesAndNewlines)
    if let utType = UTType(filenameExtension: pathExtension),
      let preferredMimeType = utType.preferredMIMEType {
      return preferredMimeType
    }

    return fallbackMediaType == "video" ? "video/mp4" : "image/jpeg"
  }

  private func presentingViewController() -> UIViewController? {
    if let controller = RCTPresentedViewController() {
      return controller
    }

    let scenes = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
    let window = scenes
      .flatMap { $0.windows }
      .first(where: { $0.isKeyWindow })
    return window?.rootViewController
  }
}
