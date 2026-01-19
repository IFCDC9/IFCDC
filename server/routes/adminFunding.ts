import express from "express";
import { getDb } from "../db";

const router = express.Router();

function cryptoRandomId() {
  return "id_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now().toString(36);
}

router.get("/funding-sources", async (_req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all("SELECT * FROM funding_sources ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error("Error fetching funding sources:", err);
    res.status(500).json({ error: "Failed to fetch funding sources" });
  }
});

router.post("/funding-sources", async (req, res) => {
  try {
    const { name, code, type, agency, notes } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: "Name and code required" });
    }

    const db = await getDb();
    const id = cryptoRandomId();
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO funding_sources (id, source_key, display_name, enabled, sandbox, created_at)
       VALUES (?, ?, ?, 0, 0, ?)`,
      id, code, name, now
    );

    const row = await db.get("SELECT * FROM funding_sources WHERE id = ?", id);
    res.json(row);
  } catch (err) {
    console.error("Error creating funding source:", err);
    res.status(500).json({ error: "Failed to create funding source" });
  }
});

router.delete("/funding-sources/:id", async (req, res) => {
  try {
    const db = await getDb();
    await db.run("DELETE FROM funding_sources WHERE id = ?", req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    console.error("Error deleting funding source:", err);
    res.status(500).json({ error: "Failed to delete funding source" });
  }
});

export default router;
