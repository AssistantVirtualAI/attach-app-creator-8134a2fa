package com.lemtel.softphone

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(CapacitorPjsip::class.java)
        super.onCreate(savedInstanceState)
    }
}
