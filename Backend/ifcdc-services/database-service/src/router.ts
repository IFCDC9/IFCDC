import { createDatabase, requireEnv } from "@ifcdc/database";
import { Router, type Request, type Response } from "express";

const schema = {} as Record<string, unknown>;

export function createDatabaseRouter(connectionString?: string) {
  const connStr = connectionString ?? process.env.DATABASE_URL;
  const router = Router();

  router.get("/health", async (_req: Request, res: Response) => {
    if (!connStr) {
      return res.json({ healthy: false, error: "DATABASE_URL not configured" });
    }
    try {
      const { healthCheck } = createDatabase({ connectionString: connStr }, schema);
      const healthy = await healthCheck();
      res.json({ healthy, service: "ifcdc-database" });
    } catch (err) {
      res.json({ healthy: false, error: err instanceof Error ? err.message : "Connection failed" });
    }
  });

  router.get("/info", (_req: Request, res: Response) => {
    res.json({
      service: "ifcdc-database",
      orm: "drizzle",
      driver: "postgresql",
      configured: !!connStr,
    });
  });

  return { router, requireEnv, createDatabase };
}
