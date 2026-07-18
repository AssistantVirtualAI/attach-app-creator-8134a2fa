// FreeSWITCH Verto client wrapper.
//
// Loads jQuery + jquery.verto (the canonical Verto client that ships with
// FreeSWITCH) at first use, then exposes a small typed surface for the
// Android softphone hook. Verto handles media server-side, so no TURN is
// required — this fixes calls on carriers (e.g. Bell Canada) that block
// TURN DNS resolution.
//
// This module intentionally has no dependency on JsSIP, PJSIP, or the
// existing SIPConfig plumbing beyond the fields it needs.

const JQUERY_SRC = 'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js';
const JSONRPC_SRC = 'https://pbxnode.lemtel.tel:8082/js/src/jquery.jsonrpcclient.js';
const VERTO_SRC = 'https://pbxnode.lemtel.tel:8082/js/src/jquery.verto.js';

export interface VertoConfig {
  host: string;
  port: number;
  login: string;         // extension number (e.g. "113")
  password: string;      // SIP password
  caller_id_name: string;
  caller_id_number: string;
  /** Optional DOM id of the <audio> element used for remote audio. */
  audioTag?: string;
}

export type VertoDialogState =
  | 'trying' | 'ringing' | 'early' | 'active'
  | 'hangup' | 'destroy' | 'held' | 'requesting' | 'recovering';

export interface VertoDialog {
  callID: string;
  hangup: () => void;
  answer: (opts?: any) => void;
  dtmf: (digit: string) => void;
  hold: () => void;
  unhold: () => void;
  toggleHold: () => void;
  rtc?: any;
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

let scriptsLoading: Promise<void> | null = null;

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-verto-src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.defer = false;
    s.dataset.vertoSrc = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureVertoLibs(): Promise<void> {
  if (typeof window === 'undefined') throw new Error('Verto requires a browser environment');
  if ((window as any).$?.verto) return;
  if (!scriptsLoading) {
    scriptsLoading = (async () => {
      await injectScript(JQUERY_SRC);
      // jsonrpcclient must load before verto
      await injectScript(JSONRPC_SRC);
      await injectScript(VERTO_SRC);
      if (!(window as any).$?.verto) {
        throw new Error('jQuery.verto did not attach — check network / CORS on pbxnode.lemtel.tel:8082');
      }
    })().catch((e) => {
      scriptsLoading = null;
      throw e;
    });
  }
  return scriptsLoading;
}

/** Ensures a hidden <audio id="…"> element exists for Verto to render remote media into. */
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

class VertoClient {
  private verto: any = null;
  private listeners = new Set<Listener>();
  private dialogs = new Map<string, VertoDialog>();
  private connected = false;
  private lastConfig: VertoConfig | null = null;

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: VertoEvent) {
    this.listeners.forEach((fn) => {
      try { fn(e); } catch (err) { console.warn('[verto] listener threw', err); }
    });
  }

  isConnected() { return this.connected; }

  async connect(cfg: VertoConfig): Promise<void> {
    await ensureVertoLibs();
    this.lastConfig = cfg;
    const jQuery = (window as any).$;
    const audioTagId = cfg.audioTag || 'verto-remote-audio';
    ensureAudioTag(audioTagId);

    this.emit({ type: 'connecting' });

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (ok: boolean, err?: string) => {
        if (settled) return;
        settled = true;
        if (ok) resolve();
        else reject(new Error(err || 'Verto connect failed'));
      };

      try {
        this.verto = new jQuery.verto({
          login: `${cfg.login}@${cfg.host}`,
          passwd: cfg.password,
          socketUrl: `wss://${cfg.host}:${cfg.port}`,
          tag: audioTagId,
          ringFile: '',
          videoParams: {},
          iceServers: false, // Verto proxies media through FreeSWITCH — no TURN needed
          sessid: null,
        }, {
          onWSLogin: (_v: any, success: boolean) => {
            if (success) {
              this.connected = true;
              this.emit({ type: 'registered' });
              done(true);
            } else {
              this.connected = false;
              this.emit({ type: 'error', error: 'Login refused (bad credentials?)' });
              done(false, 'Login refused');
            }
          },
          onWSClose: (_v: any, success: boolean) => {
            this.connected = false;
            this.emit({ type: 'disconnected', reason: success ? 'closed' : 'lost' });
            done(false, 'WebSocket closed before login');
          },
          onDialogState: (d: any) => this.handleDialogState(d),
          onMessage: () => { /* noop */ },
        });
      } catch (e: any) {
        done(false, e?.message || 'Verto init threw');
      }
    });
  }

  private handleDialogState(d: any) {
    const dialog = this.wrap(d);
    const state: VertoDialogState = d?.state?.name;
    switch (state) {
      case 'requesting':
      case 'trying':
      case 'early':
      case 'ringing':
        if (d.direction?.name === 'inbound' && !this.dialogs.has(dialog.callID)) {
          this.dialogs.set(dialog.callID, dialog);
          this.emit({
            type: 'incoming',
            dialog,
            from: d?.params?.caller_id_number || '',
            fromName: d?.params?.caller_id_name,
          });
        } else {
          this.emit({ type: 'progress', dialog });
        }
        break;
      case 'active': {
        this.emit({ type: 'answered', dialog });
        try {
          const pc = d?.rtc?.getPeer?.() as RTCPeerConnection | undefined;
          const stream = pc?.getReceivers?.()
            ?.map((r) => r.track)
            .filter(Boolean);
          if (stream && stream.length) {
            const ms = new MediaStream(stream as MediaStreamTrack[]);
            this.emit({ type: 'media', dialog, stream: ms });
          }
        } catch { /* ignore */ }
        break;
      }
      case 'hangup':
      case 'destroy':
        this.dialogs.delete(dialog.callID);
        this.emit({ type: 'hangup', dialog, cause: d?.cause });
        break;
      case 'held':
        this.emit({ type: 'progress', dialog });
        break;
      default:
        break;
    }
  }

  private wrap(d: any): VertoDialog {
    const callID: string = d.callID;
    const existing = this.dialogs.get(callID);
    if (existing) return existing;
    const wrapped: VertoDialog = {
      callID,
      hangup: () => d.hangup(),
      answer: (opts?: any) => d.answer(opts || { useMic: true, useCamera: false, useVideo: false }),
      dtmf: (digit: string) => d.dtmf(digit),
      hold: () => d.hold(),
      unhold: () => d.unhold(),
      toggleHold: () => d.toggleHold(),
      rtc: d.rtc,
    };
    this.dialogs.set(callID, wrapped);
    return wrapped;
  }

  call(destination: string, callerIdName: string, callerIdNumber: string): VertoDialog | null {
    if (!this.verto) throw new Error('Verto not initialized');
    const d = this.verto.newCall({
      destination_number: destination,
      caller_id_name: callerIdName,
      caller_id_number: callerIdNumber,
      useVideo: false,
      useCamera: false,
      useMic: true,
      dedEnc: false,
    });
    return d ? this.wrap(d) : null;
  }

  hangupAll() {
    if (!this.verto) return;
    for (const d of this.dialogs.values()) {
      try { d.hangup(); } catch { /* ignore */ }
    }
    this.dialogs.clear();
  }

  disconnect() {
    try { this.verto?.logout?.(); } catch { /* ignore */ }
    this.verto = null;
    this.connected = false;
    this.dialogs.clear();
  }
}

// Singleton — matches the JsSIP UA lifecycle model used elsewhere.
let singleton: VertoClient | null = null;
export function getVertoClient(): VertoClient {
  if (!singleton) singleton = new VertoClient();
  return singleton;
}

/** Convenience: initialize + register. Resolves on onWSLogin. */
export async function initVerto(cfg: VertoConfig): Promise<VertoClient> {
  const c = getVertoClient();
  await c.connect(cfg);
  return c;
}

export function vertoCall(destination: string, callerName: string, callerNumber?: string): VertoDialog | null {
  return getVertoClient().call(destination, callerName, callerNumber || callerName);
}

export function vertoHangup(): void {
  getVertoClient().hangupAll();
}
