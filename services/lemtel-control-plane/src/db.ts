import pg from "pg";

export type AuditInput = { action: string; requestId?: string };

export interface AuditStore {
  recordAudit(e: AuditInput): Promise<{ duplicate: boolean }>;
}

export interface Pingable { ping(): Promise<void> }

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 2000, statement_timeout: 2000 });
}

export class PgStore implements AuditStore, Pingable {
  constructor(private readonly pool: pg.Pool) {}
  async ping(): Promise<void> { await this.pool.query("SELECT 1"); }
  async recordAudit(e: AuditInput): Promise<{ duplicate: boolean }> {
    const r = await this.pool.query(
      "INSERT INTO control_plane_audit_events (action, request_id) VALUES ($1, $2) ON CONFLICT (request_id) WHERE request_id IS NOT NULL DO NOTHING",
      [e.action, e.requestId ?? null],
    );
    return { duplicate: r.rowCount === 0 };
  }
}
