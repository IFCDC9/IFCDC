import { Express } from "express";
import healthRoutes from "./health.routes";
import authRoutes from "./auth.routes";
import chaptersRoutes from "./chapters.routes";
import usersRoutes from "./users.routes";
import acknowledgementsRoutes from "./acknowledgements.routes";

export function registerRoutes(app: Express): void {
  app.use("/health", healthRoutes);
  app.use("/auth", authRoutes);
  app.use("/chapters", chaptersRoutes);
  app.use("/users", usersRoutes);
  app.use("/acknowledgements", acknowledgementsRoutes);
}
