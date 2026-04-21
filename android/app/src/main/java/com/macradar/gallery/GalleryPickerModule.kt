package com.macradar.gallery

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import java.util.UUID

class GalleryPickerModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {
  private var pendingPickerPromise: Promise? = null

  companion object {
    private const val REQUEST_PICK_MEDIA = 42061
  }

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = "GalleryPickerModule"

  @ReactMethod
  fun pickMedia(mediaType: String?, promise: Promise) {
    if (pendingPickerPromise != null) {
      promise.reject(
        "gallery_picker_busy",
        "Galeri secimi zaten devam ediyor.",
      )
      return
    }

    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject(
        "gallery_picker_no_activity",
        "Galeri secimi icin aktif ekran bulunamadi.",
      )
      return
    }

    val normalizedMediaType = mediaType
      ?.trim()
      ?.lowercase(Locale.ROOT)
      ?.ifEmpty { "mixed" }
      ?: "mixed"

    // OPEN_DOCUMENT genel "Dosyalar" arayüzünü açabiliyor; foto/video için GET_CONTENT
    // tipik olarak Galeri / Fotoğraflar uygulamalarına yönlendirir.
    val intent = when (normalizedMediaType) {
      "photo" -> Intent(Intent.ACTION_GET_CONTENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "image/*"
      }
      "video" -> Intent(Intent.ACTION_GET_CONTENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "video/*"
      }
      else -> Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
        type = "*/*"
        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*"))
      }
    }

    pendingPickerPromise = promise
    try {
      activity.startActivityForResult(intent, REQUEST_PICK_MEDIA)
    } catch (error: Throwable) {
      pendingPickerPromise = null
      promise.reject(
        "gallery_picker_open_failed",
        error.message ?: "Galeri acilamadi.",
        error,
      )
    }
  }

  @ReactMethod
  fun createVideoThumbnail(uriString: String, promise: Promise) {
    val normalizedUriString = uriString.trim()
    if (normalizedUriString.isEmpty()) {
      promise.resolve(null)
      return
    }

    try {
      promise.resolve(createVideoThumbnailInternal(Uri.parse(normalizedUriString)))
    } catch (error: Throwable) {
      promise.reject(
        "gallery_picker_thumbnail_failed",
        error.message ?: "Video thumbnail olusturulamadi.",
        error,
      )
    }
  }

  override fun onActivityResult(
    activity: Activity,
    requestCode: Int,
    resultCode: Int,
    data: Intent?
  ) {
    if (requestCode != REQUEST_PICK_MEDIA) {
      return
    }

    val promise = pendingPickerPromise ?: return
    pendingPickerPromise = null

    if (resultCode != Activity.RESULT_OK) {
      promise.resolve(null)
      return
    }

    val uri = data?.data
    if (uri == null) {
      promise.reject(
        "gallery_picker_empty_selection",
        "Galeriden medya secilemedi.",
      )
      return
    }

    try {
      val flags = data.flags and
        (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      if (flags != 0) {
        try {
          reactContext.contentResolver.takePersistableUriPermission(uri, flags)
        } catch (_: Throwable) {
        }
      }

      val payload = Arguments.createMap()
      val mimeType = resolveMimeType(uri)
      val fileName = queryDisplayName(uri)
      val mediaType = when {
        mimeType.startsWith("video/") -> "video"
        mimeType.startsWith("image/") -> "photo"
        isVideoUri(uri, fileName) -> "video"
        else -> "photo"
      }
      payload.putString("mediaType", mediaType)
      payload.putString("mediaUrl", uri.toString())
      if (mimeType.isNotEmpty()) {
        payload.putString("mimeType", mimeType)
      }
      if (!fileName.isNullOrBlank()) {
        payload.putString("fileName", fileName)
      }
      val sizeBytes = querySizeBytes(uri)
      if (sizeBytes >= 0L) {
        payload.putDouble("sizeBytes", sizeBytes.toDouble())
      }

      if (mediaType == "video") {
        val thumbnailUrl = createVideoThumbnailInternal(uri)
        if (!thumbnailUrl.isNullOrBlank()) {
          payload.putString("thumbnailUrl", thumbnailUrl)
        }
      } else {
        payload.putString("thumbnailUrl", uri.toString())
      }

      promise.resolve(payload)
    } catch (error: Throwable) {
      promise.reject(
        "gallery_picker_process_failed",
        error.message ?: "Galeri medyasi islenemedi.",
        error,
      )
    }
  }

  override fun onNewIntent(intent: Intent) {
    return
  }

  private fun resolveMimeType(uri: Uri): String {
    val direct = reactContext.contentResolver.getType(uri)?.trim()
    if (!direct.isNullOrEmpty()) {
      return direct
    }

    val fallbackName = queryDisplayName(uri).orEmpty().lowercase(Locale.ROOT)
    return when {
      fallbackName.endsWith(".png") -> "image/png"
      fallbackName.endsWith(".heic") || fallbackName.endsWith(".heif") -> "image/heic"
      fallbackName.endsWith(".mov") -> "video/quicktime"
      fallbackName.endsWith(".mp4") || fallbackName.endsWith(".m4v") -> "video/mp4"
      fallbackName.endsWith(".jpg") || fallbackName.endsWith(".jpeg") -> "image/jpeg"
      else -> ""
    }
  }

  private fun isVideoUri(uri: Uri, fileName: String?): Boolean {
    val normalized = "${uri}".lowercase(Locale.ROOT)
    val normalizedFileName = fileName.orEmpty().lowercase(Locale.ROOT)
    return normalized.endsWith(".mp4") ||
      normalized.endsWith(".mov") ||
      normalizedFileName.endsWith(".mp4") ||
      normalizedFileName.endsWith(".mov")
  }

  private fun queryDisplayName(uri: Uri): String? {
    return reactContext.contentResolver.query(
      uri,
      arrayOf(OpenableColumns.DISPLAY_NAME),
      null,
      null,
      null,
    )?.use { cursor ->
      if (!cursor.moveToFirst()) {
        return@use null
      }
      val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
      if (index < 0) {
        return@use null
      }
      cursor.getString(index)
    }
  }

  private fun querySizeBytes(uri: Uri): Long {
    return reactContext.contentResolver.query(
      uri,
      arrayOf(OpenableColumns.SIZE),
      null,
      null,
      null,
    )?.use { cursor ->
      if (!cursor.moveToFirst()) {
        return@use -1L
      }
      val index = cursor.getColumnIndex(OpenableColumns.SIZE)
      if (index < 0) {
        return@use -1L
      }
      cursor.getLong(index)
    } ?: -1L
  }

  private fun createVideoThumbnailInternal(uri: Uri): String? {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(reactContext, uri)
      val bitmap =
        retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
          ?: retriever.frameAtTime
          ?: return null
      val thumbDir = File(reactContext.cacheDir, "gallery_thumbnails")
      if (!thumbDir.exists()) {
        thumbDir.mkdirs()
      }
      val outputFile = File(
        thumbDir,
        "thumb_${System.currentTimeMillis()}_${UUID.randomUUID()}.jpg",
      )
      FileOutputStream(outputFile).use { stream ->
        bitmap.compress(Bitmap.CompressFormat.JPEG, 88, stream)
        stream.flush()
      }
      return "file://${outputFile.absolutePath}"
    } finally {
      try {
        retriever.release()
      } catch (_: Throwable) {
      }
    }
  }
}
