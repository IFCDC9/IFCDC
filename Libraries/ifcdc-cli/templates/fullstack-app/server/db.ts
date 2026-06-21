import { createDatabase, requireEnv } from "@ifcdc/database";
import * as schema from "@shared/schema";

const { db, healthCheck } = createDatabase(
  { connectionString: requireEnv("DATABASE_URL") },
  schema
);

export { db, healthCheck };
