import type { Database } from "sqlite";

let monolithDb: Database | null = null;

export function setMonolithDb(db: Database): void {
  monolithDb = db;
}

export function getMonolithDb(): Database {
  if (!monolithDb) {
    throw new Error("Monolith database not initialized");
  }
  return monolithDb;
}
