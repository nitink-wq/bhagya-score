import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import type { AppConfig } from '../config';

/**
 * Generic Postgres client.
 *
 * Talks the standard Postgres wire protocol via `pg`, so it connects to ANY
 * Postgres-compliant database (self-hosted, RDS/Aurora, Cloud SQL, Supabase, ...)
 * purely through a connection string. No vendor SDK, nothing app-specific here —
 * this class is the single seam the rest of the app uses to reach the database.
 *
 * One Pool per process/pod; sized by DB_POOL_MAX so that (pods × poolMax) stays
 * under the database's max_connections.
 */
export class Database {
  private readonly pool: Pool;

  constructor(cfg: AppConfig) {
    this.pool = new Pool({
      connectionString: cfg.databaseUrl,
      max: cfg.db.poolMax,
      idleTimeoutMillis: cfg.db.idleTimeoutMs,
      connectionTimeoutMillis: cfg.db.connectionTimeoutMs,
      // Enable TLS for managed Postgres by appending ?sslmode=require to DATABASE_URL.
      application_name: 'bhagya-score',
    });

    // A pooled connection can drop (DB restart, failover). Log and let pg recycle it
    // instead of crashing the pod.
    this.pool.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error({ err: err.message }, 'idle postgres client error');
    });
  }

  /** Parameterised query. Always pass values via `params` — never string-concatenate SQL. */
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params as unknown[]);
  }

  /** Run several statements on one connection (e.g. inside a transaction). */
  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /** Cheap round-trip used by the K8s readiness probe. */
  async healthcheck(): Promise<boolean> {
    await this.pool.query('SELECT 1');
    return true;
  }

  /** Drain the pool on shutdown so rolling deploys don't sever in-flight queries. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
