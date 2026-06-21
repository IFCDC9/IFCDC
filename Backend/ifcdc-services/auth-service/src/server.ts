import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createAuthRouter } from "./router.js";

const PORT = parseInt(process.env.AUTH_SERVICE_PORT || "4100", 10);
const JWT_SECRET = process.env.JWT_SECRET || "DEV_ONLY_CHANGE_ME_IFCDC_AUTH";

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

const { router } = createAuthRouter({
  jwtSecret: JWT_SECRET,
  expiresIn: "12h",
  onLogin: async (email, password) => {
    // Default dev handler — apps override via their own auth integration
    if (process.env.NODE_ENV === "development" && email === "admin@ifcdc.org") {
      return { userId: "dev-admin", email, role: "admin" };
    }
    return null;
  },
});

app.use("/api/auth", router);

app.get("/health", (_req, res) => {
  res.json({ service: "ifcdc-auth", status: "healthy", version: "1.0.0" });
});

app.listen(PORT, () => {
  console.log(`[IFCDC Auth Service] Running on port ${PORT}`);
});

export { app };
