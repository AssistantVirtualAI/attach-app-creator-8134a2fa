import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('./mobileSupabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt-user' } } }) } } }));
import { mobileApi, setAuthToken } from './mobileApi';
import { setLemtelOrganizationId } from './lemtelPbxMobile';

const ORG = '11111111-1111-4111-8111-111111111111';
const json = (body: unknown) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body });
beforeEach(() => { h.fetch.mockReset(); vi.stubGlobal('fetch', h.fetch); setAuthToken('jwt-user'); setLemtelOrganizationId(ORG); });

describe('mobile data comes from the Lemtel gateway (lemtel-pbx)', () => {
  it('recents: own calls through cdr_list, mapped for the Calls screen', async () => {
    h.fetch.mockResolvedValue(json({ total: 2, records: [
      { id: 'c1', direction: 'inbound', callerName: 'Ana', callerNumber: '5145550000', destination: '1001', startAt: '2026-10-19T14:00:00Z', billsec: 60, duration: 70, hangupCause: 'NORMAL_CLEARING', missed: false, hasRecording: true },
      { id: 'c2', direction: 'inbound', callerName: null, callerNumber: '5145550001', destination: '1001', startAt: '2026-10-19T15:00:00Z', billsec: 0, duration: 20, hangupCause: 'NO_ANSWER', missed: true, hasRecording: false },
    ] }));
    const calls = await mobileApi.calls({ rangeDays: 7, limit: 20 });
    const [url, init] = h.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/functions\/v1\/lemtel-pbx$/);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ organizationId: ORG, action: 'cdr_list', limit: 20 });
    expect('extension' in body).toBe(false);
    expect(calls.map((c) => [c.id, c.status, c.hasRecording])).toEqual([['c1', 'answered', true], ['c2', 'missed', false]]);
    expect((await mobileApi.callDetail('c1')).customer).toBe('Ana');
  });

  it('voicemail: own mailbox through self_overview; SMS is an empty inbox, never a broken legacy call', async () => {
    h.fetch.mockResolvedValue(json({ extension: '1001', callerIdName: 'Ana', forwarding: {}, recentCalls: [], writesEnabled: true,
      voicemail: { enabled: true, messages: [{ uuid: 'm1', createdAt: '2026-10-19T14:00:00Z', callerName: 'Bob', callerNumber: '514', seconds: 12, status: '', transcription: null }] } }));
    const vms = await mobileApi.voicemails();
    expect(vms[0]).toMatchObject({ id: 'm1', from: '514', isNew: true, voicemail_message_uuid: 'm1' });
    expect(JSON.parse(String((h.fetch.mock.calls[0] as [string, RequestInit])[1].body)).action).toBe('self_overview');
    expect(await mobileApi.threads()).toEqual([]);
    await expect(mobileApi.sendMessage('t', 'x')).rejects.toThrow('sms_not_available');
  });
});
