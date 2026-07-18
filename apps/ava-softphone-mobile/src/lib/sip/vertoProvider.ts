// FreeSWITCH Verto client — native WebSocket + JSON-RPC implementation.
//
// No jQuery, no external CDN — talks raw JSON-RPC to FreeSWITCH on
// wss://<host>:<port>. Media is negotiated via a standard RTCPeerConnection
// (offer/answer over verto.invite / verto.answer). Because FreeSWITCH
// bridges the media itself, no TURN server is required — this bypasses
// carrier TURN DNS blocks (e.g. Bell Canada).

export interface VertoConfig {
  host: string;
  port: number;
  login: string;         // extension number (e.g. "113")
  password: string;      // SIP password
  caller_id_name: string;
  caller_id_number: string;
  /** Optional DOM id of the <audio> element used for remote audio. */
  audioTag?: string;
  /** SIP domain part for the login. Defaults to `host`. */
  domain?: string;
}

export interface VertoDialog {
  callID: string;
  hangup: () => void;
  answer: (opts?: any) => void;
  dtmf: (digit: string) => void;
  hold: () => void;
  unhold: () => void;
  toggleHold: () => void;
  rtc?: RTCPeerConnection;
}

export type VertoEvent =
  | { type: 'connecting' }
  | { type: 'registered' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'error'; error: string }
  | { type: 'incoming'; dialog: VertoDialog; from: string; fromName?: string }
  | { type: 'progress'; dialog: VertoDialog }
  | { type: 'answered'; dialog: VertoDialog }
  | { type: 'hangup'; dialog: VertoDialog; cause?: string }
  | { type: 'media'; dialog: VertoDialog; stream: MediaStream };

type Listener = (e: VertoEvent) => void;

/**
 * Ensure PCMU (payload 0) and PCMA (payload 8) are present in the SDP offer.
 * On Android emulator/WebView with AudioContext silent track, the browser may
 * omit G.711 codecs from the offer. FreeSWITCH rejects such offers with
 * INCOMPATIBLE_DESTINATION (causeCode 88) when bridging to PSTN trunks.
 */
function ensurePcmuInSdp(sdp: string): string {
  const lines = sdp.split('\r\n');
  // Find the m=audio line
  const mAudioIdx = lines.findIndex((l) => l.startsWith('m=audio '));
  if (mAudioIdx === -1) return sdp;

  const mLine = lines[mAudioIdx];
  // Check if PCMU (0) and PCMA (8) are already in the m= line
  const parts = mLine.split(' ');
  // parts: ['m=audio', port, proto, pt1, pt2, ...]
  const payloads = parts.slice(3);
  const hasPcmu = payloads.includes('0');
  const hasPcma = payloads.includes('8');
  const hasTelEvent = payloads.includes('101') || payloads.includes('126');

  const toAdd: string[] = [];
  if (!hasPcmu) toAdd.push('0');
  if (!hasPcma) toAdd.push('8');
  if (!hasTelEvent) toAdd.push('101');

  if (toAdd.length === 0) return sdp; // already complete

  // Add payload types to m= line
  lines[mAudioIdx] = [...parts, ...toAdd].join(' ');

  // Find insertion point: after the last a=rtpmap line in the audio section
  let insertAfter = mAudioIdx;
  for (let i = mAudioIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('m=')) break; // next media section
    if (lines[i].startsWith('a=rtpmap:') || lines[i].startsWith('a=fmtp:')) {
      insertAfter = i;
    }
  }

  const newLines: string[] = [];
  if (!hasPcmu) {
    newLines.push('a=rtpmap:0 PCMU/8000');
    newLines.push('a=rtcp-fb:0 transport-cc');
  }
  if (!hasPcma) {
    newLines.push('a=rtpmap:8 PCMA/8000');
    newLines.push('a=rtcp-fb:8 transport-cc');
  }
  if (!hasTelEvent) {
    newLines.push('a=rtpmap:101 telephone-event/8000');
    newLines.push('a=fmtp:101 0-16');
  }

  lines.splice(insertAfter + 1, 0, ...newLines);
  return lines.join('\r\n');
}

/**
 * Remove RED codec and fix invalid bitrate lines from SDP.
 * FreeSWITCH sometimes includes RED (redundant audio) which WebRTC
 * on Android rejects with min_bitrate_bps=-1 / max_bitrate_bps=-1.
 * We strip RED payload lines and any dangling a=rtpmap/a=fmtp for it.
 */
function filterSdp(sdp: string): string {
  const lines = sdp.split('\r\n');
  // Find RED payload type numbers (e.g. "a=rtpmap:112 red/...")
  const redPayloads = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^a=rtpmap:(\d+)\s+red\//i);
    if (m) redPayloads.add(m[1]);
  }
  if (redPayloads.size === 0) return sdp; // nothing to do

  const filtered: string[] = [];
  for (const line of lines) {
    // Remove RED from m= payload list
    if (line.startsWith('m=audio')) {
      const parts = line.split(' ');
      const header = parts.slice(0, 3);
      const payloads = parts.slice(3).filter((p) => !redPayloads.has(p));
      filtered.push([...header, ...payloads].join(' '));
      continue;
    }
    // Remove a=rtpmap, a=fmtp, a=rtcp-fb for RED payloads
    const ptMatch = line.match(/^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)/);
    if (ptMatch && redPayloads.has(ptMatch[1])) continue;
    filtered.push(line);
  }
  return filtered.join('\r\n');
}

function uuid(): string {
  // RFC4122-ish; good enough for callID / sessid.
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function ensureAudioTag(id: string): HTMLAudioElement {
  let el = document.getElementById(id) as HTMLAudioElement | null;
  if (el) return el;
  el = document.createElement('audio');
  el.id = id;
  el.autoplay = true;
  el.setAttribute('playsinline', 'true');
  (el as any).muted = false;
  el.volume = 1.0;
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
}

interface DialogRecord {
  callID: string;
  direction: 'inbound' | 'outbound';
  pc: RTCPeerConnection;
  wrapped: VertoDialog;
  destination?: string;
  callerIdName?: string;
  callerIdNumber?: string;
  remoteStream?: MediaStream;
  answered?: boolean;
}

class VertoClient {
  private ws: WebSocket | null = null;
  private sessid = uuid();
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private listeners = new Set<Listener>();
  private dialogs = new Map<string, DialogRecord>();
  private connected = false;
  private loggedIn = false;
  private cfg: VertoConfig | null = null;
  private audioTagId = 'verto-remote-audio';

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: VertoEvent) {
    this.listeners.forEach((fn) => { try { fn(e); } catch (err) { console.warn('[verto] listener threw', err); } });
  }
  isConnected() { return this.loggedIn; }

  async connect(cfg: VertoConfig): Promise<void> {
    if (typeof window === 'undefined') throw new Error('Verto requires a browser environment');
    this.cfg = cfg;
    this.audioTagId = cfg.audioTag || 'verto-remote-audio';
    ensureAudioTag(this.audioTagId);
    this.emit({ type: 'connecting' });

    const url = `wss://${cfg.host}:${cfg.port}`;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (ok: boolean, err?: string) => {
        if (settled) return;
        settled = true;
        if (ok) resolve(); else reject(new Error(err || 'Verto connect failed'));
      };

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e: any) {
        done(false, e?.message || 'WebSocket construction failed');
        return;
      }
      this.ws = ws;

      ws.onopen = async () => {
        this.connected = true;
        try {
          const domain = cfg.domain || cfg.host;
          const login = cfg.login.includes('@') ? cfg.login : `${cfg.login}@${domain}`;
          const res = await this.rpc('login', {
            login,
            passwd: cfg.password,
            sessid: this.sessid,
            userVariables: {},
          });
          if (res?.message && String(res.message).toLowerCase().includes('logged in')) {
            this.loggedIn = true;
            this.emit({ type: 'registered' });
            done(true);
          } else {
            this.emit({ type: 'error', error: 'Login refused' });
            done(false, 'Login refused');
          }
        } catch (e: any) {
          this.emit({ type: 'error', error: e?.message || 'Login RPC failed' });
          done(false, e?.message);
        }
      };

      ws.onerror = () => {
        this.emit({ type: 'error', error: 'WebSocket error' });
        done(false, 'WebSocket error');
      };

      ws.onclose = (ev) => {
        const wasLoggedIn = this.loggedIn;
        this.connected = false;
        this.loggedIn = false;
        this.emit({ type: 'disconnected', reason: `code=${ev.code}` });
        if (!wasLoggedIn) done(false, `WebSocket closed (code=${ev.code})`);
      };

      ws.onmessage = (ev) => this.handleMessage(ev.data);
    });
  }

  private send(obj: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket not open');
    this.ws.send(JSON.stringify(obj));
  }

  private rpc(method: string, params: any): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.send({ jsonrpc: '2.0', id, method, params });
      } catch (e) {
        this.pending.delete(id);
        reject(e);
        return;
      }
      // Safety timeout
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 20000);
    });
  }

  private handleMessage(raw: any) {
    let msg: any;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    // Response to an outbound RPC
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error?.message || 'RPC error'));
      else p.resolve(msg.result);
      return;
    }
    // Server-initiated notification
    if (msg.method) {
      this.handleServerMethod(msg.method, msg.params, msg.id);
    }
  }

  private async handleServerMethod(method: string, params: any, msgId?: number) {
    // ACK server calls that expect a response
    const ack = () => {
      if (msgId !== undefined) {
        try { this.send({ jsonrpc: '2.0', id: msgId, result: { method } }); } catch { /* ignore */ }
      }
    };

    const callID: string | undefined = params?.callID;
    switch (method) {
      case 'verto.invite': {
        ack();
        if (!callID) return;
        await this.handleInboundInvite(callID, params);
        return;
      }
      case 'verto.answer': {
        ack();
        const rec = callID ? this.dialogs.get(callID) : undefined;
        console.log('[verto][DIAG] verto.answer received, callID:', callID, 'rec found:', !!rec, 'sdp length:', params?.sdp?.length);
        if (params?.sdp) {
          console.log('[verto][DIAG] RAW ANSWER SDP (first 800 chars):', params.sdp.substring(0, 800));
        }
        if (rec && params?.sdp) {
          try {
            const cleanAnswer = filterSdp(params.sdp);
            console.log('[verto][DIAG] CLEAN ANSWER SDP (first 800 chars):', cleanAnswer.substring(0, 800));
            console.log('[verto][DIAG] pc.signalingState before setRemoteDescription:', rec.pc.signalingState);
            await rec.pc.setRemoteDescription({ type: 'answer', sdp: cleanAnswer });
            console.log('[verto][DIAG] setRemoteDescription(answer) SUCCESS, iceConnectionState:', rec.pc.iceConnectionState);
            rec.answered = true;
            this.emit({ type: 'answered', dialog: rec.wrapped });
          } catch (e) {
            console.error('[verto][DIAG] setRemoteDescription(answer) FAILED:', e);
          }
        }
        return;
      }
      case 'verto.media': {
        ack();
        const rec = callID ? this.dialogs.get(callID) : undefined;
        console.log('[verto][DIAG] verto.media received, callID:', callID, 'rec found:', !!rec);
        if (rec && params?.sdp && !rec.answered) {
          try {
            const cleanMedia = filterSdp(params.sdp);
            console.log('[verto][DIAG] MEDIA SDP (first 400 chars):', cleanMedia.substring(0, 400));
            await rec.pc.setRemoteDescription({ type: 'answer', sdp: cleanMedia });
            console.log('[verto][DIAG] verto.media setRemoteDescription SUCCESS');
            rec.answered = true;
          } catch (e) { console.warn('[verto][DIAG] verto.media setRemoteDescription FAILED:', e); }
        }
        if (rec) this.emit({ type: 'progress', dialog: rec.wrapped });
        return;
      }
      case 'verto.bye': {
        ack();
        const rec = callID ? this.dialogs.get(callID) : undefined;
        console.error('[verto][DIAG] verto.bye received! callID:', callID, 'cause:', params?.cause, 'causeCode:', params?.causeCode, 'full params:', JSON.stringify(params));
        if (rec) {
          console.log('[verto][DIAG] ICE state at hangup:', rec.pc.iceConnectionState, 'signaling:', rec.pc.signalingState);
          try { rec.pc.close(); } catch { /* ignore */ }
          this.dialogs.delete(rec.callID);
          this.emit({ type: 'hangup', dialog: rec.wrapped, cause: params?.cause });
        }
        return;
      }
      case 'verto.display':
      case 'verto.info':
      case 'verto.event':
      case 'verto.clientReady':
      case 'verto.punt':
      default:
        ack();
        return;
    }
  }

  private async handleInboundInvite(callID: string, params: any) {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const remoteStream = new MediaStream();
    pc.ontrack = (ev) => {
      ev.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));
      const rec = this.dialogs.get(callID);
      if (rec) this.emit({ type: 'media', dialog: rec.wrapped, stream: remoteStream });
    };

    let local: MediaStream | null = null;
    try {
      local = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      local.getTracks().forEach((t) => pc.addTrack(t, local!));
    } catch (e) {
      console.warn('[verto] mic denied on inbound', e);
    }

    const rec: DialogRecord = {
      callID, direction: 'inbound', pc,
      wrapped: this.wrap(callID),
      remoteStream,
    };
    this.dialogs.set(callID, rec);

    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: params.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.waitForIce(pc);
      // Wrap dialog only once callID is known
      const wrapped = this.wrap(callID);
      rec.wrapped = wrapped;
      this.emit({
        type: 'incoming', dialog: wrapped,
        from: params?.caller_id_number || '', fromName: params?.caller_id_name,
      });
      // Note: answer is deferred until user calls .answer()
      (wrapped as any).__pendingAnswer = pc.localDescription?.sdp;
      (wrapped as any).__params = params;
    } catch (e) {
      console.warn('[verto] inbound negotiation failed', e);
    }
  }

  private waitForIce(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const t = setTimeout(() => { pc.removeEventListener('icegatheringstatechange', check); resolve(); }, timeoutMs);
      const check = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(t);
          pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  private wrap(callID: string): VertoDialog {
    const existing = this.dialogs.get(callID)?.wrapped;
    if (existing) return existing;
    const w: VertoDialog = {
      callID,
      hangup: () => this.hangup(callID),
      answer: () => this.answerInbound(callID),
      dtmf: (digit: string) => this.dtmf(callID, digit),
      hold: () => this.hold(callID, true),
      unhold: () => this.hold(callID, false),
      toggleHold: () => {
        const rec = this.dialogs.get(callID);
        if (!rec) return;
        this.hold(callID, true); // best-effort toggle
      },
      rtc: undefined,
    };
    return w;
  }

  async call(destination: string, callerIdName: string, callerIdNumber: string): Promise<VertoDialog | null> {
    if (!this.loggedIn || !this.cfg) throw new Error('Verto not registered');
    const callID = uuid();
    const pc = new RTCPeerConnection({ iceServers: [], sdpSemantics: 'unified-plan' } as any);
    const remoteStream = new MediaStream();
    pc.ontrack = (ev) => {
      ev.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));
      const rec = this.dialogs.get(callID);
      if (rec) this.emit({ type: 'media', dialog: rec.wrapped, stream: remoteStream });
    };
    pc.oniceconnectionstatechange = () => {
      console.log('[verto][DIAG] ICE connection state:', pc.iceConnectionState, 'signaling:', pc.signalingState);
    };
    pc.onicegatheringstatechange = () => {
      console.log('[verto][DIAG] ICE gathering state:', pc.iceGatheringState);
    };
    pc.onsignalingstatechange = () => {
      console.log('[verto][DIAG] Signaling state:', pc.signalingState);
    };

    // Attempt to acquire the microphone. On emulators or when permission
    // is denied, fall back to a silent audio track so the call still
    // proceeds and the remote party can be heard.
    let local: MediaStream;
    try {
      local = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (micErr) {
      console.warn('[verto] mic unavailable, using silent track:', micErr);
      // Create a silent audio track via AudioContext
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const dest = ctx.createMediaStreamDestination();
      local = dest.stream;
    }
    local.getTracks().forEach((t) => pc.addTrack(t, local));

    const wrapped = this.wrap(callID);
    wrapped.rtc = pc;
    const rec: DialogRecord = {
      callID, direction: 'outbound', pc, wrapped,
      destination, callerIdName, callerIdNumber, remoteStream,
    };
    this.dialogs.set(callID, rec);

    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    await this.waitForIce(pc);

    // Filter RED codec from the local SDP before sending to FreeSWITCH.
    // RED causes WebRTC audio_send_stream bitrate=-1 on Android WebView.
    const rawSdp = pc.localDescription?.sdp || '';
    let cleanSdp = filterSdp(rawSdp);

    // INCOMPATIBLE_DESTINATION fix: ensure PCMU (payload 0) and PCMA (payload 8)
    // are present in the SDP offer. On Android emulator with AudioContext silent
    // track, the RTCPeerConnection may omit PCMU/PCMA — FreeSWITCH then rejects
    // the call with causeCode 88 (INCOMPATIBLE_DESTINATION) because it requires
    // at least one G.711 codec for PSTN bridging.
    cleanSdp = ensurePcmuInSdp(cleanSdp);

    console.log('[verto][DIAG] FULL OFFER SDP:', cleanSdp);
    console.log('[verto][DIAG] Sending verto.invite to:', destination, 'callID:', callID);

    const dialogParams = {
      callID,
      caller_id_name: callerIdName,
      caller_id_number: callerIdNumber,
      destination_number: destination,
      remote_caller_id_name: 'Outbound Call',
      remote_caller_id_number: destination,
      useVideo: false, useStereo: false,
      tag: this.audioTagId,
      login: this.cfg.login.includes('@') ? this.cfg.login : `${this.cfg.login}@${this.cfg.domain || this.cfg.host}`,
    };

    console.log('[verto][DIAG] dialogParams:', JSON.stringify(dialogParams));
    try {
      await this.rpc('verto.invite', { sdp: cleanSdp, dialogParams });
    } catch (e: any) {
      try { pc.close(); } catch { /* ignore */ }
      this.dialogs.delete(callID);
      this.emit({ type: 'hangup', dialog: wrapped, cause: e?.message });
      return null;
    }

    this.emit({ type: 'progress', dialog: wrapped });
    return wrapped;
  }

  private async answerInbound(callID: string) {
    const rec = this.dialogs.get(callID);
    if (!rec || rec.direction !== 'inbound') return;
    const sdp = (rec.wrapped as any).__pendingAnswer;
    if (!sdp) return;
    const dialogParams = {
      callID,
      caller_id_name: this.cfg?.caller_id_name || '',
      caller_id_number: this.cfg?.caller_id_number || '',
      useVideo: false, useStereo: false,
      tag: this.audioTagId,
    };
    try {
      await this.rpc('verto.answer', { sdp, dialogParams });
      rec.answered = true;
      this.emit({ type: 'answered', dialog: rec.wrapped });
    } catch (e) {
      console.warn('[verto] answer RPC failed', e);
    }
  }

  private async hangup(callID: string) {
    const rec = this.dialogs.get(callID);
    if (!rec) return;
    const dialogParams = {
      callID,
      caller_id_name: rec.callerIdName || this.cfg?.caller_id_name || '',
      caller_id_number: rec.callerIdNumber || this.cfg?.caller_id_number || '',
      destination_number: rec.destination,
    };
    try {
      await this.rpc('verto.bye', { cause: 'NORMAL_CLEARING', dialogParams });
    } catch { /* ignore */ }
    try { rec.pc.close(); } catch { /* ignore */ }
    this.dialogs.delete(callID);
    this.emit({ type: 'hangup', dialog: rec.wrapped, cause: 'NORMAL_CLEARING' });
  }

  private async dtmf(callID: string, digit: string) {
    const rec = this.dialogs.get(callID);
    if (!rec) return;
    try {
      await this.rpc('verto.info', {
        dtmf: digit,
        dialogParams: { callID, destination_number: rec.destination },
      });
    } catch { /* ignore */ }
  }

  private async hold(callID: string, on: boolean) {
    const rec = this.dialogs.get(callID);
    if (!rec) return;
    try {
      await this.rpc('verto.modify', {
        action: on ? 'hold' : 'unhold',
        dialogParams: { callID },
      });
    } catch { /* ignore */ }
  }

  hangupAll() {
    for (const rec of Array.from(this.dialogs.values())) {
      this.hangup(rec.callID).catch(() => { /* ignore */ });
    }
  }

  disconnect() {
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.connected = false;
    this.loggedIn = false;
    this.dialogs.clear();
  }
}

// Singleton — matches the JsSIP UA lifecycle model used elsewhere.
let singleton: VertoClient | null = null;
export function getVertoClient(): VertoClient {
  if (!singleton) singleton = new VertoClient();
  return singleton;
}

/** Convenience: initialize + register. Resolves after successful login. */
export async function initVerto(cfg: VertoConfig): Promise<VertoClient> {
  const c = getVertoClient();
  await c.connect(cfg);
  return c;
}

export async function vertoCall(destination: string, callerName: string, callerNumber?: string): Promise<VertoDialog | null> {
  return getVertoClient().call(destination, callerName, callerNumber || callerName);
}

export function vertoHangup(): void {
  getVertoClient().hangupAll();
}
