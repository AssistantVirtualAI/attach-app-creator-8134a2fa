import { describe, expect, it, vi } from 'vitest';
import { fetchLemtelProvisioning, lemtelProvisioningMessage, lemtelProvisioningRefreshDelayMs, parseLemtelProvisioning, toLemtelSipSettings } from './lemtelSoftphoneProvisioning';

const ready = {
  schema: 'lemtel_softphone_provisioning_v1', status: 'ready', connectionRevision: 3, credentialRevision: 1, expiresAt: '2026-10-19T12:15:00.000Z',
  telephony: { sipDomain: 'lemtel.lemtel.tel', extension: '1042', authorizationUser: '1042', displayName: 'Alice', wssUrls: ['wss://pbxnode.lemtel.tel:7443'],
    outboundProxy: null, registerExpires: 300, codecs: ['opus', 'PCMU'], srtpMode: 'dtls_srtp', password: 'Ext1042!Pass' },
  media: { iceServers: [{ urls: ['stun:turn.lemtel.tel:3478'] }, { urls: ['turns:turn.lemtel.tel:5349?transport=tcp'], username: '1:abc', credential: 'c' }], iceTransportPolicy: 'all' },
};

describe('Lemtel softphone provisioning contract (shared by Mobile and Desktop)', () => {
  it('maps a ready answer to the exact SIP stack settings', () => {
    const p = parseLemtelProvisioning(ready);
    expect(p?.status).toBe('ready');
    const s = toLemtelSipSettings(p as Extract<NonNullable<typeof p>, { status: 'ready' }>);
    expect(s).toMatchObject({ extension: '1042', sipDomain: 'lemtel.lemtel.tel', wssUrl: 'wss://pbxnode.lemtel.tel:7443', authUsername: '1042', registerExpires: 300, password: 'Ext1042!Pass' });
    expect(s.iceServers[1]).toEqual({ urls: ['turns:turn.lemtel.tel:5349?transport=tcp'], username: '1:abc', credential: 'c' });
  });
  it('fails closed on anything unexpected', () => {
    expect(parseLemtelProvisioning({ ...ready, schema: 'other' })).toBeNull();
    expect(parseLemtelProvisioning({ ...ready, telephony: { ...ready.telephony, wssUrls: ['ws://pbx:5066'] } })).toBeNull();
    expect(parseLemtelProvisioning({ ...ready, telephony: { ...ready.telephony, wssUrls: ['wss://u:p@pbx.tel:7443'] } })).toBeNull();
    expect(parseLemtelProvisioning({ ...ready, telephony: { ...ready.telephony, password: '' } })).toBeNull();
    expect(parseLemtelProvisioning({ ...ready, media: { iceServers: [{ urls: ['http://x'] }], iceTransportPolicy: 'all' } })).toBeNull();
    expect(parseLemtelProvisioning({ schema: 'lemtel_softphone_provisioning_v1', status: 'whatever' })).toBeNull();
    expect(parseLemtelProvisioning({ schema: 'lemtel_softphone_provisioning_v1', status: 'pending_activation' })).toEqual({ status: 'pending_activation' });
  });
  it('calls the server with the client kind and never caches', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(ready), { status: 200 }));
    await fetchLemtelProvisioning('https://lemtel.assistantvirtualai.com', 'pk', 'jwt', 'desktop', fetcher);
    expect(fetcher).toHaveBeenCalledWith('https://lemtel.assistantvirtualai.com/functions/v1/lemtel-softphone-provisioning', expect.objectContaining({
      method: 'GET', cache: 'no-store', headers: { apikey: 'pk', Authorization: 'Bearer jwt', 'X-Lemtel-Client': 'desktop' } }));
    const denied = vi.fn(async () => new Response(JSON.stringify({ error: 'lemtel_active_client_access_required' }), { status: 403 }));
    await expect(fetchLemtelProvisioning('https://x.tel', 'pk', 'jwt', 'mobile', denied)).rejects.toMatchObject({ code: 'lemtel_active_client_access_required', status: 403 });
  });
  it('explains every non-ready state and refreshes before expiry', () => {
    for (const s of ['not_assigned', 'not_provisioned', 'pending_activation', 'suspended', 'delivery_disabled', 'credential_missing']) expect(lemtelProvisioningMessage(s)).not.toMatch(/indisponible \(/);
    expect(lemtelProvisioningRefreshDelayMs('2026-10-19T12:15:00.000Z', Date.parse('2026-10-19T12:00:00.000Z'))).toBe(14 * 60_000);
  });
});
