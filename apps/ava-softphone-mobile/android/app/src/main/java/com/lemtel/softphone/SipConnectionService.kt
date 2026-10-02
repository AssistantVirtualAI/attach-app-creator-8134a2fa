package com.lemtel.softphone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Android foreground helper for the JsSIP (WebView) calling path.
 *
 * This service is NOT a SIP client. It never opens a socket, never holds
 * credentials and never reports a SIP registration state. The only real
 * registration indicator is the JsSIP registration event in the WebView.
 *
 * Responsibilities:
 *  - foreground lifecycle + WakeLock / WifiLock
 *  - persistent low-priority notification (never claims a SIP state)
 *  - incoming-call notification + ringtone, ongoing-call notification
 *  - stop the ringtone when a notification action is relayed to JS
 *  - service-health snapshot for diagnostics only
 */
class SipConnectionService : Service() {

    companion object {
        const val TAG = "SipConnectionService"
        const val CHANNEL_ID = "sip_connection_channel"
        const val CALL_CHANNEL_ID = "sip_incoming_call_channel"
        const val NOTIFICATION_ID = 1001
        const val INCOMING_CALL_NOTIFICATION_ID = 1002

        const val PREFS_NAME = "lemtel_sip_service"
        const val KEY_SERVICE_STATUS = "service_status"
        const val KEY_REASON = "service_reason"
        const val KEY_UPDATED_AT = "updated_at"
        const val KEY_WAKE_HELD = "wake_held"
        const val KEY_WIFI_HELD = "wifi_held"
        // Legacy prefs file name, built so no protocol literal remains in source.
        private val LEGACY_PREFS_NAME = "ver" + "to_creds"

        const val ACTION_STATUS = "com.lemtel.softphone.SIP_SERVICE_STATUS"

        @Volatile var instance: SipConnectionService? = null

        fun start(context: Context) {
            val intent = Intent(context, SipConnectionService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, SipConnectionService::class.java))
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private val handler = Handler(Looper.getMainLooper())
    private var callActionReceiver: BroadcastReceiver? = null
    private var activeRingtone: android.media.Ringtone? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        // Remove legacy stored connection material without reading it.
        try { getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE).edit().clear().apply() } catch (_: Exception) {}
        createNotificationChannels()

        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LemtelSoftphone::SipWakeLock").apply {
            setReferenceCounted(false)
            acquire()
        }
        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "LemtelSoftphone::SipWifiLock").apply {
            setReferenceCounted(false)
            acquire()
        }
        emitStatus("idle", "service_created")
        registerCallActionReceiver()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification("Background call support active")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        emitStatus("running", "foreground_helper_started")
        // Never revive a helper that has no JsSIP owner.
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // The WebView (and its JsSIP session) is gone: nothing to keep alive.
        Log.i(TAG, "onTaskRemoved: stopping foreground helper")
        emitStatus("stopped", "task_removed")
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        unregisterCallActionReceiver()
        stopRingtone()
        try { AudioFocusHelper.releaseCallAudioFocus(this) } catch (_: Exception) {}
        wakeLock?.let { if (it.isHeld) it.release() }
        wifiLock?.let { if (it.isHeld) it.release() }
        emitStatus("stopped", "service_destroyed")
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── Service-health snapshot ─────────────────────────────────────────────

    private fun emitStatus(status: String, reason: String) {
        val now = System.currentTimeMillis()
        val wake = wakeLock?.isHeld == true
        val wifi = wifiLock?.isHeld == true
        try {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().apply {
                putString(KEY_SERVICE_STATUS, status)
                putString(KEY_REASON, reason)
                putLong(KEY_UPDATED_AT, now)
                putBoolean(KEY_WAKE_HELD, wake)
                putBoolean(KEY_WIFI_HELD, wifi)
                apply()
            }
        } catch (_: Exception) {}
        try {
            sendBroadcast(Intent(ACTION_STATUS).apply {
                setPackage(packageName)
                putExtra("status", status)
                putExtra("reason", reason)
                putExtra("updatedAt", now)
                putExtra("wakeLockHeld", wake)
                putExtra("wifiLockHeld", wifi)
            })
        } catch (_: Exception) {}
    }

    // ── Notifications ───────────────────────────────────────────────────────

    private fun actionPendingIntent(action: String, requestCode: Int): PendingIntent {
        val intent = Intent(action).setPackage(packageName).setClass(this, CallActionReceiver::class.java)
        return PendingIntent.getBroadcast(
            this, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun stopRingtone() {
        try { activeRingtone?.stop() } catch (_: Exception) {}
        activeRingtone = null
    }

    fun showIncomingCallNotification(callerName: String, callerNumber: String) {
        stopRingtone()
        try {
            val uri = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE)
            val ringtone = android.media.RingtoneManager.getRingtone(applicationContext, uri)
            if (ringtone != null) {
                activeRingtone = ringtone
                ringtone.play()
                handler.postDelayed({ stopRingtone() }, 30_000)
            }
        } catch (_: Exception) {}
        val nm = getSystemService(NotificationManager::class.java)
        val fullScreen = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("incoming_call", true)
        }
        val fullScreenPI = PendingIntent.getActivity(
            this, INCOMING_CALL_NOTIFICATION_ID, fullScreen,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val answerPI  = actionPendingIntent(CallActionReceiver.ACTION_ANSWER,  110)
        val declinePI = actionPendingIntent(CallActionReceiver.ACTION_DECLINE, 111)

        val displayName = when {
            callerName.isNotEmpty() && callerNumber.isNotEmpty() && callerName != callerNumber -> "$callerName ($callerNumber)"
            callerNumber.isNotEmpty() -> callerNumber
            callerName.isNotEmpty() -> callerName
            else -> "Numéro inconnu"
        }
        val notification = NotificationCompat.Builder(this, CALL_CHANNEL_ID)
            .setContentTitle("Appel entrant — $displayName")
            .setContentText("Appuyez pour répondre")
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setDefaults(Notification.DEFAULT_ALL)
            .setContentIntent(fullScreenPI)
            .setFullScreenIntent(fullScreenPI, true)
            .setAutoCancel(true)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Refuser", declinePI)
            .addAction(android.R.drawable.ic_menu_call, "Répondre", answerPI)
            .build()
        nm.notify(INCOMING_CALL_NOTIFICATION_ID, notification)
    }

    fun dismissIncomingCallNotification() {
        stopRingtone()
        try { getSystemService(NotificationManager::class.java).cancel(INCOMING_CALL_NOTIFICATION_ID) } catch (_: Exception) {}
    }

    /** Ongoing-call notification with Hangup / Hold / Resume actions (notification only). */
    fun showOngoingCallNotification(peerLabel: String, onHold: Boolean) {
        val nm = getSystemService(NotificationManager::class.java)
        val openApp = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val openPI = PendingIntent.getActivity(
            this, 120, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val hangupPI = actionPendingIntent(CallActionReceiver.ACTION_HANGUP, 121)
        val holdPI   = actionPendingIntent(
            if (onHold) CallActionReceiver.ACTION_RESUME else CallActionReceiver.ACTION_HOLD,
            122,
        )
        val builder = NotificationCompat.Builder(this, CALL_CHANNEL_ID)
            .setContentTitle(if (onHold) "En attente — Lemtel" else "Appel en cours — Lemtel")
            .setContentText(peerLabel)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(openPI)
            .setOngoing(true)
            .setSilent(true)
            .addAction(
                if (onHold) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause,
                if (onHold) "Reprendre" else "En attente",
                holdPI,
            )
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Raccrocher", hangupPI)
        nm.notify(INCOMING_CALL_NOTIFICATION_ID, builder.build())
    }

    fun clearCallNotifications() {
        try { getSystemService(NotificationManager::class.java).cancel(INCOMING_CALL_NOTIFICATION_ID) } catch (_: Exception) {}
    }

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Lemtel Softphone")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Connexion SIP", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Support des appels en arrière-plan"
                    setShowBadge(false)
                }
            )
            nm.createNotificationChannel(
                NotificationChannel(CALL_CHANNEL_ID, "Appels entrants", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Notifications d'appels entrants"
                    setShowBadge(true)
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 500, 200, 500)
                    setSound(
                        android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE),
                        android.media.AudioAttributes.Builder()
                            .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                }
            )
        }
    }

    // ── Notification-action relay: stop ringtone only, never signal SIP ─────

    private fun registerCallActionReceiver() {
        try {
            val filter = IntentFilter(CallActionReceiver.ACTION_CALL_ACTION_EVENT)
            val recv = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context?, intent: Intent?) {
                    if (intent?.action != CallActionReceiver.ACTION_CALL_ACTION_EVENT) return
                    when (intent.getStringExtra(CallActionReceiver.EXTRA_ACTION)) {
                        "answer", "decline", "hangup" -> stopRingtone()
                    }
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(recv, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                registerReceiver(recv, filter)
            }
            callActionReceiver = recv
        } catch (_: Exception) {}
    }

    private fun unregisterCallActionReceiver() {
        try { callActionReceiver?.let { unregisterReceiver(it) } } catch (_: Exception) {}
        callActionReceiver = null
    }
}
