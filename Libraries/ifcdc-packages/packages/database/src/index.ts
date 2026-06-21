import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

export interface DatabaseConfig {
  connectionString: string;
  maxConnections?: number;
  ssl?: boolean;
}

export function createDatabase<TSchema extends Record<string, unknown>>(
  config: DatabaseConfig,
  schema: TSchema
) {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 10,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  });

  const db = drizzle(pool, { schema });

  return {
    db: db as NodePgDatabase<TSchema>,
    pool,
    async healthCheck(): Promise<boolean> {
      try {
        const client = await pool.connect();
        await client.query("SELECT 1");
        client.release();
        return true;
      } catch {
        return false;
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export { drizzle, pg };
