# Scott: widget handoff integration

POST `{backendHost}/functions/v1/pp-call-handoff`.
Headers: `Content-Type: application/json`, `Authorization: Bearer <MAESTRO_MACHINE_API_KEY>` (server-to-server only; never ship this key in browser code). Supabase clients may instead use their broker JWT, omitting `user_id`. If required by your gateway, also supply `apikey: <public Supabase anon key>`.

Machine status body: `{"action":"status","target":"mobile","user_id":"<Maestro broker ID>"}`.
App status body: `{"action":"status","target":"widget"}`.
Successful status response: `{"registered":true}` or `{"registered":false}` (no identity/device details).
Transfer body: `{"target":"mobile","user_id":"<Maestro broker ID>","call_id":"<owned active call ID>"}`. `call_id` may be omitted only when exactly one owned active call exists; target may also be `widget`.

Transfer accepted: `{"ok":true,"status":"handoff_requested","error_code":null}`. This is acceptance, NOT proof of answer.
Errors: `{"ok":false,"status":"refused|unavailable|failed","error_code":"..."}`.
Codes: `method_not_allowed` (405), `unauthorized` (401), `authentication_or_profile` (401/403/404), `invalid_input` (400), `profile_unavailable` (403), `device_lookup_failed` (502), `target_not_registered` (409), `call_lookup_failed` (502), `call_not_owned_or_ambiguous` (403), `remote_leg_unavailable` (409), `provider_refused` (502), `request_failed` (500).

Register the widget ONLY as `<ext>x`, never `<ext>M` or legacy `<ext>W`. Do not auto-answer; accept transferred calls as normal incoming calls. Profiles/extensions/domains are resolved server-side. Registrations are checked before transfer; v45 Device registration fields are used only if the registrations endpoint returns 404/405.

The backend transfers the provider-reported remote leg to `sip:<ext>x@domain` or `sip:<ext>M@domain`; it never hangs up the source. NS must own answer/completion and rollback. The supplied docs do not specify a 20-second timeout/no-voicemail option or remote-leg field contract: these guarantees require provider verification, not an invented parameter. Missing remote-leg evidence is refused. The UI deliberately does not declare success from HTTP acceptance or local termination alone; confirmed-success signaling remains pending.

## Notifications (disabled until Scott approves)

Under `PP_WIDGET_CALL_EVENTS=1`, POST to the configured Maestro telecom `/sync`, using the existing server-side telecom authentication:

- `{event:"call_active"|"call_ended",user_id,external_user_id,call_id,direction:"inbound"|"outbound",started_at,device:"mobile"|"widget"}`
- `{event:"recording_ready"|"transcript_ready",user_id,external_user_id,resource_id}`
- `{event:"sms",user_id,external_user_id,resource_id,direction:"inbound"|"outbound"}`

Only allowlisted fields leave the backend: no phone numbers, SMS bodies, transcript text, recording URLs or tokens. Delivery is non-blocking, best-effort, debounced; resources must be fetched through existing authorized APIs. Hooks cover CDR recordings, NS/admin transcript persistence and the existing inbound/outbound Maestro SMS sync path; not every historical/backfill ingestion path has been verified.

## Delivery and remaining acceptance

No schema migration: history uses existing `ns_orig_callid` and metadata. Both web UI copies are identical. Live app→widget and widget→app tests, unanswered rollback/no voicemail, success confirmation and SMS round-trip verification remain required; no real call was placed. Deployment unavailable: CLI reports no access token. Deploy `pp-call-handoff` (gateway JWT verification off; handler authenticates both paths), `ns-webhook-receiver`, `ns-transcription`, `pp-admin-transcribe`, `maestro-sync-message`; redeploy existing importers of `_shared/maestro-widget-sync.ts` if updating shared code in their bundles. JWT/machine integration and unregistered-response handler tests remain to be completed.
