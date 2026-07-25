package com.lemtel.softphone

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Receives notification action button taps (Answer / Decline / Hold / Resume)
 * from both the incoming-call notification and the ongoing-call notification.
 *
 * For ANSWER: the service handles the answer natively (no JS bridge needed).
 * For DECLINE/HANGUP: the service handles the hangup natively.
 * For HOLD/RESUME/MUTE: relay to JS via CapacitorPjsip.
 */
class CallActionReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "CallActionReceiver"

        const val ACTION_ANSWER  = "com.lemtel.softphone.CALL_ANSWER"
        const val ACTION_DECLINE = "com.lemtel.softphone.CALL_DECLINE"
        const val ACTION_HANGUP  = "com.lemtel.softphone.CALL_HANGUP"
        const val ACTION_HOLD    = "com.lemtel.softphone.CALL_HOLD"
        const val ACTION_RESUME  = "com.lemtel.softphone.CALL_RESUME"
        const val ACTION_MUTE    = "com.lemtel.softphone.CALL_MUTE"

        /** Internal broadcast picked up by CapacitorPjsip and relayed to JS. */
        const val ACTION_CALL_ACTION_EVENT = "com.lemtel.softphone.CALL_ACTION_EVENT"
        const val EXTRA_ACTION = "action"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = when (intent.action) {
            ACTION_ANSWER  -> "answer"
            ACTION_DECLINE -> "decline"
            ACTION_HANGUP  -> "hangup"
            ACTION_HOLD    -> "hold"
            ACTION_RESUME  -> "resume"
            ACTION_MUTE    -> "mute"
            else -> return
        }
        Log.i(TAG, "Notification action tapped: $action")

        when (action) {
            "answer" -> {
                // Step 1: Bring the app to foreground so the UI can show the call screen.
                val launch = Intent(context, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    putExtra("incoming_call_action", "answer")
                }
                try { context.startActivity(launch) } catch (_: Exception) {}

                // Step 2: Tell SipConnectionService to answer natively (no JS needed).
                // This is the primary answer path — it sends verto.answer directly
                // from the native WebSocket without going through the JS bridge.
                // The JS bridge path is kept as a secondary fallback via sipCallAction.
                context.sendBroadcast(
                    Intent(SipConnectionService.ACTION_NATIVE_ANSWER_REQUEST)
                        .setPackage(context.packageName)
                )

                // Step 3: Also relay to JS after a delay in case the JS Verto client
                // is connected and wants to do its own WebRTC negotiation.
                Handler(Looper.getMainLooper()).postDelayed({
                    context.sendBroadcast(
                        Intent(ACTION_CALL_ACTION_EVENT)
                            .setPackage(context.packageName)
                            .putExtra(EXTRA_ACTION, action)
                    )
                }, 1500)
            }

            "decline", "hangup" -> {
                // Tell the service to hang up natively (no JS needed).
                context.sendBroadcast(
                    Intent(SipConnectionService.ACTION_NATIVE_VERTO_HANGUP)
                        .setPackage(context.packageName)
                )
                // Also relay to JS for UI cleanup.
                context.sendBroadcast(
                    Intent(ACTION_CALL_ACTION_EVENT)
                        .setPackage(context.packageName)
                        .putExtra(EXTRA_ACTION, action)
                )
            }

            else -> {
                // Hold, resume, mute — relay to JS via CapacitorPjsip.
                context.sendBroadcast(
                    Intent(ACTION_CALL_ACTION_EVENT)
                        .setPackage(context.packageName)
                        .putExtra(EXTRA_ACTION, action)
                )
            }
        }
    }
}
