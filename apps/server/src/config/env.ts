import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** Environment, validated once at startup: a typo fails fast with a clear message. */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    ALLOW_SIGNUP: bool.default('false'),
    SESSION_TTL_DAYS: z.coerce.number().positive().default(30),
    COOKIE_SECURE: bool.optional(),
    WEB_ORIGIN: z.string().url().optional(),
    TRUST_PROXY: z.coerce.number().int().min(0).optional(),
    LEVELS_DIR: z.string().optional(),
    ENGINE_THREADS: z.coerce.number().int().min(1).max(8).optional(),
    ENGINE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  })
  .transform((e) => ({ ...e, COOKIE_SECURE: e.COOKIE_SECURE ?? e.NODE_ENV === 'production' }));

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}\nSee apps/server/.env.example`);
  }
  return parsed.data;
}
