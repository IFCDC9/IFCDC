import { Router } from "express";
import type { Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { hqAuthRequired, requireHQPermission } from "../middleware/hqAuth";
import { resolveHqFilePath, saveHqFileBase64, verifyHqFileAccess } from "../hq/hqFileStorage";

const router = Router();

router.use(hqAuthRequired, requireHQPermission("hq.settings", "hq.grants.manage", "hq.hr.manage", "hq.executive"));

router.post("/upload", async (req: Request, res: Response) => {
  const { fileName, base64, mimeType, access_level } = req.body ?? {};
  if (!fileName || !base64) {
    return res.status(400).json({ error: "fileName and base64 are required" });
  }
  try {
    const saved = await saveHqFileBase64(
      String(fileName),
      String(base64),
      mimeType ? String(mimeType) : undefined,
      req.hqUser?.email ?? "unknown",
      access_level ?? "internal"
    );
    res.status(201).json({ file: saved });
  } catch (error) {
    console.error("HQ file upload error:", error);
    res.status(500).json({ error: "Failed to store file" });
  }
});

router.get("/:storedName", async (req, res) => {
  const storedName = path.basename(req.params.storedName);
  const allowed = await verifyHqFileAccess(storedName, req.hqUser?.role ?? "", req.hqUser?.email);
  if (!allowed) return res.status(403).json({ error: "Access denied for this file" });

  const filePath = resolveHqFilePath(storedName);
  if (!filePath) return res.status(400).json({ error: "Invalid file name" });
  try {
    await fs.access(filePath);
    res.sendFile(path.resolve(filePath));
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

export default router;
