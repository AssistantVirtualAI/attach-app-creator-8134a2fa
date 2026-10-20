package com.lemtel.softphone

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.capacitorjs.plugins.pushnotifications.MessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

/**
 * Lemtel call notifications (phase 3.3). Replaces the Capacitor push service so ONE FCM receiver handles both:
 *  - data message type=incoming_call (HIGH priority, sent by lemtel-push-notify while the Lemtel SIP edge holds the
 *    INVITE): starts the phone-call foreground service, rings with a full-screen incoming-call notification and leaves
 *    the call for the JS layer, which re-registers SIP so the held INVITE reaches this device;
 *  - everything else: unchanged Capacitor behaviour (super).
 * Nothing secret is in the push: caller label/number, a call reference and an expiry.
 */
class LemtelPushService : MessagingService() {

    companion object {
        const val TAG = "LemtelPushService"
        const val ACTION_PUSH_INCOMING = "com.lemtel.softphone.PUSH_INCOMING_CALL"
        const val EXTRA_CALLER_NAME = "callerName"
        const val EXTRA_CALLER_NUMBER = "callerNumber"
        // Capacitor Preferences storage (read by consumePendingIncomingPush in src/lib/lemtelCallPush.ts).
        private const val CAPACITOR_PREFS = "CapacitorStorage"
        private const val PENDING_KEY = "lemtel.pendingIncomingPush"
        private val REF_RE = Regex("^[A-Za-z0-9@._-]{1,128}$")

        fun clean(value: String?, max: Int, allowed: Regex): String =
            (value ?: "").filter { allowed.matches(it.toString()) }.take(max)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data["type"] != "incoming_call") { super.onMessageReceived(message); return }
        val callRef = data["callRef"] ?: ""
        val expiresAt = data["expiresAt"]?.toLongOrNull() ?: 0L
        if (!REF_RE.matches(callRef) || expiresAt < System.currentTimeMillis()) {
            Log.i(TAG, "incoming_call push ignored (invalid or expired)")
            return
        }
        val number = clean(data["fromNumber"], 32, Regex("[0-9+*#]"))
        val name = (data["fromName"] ?: "").filter { it >= ' ' && it != '<' && it != '>' && it != '"' }.take(64)
        val pending = JSONObject().put("callRef", callRef).put("fromNumber", number).put("fromName", name).put("expiresAt", expiresAt)
        getSharedPreferences(CAPACITOR_PREFS, Context.MODE_PRIVATE).edit().putString(PENDING_KEY, pending.toString()).apply()
        val intent = Intent(this, SipConnectionService::class.java).apply {
            action = ACTION_PUSH_INCOMING
            putExtra(EXTRA_CALLER_NAME, name)
            putExtra(EXTRA_CALLER_NUMBER, number)
        }
        try {
            // A HIGH-priority FCM message grants a short window to start a foreground service (phoneCall type).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
        } catch (e: Exception) {
            Log.w(TAG, "could not start the call service from push: ${e.javaClass.simpleName}")
        }
    }
}
