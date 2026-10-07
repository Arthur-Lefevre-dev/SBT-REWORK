import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieSession from "cookie-session";
import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { env, requireSessionSecret } from "../env.js";
import { adminRoutes } from "./routes/admin.js";
import { publicRoutes } from "./routes/public.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

/** Public origin for Steam OpenID redirects (Vite UI port in dev). */
export function getPublicBaseUrl(apiPort: number): string {
  if (env.BASE_URL) return env.BASE_URL.replace(/\/$/, "");
  // npm run dev:server → API :3001, UI :3000 (proxied)
  if (process.env.npm_lifecycle_event === "dev:server") {
    return "http://localhost:3000";
  }
  return `http://localhost:${apiPort}`;
}

export function createApp(apiPort: number): Express {
  const app = express();
  const sessionSecret = requireSessionSecret();
  const baseUrl = getPublicBaseUrl(apiPort);

  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(
    cookieSession({
      name: "sbt.sid",
      keys: [sessionSecret],
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      httpOnly: true,
    }),
  );

  app.use(publicRoutes());
  app.use(adminRoutes(baseUrl));

  // SPA static (production / npm start). Dev UI is served by Vite on :3000.
  const distDir = path.join(root, "dist");
  app.use(express.static(distDir));
  app.get(
    /^(?!\/api(?:\/|$)|\/admin\/(?:login|callback|logout|ws)).*/,
    (_req, res, next) => {
      res.sendFile(path.join(distDir, "index.html"), (err) => {
        if (err) next();
      });
    },
  );

  const errorHandler: ErrorRequestHandler = (
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api]", message);
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  };
  app.use(errorHandler);

  return app;
}
