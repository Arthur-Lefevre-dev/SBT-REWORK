import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Dev UI is Vite on 3000; API moves to 3001 when script is `dev:server`.
  PORT: z.coerce
    .number()
    .default(process.env.npm_lifecycle_event === "dev:server" ? 3001 : 3000),
  BASE_URL: z.string().optional(),

  STEAM_API_KEY: z.string().optional(),
  FACEIT_API_KEY: z.string().optional(),
  LEETIFY_API_KEY: z.string().optional(),

  SQLITE_PATH: z.string().default("./steam-data.db"),

  ADMIN_STEAM_IDS: z.string().default(""),
  SESSION_SECRET: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),

  DECODO_PROXY_USER: z.string().optional(),
  DECODO_PROXY_PASSWORD: z.string().optional(),

  TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),

  /** Auto recheck non-VAC profiles every VAC_VERIFY_INTERVAL_MS (default 24h). */
  VAC_VERIFY_AUTO: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
  VAC_VERIFY_INTERVAL_MS: z.coerce.number().default(24 * 60 * 60 * 1000),
  VAC_VERIFY_CONCURRENCY: z.coerce.number().default(2),
  /** Delay after each profile HTML fetch (ms) */
  VAC_VERIFY_DELAY_MS: z.coerce.number().default(800),
  /** 0 = up to 10000 profiles per pass */
  VAC_VERIFY_LIMIT: z.coerce.number().default(0),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export function requireSessionSecret(): string {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 16) {
    return env.SESSION_SECRET;
  }
  if (env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET (min 16 chars) is required in production");
  }
  console.warn(
    "[warn] SESSION_SECRET missing or short — using insecure dev default",
  );
  return "dev-only-session-secret-change-me";
}

export function getAdminIds(): Set<string> {
  return new Set(
    env.ADMIN_STEAM_IDS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
