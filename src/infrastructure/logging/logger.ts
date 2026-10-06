import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Structured logger with PII redaction (TRD F7 / §16.9, UU PDP No. 27/2022).
 * License plates, phone numbers, passwords, and credentials never reach the log sink.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.phone_number',
      '*.phoneNumber',
      '*.vehiclePlate',
      '*.qrString',
      'password',
      'vehiclePlate',
    ],
    censor: '[REDACTED]',
  },
});

export type Logger = typeof logger;
