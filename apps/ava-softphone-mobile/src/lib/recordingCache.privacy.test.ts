// Phase 30A — entirely local mocks, including native Capacitor filesystem.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  native: false, load: vi.fn(), fetch: vi.fn(),
  stat: vi.fn(), getUri: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(), rmdir: vi.fn(), deleteFile: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: {
  isNativePlatform: () => h.native,
  convertFileSrc: (url: string) => `capacitor://${url}`,
} }));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { stat: h.stat, getUri: h.getUri, mkdir: h.mkdir, writeFile: h.writeFile, rmdir: h.rmdir, deleteFile: h.deleteFile },
  Directory: { Data: 'DATA' },
}));
vi.mock('./mobileSupabase', () => ({ loadPbxRecordingAudioMobile: h.load }));

import { clearRecordingCache, downloadRecording, getCachedRecordingUrl, type RecordingScope } from './recordingCache';

const a: RecordingScope = { userId: 'user-a', organizationId: 'org-a', extension: '201' };
const b: RecordingScope = { userId: 'user-b', organizationId: 'org-a', extension: '201' };
const meta = { xml_cdr_uuid: 'cdr-1', recording_name: 'example.wav' };
const audio = { type: 'audio/wav', size: 512, arrayBuffer: async () => new Uint8Array(512).buffer };

beforeEach(async () => {
  h.native = false;
  await clearRecordingCache();
  for (const mock of [h.load, h.fetch, h.stat, h.getUri, h.mkdir, h.writeFile, h.rmdir, h.deleteFile]) mock.mockReset();
  h.load.mockResolvedValue('https://signed.invalid/audio');
  h.fetch.mockResolvedValue({ ok: true, headers: { get: (k: string) => k === 'content-type' ? 'audio/wav' : '512' }, blob: async () => audio });
  h.stat.mockRejectedValue(new Error('not found'));
  h.getUri.mockImplementation(async ({ path }: { path: string }) => ({ uri: path }));
  h.mkdir.mockResolvedValue(undefined); h.writeFile.mockResolvedValue(undefined); h.rmdir.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', h.fetch);
  vi.stubGlobal('btoa', (text: string) => Buffer.from(text, 'binary').toString('base64'));
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:recording-a'), revokeObjectURL: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('Phase 30A — scoped recording cache', () => {
  it('requires a complete authenticated scope before using disk or network', async () => {
    expect(await getCachedRecordingUrl('cdr-1')).toBeNull();
    await expect(downloadRecording('cdr-1', meta, null, null, null)).rejects.toThrow('scope required');
    expect(h.load).not.toHaveBeenCalled();
  });

  it('a cached web recording is not visible to another user and is revoked at logout', async () => {
    const url = await downloadRecording('cdr-1', meta, 'jwt', 'org-a', null, { scope: a });
    expect(url).toBe('blob:recording-a');
    expect(await getCachedRecordingUrl('cdr-1', a)).toBe(url);
    expect(await getCachedRecordingUrl('cdr-1', b)).toBeNull();
    expect(await getCachedRecordingUrl('cdr-1', { ...a, extension: '202' })).toBeNull();
    expect(await getCachedRecordingUrl('cdr-1', { ...a, organizationId: 'org-b' })).toBeNull();
    await clearRecordingCache();
    expect(await getCachedRecordingUrl('cdr-1', a)).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it('native probes and writes only namespaced v2 paths, never legacy ownerless audio', async () => {
    h.native = true;
    expect(await getCachedRecordingUrl('cdr-1', a)).toBeNull();
    expect(h.stat.mock.calls.every(([opts]) => String(opts.path).startsWith('recordings/v2/user-a-org-a-201/'))).toBe(true);
    await downloadRecording('cdr-1', meta, 'jwt', 'org-a', null, { scope: a });
    expect(h.writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'recordings/v2/user-a-org-a-201/cdr-1.wav', directory: 'DATA' }));
    expect(await getCachedRecordingUrl('cdr-1', b)).toBeNull();
    await clearRecordingCache();
    expect(h.rmdir).toHaveBeenCalledWith({ path: 'recordings', directory: 'DATA', recursive: true });
  });

  it('a download completed after logout cannot write an old account blob', async () => {
    let finish!: (response: any) => void;
    h.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = downloadRecording('cdr-1', meta, 'jwt', 'org-a', null, { scope: a });
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
    await clearRecordingCache();
    finish({ ok: true, headers: { get: () => 'audio/wav' }, blob: async () => audio });
    await expect(pending).rejects.toThrow('Recording session changed');
    expect(await getCachedRecordingUrl('cdr-1', a)).toBeNull();
  });
});
