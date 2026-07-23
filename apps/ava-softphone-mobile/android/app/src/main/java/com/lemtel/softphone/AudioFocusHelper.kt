package com.lemtel.softphone

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build

/**
 * Shared audio-focus helper used by both CapacitorPjsip (WebView-driven calls)
 * and SipConnectionService (native background/lockscreen ringing + answer).
 *
 * Without an AudioFocusRequest on Android 8+ the system can steal the voice
 * stream mid-call (e.g. incoming notification) and future calls start silent.
 */
object AudioFocusHelper {

    private var audioFocusRequest: AudioFocusRequest? = null
    private var previousMode: Int = AudioManager.MODE_NORMAL
    private var held: Boolean = false

    @Synchronized
    fun requestCallAudioFocus(context: Context): Boolean {
        val am = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            ?: return false
        if (!held) previousMode = am.mode
        val result: Int = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attrs)
                .setAcceptsDelayedFocusGain(false)
                .setWillPauseWhenDucked(false)
                .build()
            audioFocusRequest = req
            am.requestAudioFocus(req)
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        }
        am.mode = AudioManager.MODE_IN_COMMUNICATION
        am.isSpeakerphoneOn = false
        held = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        return held
    }

    @Synchronized
    fun releaseCallAudioFocus(context: Context) {
        val am = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            ?: return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioFocusRequest?.let { am.abandonAudioFocusRequest(it) }
            } else {
                @Suppress("DEPRECATION")
                am.abandonAudioFocus(null)
            }
        } catch (_: Exception) {}
        audioFocusRequest = null
        try { am.mode = AudioManager.MODE_NORMAL } catch (_: Exception) {}
        try { am.isSpeakerphoneOn = false } catch (_: Exception) {}
        held = false
    }

    fun isHeld(): Boolean = held
}
