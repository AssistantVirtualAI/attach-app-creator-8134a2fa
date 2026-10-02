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
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        enableOverLockscreen()
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
}
