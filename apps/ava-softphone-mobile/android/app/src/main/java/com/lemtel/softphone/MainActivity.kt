package com.lemtel.softphone

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(CapacitorPjsip::class.java)
        super.onCreate(savedInstanceState)
        enableOverLockscreen()
        handleIncomingCallIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        enableOverLockscreen()
        handleIncomingCallIntent(intent)
    }

    /**
     * Allow the activity to show over the lockscreen and turn the screen on
     * when an incoming call notification launches it as a full-screen intent.
     * Required on Android 8.1+ (API 27+) to replace the deprecated window flags.
     */
    private fun enableOverLockscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }
    }

    /**
     * When the Activity is launched (or brought to front) from an incoming-call
     * notification / full-screen intent, ask SipConnectionService to re-broadcast
     * the current invite so the JS side gets the Answer button even if it
     * mounted after the original `verto.invite` was processed.
     */
    private fun handleIncomingCallIntent(intent: Intent?) {
        val fromCall = intent?.getBooleanExtra("incoming_call", false) == true ||
            intent?.getStringExtra("incoming_call_action") != null
        if (fromCall) {
            SipConnectionService.instance?.reEmitIncomingStatus()
        }
    }
}
