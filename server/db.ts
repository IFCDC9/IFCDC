import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import path from "path";
import fs from "fs";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;
  
  const dataDir = path.join(import.meta.dirname, "..", "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = await open({
    filename: path.join(dataDir, "ifcdc.db"),
    driver: sqlite3.Database,
  });

  return db;
}

export { db };
