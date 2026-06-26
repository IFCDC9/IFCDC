import { Request, Response } from "express";

export const check = (req: Request, res: Response) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
};

export const ready = (req: Request, res: Response) => {
  res.json({
    status: "ready",
    timestamp: new Date().toISOString(),
  });
};
