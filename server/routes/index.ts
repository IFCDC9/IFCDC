import { Express } from "express";
import healthRoutes from "./health.routes";
import authRoutes from "./auth.routes";
import chaptersRoutes from "./chapters.routes";
import usersRoutes from "./users.routes";
import acknowledgementsRoutes from "./acknowledgements.routes";

export function registerRoutes(app: Express): void {
  app.use("/api/health", healthRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/chapters", chaptersRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/acknowledgements", acknowledgementsRoutes);
}
