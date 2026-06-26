# @ifcdc/database

Database utilities for IFCDC applications using Drizzle ORM and PostgreSQL.

## Features

- Connection pool management
- Drizzle ORM integration
- Health check endpoint helper
- Environment variable validation

## Usage

```typescript
import { createDatabase, requireEnv } from "@ifcdc/database";
import * as schema from "./schema";

const { db, healthCheck } = createDatabase(
  { connectionString: requireEnv("DATABASE_URL") },
  schema
);
```
