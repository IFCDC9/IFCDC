import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import { getDataDir, getDbPath } from "./config/dataPaths";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;

  getDataDir();

  db = await open({
    filename: getDbPath(),
    driver: sqlite3.Database,
  });

  return db;
}

export { db };
