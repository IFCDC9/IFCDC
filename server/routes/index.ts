import { Express } from "express";
import healthRoutes from "./health.routes";
import authRoutes from "./auth.routes";
import chaptersRoutes from "./chapters.routes";
import usersRoutes from "./users.routes";
import acknowledgementsRoutes from "./acknowledgements.routes";
import formsRoutes from "./forms.routes";
import reportsRoutes from "./reports.routes";
import queueRoutes from "./queue.routes";
import barbershopRoutes from "./barbershop.routes";
import twilioRoutes from "./twilio.routes";

export function registerRoutes(app: Express): void {
  app.use("/api/health", healthRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/chapters", chaptersRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/acknowledgements", acknowledgementsRoutes);
  app.use("/api/forms", formsRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/queue", queueRoutes);
  app.use("/api/bookings", barbershopRoutes);
  app.use("/twiml", twilioRoutes);
}
