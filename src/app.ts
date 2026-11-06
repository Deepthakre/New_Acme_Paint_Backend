import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import hpp from 'hpp';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { corsOrigins, isProd } from './config/env';
import { apiRateLimiter } from './middleware/rateLimiters';
import { sanitizeInput } from './middleware/sanitize';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import apiRoutes from './routes';

export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy (nginx/render/heroku) in production, so
  // req.ip / rate limiting reflect the real client IP from X-Forwarded-For.
  app.set('trust proxy', 1);

  // ---------- SECURITY HEADERS ----------
  app.use(
    helmet({
      contentSecurityPolicy: isProd ? undefined : false, // CSP defaults are fine to enable in prod once the frontend's exact origins/CDNs are finalized
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // ---------- CORS ----------
  // Only the explicitly configured frontend origin(s) may call this API
  // with credentials (needed for the httpOnly refresh-token cookie).
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    })
  );

  // ---------- BODY PARSING ----------
  // The raw bytes of webhook requests are kept so their HMAC signature can be verified exactly as sent.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        if ((req as express.Request).originalUrl.startsWith('/api/webhooks/')) {
          (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
        }
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(compression());

  // ---------- HARDENING ----------
  app.use(sanitizeInput); // strip NoSQL-injection operators from body/params
  app.use(hpp()); // guard against HTTP parameter pollution on query strings

  // ---------- LOGGING ----------
  app.use(
    morgan(isProd ? 'combined' : 'dev', {
      stream: { write: (msg: string) => logger.info(msg.trim()) },
      skip: (req) => req.path === '/health',
    })
  );

  // ---------- BASELINE RATE LIMIT ----------
  app.use('/api', apiRateLimiter);

  app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  app.use('/api', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
