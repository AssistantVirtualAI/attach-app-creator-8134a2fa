package com.lemtel.softphone

import android.content.Intent
import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(CapacitorPjsip::class.java)
        super.onCreate(savedInstanceState)
        handleIncomingCallIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIncomingCallIntent(intent)
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
