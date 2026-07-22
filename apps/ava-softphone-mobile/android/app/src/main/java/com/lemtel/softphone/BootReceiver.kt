package com.lemtel.softphone

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Restarts the SIP foreground service after a device reboot so the app
 * stays registered and can receive incoming calls even if the user hasn't
 * opened the app since the last boot.
 *
 * Requires RECEIVE_BOOT_COMPLETED permission (already declared in
 * AndroidManifest.xml) and the receiver to be registered in the manifest.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.QUICKBOOT_POWERON"
        ) {
            // Re-start the foreground service so the WebSocket reconnects
            // automatically. The JS layer will re-register with Verto once
            // the WebView is ready.
            SipConnectionService.start(context)
        }
    }
}
