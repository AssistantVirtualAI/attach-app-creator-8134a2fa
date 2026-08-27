# Plan: Maestro Data Sync Dashboard (admin)

## Goal

Create a comprehensive real-time dashboard in the Planiprêt admin portal (accessible to Marc and Gilles as `planipret_admin`/`super_admin`) that visualizes **all data flowing to and from Maestro** — calls, SMS, commissions, tasks, recordings, AI summaries — with beautiful charts and full error visibility.

This consolidates and replaces the simpler `PAMaestroMetrics.tsx` I started building earlier into a single comprehensive page.

## Page: `PAMaestroDashboard.tsx`

Route: `/planipret/admin/maestro-dashboard`  
Nav: "Pilotage" section, icon `Activity`, after "Reports".  
Access: `is_planipret_admin` or `is_super_admin` only.

### Data sources (read-only, all existing tables)

| Source | What it shows |
|--------|---------------|
| `planipret_pipeline_logs` | Per-step chain: cdr → recording → transcription → ai_summary → sms, with http_status, errors, correlation_id |
| `planipret_maestro_sync_log` | Raw Maestro API calls: action, endpoint, response_status, duration_ms, success |
| `planipret_phone_calls` | Call-level sync state: maestro_synced, maestro_call_id, pipeline_state |
| `planipret_phone_messages` | SMS push status |
| `planipret_commission_sync_runs` | Commission sync runs: brokers_total, brokers_connected, rows_upserted, errors |
| `planipret_commission_sync_diag` | Per-broker commission sync health: connected, status, reason, http_status, last_ok_at |
| `planipret_edge_function_runs` | Edge function executions: function_name, status, error, duration |
| `planipret_call_job_queue` | Retry queue depth: pending, done, dead |
| `planipret_job_state` | Circuit breaker: active vs paused |

### Layout (top to bottom)

```text
┌─────────────────────────────────────────────────────────┐
│  KPI Row (6 cards)                                       │
│  [Sync rate %] [Calls synced] [SMS pushed] [Commissions] │
│  [Queue pending] [Errors 24h]                            │
├──────────────────────────────┬──────────────────────────┤
│  Sync Activity Timeline      │  Error Breakdown (donut) │
│  (AreaChart, hourly,         │  maestro_404 / put_404 / │
│   success vs error, 24h)     │  maestro_500 / other      │
├──────────────────────────────┼──────────────────────────┤
│  Pipeline Chain Health       │  Per-Endpoint Success     │
│  (BarChart per step:         │  (BarChart, % per        │
│   cdr→rec→trans→ai→sms)     │   Maestro endpoint)       │
├──────────────────────────────┴──────────────────────────┤
│  Commission Sync Status (table: per-broker,             │
│   connected, rows, last_ok, errors)                     │
├─────────────────────────────────────────────────────────┤
│  Circuit Breaker + Queue Controls                       │
│  [status badge] [Process queue] [Resume] [pending/dead]│
├─────────────────────────────────────────────────────────┤
│  Error Log (filterable table, 20 rows)                  │
│  Filters: call_id, deal_id, step, http_status          │
│  Columns: time, correlation_id, step, endpoint,        │
│           http_status, error_message                    │
└─────────────────────────────────────────────────────────┘
```

### Charts (Recharts, already in deps)

1. **Sync Activity Timeline** — `AreaChart` with two series (success/error) over 24h buckets. Auto-refresh every 10s.
2. **Error Breakdown** — `PieChart` (donut) splitting maestro_404, maestro_put_404, maestro_500, other.
3. **Pipeline Chain Health** — `BarChart` per pipeline step (cdr, recording, transcription, ai_summary, sms) showing success/error counts side by side.
4. **Per-Endpoint Success Rate** — `BarChart` (horizontal) showing success % per Maestro endpoint pattern.

### Real-time

- Poll `planipret_pipeline_logs` + `planipret_maestro_sync_log` every **10 seconds** via Supabase query.
- Queue status polled every 30s via `pp-call-queue` function invoke.
- "Actualiser" button for manual refresh.
- Time-range selector: 1h / 6h / 24h / 3d / 7d.

### Filters

- `call_id` text input (exact match on `planipret_pipeline_logs.call_id`)
- `deal_id` text input (search payload JSON)
- Time-range dropdown
- Step filter (dropdown: all / cdr / recording / transcription / ai_summary / sms)
- HTTP status filter (all / 4xx / 5xx)

### i18n

Bilingual `fr`/`en` via `useMplanipretLang`, matching existing admin pages.

### Admin access

- `PlanipretAdminLayout.tsx`: add nav item to "Pilotage" section.
- `App.tsx`: add lazy route `maestro-dashboard`.
- Role gate already handled by `PortalDomainGate` + admin layout auth.

### Circuit breaker controls

- Show paused/active state from `pp-call-queue` status.
- "Reprendre" (resume) button → `pp-call-queue` action `resume`.
- "Traiter la file" (process) button → `pp-call-queue` action `process`.
- Dead jobs count with red badge.

### Commission sync section

- Table from `planipret_commission_sync_diag`: broker name, connected, status, last_ok_at, rows_count, reason.
- Last sync run from `planipret_commission_sync_runs`: brokers_connected/total, rows_upserted, error.

### Edge function health (compact)

- Mini-table from `planipret_edge_function_runs`: function_name, status, error, duration (last 20).
- Error count badge per function.

## Files to create/modify

1. **Create** `src/pages/planipret/admin/PAMaestroDashboard.tsx` — the full dashboard page (replaces the simpler `PAMaestroMetrics.tsx`).
2. **Delete** `src/pages/planipret/admin/PAMaestroMetrics.tsx` — folded into the new page.
3. **Modify** `src/pages/planipret/admin/PlanipretAdminLayout.tsx` — add nav item.
4. **Modify** `src/App.tsx` — add lazy route.
5. **Modify** `src/lib/routePrefetch.ts` — add prefetch entry (if pattern exists).

## Out of scope

- The job queue (`pp-call-queue`), E2E test (`chain_test.ts`), and `pp-connection-audit` notify run are already built/deployed from the earlier turn — this dashboard surfaces their data, it doesn't re-implement them.
- No schema changes needed — all tables already exist.
