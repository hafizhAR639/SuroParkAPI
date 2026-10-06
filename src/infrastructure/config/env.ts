import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

/**
 * Reads a secret value, preferring the *_FILE variant (Docker/K8s secrets, TRD F1/§16.12)
 * over the inline env var. The *_FILE indirection is the app-side half of the compose fix.
 */
function secret(name: string): (arg: unknown) => string | undefined {
  return (arg: unknown) => {
    const file = process.env[`${name}_FILE`];
    if (file !== undefined && file !== '') {
      return readFileSync(file, 'utf8').trim();
    }
    return typeof arg === 'string' && arg !== '' ? arg : undefined;
  };
}

const optionalStr = z.preprocess((v: unknown) => (v === '' ? undefined : v), z.string().optional());
const secretStr = (name: string): typeof optionalStr =>
  z.preprocess(secret(name), z.string().optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: secretStr('DATABASE_URL'),
  JWT_PRIVATE_KEY: secretStr('JWT_PRIVATE_KEY'),
  JWT_PUBLIC_KEY: secretStr('JWT_PUBLIC_KEY'),
  JWT_ISSUER: z.string().default('suropark'),
  JWT_AUDIENCE: z.string().default('suropark-api'),
  JWT_KEY_ID: z.string().default('suropark-2026-01'),

  DOKU_BASE_URL: z.string().url().default('https://api.doku.com'),
  PAYMENT_GATEWAY_MODE: z.enum(['stub', 'doku']).default('stub'),
  DOKU_CLIENT_ID: optionalStr,
  DOKU_CLIENT_SECRET: secretStr('DOKU_CLIENT_SECRET'),
  DOKU_WEBHOOK_SECRET: secretStr('DOKU_WEBHOOK_SECRET'),
  DOKU_PRIVATE_KEY: secretStr('DOKU_PRIVATE_KEY'),
  DOKU_MERCHANT_ID: optionalStr,
  DOKU_TERMINAL_ID: optionalStr,
  DOKU_POSTAL_CODE: z.string().regex(/^\d{5}$/).default('60111'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast on boot (TRD §18.4): invalid env must prevent startup.
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
