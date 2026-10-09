# Project Architecture Rules

- Planipret APNs alert, background and VoIP pushes use one server-only persisted provider-token cache with atomic renewal and local single-flight reuse; independent worker signing triggers Apple's refresh limits.

- Planipret call and recording transcripts share the speaker-message renderer in both web source trees; speaker identity comes only from explicit source labels, never inferred dialogue turns.

- Maestro task completion uses the documented soft-delete endpoint and a complete GET read-back; never invent a status option ID or trust mutation success alone.
- AVA customer lookup is profile-first: show verified Maestro details before contact actions, and offer calls, SMS, or email only when explicitly requested.
- Every answered inbound or outbound call requires a persisted post-call CRM/AVA decision; recordings remain in AVA and CRM delivery requires an explicit user action.
- Lemtel UC lives only in src/pages/lemtel-uc, src/components/lemtel-uc, luc_* tables and luc-* functions; never touches Planipret/pbx/legacy Lemtel data — isolation required by product owner.
