package com.thrilla_btc.thrilla.updater

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Download a WhiSPa APK and hand it to Android's installer.
 *
 * WHY THIS IS NATIVE AND NOT A LIBRARY. Three things are needed — stream a file
 * to disk, hash it, and launch an install Intent through a FileProvider — and
 * the usual way to get them in React Native is a general-purpose filesystem and
 * networking library. That is a lot of new surface, most of it unrelated, in an
 * app where the reason for writing our own transaction signer was that adding
 * dependency surface to fix an exposure problem is the wrong trade. The same
 * reasoning applies here, so this is the narrow thing instead.
 *
 * WHAT ACTUALLY PROTECTS THE USER. Three layers, in increasing order of how
 * much they are worth:
 *
 *   1. The download host is checked against an allowlist, so this cannot be
 *      driven into fetching arbitrary URLs by a bad API response.
 *   2. The SHA-256 is computed while downloading and compared to the hash the
 *      caller supplies, from the release's SHA256SUMS. A mismatch deletes the
 *      file and the install is never offered. This catches a truncated
 *      download, a bad mirror or a corrupted cache — but not a compromised
 *      GitHub, which would serve a matching SHA256SUMS alongside a bad APK.
 *   3. Android verifies the APK's signing certificate against the installed
 *      app's on every update and refuses the install if they differ. THIS is
 *      the guarantee that matters: an APK signed with any other key cannot
 *      replace WhiSPa, whatever it claims about itself and wherever it came
 *      from. It is enforced by the platform, not by this file.
 *
 * The GPG-signed SHA256SUMS.asc stays the out-of-band chain for anyone who
 * wants to check by hand; the About page links to the instructions.
 */
class ApkInstallerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  companion object {
    const val NAME = "ApkInstaller"

    /** Where a release APK may be fetched from. Anything else is refused. */
    private val ALLOWED_HOSTS = setOf(
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    )

    private const val APK_MIME = "application/vnd.android.package-archive"
    private const val DIR = "updates"
    private const val BUFFER = 64 * 1024

    /** Emit at most this often, so a 37 MB download is not 600 bridge calls. */
    private const val PROGRESS_STEP_BYTES = 512L * 1024L

    const val EVENT_PROGRESS = "ApkInstaller:progress"
  }

  private val executor = Executors.newSingleThreadExecutor()

  /** Flipped by cancel(); read by the download loop. */
  @Volatile private var cancelled = false

  /**
   * The one file download() has verified this session.
   *
   * install() will accept nothing else. The directory check below already
   * limits it to our own cache, and download() deletes anything that failed its
   * hash — this is the third thing that has to be wrong before an unverified
   * APK could reach the installer.
   */
  @Volatile private var verifiedPath: String? = null

  // NativeEventEmitter calls these on subscribe and unsubscribe. Both have to
  // exist or RN warns on every listener; the download loop emits regardless, so
  // there is nothing for them to do.
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Double) {}

  private fun updatesDir(): File {
    val dir = File(reactContext.cacheDir, DIR)
    if (!dir.exists()) dir.mkdirs()
    return dir
  }

  /**
   * Is the app allowed to ask Android to install a package?
   *
   * API 26 introduced a per-app permission for this, granted in Settings rather
   * than at runtime. Below 26 there is only the device-wide "unknown sources"
   * toggle, which this cannot see or ask for — so it reports true and lets the
   * install Intent tell the user if it is off.
   */
  @ReactMethod
  fun canInstall(promise: Promise) {
    try {
      val allowed =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.packageManager.canRequestPackageInstalls()
          } else {
            true
          }
      val result = Arguments.createMap()
      result.putBoolean("allowed", allowed)
      result.putBoolean("askable", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      promise.resolve(result)
    } catch (e: Throwable) {
      promise.reject("E_CAN_INSTALL", e.message, e)
    }
  }

  /** Open the Settings page where that permission is granted. */
  @ReactMethod
  fun openInstallSettings(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        promise.reject("E_UNSUPPORTED", "This Android version has no per-app setting.")
        return
      }
      val intent =
          Intent(
                  Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                  Uri.parse("package:${reactContext.packageName}"),
              )
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      (currentActivity ?: reactContext).startActivity(intent)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_OPEN_SETTINGS", e.message, e)
    }
  }

  /** Throw away any downloaded APK. Each one is tens of megabytes. */
  @ReactMethod
  fun discard(promise: Promise) {
    try {
      verifiedPath = null
      updatesDir().listFiles()?.forEach { it.delete() }
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_DISCARD", e.message, e)
    }
  }

  /** Stop an in-flight download. The partial file is deleted by the loop. */
  @ReactMethod
  fun cancel(promise: Promise) {
    cancelled = true
    promise.resolve(true)
  }

  /**
   * Fetch `url` into the cache, verifying it hashes to `expectedSha256`.
   *
   * Resolves with the file's path only if the hash matches. On any other
   * outcome — mismatch, cancellation, network or disk error — the partial or
   * wrong file is deleted before the promise settles, so there is never an
   * unverified APK sitting on disk for install() to find.
   */
  @ReactMethod
  fun download(url: String, expectedSha256: String, fileName: String, promise: Promise) {
    val wantHash = expectedSha256.trim().lowercase()
    if (!wantHash.matches(Regex("^[0-9a-f]{64}$"))) {
      promise.reject(
          "E_NO_HASH",
          "Refusing to download without a SHA-256 to check it against.",
      )
      return
    }
    // The installer keys off the extension, and the name comes from a release
    // payload, so it is scrubbed to a plain filename rather than trusted.
    val scrubbed = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_")
    val safeName =
        if (scrubbed.endsWith(".apk") && scrubbed.length > 4) scrubbed else "update.apk"

    val parsed =
        try {
          URL(url)
        } catch (ignored: Throwable) {
          promise.reject("E_BAD_URL", "That is not a URL.")
          return
        }
    if (parsed.protocol != "https" || parsed.host !in ALLOWED_HOSTS) {
      promise.reject(
          "E_BAD_HOST",
          "Refusing to download an update from ${parsed.host}.",
      )
      return
    }

    cancelled = false
    executor.execute {
      // Only one APK is ever kept: the previous one is dead weight at this size.
      // Whatever was verified before is gone with it.
      verifiedPath = null
      updatesDir().listFiles()?.forEach { it.delete() }
      val target = File(updatesDir(), safeName)
      var connection: HttpURLConnection? = null
      // Nothing that did not verify is left on disk, so install() cannot find
      // an APK that was never checked. Set true only on the resolve path.
      var keep = false
      try {
        connection =
            (parsed.openConnection() as HttpURLConnection).apply {
              connectTimeout = 30_000
              readTimeout = 60_000
              // GitHub redirects a release asset to its storage host. Both hops
              // are https, which is the case HttpURLConnection follows on its
              // own; it refuses to cross protocols, which is the behaviour we
              // want anyway.
              instanceFollowRedirects = true
              setRequestProperty("Accept", "$APK_MIME, application/octet-stream")
            }
        val code = connection.responseCode
        if (code !in 200..299) {
          promise.reject("E_HTTP", "The download returned $code.")
          return@execute
        }

        // contentLength, not contentLengthLong: the latter is API 24 and this
        // app supports 23. An APK is nowhere near the 2 GB an Int gives out.
        // Chunked responses report -1, which the progress maths allows for.
        val total = connection.contentLength.toLong()
        val digest = MessageDigest.getInstance("SHA-256")
        var read = 0L
        var lastEmit = 0L

        connection.inputStream.use { input ->
          FileOutputStream(target).use { output ->
            val buffer = ByteArray(BUFFER)
            while (true) {
              if (cancelled) {
                promise.reject("E_CANCELLED", "The download was cancelled.")
                return@execute
              }
              val n = input.read(buffer)
              if (n < 0) break
              output.write(buffer, 0, n)
              digest.update(buffer, 0, n)
              read += n
              if (read - lastEmit >= PROGRESS_STEP_BYTES) {
                lastEmit = read
                emitProgress(read, total)
              }
            }
            output.flush()
          }
        }
        emitProgress(read, total)

        if (total > 0 && read != total) {
          promise.reject(
              "E_TRUNCATED",
              "The download stopped early — $read of $total bytes.",
          )
          return@execute
        }

        val got = digest.digest().joinToString("") { "%02x".format(it) }
        if (got != wantHash) {
          promise.reject(
              "E_HASH_MISMATCH",
              "The download does not match the checksum published for this " +
                  "release, so it has not been kept. Nothing was installed.",
          )
          return@execute
        }

        val result = Arguments.createMap()
        result.putString("path", target.absolutePath)
        result.putString("sha256", got)
        result.putDouble("bytes", read.toDouble())
        keep = true
        verifiedPath = target.absolutePath
        promise.resolve(result)
        return@execute
      } catch (e: Throwable) {
        promise.reject("E_DOWNLOAD", e.message ?: "The download failed.", e)
        return@execute
      } finally {
        connection?.disconnect()
        if (!keep) target.delete()
      }
    }
  }

  private fun emitProgress(read: Long, total: Long) {
    val payload = Arguments.createMap()
    payload.putDouble("bytes", read.toDouble())
    payload.putDouble("total", total.toDouble())
    payload.putDouble(
        "fraction",
        if (total > 0) (read.toDouble() / total.toDouble()) else 0.0,
    )
    try {
      reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(EVENT_PROGRESS, payload)
    } catch (ignored: Throwable) {
      // No bridge to emit on — the app was backgrounded or reloaded mid-download.
      // Progress is cosmetic; losing it must not abandon a 37 MB transfer.
    }
  }

  /**
   * Hand the APK to Android's package installer.
   *
   * From here on it is the platform's decision, not ours: it shows the user
   * what is being installed and refuses outright unless the APK is signed with
   * the same certificate as the copy already on the phone.
   */
  @ReactMethod
  fun install(path: String, promise: Promise) {
    try {
      val file = File(path)
      // Only ever our own cache directory, so a path from JS cannot be turned
      // into "install this other file on the device".
      if (file.parentFile?.canonicalPath != updatesDir().canonicalPath) {
        promise.reject("E_BAD_PATH", "That file is not a downloaded update.")
        return
      }
      if (file.absolutePath != verifiedPath) {
        promise.reject(
            "E_UNVERIFIED",
            "That file was not checked against a release checksum by this app.",
        )
        return
      }
      if (!file.exists()) {
        promise.reject("E_MISSING", "The downloaded update is no longer there.")
        return
      }
      val uri =
          FileProvider.getUriForFile(
              reactContext,
              "${reactContext.packageName}.updates",
              file,
          )
      val intent =
          Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, APK_MIME)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
      (currentActivity ?: reactContext).startActivity(intent)
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("E_INSTALL", e.message ?: "Could not start the installer.", e)
    }
  }
}
