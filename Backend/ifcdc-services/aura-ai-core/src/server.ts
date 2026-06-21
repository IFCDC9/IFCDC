import "dotenv/config";
import express from "express";
import cors from "cors";
import { createAuraRouter } from "./router.js";

const PORT = parseInt(process.env.AURA_SERVICE_PORT || "4101", 10);
const API_KEY = process.env.OPENAI_API_KEY || "";

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

if (!API_KEY) {
  console.warn("[IFCDC AURA AI Core] OPENAI_API_KEY not set — AI endpoints will fail");
}

const { router } = createAuraRouter(API_KEY);
app.use("/api/aura", router);

app.get("/health", (_req, res) => {
  res.json({ service: "ifcdc-aura-ai", status: API_KEY ? "healthy" : "degraded", version: "1.0.0" });
});

app.listen(PORT, () => {
  console.log(`[IFCDC AURA AI Core] Running on port ${PORT}`);
});
