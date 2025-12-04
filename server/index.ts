import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import { createServer } from "http";
import { registerRoutes } from "./routes/index";
import { config } from "./config/env";

const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Static assets (HTML/CSS/JS) from /public
const publicDir = path.join(import.meta.dirname, "..", "public");
app.use(express.static(publicDir));

// Home route
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Mental Health Program page
app.get("/mental-health", (req, res) => {
  res.sendFile(path.join(publicDir, "mental-health.html"));
});

// Records & Privacy policy page
app.get("/records-policy", (req, res) => {
  res.sendFile(path.join(publicDir, "records-policy.html"));
});

// Programs page
app.get("/programs", (req, res) => {
  res.sendFile(path.join(publicDir, "programs.html"));
});

// Contact page
app.get("/contact", (req, res) => {
  res.sendFile(path.join(publicDir, "contact.html"));
});

// ROI Form (printable)
app.get("/roi", (req, res) => {
  res.sendFile(path.join(publicDir, "roi.html"));
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

app.get("/api", (req, res) => {
  res.json({ status: "ok", service: "IFCDC Manual API" });
});

registerRoutes(app);

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  res.status(status).json({ message });
  console.error(err);
});

(async () => {
  if (config.nodeEnv === "development") {
    const { createServer: createViteServer } = await import("vite");
    const path = await import("path");
    
    const vite = await createViteServer({
      configFile: path.resolve(import.meta.dirname, "../vite.config.ts"),
      server: {
        middlewareMode: true,
        hmr: { server },
      },
    });

    app.use(vite.middlewares);

    app.use("*", async (req, res, next) => {
      if (req.originalUrl.startsWith("/api")) {
        return next();
      }

      try {
        const fs = await import("fs/promises");
        const clientTemplate = path.resolve(
          import.meta.dirname,
          "../client/index.html"
        );
        let template = await fs.readFile(clientTemplate, "utf-8");
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  }

  server.listen(config.port, "0.0.0.0", () => {
    log(`IFCDC Portal running on port ${config.port}`);
  });
})();
