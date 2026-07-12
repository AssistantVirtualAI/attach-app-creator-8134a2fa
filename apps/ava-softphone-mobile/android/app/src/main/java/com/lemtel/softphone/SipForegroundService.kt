package com.lemtel.softphone

/**
 * Copy this file to android/app/src/main/java/com/lemtel/softphone/SipForegroundService.kt
 * after `npx cap add android`. Also merge the matching <service> declaration
 * from native-config/android-AndroidManifest.snippet.xml into AndroidManifest.xml.
 *
 * Required on Android 14+ (API 34) so that the microphone stays accessible
 * while a SIP call runs in the background. The service must be started with
 * ServiceCompat.startForeground(..., FOREGROUND_SERVICE_TYPE_MICROPHONE
 * | FOREGROUND_SERVICE_TYPE_PHONE_CALL) BEFORE PJSIP grabs the audio device.
 */
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

class SipForegroundService : Service() {

    // WifiLock : empêche Android de couper la radio Wi-Fi écran éteint
    private var wifiLock: WifiManager.WifiLock? = null
    // WakeLock : maintient le CPU actif pour les timers JsSIP (keep-alive, re-REGISTER)
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(NotificationManager::class.java)
            val ch = NotificationChannel(
                CHANNEL_ID,
                "Active call",
                NotificationManager.IMPORTANCE_LOW,
            )
            ch.description = "Shown while a Lemtel call is ongoing"
            mgr?.createNotificationChannel(ch)
        }

        // Initialiser WifiLock (WIFI_MODE_FULL_HIGH_PERF = maintien radio Wi-Fi)
        val wifiMgr = applicationContext.getSystemService(WIFI_SERVICE) as? WifiManager
        wifiLock = wifiMgr?.createWifiLock(
            WifiManager.WIFI_MODE_FULL_HIGH_PERF,
            "lemtel:sip_wifi_lock"
        )
        wifiLock?.setReferenceCounted(false)

        // Initialiser WakeLock (PARTIAL_WAKE_LOCK = CPU actif, écran peut s'éteindre)
        val powerMgr = getSystemService(POWER_SERVICE) as? PowerManager
        wakeLock = powerMgr?.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "lemtel:sip_wake_lock"
        )
        wakeLock?.setReferenceCounted(false)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Lemtel Softphone")
            .setContentText("Active call in progress")
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(
                this,
                NOTIF_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL,
            )
        } else {
            startForeground(NOTIF_ID, notification)
        }
        // Acquérir les locks après startForeground pour maintenir CPU + Wi-Fi actifs
        if (wifiLock?.isHeld == false) wifiLock?.acquire()
        if (wakeLock?.isHeld == false) wakeLock?.acquire()

        return START_STICKY
    }

    override fun onDestroy() {
        // Libérer les locks proprement à la destruction du service
        try { if (wifiLock?.isHeld == true) wifiLock?.release() } catch (_: Exception) {}
        try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_ID = "lemtel_active_call"
        private const val NOTIF_ID = 4711
    }
}
