#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const appDir = path.resolve(path.dirname(__filename), "..");

const IOS_URL_TYPES = `
\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>com.planipret.mobile.oauth</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>planipret</string>
\t\t\t\t<string>capacitor</string>
\t\t\t</array>
\t\t</dict>
\t</array>
`;

const IOS_URL_TYPES_DICT = `
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>com.planipret.mobile.oauth</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>planipret</string>
\t\t\t\t<string>capacitor</string>
\t\t\t</array>
\t\t</dict>
`;

const ANDROID_INTENT_FILTERS = `
            <!-- Planiprêt OAuth deep links: Maestro + Microsoft mobile callbacks -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="planipret" android:host="auth" android:pathPrefix="/maestro/callback" />
            </intent-filter>

            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="capacitor" android:host="localhost" android:pathPrefix="/auth/microsoft/callback" />
                <data android:scheme="capacitor" android:host="localhost" android:pathPrefix="/auth/ms365/callback" />
            </intent-filter>
`;

const ANDROID_PERMISSIONS = [
  "android.permission.INTERNET",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.WAKE_LOCK",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.USE_FULL_SCREEN_INTENT",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.CHANGE_WIFI_STATE",
];

const ANDROID_SERVICE = `
        <service
            android:name=".PpSipKeepAliveService"
            android:foregroundServiceType="phoneCall"
            android:exported="false" />
`;

const ANDROID_PLUGIN = (pkg) => `package ${pkg}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "PpSipKeepAlive")
class PpSipKeepAlivePlugin : Plugin() {
    private var statusReceiver: BroadcastReceiver? = null
    private var reregisterReceiver: BroadcastReceiver? = null

    override fun load() {
        statusReceiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action != PpSipKeepAliveService.ACTION_STATUS) return
                notifyListeners("sipServiceStatus", statusFromIntent(intent), true)
            }
        }
        reregisterReceiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action != PpSipKeepAliveService.ACTION_REREGISTER) return
                notifyListeners("sipReregisterRequested", JSObject().put("reason", intent.getStringExtra("reason") ?: "native_keepalive"), true)
            }
        }
        try {
            val sf = IntentFilter(PpSipKeepAliveService.ACTION_STATUS)
            val rf = IntentFilter(PpSipKeepAliveService.ACTION_REREGISTER)
            val sr = statusReceiver ?: return
            val rr = reregisterReceiver ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(sr, sf, Context.RECEIVER_NOT_EXPORTED)
                context.registerReceiver(rr, rf, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("DEPRECATION") context.registerReceiver(sr, sf)
                @Suppress("DEPRECATION") context.registerReceiver(rr, rf)
            }
        } catch (_: Exception) {}
    }

    override fun handleOnDestroy() {
        try { statusReceiver?.let { context.unregisterReceiver(it) } } catch (_: Exception) {}
        try { reregisterReceiver?.let { context.unregisterReceiver(it) } } catch (_: Exception) {}
        statusReceiver = null
        reregisterReceiver = null
        super.handleOnDestroy()
    }

    @PluginMethod fun startSipService(call: PluginCall) {
        try {
            PpSipKeepAliveService.saveConfig(
                context,
                call.getString("host") ?: call.getString("domain") ?: "",
                call.getInt("port") ?: 443,
                call.getString("path") ?: "/",
                call.getString("login") ?: call.getString("username") ?: call.getString("extension") ?: "",
                call.getString("domain") ?: "",
                call.getString("displayName") ?: call.getString("extension") ?: ""
            )
            PpSipKeepAliveService.start(context)
            call.resolve(readStatus().apply { put("ok", true) })
        } catch (e: Exception) { call.reject(e.message ?: "startSipService failed") }
    }
    @PluginMethod fun stopSipService(call: PluginCall) { PpSipKeepAliveService.stop(context); call.resolve(JSObject().put("ok", true)) }
    @PluginMethod fun getSipServiceStatus(call: PluginCall) { call.resolve(readStatus().apply { put("ok", true) }) }
    @PluginMethod fun triggerReregister(call: PluginCall) { PpSipKeepAliveService.requestReregister(context, "manual"); call.resolve(readStatus().apply { put("ok", true) }) }
    @PluginMethod fun requestBatteryOptimizationExemption(call: PluginCall) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) { call.resolve(JSObject().put("ok", true).put("ignored", true).put("requested", false)); return }
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            val ignored = pm.isIgnoringBatteryOptimizations(context.packageName)
            if (!ignored) context.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply { data = Uri.parse("package:${context.packageName}"); addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) })
            call.resolve(JSObject().put("ok", true).put("ignored", ignored).put("requested", !ignored))
        } catch (e: Exception) { call.reject(e.message ?: "battery optimization request failed") }
    }
    private fun statusFromIntent(intent: Intent): JSObject = JSObject().apply {
        put("status", intent.getStringExtra("status") ?: "unknown"); put("reason", intent.getStringExtra("reason") ?: "")
        put("updatedAt", intent.getLongExtra("updatedAt", 0L)); put("wakeLockHeld", intent.getBooleanExtra("wakeLockHeld", false))
        put("wifiLockHeld", intent.getBooleanExtra("wifiLockHeld", false)); put("loggedIn", intent.getBooleanExtra("loggedIn", false))
    }
    private fun readStatus(): JSObject {
        val p = context.getSharedPreferences(PpSipKeepAliveService.PREFS_NAME, Context.MODE_PRIVATE)
        return JSObject().apply {
            put("status", p.getString(PpSipKeepAliveService.KEY_STATUS, "unknown") ?: "unknown"); put("reason", p.getString(PpSipKeepAliveService.KEY_REASON, "") ?: "")
            put("updatedAt", p.getLong(PpSipKeepAliveService.KEY_UPDATED_AT, 0L)); put("wakeLockHeld", p.getBoolean(PpSipKeepAliveService.KEY_WAKE_HELD, false))
            put("wifiLockHeld", p.getBoolean(PpSipKeepAliveService.KEY_WIFI_HELD, false)); put("loggedIn", p.getBoolean(PpSipKeepAliveService.KEY_LOGGED_IN, false))
        }
    }
}
`;

const ANDROID_SERVICE_KT = (pkg) => `package ${pkg}

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class PpSipKeepAliveService : Service() {
    companion object {
        const val CHANNEL_ID = "pp_sip_keepalive_channel"; const val NOTIFICATION_ID = 2201; const val PREFS_NAME = "pp_sip_keepalive"
        const val ACTION_STATUS = "com.planipret.mobile.PP_SIP_STATUS"; const val ACTION_REREGISTER = "com.planipret.mobile.PP_SIP_REREGISTER"
        const val KEY_STATUS = "status"; const val KEY_REASON = "reason"; const val KEY_UPDATED_AT = "updated_at"; const val KEY_WAKE_HELD = "wake_held"; const val KEY_WIFI_HELD = "wifi_held"; const val KEY_LOGGED_IN = "logged_in"
        fun start(context: Context) { val i = Intent(context, PpSipKeepAliveService::class.java); if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(i) else context.startService(i) }
        fun stop(context: Context) { context.stopService(Intent(context, PpSipKeepAliveService::class.java)) }
        fun saveConfig(context: Context, host: String, port: Int, path: String, login: String, domain: String, displayName: String) { context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().apply { putString("host", host); putInt("port", port); putString("path", path); putString("login", login); putString("domain", domain); putString("display_name", displayName); apply() } }
        fun requestReregister(context: Context, reason: String) { context.sendBroadcast(Intent(ACTION_REREGISTER).setPackage(context.packageName).putExtra("reason", reason)) }
    }
    private val executor = Executors.newSingleThreadScheduledExecutor(); private var heartbeat: ScheduledFuture<*>? = null
    private var wakeLock: PowerManager.WakeLock? = null; private var wifiLock: WifiManager.WifiLock? = null; private var connectivityManager: ConnectivityManager? = null; private var networkCallback: ConnectivityManager.NetworkCallback? = null
    override fun onCreate() { super.onCreate(); createNotificationChannel(); wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Planipret::SipWakeLock").apply { setReferenceCounted(false); acquire() }; wifiLock = (applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Planipret::SipWifiLock").apply { setReferenceCounted(false); acquire() }; registerNetworkWatchdog(); emitStatus("protected", "service_created") }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int { val n = buildNotification("Téléphonie prête en arrière-plan"); if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceCompat.startForeground(this, NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL) else startForeground(NOTIFICATION_ID, n); emitStatus("registered", "native_guard_active"); requestReregister(this, "service_start"); heartbeat?.cancel(false); heartbeat = executor.scheduleAtFixedRate({ emitStatus("registered", "keepalive"); requestReregister(this, "keepalive") }, 30, 240, TimeUnit.SECONDS); return START_STICKY }
    override fun onTaskRemoved(rootIntent: Intent?) { emitStatus("registered", "task_removed_keepalive"); requestReregister(this, "task_removed"); super.onTaskRemoved(rootIntent) }
    override fun onDestroy() { heartbeat?.cancel(true); unregisterNetworkWatchdog(); try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}; try { wifiLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}; executor.shutdownNow(); emitStatus("disconnected", "service_destroyed"); super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
    private fun registerNetworkWatchdog() { try { connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager; val req = NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(); val cb = object : ConnectivityManager.NetworkCallback() { override fun onAvailable(network: Network) { emitStatus("registered", "network_available"); requestReregister(this@PpSipKeepAliveService, "network_available") }; override fun onLost(network: Network) { emitStatus("reconnecting", "network_lost") } }; connectivityManager?.registerNetworkCallback(req, cb); networkCallback = cb } catch (_: Exception) {} }
    private fun unregisterNetworkWatchdog() { try { networkCallback?.let { connectivityManager?.unregisterNetworkCallback(it) } } catch (_: Exception) {}; networkCallback = null }
    private fun emitStatus(status: String, reason: String) { val now = System.currentTimeMillis(); val wake = wakeLock?.isHeld == true; val wifi = wifiLock?.isHeld == true; getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().apply { putString(KEY_STATUS, status); putString(KEY_REASON, reason); putLong(KEY_UPDATED_AT, now); putBoolean(KEY_WAKE_HELD, wake); putBoolean(KEY_WIFI_HELD, wifi); putBoolean(KEY_LOGGED_IN, status == "registered" || status == "protected"); apply() }; sendBroadcast(Intent(ACTION_STATUS).setPackage(packageName).putExtra("status", status).putExtra("reason", reason).putExtra("updatedAt", now).putExtra("wakeLockHeld", wake).putExtra("wifiLockHeld", wifi).putExtra("loggedIn", status == "registered" || status == "protected")) }
    private fun buildNotification(text: String): Notification = NotificationCompat.Builder(this, CHANNEL_ID).setContentTitle("Planiprêt Mobile").setContentText(text).setSmallIcon(android.R.drawable.ic_menu_call).setPriority(NotificationCompat.PRIORITY_LOW).setOngoing(true).setSilent(true).build()
    private fun createNotificationChannel() { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL_ID, "Connexion téléphonique", NotificationManager.IMPORTANCE_LOW).apply { description = "Maintien de l'enregistrement téléphonique en arrière-plan"; setShowBadge(false) }) }
}
`;

const IOS_PLUGIN = `import Foundation
import Capacitor
import UIKit

@objc(PpSipKeepAlive)
public class PpSipKeepAlive: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PpSipKeepAlive"; public let jsName = "PpSipKeepAlive"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "startSipService", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "stopSipService", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "getSipServiceStatus", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "triggerReregister", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "addListener", returnType: CAPPluginReturnCallback), CAPPluginMethod(name: "removeAllListeners", returnType: CAPPluginReturnPromise)]
    private var status = "idle"; private var reason = "plugin_loaded"; private var updatedAt = Date().timeIntervalSince1970 * 1000; private var bgTask: UIBackgroundTaskIdentifier = .invalid
    public override func load() { NotificationCenter.default.addObserver(self, selector: #selector(onBackground), name: UIApplication.didEnterBackgroundNotification, object: nil); NotificationCenter.default.addObserver(self, selector: #selector(onForeground), name: UIApplication.willEnterForegroundNotification, object: nil) }
    deinit { NotificationCenter.default.removeObserver(self) }
    @objc func startSipService(_ call: CAPPluginCall) { setStatus("registered", "native_guard_active"); call.resolve(snapshot(ok: true)) }
    @objc func stopSipService(_ call: CAPPluginCall) { endBackgroundTask(); setStatus("disconnected", "stopped"); call.resolve(snapshot(ok: true)) }
    @objc func getSipServiceStatus(_ call: CAPPluginCall) { call.resolve(snapshot(ok: true)) }
    @objc func triggerReregister(_ call: CAPPluginCall) { notifyListeners("sipReregisterRequested", data: ["reason": "manual"]); setStatus("registered", "reregister_requested"); call.resolve(snapshot(ok: true)) }
    @objc private func onBackground() { beginBackgroundTask(); notifyListeners("sipReregisterRequested", data: ["reason": "enter_background"]); setStatus("protected", "background_task_active") }
    @objc private func onForeground() { notifyListeners("sipReregisterRequested", data: ["reason": "enter_foreground"]); setStatus("registered", "foreground_refresh"); endBackgroundTask() }
    private func beginBackgroundTask() { if bgTask != .invalid { return }; bgTask = UIApplication.shared.beginBackgroundTask(withName: "PlanipretSIPKeepAlive") { [weak self] in self?.endBackgroundTask(); self?.setStatus("protected", "background_task_expired") }; DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in self?.notifyListeners("sipReregisterRequested", data: ["reason": "background_keepalive"]); self?.endBackgroundTask() } }
    private func endBackgroundTask() { if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask); bgTask = .invalid } }
    private func setStatus(_ next: String, _ nextReason: String) { status = next; reason = nextReason; updatedAt = Date().timeIntervalSince1970 * 1000; notifyListeners("sipServiceStatus", data: snapshot(ok: true)) }
    private func snapshot(ok: Bool) -> [String: Any] { ["ok": ok, "status": status, "reason": reason, "updatedAt": updatedAt, "backgroundTaskActive": bgTask != .invalid, "loggedIn": status == "registered" || status == "protected"] }
}
`;

function writeIfChanged(file, next) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (prev === next) return false;
  fs.writeFileSync(file, next);
  return true;
}

function patchIosInfoPlist() {
  const file = path.join(appDir, "ios", "App", "App", "Info.plist");
  if (!fs.existsSync(file)) {
    console.log("[native-config] iOS Info.plist not found — run npx cap add ios first.");
    return;
  }

  let xml = fs.readFileSync(file, "utf8");
  if (xml.includes("<string>planipret</string>") && xml.includes("<string>capacitor</string>")) {
    console.log("[native-config] iOS URL schemes already present.");
    return;
  }

  if (xml.includes("<key>CFBundleURLTypes</key>")) {
    xml = xml.replace(/(<key>CFBundleURLTypes<\/key>\s*<array>)/, `$1${IOS_URL_TYPES_DICT}`);
  } else {
    xml = xml.replace(/\n<\/dict>\s*\n<\/plist>\s*$/, `${IOS_URL_TYPES}\n</dict>\n</plist>\n`);
  }

  writeIfChanged(file, xml);
  console.log("[native-config] iOS URL schemes applied: planipret, capacitor.");
}

function patchAndroidManifest() {
  const file = path.join(appDir, "android", "app", "src", "main", "AndroidManifest.xml");
  if (!fs.existsSync(file)) {
    console.log("[native-config] AndroidManifest.xml not found — run npx cap add android first.");
    return;
  }

  let xml = fs.readFileSync(file, "utf8");
  const hasPlanipret = xml.includes('android:scheme="planipret"');
  const hasCapacitor = xml.includes('android:scheme="capacitor"') && xml.includes('android:host="localhost"');
  if (hasPlanipret && hasCapacitor) {
    console.log("[native-config] Android deep links already present.");
    return;
  }

  const mainActivityClose = /\n\s*<\/activity>/;
  if (!mainActivityClose.test(xml)) {
    console.warn("[native-config] Android MainActivity close tag not found; skipped.");
    return;
  }

  xml = xml.replace(mainActivityClose, `${ANDROID_INTENT_FILTERS}\n        </activity>`);
  writeIfChanged(file, xml);
  console.log("[native-config] Android deep links applied: planipret, capacitor://localhost.");
}

patchIosInfoPlist();
patchAndroidManifest();