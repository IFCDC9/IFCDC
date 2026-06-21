import { createAuthService, createAuthMiddleware, type TokenPayload } from "@ifcdc/auth";
import { Router, type Request, type Response } from "express";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  role: z.string().optional(),
});

export interface AuthServiceConfig {
  jwtSecret: string;
  expiresIn?: string;
  onLogin?: (email: string, password: string) => Promise<TokenPayload | null>;
  onRegister?: (data: z.infer<typeof registerSchema>) => Promise<TokenPayload | null>;
}

export function createAuthRouter(config: AuthServiceConfig) {
  const auth = createAuthService({ jwtSecret: config.jwtSecret, expiresIn: config.expiresIn });
  const router = Router();

  router.post("/login", async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid credentials format" });

    if (!config.onLogin) return res.status(501).json({ error: "Login handler not configured" });

    const payload = await config.onLogin(parsed.data.email, parsed.data.password);
    if (!payload) return res.status(401).json({ error: "Invalid credentials" });

    res.json({ token: auth.signToken(payload), user: payload });
  });

  router.post("/register", async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    if (!config.onRegister) return res.status(501).json({ error: "Register handler not configured" });

    const payload = await config.onRegister(parsed.data);
    if (!payload) return res.status(409).json({ error: "Registration failed" });

    res.status(201).json({ token: auth.signToken(payload), user: payload });
  });

  router.post("/verify", (req: Request, res: Response) => {
    const token = req.body.token || req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(400).json({ error: "Token required" });

    const payload = auth.verifyToken(token);
    if (!payload) return res.status(401).json({ error: "Invalid token" });

    res.json({ valid: true, user: payload });
  });

  router.get("/me", createAuthMiddleware({ jwtSecret: config.jwtSecret }), (req: Request, res: Response) => {
    res.json({ user: (req as { user?: TokenPayload }).user });
  });

  return { router, auth, middleware: createAuthMiddleware({ jwtSecret: config.jwtSecret }) };
}

export { createAuthService, createAuthMiddleware };
