import { env } from '../infrastructure/config/env.js';
import { createDb } from '../infrastructure/database/db.js';
import { KyselyTicketRepository } from '../infrastructure/database/repositories/KyselyTicketRepository.js';
import { KyselyZoneRepository } from '../infrastructure/database/repositories/KyselyZoneRepository.js';
import { KyselyPaymentRepository } from '../infrastructure/database/repositories/KyselyPaymentRepository.js';
import { KyselyUserRepository } from '../infrastructure/database/repositories/KyselyUserRepository.js';
import { KyselyRefreshTokenRepository } from '../infrastructure/database/repositories/KyselyRefreshTokenRepository.js';
import { Argon2PasswordHasher } from '../infrastructure/auth/Argon2PasswordHasher.js';
import { JwtService } from '../infrastructure/auth/JwtService.js';
import { AuditLogService } from '../infrastructure/audit/AuditLogService.js';
import { SystemClock, CryptoIdGenerator } from '../infrastructure/adapters/SystemAdapters.js';
import { StubPaymentGateway } from '../infrastructure/payment/StubPaymentGateway.js';
import { DokuPaymentGateway } from '../infrastructure/payment/DokuPaymentGateway.js';
import { DokuWebhookVerifier } from '../infrastructure/payment/DokuWebhookVerifier.js';
import { HandleDokuWebhookUseCase } from '../usecases/payment/HandleDokuWebhookUseCase.js';
import { IssueTicketUseCase } from '../usecases/ticket/IssueTicketUseCase.js';
import { CheckoutTicketUseCase } from '../usecases/ticket/CheckoutTicketUseCase.js';
import { SubmitViolationReportUseCase } from '../usecases/report/SubmitViolationReportUseCase.js';
import { AuthUseCase } from '../usecases/auth/AuthUseCase.js';
import { SimpleLock } from '../infrastructure/adapters/SimpleLock.js';
import { logger } from '../infrastructure/logging/logger.js';

/**
 * Composition root (TRD §18.4): the single place where concrete infrastructure is built and
 * injected into use cases. Use cases never `new` infrastructure themselves.
 */
export async function buildContainer() {
  const db = createDb(env.DATABASE_URL);
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator();
  const lock = new SimpleLock();

  const ticketRepo = new KyselyTicketRepository(db);
  const zoneRepo = new KyselyZoneRepository(db);
  const paymentRepo = new KyselyPaymentRepository(db);
  const userRepo = new KyselyUserRepository(db);
  const refreshRepo = new KyselyRefreshTokenRepository(db);
  const audit = new AuditLogService(db);
  const hasher = new Argon2PasswordHasher();
  const jwt = await JwtService.create(env);
  const gateway = env.PAYMENT_GATEWAY_MODE === 'doku'
    ? new DokuPaymentGateway(env)
    : new StubPaymentGateway();
  const handleWebhook = new HandleDokuWebhookUseCase(paymentRepo);
  const webhookVerifier = new DokuWebhookVerifier({
    secret: env.DOKU_WEBHOOK_SECRET ?? '',
    expectedClientId: env.DOKU_CLIENT_ID ?? '',
  });

  const issueTicket = new IssueTicketUseCase(ticketRepo, lock, zoneRepo, clock, ids);
  const checkout = new CheckoutTicketUseCase(ticketRepo, lock, zoneRepo, gateway, clock);
  const submitReport = new SubmitViolationReportUseCase(ids);
  const auth = new AuthUseCase(userRepo, refreshRepo, hasher, jwt);

  return {
    env, db, clock, ids, lock,
    ticketRepo, zoneRepo, paymentRepo, userRepo, refreshRepo,
    audit, hasher, jwt, gateway, issueTicket, checkout, submitReport, auth,
    handleWebhook, webhookVerifier, logger,
  };
}

export type Container = Awaited<ReturnType<typeof buildContainer>>;
