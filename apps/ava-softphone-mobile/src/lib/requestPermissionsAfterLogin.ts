import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

async function log(step: string, data?: any) {
  const msg = `[Perms][${new Date().toISOString()}] ${step}${data !== undefined ? ' ' + safeStringify(data) : ''}`;
  // eslint-disable-next-line no-console
  console.log(msg);
  try {
    const { value } = await Preferences.get({ key: 'perm_log' });
    const logs = value ? value + '\n' + msg : msg;
    await Preferences.set({ key: 'perm_log', value: logs.slice(-5000) });
  } catch {}
}

function safeStringify(v: any): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

export async function requestPermissionsAfterLogin(): Promise<void> {
  await log('START', { platform: safeGetPlatform(), isNative: safeIsNative() });

  if (!Capacitor.isNativePlatform()) {
    await log('SKIP - not native');
    return;
  }

  const platform = Capacitor.getPlatform();

  // Idempotency flag (v2 so old installs re-run once with logging)
  try {
    await log('CHECK v2 flag');
    const { value } = await Preferences.get({ key: 'permissions_requested_v2' });
    await log('v2 flag value', { value });
    if (value === 'true') {
      await log('SKIP - already done');
      return;
    }
  } catch (e) {
    await log('ERROR checking v2 flag', { error: String(e) });
  }

  // STEP A: Import PushNotifications
  await log('STEP A: importing PushNotifications');
  let PushNotifications: any = null;
  try {
    const mod = await import('@capacitor/push-notifications');
    PushNotifications = mod.PushNotifications;
    await log('STEP A: import success');
  } catch (e) {
    await log('STEP A: import FAILED', { error: String(e) });
    PushNotifications = null;
  }

  // STEP B: Add listeners
  if (PushNotifications) {
    await log('STEP B: adding registration listener');
    try {
      await PushNotifications.addListener('registration', (token: any) => {
        void log('FCM token received', { token: token?.value?.slice(0, 20) });
      });
      await log('STEP B: registration listener added');
    } catch (e) {
      await log('STEP B: addListener registration FAILED', { error: String(e) });
    }

    try {
      await PushNotifications.addListener('registrationError', (error: any) => {
        void log('FCM registration error', { error: String(error) });
      });
      await log('STEP B: registrationError listener added');
    } catch (e) {
      await log('STEP B: addListener registrationError FAILED', { error: String(e) });
    }
  }

  // STEP C: checkPermissions
  await log('STEP C: checkPermissions');
  let permStatus: any = null;
  try {
    permStatus = await PushNotifications?.checkPermissions();
    await log('STEP C: status', { receive: permStatus?.receive });
  } catch (e) {
    await log('STEP C: checkPermissions FAILED', { error: String(e) });
  }

  // STEP D: requestPermissions + register
  await log('STEP D: requestPermissions', { currentStatus: permStatus?.receive });
  try {
    if (permStatus?.receive === 'prompt' || permStatus?.receive === 'prompt-with-rationale') {
      await log('STEP D: showing permission dialog');
      const result = await PushNotifications?.requestPermissions();
      await log('STEP D: result', { receive: result?.receive });
      if (result?.receive === 'granted') {
        await log('STEP D: calling register()');
        await PushNotifications?.register();
        await log('STEP D: register() success');
      }
    } else if (permStatus?.receive === 'granted') {
      await log('STEP D: already granted, calling register()');
      try {
        await PushNotifications?.register();
        await log('STEP D: register() success');
      } catch (e) {
        await log('STEP D: register() FAILED', { error: String(e) });
      }
    } else {
      await log('STEP D: skipping', { status: permStatus?.receive });
    }
  } catch (e) {
    await log('STEP D: CRASHED', { error: String(e), stack: (e as any)?.stack });
  }

  // STEP E: Microphone (iOS only)
  await log('STEP E: microphone check', { platform });
  if (platform === 'ios') {
    try {
      await log('STEP E: calling getUserMedia');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await log('STEP E: microphone granted');
    } catch (e) {
      await log('STEP E: microphone FAILED', { error: String(e) });
    }
  } else {
    await log('STEP E: skipping microphone on Android');
  }

  // STEP F: Contacts (iOS only)
  await log('STEP F: contacts check', { platform });
  if (platform === 'ios') {
    try {
      await log('STEP F: importing Contacts');
      const { Contacts } = await import('@capacitor-community/contacts');
      await log('STEP F: requesting contacts permission');
      await (Contacts as any).requestPermissions();
      await log('STEP F: contacts done');
    } catch (e) {
      await log('STEP F: contacts FAILED', { error: String(e) });
    }
  } else {
    await log('STEP F: skipping contacts on Android');
  }

  // Save flag
  await log('SAVING flag v2');
  try {
    await Preferences.set({ key: 'permissions_requested_v2', value: 'true' });
    await log('FLAG SAVED - all done');
  } catch (e) {
    await log('FLAG SAVE FAILED', { error: String(e) });
  }
}

function safeGetPlatform(): string {
  try { return Capacitor.getPlatform(); } catch { return 'unknown'; }
}
function safeIsNative(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export async function getPermissionLogs(): Promise<string> {
  try {
    const { value } = await Preferences.get({ key: 'perm_log' });
    return value || 'No logs found';
  } catch (e) {
    return 'Error reading logs: ' + String(e);
  }
}

export async function clearPermissionLogs(): Promise<void> {
  try { await Preferences.remove({ key: 'perm_log' }); } catch {}
}
