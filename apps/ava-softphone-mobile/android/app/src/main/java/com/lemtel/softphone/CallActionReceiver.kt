package com.lemtel.softphone

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Receives notification action button taps (Answer / Decline / Hold / Resume)
 * from both the incoming-call notification and the ongoing-call notification.
 *
 * Rebroadcasts the action as an internal intent that CapacitorPjsip listens
 * to. The plugin then relays it to the JS layer as a `sipCallAction` event.
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

        // If the app is answering, bring it to foreground so the UI can take
        // over (mic permission prompts, active-call sheet, audio routing).
        if (action == "answer") {
            val launch = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra("incoming_call_action", "answer")
            }
            try { context.startActivity(launch) } catch (_: Exception) {}
        }

        // Rebroadcast internally so CapacitorPjsip's receiver picks it up
        // and forwards to the JS bridge.
        context.sendBroadcast(
            Intent(ACTION_CALL_ACTION_EVENT)
                .setPackage(context.packageName)
                .putExtra(EXTRA_ACTION, action)
        )
    }
}
