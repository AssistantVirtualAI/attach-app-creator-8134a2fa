# Restore the complete Maestro Communications pipeline

## Confirmed diagnosis

- SMS is delivered by the telecom provider, but the latest Maestro message pushes fail with HTTP 500 on the broker-scoped messages endpoint.
- Recent call pushes also fail with HTTP 500 during CDR creation. Of 37 calls from the last seven days, 18 have no Maestro call ID.
- Without that Maestro call ID, recordings, transcripts, AI summaries and coaching cannot be attached to the Maestro Communication record.
- The local pipeline contains recent transcripts and AI analyses, so “processed locally” must no longer be reported as “synced to Maestro.”

## Fix

1. **Correct the Maestro write contract**
   - Validate the exact broker-scoped endpoints and accepted payload fields for SMS and calls.
   - Use the freshly resolved broker Maestro ID and the matched Maestro client/contact ID on every write.
   - Separate call creation from updates so only fields accepted by each endpoint are sent.

2. **Make one call the parent communication record**
   - Create or recover the Maestro call record first and persist its returned ID.
   - Attach recording permalink, transcript, AI summary, key points, next actions and coaching notes to that same record.
   - Never mark a downstream stage successful when its Maestro parent record is missing.

3. **Reliable retries and backfill**
   - Classify 4xx failures as configuration/payload errors and 5xx failures as retryable.
   - Add bounded exponential retries and preserve idempotency keys to prevent duplicate SMS or call records.
   - Replay unsynced recent SMS and calls after the corrected contract succeeds, then process their recording/transcription/AI stages.

4. **Truthful status and diagnostics**
   - Keep one `correlation_id` across SMS/call creation and every downstream stage.
   - Record endpoint, broker ID, contact ID, Maestro object ID, HTTP status and sanitized response.
   - Distinguish `local_success`, `maestro_pending`, `maestro_synced` and `maestro_failed` in the pipeline/admin status.

5. **End-to-end verification**
   - Test one outbound SMS, one inbound SMS, one outbound call and one inbound call using the active broker account.
   - Verify each item visibly appears in Maestro Communications under the correct customer.
   - Verify call log, playable recording, transcript, AI summary and coaching are attached once, with no duplicates.
   - Produce a correlation-ID test report for every stage and backfill result.

## Technical scope

- Backend functions: `maestro-sync-message`, `maestro-cdr`, `maestro-recording-upload`, transcript/AI pipeline functions and shared Maestro request helpers.
- Database: existing call/message synchronization fields, retry queue and pipeline logs; schema changes only if current retry state cannot represent the required statuses.
- No changes to SIP calling, native audio, Microsoft authentication or mobile navigation.