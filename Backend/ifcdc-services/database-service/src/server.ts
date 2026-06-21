import "dotenv/config";
import express from "express";
import cors from "cors";
import { createDatabaseRouter } from "./router.js";

const PORT = parseInt(process.env.DATABASE_SERVICE_PORT || "4104", 10);
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

const { router } = createDatabaseRouter();
app.use("/api/database", router);

app.get("/health", (_req, res) => {
  res.json({ service: "ifcdc-database", status: "healthy", version: "1.0.0" });
});

app.listen(PORT, () => {
  console.log(`[IFCDC Database Service] Running on port ${PORT}`);
});
