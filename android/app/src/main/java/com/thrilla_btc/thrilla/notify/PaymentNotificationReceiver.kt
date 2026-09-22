package com.thrilla_btc.thrilla.notify

import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.thrilla_btc.thrilla.MainActivity
import com.thrilla_btc.thrilla.R

/**
 * Builds the payment notification in the app, so it can carry the WhiSPa logo.
 *
 * WHY THIS EXISTS AT ALL
 *
 * A notification's *small* icon is an alpha mask: Android flattens it to one
 * colour and discards the rest, so the logo cannot go there — it comes out as
 * a featureless blob. The full-colour slot is the *large* icon, and FCM has no
 * field for it. Nothing the server sends can set it.
 *
 * The large icon can only be set by whoever builds the Notification. For a
 * message with a `notification` block, that is the firebase-messaging SDK,
 * inside Google's code, when the app is not in the foreground. So the server
 * now sends payment pushes as DATA-ONLY messages (helpers/fcm.py): with no
 * `notification` block the SDK displays nothing, and this receiver builds it
 * instead — small icon, brand tint, logo, tap-to-open.
 *
 * WHY A RECEIVER AND NOT A SERVICE
 *
 * A FirebaseMessagingService is chosen by the manifest merger, and declaring a
 * second one would displace @react-native-firebase/messaging's and cut JS off
 * from messages entirely. A broadcast receiver on the same action runs
 * alongside it: FCM broadcasts to every matching receiver in the package,
 * which is how the library's own ReactNativeFirebaseMessagingReceiver already
 * coexists with the SDK's. It also needs no JavaScript, so a notification
 * costs no React Native startup with the app closed.
 *
 * The logo is bundled (res/drawable-xxhdpi/ic_notification_large.png) rather
 * than fetched from a URL. FCM's `image` field would have given a large icon
 * for far less code, but every notification would then make the phone fetch a
 * known URL — a timestamped, per-IP record of when this user is paid, held by
 * whoever serves it. For a Silent Payments wallet that is the wrong trade, and
 * a bundled asset also works offline.
 */
class PaymentNotificationReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val extras = intent.extras ?: return
        try {
            // FCM puts each data key in at its own name, so no firebase class is
            // needed to read them — which keeps this receiver independent of the
            // messaging library's version.
            val type = extras.getString(KEY_TYPE) ?: return
            if (type != TYPE_PAYMENT && type != TYPE_SEND_CONFIRMED && type != TYPE_TEST) return

            // With the app open, PushBanner already shows this — and it shows the
            // logo at full size. Two announcements of one event is worse than
            // either alone.
            if (isAppInForeground(context)) return

            val title = extras.getString(KEY_TITLE) ?: DEFAULT_TITLE
            val body = extras.getString(KEY_BODY) ?: DEFAULT_BODY
            notify(context, type, title, body)
        } catch (e: Exception) {
            // A push must never crash the app. Losing the notification is the
            // lesser failure, and it is logged rather than swallowed silently.
            Log.w(TAG, "could not post the payment notification", e)
        }
    }

    private fun notify(context: Context, type: String, title: String, body: String) {
        ensureChannel(context)

        // Opens the app. No extras: which screen to land on is the app's
        // decision, and a notification is not the place to encode it.
        val launch = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = PendingIntent.getActivity(
            context,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(context, R.color.notification_accent))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)

        // The point of all this. decodeResource returns null if the asset is
        // missing or the device is out of memory; the notification is still
        // worth posting without it.
        BitmapFactory.decodeResource(context.resources, R.drawable.ic_notification_large)
            ?.let { builder.setLargeIcon(it) }

        try {
            // One id per type, so a second payment replaces an unread first
            // rather than stacking identical lines. The body names no amount and
            // no count, so there is nothing in the older one to lose.
            NotificationManagerCompat.from(context).notify(type.hashCode(), builder.build())
        } catch (e: SecurityException) {
            // Android 13+ without POST_NOTIFICATIONS. The server should not have
            // a token in that case (push.ts declines to register one), so this is
            // a permission revoked after the fact.
            Log.w(TAG, "notifications are not permitted", e)
        }
    }

    /**
     * The channel the user sees in system settings, and the only route to
     * heads-up display on API 26+. Created every time because creating an
     * existing channel is a no-op, and there is no earlier hook that is
     * guaranteed to have run when the app is not the one being started.
     */
    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Payments",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Incoming payments and send confirmations."
            // The notification carries no amount, but it does announce that
            // money moved — which is not for a lock screen in public.
            lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)
    }

    /**
     * Is this app's own process in the foreground? getRunningAppProcesses has
     * been restricted to the caller's own processes since API 21, which is all
     * this needs.
     *
     * This has to agree with SharedUtils.isAppInForeground in
     * @react-native-firebase, because that is what decides whether the library
     * emits the message to JS (PushBanner) or hands it to the headless task.
     * If the two ever disagreed the same way round, the app would show nothing
     * at all: the library would post a banner into a UI nobody is looking at
     * while this receiver stood down. Hence the same predicate it uses —
     * IMPORTANCE_FOREGROUND for this app's process — rather than something
     * cleverer. (Same process, too: nothing here declares android:process, so
     * its processName check and this pid check pick out the same process.)
     */
    private fun isAppInForeground(context: Context): Boolean {
        val manager =
            context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
        val processes = manager.runningAppProcesses ?: return false
        val pid = android.os.Process.myPid()
        return processes.any {
            it.pid == pid &&
                it.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
        }
    }

    companion object {
        private const val TAG = "PaymentNotification"
        private const val CHANNEL_ID = "payments"

        private const val KEY_TYPE = "type"
        private const val KEY_TITLE = "title"
        private const val KEY_BODY = "body"

        // Mirrors the `type` the backend sets (siLNt views_api.py).
        private const val TYPE_PAYMENT = "payment"
        private const val TYPE_SEND_CONFIRMED = "send_confirmed"
        private const val TYPE_TEST = "test"

        private const val DEFAULT_TITLE = "WhiSPa"
        private const val DEFAULT_BODY = "Open WhiSPa to view."
    }
}
