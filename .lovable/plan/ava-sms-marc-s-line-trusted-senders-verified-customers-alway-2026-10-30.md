# AVA SMS (Marc's line) — trusted senders, verified customers, always reply, end-to-end test

## What changes
1. **Your cell (514-216-3359) is trusted**: AVA answers any question with full read access to Marc's info (files, agenda, clients). No security check.
2. **Internal Planiprêt lines (colleague extension or colleague DID)**: trusted too, no security check, read-only.
3. **Customers (external numbers)**: when a question needs file access, AVA asks for **first name, last name and address**. She compares them with the Maestro profile and the texting number. If they match, she can answer any question about the file.
4. **Read-only everywhere**: AVA can never create, change or delete anything in a file or the CRM. The only thing she can still write is booking a meeting in Marc's calendar (already approved). Requests to change something get a polite reply saying Marc will handle it.
5. **Every text gets a reply**: no text goes unanswered. If a request still needs Marc, AVA texts back right away in the customer's language (French or English), for example:
   - FR: « Je suis désolée, je suis l'assistante de Marc et je ne peux pas partager d'informations de votre dossier sans vérification. En attendant que Marc soit disponible, pourriez-vous me donner votre prénom, votre nom complet et votre adresse? Je validerai votre identité avant de vous transmettre vos informations. 😊 »
   - EN: the same text in English.
   Marc is still notified when something needs his review.
6. **Tone**: professional, relaxed, smiling and warm. Short texts, always signed « — AVA, assistante de Marc Maglieri ».

## End-to-end test (on the real pilot line)
Simulated inbound texts go through the real processing flow. Real outbound texts go only to your cell (5142163359) and to one internal extension.
- Internal sender: gets a context-aware reply, no security check.
- Your cell: asks for a file update and gets an answer with no security check.
- External customer: asks "où est mon dossier" → AVA asks for name and address → wrong details are refused politely → correct details get the file update.
- Change request ("change my address"): read-only refusal, no write.
- Full conversation: the reply uses something from earlier in the thread.
- Duplicates: the same message processed twice sends only one text.
- Signature: present exactly once.
- Language: a message in English gets an English reply.
Any failures are fixed and the test is run again. You get a short pass/fail report.

## Risk to accept
Caller ID on a text can be spoofed. Whoever spoofs your cell number would get full read access. Internal lines are trusted the same way.

## Technical details
- `_shared/ava-sms-policy.ts`: `TRUSTED_OWNER_PEERS = ["+15142163359"]`, `senderTier(peer, colleagues)` → `owner | internal | external`. `smsIdentityVerified` adds address matching (normalized civic number plus street, compared against address fields on the Maestro profile). `detectLanguage`. `READ_ONLY_TOOLS` allowlist (search/get client profile/contracts, list tasks/appointments, calendar reads).
- `pp-ava-sms/index.ts`: for owner, internal and verified customers, run a read-only tool loop through `ava-tool-executor` (service role, Marc's `_user_id`), restricted to `READ_ONLY_TOOLS`. Write tools are rejected server-side. `sensitive` jobs still go to `needs_review` with a push to Marc, but now send the fixed bilingual holding text immediately (separate idempotency key `ava-sms-hold:<job>`). On an analysis failure, send the holding text instead of staying silent. Prompt tone updated.
- Verification state is saved on the job (`proposal.identity`) so a customer who already passed doesn't have to repeat it within the same thread for 24h.
- Tests: new cases in `src/test/avaSmsIdentity.test.ts` (tiers, address match, language, read-only allowlist, holding-text idempotency). Existing AVA protection suites must stay green.
- Deploy `pp-ava-sms` only.
