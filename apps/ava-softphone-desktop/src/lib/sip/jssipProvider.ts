import * as JsSIP from 'jssip';

// ============================================================
// Runtime toggle — persisted across sessions via localStorage.
// Default ON to keep current FusionPBX 488 mitigation behavior.
// ============================================================
const SDP_TOGGLE_KEY = 'lemtel.sdpWorkaround';
const ATTEMPT_LOG_KEY = 'lemtel.sipAttemptLog';
const ATTEMPT_LOG_MAX = 20;

export function isSdpWorkaroundEnabled(): boolean {
  try {
    const v = localStorage.getItem(SDP_TOGGLE_KEY);
    return v === null ? true : v === '1';
  } catch { return true; }
}
export function setSdpWorkaroundEnabled(on: boolean) {
  try { localStorage.setItem(SDP_TOGGLE_KEY, on ? '1' : '0'); } catch { /* noop */ }
}

// ============================================================
// SDP rewriter — forces audio-only PCMU/PCMA, plain RTP (no DTLS/SRTP)
// to fix FusionPBX 488 Not Acceptable Here on WebRTC offers.
// ============================================================
function rewriteSdpForFusionPBX(sdp: string): string {
  let out = sdp;
  out = out.replace(/m=video[\s\S]*?(?=\r\nm=|$)/g, '');
  out = out.replace(/m=audio (\d+) [A-Z\/]+ [^\r\n]+/g, 'm=audio $1 RTP/AVP 0 8 101');
  out = out.replace(/^a=fingerprint:.*$/gm, '');
  out = out.replace(/^a=setup:.*$/gm, '');
  out = out.replace(/^a=dtls[-a-z]*:.*$/gm, '');
  out = out.replace(/^a=crypto:.*$/gm, '');
  out = out.replace(/^a=ice-options:.*$/gm, '');
  out = out.replace(/^a=rtpmap:(\d+) [^\r\n]+$/gm, (line, pt) =>
    (pt === '0' || pt === '8' || pt === '101') ? line : ''
  );
  out = out.replace(/^a=fmtp:(\d+) [^\r\n]+$/gm, (line, pt) =>
    pt === '0' ? line : ''
  );
  out = out.replace(/^a=rtcp-fb:.*$/gm, '');
  out = out.replace(/^a=extmap:.*$/gm, '');
  out = out.replace(/\r?\n\r?\n+/g, '\r\n');
  return out;
}

// Track last seen SDP across the modifier (per call attempt).
let _lastSdpBefore: string | null = null;
let _lastSdpAfter: string | null = null;

const sdpModifier = (description: any) => {
  if (description?.sdp) {
    try {
      _lastSdpBefore = description.sdp;
      // eslint-disable-next-line no-console
      console.log('[SIP][SDP][BEFORE]\n' + description.sdp);
      if (isSdpWorkaroundEnabled()) {
        description.sdp = rewriteSdpForFusionPBX(description.sdp);
      } else {
        // eslint-disable-next-line no-console
        console.warn('[SIP][SDP] workaround DISABLED — sending native WebRTC SDP');
      }
      _lastSdpAfter = description.sdp;
      // eslint-disable-next-line no-console
      console.log('[SIP][SDP][AFTER]\n' + description.sdp);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[SIP][SDP] rewrite error', e);
    }
  }
  return Promise.resolve(description);
};

// ============================================================
// Failure classification & troubleshooting hints
// ============================================================
export type FailureCategory =
  | 'sdp_488'
  | 'auth'
  | 'not_found'
  | 'busy'
  | 'timeout'
  | 'network'
  | 'rejected'
  | 'other';

export interface ClassifiedFailure {
  category: FailureCategory;
  title: string;
  hint: string;
}

export function classifySipFailure(code: number | undefined, reason: string, cause: string): ClassifiedFailure {
  const r = (reason || '').toLowerCase();
  const c = (cause || '').toLowerCase();
  if (code === 488 || /not acceptable/.test(r)) {
    return {
      category: 'sdp_488',
      title: '488 Not Acceptable — codec/SDP rejected by PBX',
      hint: isSdpWorkaroundEnabled()
        ? 'The PBX still refused the offer with the PCMU/PCMA workaround. Ask your PBX admin to enable PCMU/PCMA on the internal SIP profile and disable rtp_secure_media for this domain.'
        : 'Enable the "SDP/codec workaround" in Settings → Diagnostics to force PCMU/PCMA and disable DTLS/SRTP.',
    };
  }
  if (code === 401 || code === 403 || code === 407 || /auth/.test(r) || /unauthor/.test(r)) {
    return { category: 'auth', title: `${code || ''} Authentication failed`.trim(), hint: 'Check the SIP extension and password. Re-sign-in if the issue persists.' };
  }
  if (code === 404 || /not found/.test(r)) {
    return { category: 'not_found', title: '404 Not Found', hint: 'The dialed number or extension does not exist on this PBX.' };
  }
  if (code === 486 || code === 600 || /busy/.test(r)) {
    return { category: 'busy', title: `${code} Busy here`.trim(), hint: 'The remote party is busy. Try again later.' };
  }
  if (code === 408 || /timeout/.test(r) || /timeout/.test(c) || /request timeout/.test(c)) {
    return { category: 'timeout', title: 'Request timeout', hint: 'No response from PBX. Verify WSS connectivity and that your network is not blocking SIP/RTP.' };
  }
  if (/connection|network|transport/.test(c)) {
    return { category: 'network', title: 'Network / transport error', hint: 'WebSocket lost or unreachable. Click Retry, or run Test WSS in Diagnostics.' };
  }
  if (code && code >= 400 && code < 700) {
    return { category: 'rejected', title: `${code} ${reason || 'Call rejected'}`.trim(), hint: 'The PBX rejected the call. Check dialplan permissions for this extension.' };
  }
  return { category: 'other', title: cause || reason || 'Call failed', hint: 'See diagnostics for details. Download the debug report to share with support.' };
}

// ============================================================
// Rolling per-attempt debug log (persisted to localStorage)
// ============================================================
export interface SipAttempt {
  id: string;
  at: number;
  target: string;
  direction: 'in' | 'out';
  sdpBefore: string | null;
  sdpAfter: string | null;
  workaroundOn: boolean;
  responseCode?: number;
  responseReason?: string;
  responseBody?: string;
  category?: FailureCategory;
  hint?: string;
  outcome: 'pending' | 'connected' | 'failed' | 'ended';
}

function loadAttemptLog(): SipAttempt[] {
  try {
    const raw = localStorage.getItem(ATTEMPT_LOG_KEY);
    return raw ? (JSON.parse(raw) as SipAttempt[]) : [];
  } catch { return []; }
}
function saveAttemptLog(log: SipAttempt[]) {
  try { localStorage.setItem(ATTEMPT_LOG_KEY, JSON.stringify(log.slice(-ATTEMPT_LOG_MAX))); } catch { /* noop */ }
}

// Activate JsSIP debug logging
try {
  (JsSIP as any).debug.enable('JsSIP:*');
} catch(e) {}

const JSSIP_MODULE_INFO = (() => {
  try {
    const keys = JsSIP ? Object.keys(JsSIP as any) : [];
    return {
      loaded: !!(JsSIP && (JsSIP as any).UA),
      version: (JsSIP as any)?.version || (JsSIP as any)?.default?.version || 'unknown',
      exports: keys.slice(0, 20),
      source: 'npm:jssip',
    };
  } catch (e: any) {
    return { loaded: false, version: 'unknown', exports: [], source: 'npm:jssip', error: String(e?.message || e) };
  }
})();

const pcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  sdpSemantics: 'unified-plan' as any,
  iceTransportPolicy: 'all' as RTCIceTransportPolicy,
};

const sessionDescriptionHandlerOptions = {
  peerConnectionOptions: {
    rtcConfiguration: pcConfig,
  },
  constraints: {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  },
  offerOptions: {
    offerToReceiveAudio: true,
    offerToReceiveVideo: false,
  },
};

// JsSIP UA lifecycle manager — desktop softphone.
// Mirrors the web app provider with extras: attended transfer, audio device pinning.

export type SipStatus =
  | 'idle' | 'connecting' | 'connected' | 'registered'
  | 'disconnected' | 'error';

export type CallState =
  | 'idle' | 'ringing-out' | 'ringing-in'
  | 'active' | 'held' | 'ended';

export interface SipEvent {
  at: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface AuthBlock {
  code: number;
  reason: string;
  since: number;
}

export interface SoftphoneSnapshot {
  status: SipStatus;
  callState: CallState;
  remoteIdentity: string;
  remoteNumber: string;
  errorCause?: string;
  muted: boolean;
  onHold: boolean;
  direction: 'in' | 'out' | null;
  startedAt: number | null;
  events: SipEvent[];
  authBlocked?: AuthBlock | null;
}

export interface SoftphoneConfig {
  extension: string;
  displayName: string;
  sipDomain: string;
  wssUrl: string;
  wssUrls?: string[];
  password: string;
  authUsername?: string;
  mock?: boolean;
}

type Listener = (snap: SoftphoneSnapshot) => void;

class JsSipProvider {
  private ua: any = null;
  private session: any = null;
  private secondSession: any = null; // attended transfer hold-buffer
  private config: SoftphoneConfig | null = null;
  private listeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Keep-alive + silent reconnect bookkeeping
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private statusGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStableStatus: SipStatus = 'idle';
  private windowListenersBound = false;
  private onOnline = () => this.kickReconnect('network online');
  private onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.kickReconnect('tab visible');
    }
  };
  private snap: SoftphoneSnapshot = {
    status: 'idle',
    callState: 'idle',
    remoteIdentity: '',
    remoteNumber: '',
    muted: false,
    onHold: false,
    direction: null,
    startedAt: null,
    events: [],
    authBlocked: null,
  };
  audioEl: HTMLAudioElement | null = null;
  outputDeviceId: string | null = null;
  inputDeviceId: string | null = null;
  boundOutputLabel: string = 'System default';
  boundInputLabel: string = 'System default';
  private wssAttempted: string[] = [];
  private lastCallError: string | null = null;
  private currentAttempt: SipAttempt | null = null;
  private attemptLog: SipAttempt[] = loadAttemptLog();
  private lastFailure: ClassifiedFailure | null = null;

  getLastFailure() { return this.lastFailure; }
  getCurrentAttempt() { return this.currentAttempt; }
  getAttemptLog() { return [...this.attemptLog]; }
  clearAttemptLog() { this.attemptLog = []; saveAttemptLog(this.attemptLog); }
  getLastSdp() { return { before: _lastSdpBefore, after: _lastSdpAfter }; }

  private pushAttempt(a: SipAttempt) {
    this.attemptLog = [...this.attemptLog, a].slice(-ATTEMPT_LOG_MAX);
    saveAttemptLog(this.attemptLog);
  }
  private patchCurrentAttempt(patch: Partial<SipAttempt>) {
    if (!this.currentAttempt) return;
    this.currentAttempt = { ...this.currentAttempt, ...patch };
    // Replace last entry in log if id matches
    const idx = this.attemptLog.findIndex((x) => x.id === this.currentAttempt!.id);
    if (idx >= 0) {
      this.attemptLog[idx] = this.currentAttempt;
      saveAttemptLog(this.attemptLog);
    }
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.snap);
    return () => this.listeners.delete(fn);
  }

  private update(patch: Partial<SoftphoneSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l(this.snap));
  }

  /**
   * Silent-reconnect-aware status setter. If we already reached a healthy
   * state (registered/connected) and we briefly drop into connecting/
   * disconnected, defer the public emission so quick recoveries never flash
   * a "reconnecting…" banner in the UI. Healthy/error transitions emit
   * immediately and cancel any pending grace.
   */
  private setStatus(next: SipStatus, errorCause?: string) {
    const healthy = next === 'registered' || next === 'connected';
    const wasHealthy = this.lastStableStatus === 'registered' || this.lastStableStatus === 'connected';

    if (healthy || next === 'error') {
      if (this.statusGraceTimer) { clearTimeout(this.statusGraceTimer); this.statusGraceTimer = null; }
      this.lastStableStatus = next;
      this.update({ status: next, errorCause: healthy ? undefined : errorCause });
      return;
    }

    if (wasHealthy) {
      if (this.statusGraceTimer) clearTimeout(this.statusGraceTimer);
      this.statusGraceTimer = setTimeout(() => {
        this.statusGraceTimer = null;
        this.lastStableStatus = next;
        this.update({ status: next, errorCause });
      }, 3500);
      return;
    }

    this.lastStableStatus = next;
    this.update({ status: next, errorCause });
  }

  private bindWindowListeners() {
    if (this.windowListenersBound || typeof window === 'undefined') return;
    this.windowListenersBound = true;
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
  }
  private unbindWindowListeners() {
    if (!this.windowListenersBound || typeof window === 'undefined') return;
    this.windowListenersBound = false;
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private kickReconnect(why: string) {
    if (!this.ua) return;
    if (this.snap.authBlocked) {
      // Auth-rejected by PBX (401/403/407). Re-registering with the same
      // bad credentials would just spam the server — wait for a manual
      // restart or a password sync that bumps the config.
      return;
    }
    try {
      const connected = this.ua.isConnected?.() ?? false;
      const registered = this.ua.isRegistered?.() ?? false;
      if (connected) {
        if (!registered) {
          this.logEvent('info', `Keep-alive: re-register (${why})`);
          try { this.ua.register(); } catch { /* noop */ }
        }
        return;
      }
    } catch { /* noop */ }
    this.logEvent('info', `Keep-alive: forcing reconnect (${why})`);
    try { this.ua.start(); } catch { /* noop */ }
  }

  private startKeepAlive() {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = setInterval(() => {
      if (!this.ua) return;
      if (this.snap.authBlocked) return;
      try {
        const connected = this.ua.isConnected?.() ?? false;
        const registered = this.ua.isRegistered?.() ?? false;
        if (!connected) this.kickReconnect('heartbeat: socket down');
        else if (!registered) this.kickReconnect('heartbeat: not registered');
      } catch { /* noop */ }
    }, 25_000);
  }

  private logEvent(level: SipEvent['level'], message: string) {
    const next = [...this.snap.events, { at: Date.now(), level, message }].slice(-50);
    // eslint-disable-next-line no-console
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[SIP] ${message}`);
    this.update({ events: next });
  }

  getConfig() { return this.config; }
  getSnapshot() { return this.snap; }
  hasActiveCall() { return !!this.session; }

  private sameConfig(next: SoftphoneConfig) {
    const cur = this.config;
    if (!cur) return false;
    return cur.extension === next.extension &&
      cur.displayName === next.displayName &&
      cur.sipDomain === next.sipDomain &&
      cur.wssUrl === next.wssUrl &&
      cur.password === next.password &&
      cur.authUsername === next.authUsername &&
      !!cur.mock === !!next.mock;
  }

  async restart() {
    const cfg = this.config;
    this.logEvent('info', 'Manual restart requested');
    this.stop();
    if (cfg) await this.init(cfg);
  }


  async init(cfg: SoftphoneConfig) {
    if (this.ua && this.sameConfig(cfg)) {
      this.config = cfg;
      this.logEvent('info', 'SIP already initialized — keeping existing registration');
      // Re-broadcast snapshot so freshly-mounted subscribers get current state.
      this.listeners.forEach((l) => l(this.snap));
      // Opportunistic heal in case socket dropped while UI was unmounted.
      this.kickReconnect('init() with matching config');
      return;
    }
    if (this.ua) this.stop();
    this.config = cfg;
    // Fresh init with (potentially) new credentials — clear any prior auth block.
    if (this.snap.authBlocked) this.update({ authBlocked: null, errorCause: undefined });

    if (cfg.mock || !cfg.password) {
      this.logEvent('warn', cfg.mock ? 'Mock mode — skipping JsSIP init' : 'No SIP password — skipping JsSIP init');
      this.setStatus('registered');
      return;
    }


    if (!JSSIP_MODULE_INFO.loaded) {
      const msg = `JsSIP module failed to load: ${JSSIP_MODULE_INFO['error' as keyof typeof JSSIP_MODULE_INFO] || 'no UA export'}`;
      this.logEvent('error', msg);
      this.update({ status: 'error', errorCause: msg });
      return;
    }
    this.logEvent('info', `JsSIP module ready (version=${JSSIP_MODULE_INFO.version})`);

    const isElectron = typeof window !== 'undefined' &&
      typeof window.navigator !== 'undefined' &&
      window.navigator.userAgent.includes('Electron');
    this.logEvent('info', isElectron
      ? 'Running in Electron — direct WSS, no CORS/mixed-content'
      : 'Running in browser — WSS may be blocked by CORS/mixed-content');

    try {
                              const fallbackUrls = Array.from(new Set([
        'wss://node.lemtelcloud.net:7443',
        'wss://pbxnode.lemtel.tel:7443',
        'wss://170.39.199.132:7443',
      ].filter(Boolean)));
      this.wssAttempted = fallbackUrls;

      this.logEvent('info', `Init sip:${cfg.extension}@${cfg.sipDomain} via ${fallbackUrls.length} WSS endpoint(s): ${fallbackUrls.join(', ')}`);

      const sockets = fallbackUrls.map(
        (url) => new JsSIP.WebSocketInterface(url),
      );
      sockets.forEach((s: any) => { try { s.via_transport = 'wss'; } catch { /* noop */ } });

      let deviceId = '';
      try {
        deviceId = localStorage.getItem('lemtel.device_id') || '';
        if (!deviceId) {
          deviceId = (crypto as any)?.randomUUID?.() || String(Date.now());
          localStorage.setItem('lemtel.device_id', deviceId);
        }
      } catch { deviceId = String(Date.now()); }

      const ua = new JsSIP.UA({
        sockets,
        uri: `sip:${cfg.extension}@${cfg.sipDomain}`,
        password: cfg.password,
        authorization_user: cfg.authUsername || cfg.extension,
        realm: cfg.sipDomain,
        contact_uri: `sip:${cfg.extension}@${cfg.sipDomain};transport=wss`,
        contact_params: `+sip.instance="<urn:uuid:DESKTOP-${deviceId}>";+lemtel.device="desktop"`,
        register: true,
        session_timers: false,
        register_expires: 300,
        no_answer_timeout: 60,
        connection_recovery_min_interval: 2,
        connection_recovery_max_interval: 30,
        user_agent: 'Lemtel-Softphone/2.3.5',
        hackWssInTransport: true,
        hackIpInContact: true,
        hackViaBranch: true,
        sessionDescriptionHandlerOptions,
      });

      ua.on('connecting', () => {
        this.logEvent('info', 'WebSocket connecting…');
        this.setStatus('connecting');
      });
      ua.on('connected', () => {
        this.logEvent('info', 'WebSocket connected ✓');
        this.setStatus('connected');
      });
      ua.on('disconnected', (e: any) => {
        const cause = e?.code ? `code=${e.code} reason=${e.reason || ''}` : (e?.reason || 'unknown');
        this.logEvent('warn', `Disconnected (${cause}) — silent reconnect in 1s`);
        this.setStatus('disconnected', cause);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.logEvent('info', 'Reconnect attempt…');
          try { ua.start(); } catch { /* noop */ }
        }, 1000);
      });
      ua.on('registered', () => {
        this.logEvent('info', 'Registered ✓');
        this.setStatus('registered');
      });
      ua.on('unregistered', () => {
        this.logEvent('warn', 'Unregistered — keep-alive will re-register');
        // Don't auto re-register if we're auth-blocked — that's the bug that
        // produced the 403 storm. kickReconnect() short-circuits when blocked.
        if (this.snap.authBlocked) return;
        try { ua.register(); } catch { /* noop */ }
      });
      ua.on('registrationFailed', (e: any) => {
        const code = e?.response?.status_code;
        const reason = e?.response?.reason_phrase || e?.cause || 'registration failed';
        const detail = code ? `${code} ${reason}` : reason;
        this.logEvent('error', `Registration failed: ${detail}`);
        this.setStatus('error', detail);
        if (code === 401 || code === 403 || code === 407) {
          // Stop the keep-alive/re-register loop until manual restart or new password.
          if (this.keepAliveTimer) { clearInterval(this.keepAliveTimer); this.keepAliveTimer = null; }
          this.update({ authBlocked: { code, reason, since: Date.now() } });
          this.logEvent('warn', `Auth blocked (${code}) — keep-alive disabled. Refresh SIP credentials to retry.`);
        }
      });
      ua.on('newRTCSession', (e: any) => this.attachSession(e.session, e.originator));

      try {
        ua.start();
        this.logEvent('info', 'UA.start() invoked');
      } catch (startErr: any) {
        this.logEvent('error', `UA.start() threw: ${String(startErr?.message || startErr)}`);
        throw startErr;
      }
      this.ua = ua;
      this.setStatus('connecting');
      this.bindWindowListeners();
      this.startKeepAlive();
    } catch (err: any) {
      this.logEvent('error', `Init exception: ${String(err?.message || err)}`);
      this.setStatus('error', String(err?.message || err));
    }
  }



  private attachSession(session: any, originator: string) {
    // If we already have a primary session, treat this as a secondary (attended xfer).
    if (this.session && originator !== 'remote') {
      this.secondSession = session;
      this.bindSecondary(session);
      return;
    }

    this.session = session;
    const incoming = originator === 'remote';
    const remoteUri = session.remote_identity?.uri?.user || '';
    const remoteName = session.remote_identity?.display_name || remoteUri;

    // Track this attempt
    if (!this.currentAttempt || this.currentAttempt.direction !== (incoming ? 'in' : 'out')) {
      const attempt: SipAttempt = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        at: Date.now(),
        target: remoteUri || remoteName || (incoming ? 'incoming' : 'outgoing'),
        direction: incoming ? 'in' : 'out',
        sdpBefore: _lastSdpBefore,
        sdpAfter: _lastSdpAfter,
        workaroundOn: isSdpWorkaroundEnabled(),
        outcome: 'pending',
      };
      this.currentAttempt = attempt;
      this.pushAttempt(attempt);
    } else {
      this.patchCurrentAttempt({ sdpBefore: _lastSdpBefore, sdpAfter: _lastSdpAfter });
    }

    this.update({
      callState: incoming ? 'ringing-in' : 'ringing-out',
      remoteIdentity: remoteName,
      remoteNumber: remoteUri,
      direction: incoming ? 'in' : 'out',
      muted: false,
      onHold: false,
    });

    session.on('progress', () => {
      if (!incoming) this.update({ callState: 'ringing-out' });
    });
    session.on('confirmed', () => {
      this.update({ callState: 'active', startedAt: Date.now() });
      this.patchCurrentAttempt({ outcome: 'connected', sdpAfter: _lastSdpAfter });
      this.lastFailure = null;
    });
    session.on('failed', (e: any) => {
      const cause = e?.cause || 'unknown';
      const reason = e?.message?.reason_phrase || e?.response?.reason_phrase || '';
      const code: number | undefined = e?.message?.status_code || e?.response?.status_code;
      const detail = [cause, code, reason].filter(Boolean).join(' ');
      const respBody = e?.response?.body || e?.message?.body || '';
      this.lastCallError = detail;
      const classified = classifySipFailure(code, reason, cause);
      this.lastFailure = classified;
      // eslint-disable-next-line no-console
      console.error('[SIP][CALL FAILED]', { cause, code, reason, originator: e?.originator, category: classified.category });
      if (respBody) {
        // eslint-disable-next-line no-console
        console.error('[SIP][RESP BODY]\n' + respBody);
      }
      if (classified.category === 'sdp_488') {
        this.logEvent('error', `488 Not Acceptable — ${classified.hint}`);
      }
      this.patchCurrentAttempt({
        outcome: 'failed',
        responseCode: code,
        responseReason: reason,
        responseBody: respBody ? String(respBody).slice(0, 4000) : undefined,
        category: classified.category,
        hint: classified.hint,
      });
      this.logEvent('error', `Call failed: ${detail}`);
      this.update({ callState: 'ended', errorCause: `${classified.title} — ${classified.hint}` });
      setTimeout(() => this.resetCall(), 2500);
    });
    session.on('ended', () => {
      this.update({ callState: 'ended' });
      this.patchCurrentAttempt({ outcome: 'ended' });
      setTimeout(() => this.resetCall(), 2500);
    });
    session.on('hold', () => this.update({ onHold: true, callState: 'held' }));
    session.on('unhold', () => this.update({ onHold: false, callState: 'active' }));
    session.on('muted', () => this.update({ muted: true }));
    session.on('unmuted', () => this.update({ muted: false }));

    // Verbose SDP logging — peerconnection offer/answer trace
    try {
      const pc = session.connection;
      if (pc) {
        pc.addEventListener('iceconnectionstatechange', () => {
          // eslint-disable-next-line no-console
          console.log('[SIP][ICE]', pc.iceConnectionState);
        });
        pc.addEventListener('connectionstatechange', () => {
          // eslint-disable-next-line no-console
          console.log('[SIP][PC]', pc.connectionState);
        });
      }
    } catch { /* noop */ }

    this.bindMedia(session);
  }


  private bindSecondary(session: any) {
    session.on('ended', () => { this.secondSession = null; });
    session.on('failed', () => { this.secondSession = null; });
    this.bindMedia(session);
  }

  private bindMedia(session: any) {
    const pc = session.connection;
    if (!pc) return;
    pc.addEventListener('track', (ev: any) => {
      if (this.audioEl && ev.streams[0]) {
        this.audioEl.srcObject = ev.streams[0];
        if (this.outputDeviceId && (this.audioEl as any).setSinkId) {
          (this.audioEl as any).setSinkId(this.outputDeviceId).catch(() => { /* noop */ });
        }
        this.audioEl.play().catch(() => { /* noop */ });
      }
    });
  }

  private resetCall() {
    this.session = null;
    this.secondSession = null;
    this.update({
      callState: 'idle',
      remoteIdentity: '',
      remoteNumber: '',
      direction: null,
      startedAt: null,
      muted: false,
      onHold: false,
    });
  }

  /** Ensure mic permission before placing a call. Returns null on success or error message. */
  async ensureMicPermission(): Promise<string | null> {
    try {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      };
      if (this.inputDeviceId) (audioConstraints as any).deviceId = { exact: this.inputDeviceId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
      const track = stream.getAudioTracks()[0];
      if (track) {
        this.boundInputLabel = track.label || 'System default';
        this.logEvent('info', `Mic ready: ${this.boundInputLabel}`);
      }
      stream.getTracks().forEach((t) => t.stop());
      return null;
    } catch (err: any) {
      const msg = `Microphone access denied: ${err?.message || err}`;
      this.logEvent('error', msg);
      return msg;
    }
  }

  /** List + verify audio devices. Returns labels of currently bound input/output. */
  async testAudioDevices(): Promise<{ input: string; output: string; inputs: number; outputs: number; error?: string }> {
    try {
      // Trigger permission so labels populate.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      const outputs = devices.filter((d) => d.kind === 'audiooutput');
      const inDev = this.inputDeviceId
        ? inputs.find((d) => d.deviceId === this.inputDeviceId)
        : inputs.find((d) => d.deviceId === 'default') || inputs[0];
      const outDev = this.outputDeviceId
        ? outputs.find((d) => d.deviceId === this.outputDeviceId)
        : outputs.find((d) => d.deviceId === 'default') || outputs[0];
      this.boundInputLabel = inDev?.label || 'System default';
      this.boundOutputLabel = outDev?.label || 'System default';
      this.logEvent('info', `Device test OK — in: ${this.boundInputLabel} / out: ${this.boundOutputLabel} (${inputs.length} in, ${outputs.length} out)`);
      return {
        input: this.boundInputLabel,
        output: this.boundOutputLabel,
        inputs: inputs.length,
        outputs: outputs.length,
      };
    } catch (err: any) {
      const msg = String(err?.message || err);
      this.logEvent('error', `Device test failed: ${msg}`);
      return { input: '—', output: '—', inputs: 0, outputs: 0, error: msg };
    }
  }

  async call(number: string): Promise<string | null> {
    if (!this.config || !this.ua) {
      this.logEvent('error', 'UA not ready — cannot call');
      return 'SIP not initialized';
    }
    const target = `sip:${number}@${this.config.sipDomain}`;
    this.logEvent('info', `Dialing ${number} (workaround=${isSdpWorkaroundEnabled() ? 'on' : 'off'})`);
    // Reset SDP capture so this attempt only contains its own offer
    _lastSdpBefore = null;
    _lastSdpAfter = null;
    // Pre-register an attempt so we capture target even if attachSession fires after SDP
    this.currentAttempt = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
      target: number,
      direction: 'out',
      sdpBefore: null,
      sdpAfter: null,
      workaroundOn: isSdpWorkaroundEnabled(),
      outcome: 'pending',
    };
    this.pushAttempt(this.currentAttempt);
    try {
      this.ua.call(target, {
        mediaConstraints: { audio: true, video: false },
        pcConfig,
        sessionDescriptionHandlerOptions,
        sessionDescriptionHandlerModifiers: [sdpModifier],
      } as any);
      this.lastCallError = null;
      return null;
    } catch (e: any) {
      const msg = `call() threw: ${e?.message || e}`;
      this.logEvent('error', msg);
      this.lastCallError = msg;
      this.update({ callState: 'idle', errorCause: e?.message || 'Call failed' });
      return msg;
    }
  }

  /** Build a debug report JSON with secrets masked. */
  buildDebugReport(): string {
    const cfg = this.config;
    const masked = cfg ? {
      extension: cfg.extension,
      displayName: cfg.displayName,
      sipDomain: cfg.sipDomain,
      wssUrl: cfg.wssUrl,
      wssUrls: cfg.wssUrls,
      password: cfg.password ? `***${cfg.password.length}chars***` : '(none)',
      mock: !!cfg.mock,
    } : null;
    const report = {
      generatedAt: new Date().toISOString(),
      jssipModule: JSSIP_MODULE_INFO,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
      isElectron: typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'),
      config: masked,
      wssAttempted: this.wssAttempted,
      audio: {
        input: this.boundInputLabel,
        output: this.boundOutputLabel,
        inputDeviceId: this.inputDeviceId,
        outputDeviceId: this.outputDeviceId,
      },
      sip: {
        status: this.snap.status,
        callState: this.snap.callState,
        errorCause: this.snap.errorCause || null,
        lastCallError: this.lastCallError,
        hasUA: !!this.ua,
        hasSession: !!this.session,
      },
      events: this.snap.events,
    };
    return JSON.stringify(report, null, 2);
  }

  downloadDebugReport() {
    try {
      const json = this.buildDebugReport();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lemtel-softphone-debug-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.logEvent('info', 'Debug report downloaded');
    } catch (err: any) {
      this.logEvent('error', `Debug report failed: ${err?.message || err}`);
    }
  }


  answer() {
    this.session?.answer({
      mediaConstraints: { audio: true, video: false },
      pcConfig,
      sessionDescriptionHandlerOptions,
      sessionDescriptionHandlerModifiers: [sdpModifier],
    } as any);
  }

  hangup() {
    try { this.session?.terminate(); } catch { /* noop */ }
  }

  mute() { this.session?.mute({ audio: true }); }
  unmute() { this.session?.unmute({ audio: true }); }
  hold() { this.session?.hold(); }
  unhold() { this.session?.unhold(); }

  sendDTMF(key: string) {
    this.session?.sendDTMF(key, { duration: 100, interToneGap: 70 });
  }

  /** Blind transfer — refer current call to target extension. */
  blindTransfer(target: string) {
    if (!this.session || !this.config) return;
    this.session.refer(`sip:${target}@${this.config.sipDomain}`);
  }

  /** Attended transfer — start a consult call. Caller must then complete with completeAttendedTransfer(). */
  startAttendedConsult(target: string) {
    if (!this.ua || !this.session || !this.config) return;
    this.session.hold();
    const uri = `sip:${target}@${this.config.sipDomain}`;
    this.ua.call(uri, {
      mediaConstraints: { audio: true, video: false },
      pcConfig,
      sessionDescriptionHandlerOptions,
      sessionDescriptionHandlerModifiers: [sdpModifier],
    } as any);
  }

  /** After consult is established, transfer original call to the consult party. */
  completeAttendedTransfer() {
    if (!this.session || !this.secondSession) return;
    try { this.session.refer(this.secondSession); } catch { /* noop */ }
  }

  cancelAttendedConsult() {
    try { this.secondSession?.terminate(); } catch { /* noop */ }
    this.secondSession = null;
    this.session?.unhold();
  }

  hasConsult() { return !!this.secondSession; }

  stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
    if (this.statusGraceTimer) clearTimeout(this.statusGraceTimer);
    this.statusGraceTimer = null;
    this.unbindWindowListeners();
    try { this.ua?.stop(); } catch { /* noop */ }
    this.ua = null;
    this.session = null;
    this.secondSession = null;
    this.lastStableStatus = 'disconnected';
    this.update({ status: 'disconnected', callState: 'idle', direction: null, startedAt: null });
  }
}

export const sipProvider = new JsSipProvider();
