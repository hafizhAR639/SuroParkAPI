import express, { type Express, type RequestHandler, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import cors from 'cors';
import type { Container } from './container.js';
import { errorHandler } from '../interfaces/http/middlewares/errorHandler.js';
import { authMiddleware, requireRole } from '../interfaces/http/middlewares/authMiddleware.js';
import { validate } from '../interfaces/http/middlewares/validate.js';
import { loginSchema, refreshSchema, checkInSchema, checkoutSchema, reportSchema } from '../interfaces/http/validators/schemas.js';
import { AuthController } from '../interfaces/http/controllers/AuthController.js';
import { TicketController } from '../interfaces/http/controllers/TicketController.js';
import { ReportController } from '../interfaces/http/controllers/ReportController.js';
import { ZonesController } from '../interfaces/http/controllers/ZonesController.js';
import { WebhookController } from '../interfaces/http/controllers/WebhookController.js';

export function buildApp(c: Container): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  // TRD §16.10: explicit CORS allow-list (native mobile clients need none).
  app.use(cors({ origin: [] }));

  // Serve the static demo frontend (development aid for Dishub demos).
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.get('/demo', (_req: Request, res: Response) => res.redirect('/demo/demo.html'));
  app.use('/demo', express.static(path.resolve(__dirname, '../../frontend')));

  // Body limit 100 KB (uploads go direct to S3 via presigned URL, F9). Capture raw body for webhook HMAC.
  app.use(
    express.json({
      limit: '100kb',
      verify: (req: express.Request, _res, buf: Buffer) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  const auth = AuthController(c.auth);
  const tickets = TicketController(c.issueTicket, c.checkout, c.audit);
  const reports = ReportController(c.submitReport);
  const zones = ZonesController(c.zoneRepo);
  const webhook = WebhookController(c.webhookVerifier, c.handleWebhook, c.logger);

  const authenticate = authMiddleware(c.jwt, c.userRepo) as unknown as RequestHandler;
  app.post('/api/v1/auth/login', validate(loginSchema), auth.login);
  app.post('/api/v1/auth/refresh', validate(refreshSchema), auth.refresh);
  app.post('/api/v1/payments/doku/webhook', webhook.doku);

  app.post(
    '/api/v1/tickets/check-in',
    authenticate,
    requireRole('USER', 'JUKIR'),
    validate(checkInSchema),
    tickets.checkIn,
  );
  app.post(
    '/api/v1/tickets/check-out',
    authenticate,
    requireRole('USER', 'JUKIR'),
    validate(checkoutSchema),
    tickets.checkOut,
  );
  app.post(
    '/api/v1/reports/violation',
    authenticate,
    requireRole('USER'),
    validate(reportSchema),
    reports.submit,
  );

  // Admin map. NOTE (TRD §16.3): /admin/* should additionally be restricted to the Dishub
  // VPN / IP allow-list + MFA step-up at the gateway edge, layered on top of this RBAC gate.
  app.get('/api/v1/admin/zones', authenticate, requireRole('ADMIN'), zones.list);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(errorHandler);
  return app;
}
