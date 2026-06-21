import "dotenv/config";
import express from "express";
import cors from "cors";
import { createNotificationRouter } from "./router.js";

const PORT = parseInt(process.env.NOTIFICATION_SERVICE_PORT || "4102", 10);
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

const { router } = createNotificationRouter();
app.use("/api/notifications", router);

app.get("/health", (_req, res) => {
  res.json({ service: "ifcdc-notifications", status: "healthy", version: "1.0.0" });
});

app.listen(PORT, () => {
  console.log(`[IFCDC Notification Service] Running on port ${PORT}`);
});
