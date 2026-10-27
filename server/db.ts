import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import { getDataDir, getDbPath } from "./config/dataPaths";

let db: Database | null = null;
let opening: Promise<Database> | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;

  if (!opening) opening = (async () => {
    getDataDir();
    const connection = await open({ filename: getDbPath(), driver: sqlite3.Database });
    try {
      await connection.exec("PRAGMA busy_timeout = 5000");
      db = connection;
      return connection;
    } catch (error) {
      await connection.close();
      throw error;
    }
  })().catch(error => { opening = null; throw error; });
  return opening;
}

export { db };
