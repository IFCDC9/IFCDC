import "dotenv/config";
import express from "express";
import cors from "cors";
import { createPaymentRouter } from "./router.js";

const PORT = parseInt(process.env.PAYMENT_SERVICE_PORT || "4103", 10);
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

const stripeKey = process.env.STRIPE_SECRET_KEY || "";
const { router } = createPaymentRouter(stripeKey, process.env.STRIPE_WEBHOOK_SECRET);
app.use("/api/payments", router);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ service: "ifcdc-payments", status: stripeKey ? "healthy" : "degraded", version: "1.0.0" });
});

app.listen(PORT, () => {
  console.log(`[IFCDC Payment Service] Running on port ${PORT}`);
});
