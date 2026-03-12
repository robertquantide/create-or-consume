import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  TodayResponse,
  ClassifyRequest,
  TrackRequest,
  StatsResponse,
} from './types.js';
import {
  getTodaySummary,
  getRecentSessions,
  getWeeklySummaries,
  getMonthlySummaries,
  getAppBreakdown,
  setAppOverride,
  setDomainOverride,
  getDaySummary,
  getSessionsForDate,
} from './db.js';
import { getPresets, updatePresets, classify } from './classifier.js';
import { setExtensionData, getTrackingState } from './tracker.js';
import { getAllGraceSessions } from './grace.js';
import { validateToken } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Allowed CORS origins — localhost dashboard + any Chrome extension (#2)
const ALLOWED_ORIGINS = ['http://localhost:9876', 'http://127.0.0.1:9876'];

function isAllowedOrigin(origin: string): boolean {
  if (origin.startsWith('chrome-extension://')) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

// --- Simple in-memory rate limiter (#7) ---
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_READ_MAX = 100;     // 100 read requests/min per IP
const RATE_LIMIT_WRITE_MAX = 20;     // 20 write requests/min per IP

function checkRateLimit(ip: string, isWrite: boolean): boolean {
  const limit = isWrite ? RATE_LIMIT_WRITE_MAX : RATE_LIMIT_READ_MAX;
  const key = `${ip}:${isWrite ? 'w' : 'r'}`;
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  if (entry.count > limit) return false;
  return true;
}

// --- Preset validation (#6) ---
function validatePresets(data: any): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  // apps section
  if (data.apps !== undefined) {
    if (typeof data.apps !== 'object' || Array.isArray(data.apps)) return false;
    const apps = data.apps;
    if (apps.create !== undefined && !Array.isArray(apps.create)) return false;
    if (apps.consume !== undefined && !Array.isArray(apps.consume)) return false;
    for (const arr of [apps.create, apps.consume]) {
      if (arr && !arr.every((v: any) => typeof v === 'string')) return false;
    }
  }
  // domains section
  if (data.domains !== undefined) {
    if (typeof data.domains !== 'object' || Array.isArray(data.domains)) return false;
    const domains = data.domains;
    if (domains.create !== undefined && !Array.isArray(domains.create)) return false;
    if (domains.consume !== undefined && !Array.isArray(domains.consume)) return false;
    for (const arr of [domains.create, domains.consume]) {
      if (arr && !arr.every((v: any) => typeof v === 'string')) return false;
    }
    if (domains.mixed !== undefined) {
      if (typeof domains.mixed !== 'object' || Array.isArray(domains.mixed)) return false;
      for (const val of Object.values(domains.mixed)) {
        if (typeof val !== 'object' || val === null) return false;
        const v = val as any;
        if (typeof v.graceMinutes !== 'number') return false;
      }
    }
  }
  return true;
}

// --- Date format validation (#14) ---
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(dateStr: string): boolean {
  if (!DATE_REGEX.test(dateStr)) return false;
  const d = new Date(dateStr + 'T12:00:00');
  return !isNaN(d.getTime());
}

// --- Auth middleware ---
// Uses validateToken from auth.ts (constant-time comparison, token from ~/.config or env var)
function checkAuth(req: express.Request, res: express.Response): boolean {
  const header = req.headers.authorization;
  if (!validateToken(header)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export function createAPI(): express.Application {
  const app = express();

  // Body size limit — 100KB max
  app.use(express.json({ limit: '100kb' }));

  // CORS — restrict to localhost dashboard and Chrome extensions only (#2)
  app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    if (origin && isAllowedOrigin(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Read rate limiting middleware (#7)
  app.use((req, res, next) => {
    const isWrite = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip, isWrite)) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  });

  // Serve dashboard
  const dashboardPath = path.resolve(__dirname, '../../dashboard');
  app.use(express.static(dashboardPath));

  // --- API Routes ---

  // GET /api/today — today's CREATE/CONSUME ratio
  app.get('/api/today', (req, res) => {
    if (!checkAuth(req, res)) return;
    const summary = getTodaySummary();
    const total = summary.total_seconds || 1; // avoid division by zero

    const response: TodayResponse = {
      date: summary.date,
      create_seconds: summary.create_seconds,
      consume_seconds: summary.consume_seconds,
      mixed_seconds: summary.mixed_seconds,
      total_seconds: summary.total_seconds,
      create_percentage: Math.round((summary.create_seconds / total) * 100),
      consume_percentage: Math.round((summary.consume_seconds / total) * 100),
      mixed_percentage: Math.round((summary.mixed_seconds / total) * 100),
    };

    res.json(response);
  });

  // GET /api/sessions — recent sessions with pagination
  app.get('/api/sessions', (req, res) => {
    if (!checkAuth(req, res)) return;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const date = req.query.date as string;

    if (date) {
      // Validate date format (#14)
      if (!isValidDate(date)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
      }
      const sessions = getSessionsForDate(date);
      res.json({ sessions, total: sessions.length });
    } else {
      const sessions = getRecentSessions(limit, offset);
      res.json({ sessions, limit, offset });
    }
  });

  // GET /api/stats/:period — daily/weekly/monthly stats
  app.get('/api/stats/:period', (req, res) => {
    if (!checkAuth(req, res)) return;
    const { period } = req.params;
    let days;

    switch (period) {
      case 'weekly':
        days = getWeeklySummaries();
        break;
      case 'monthly':
        days = getMonthlySummaries();
        break;
      case 'daily': {
        const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
        // Validate date format (#14)
        if (!isValidDate(date)) {
          return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        }
        days = [getDaySummary(date)];
        break;
      }
      default:
        return res.status(400).json({ error: 'Invalid period. Use: daily, weekly, monthly' });
    }

    const response: StatsResponse = { period, days };
    res.json(response);
  });

  // GET /api/apps — per-app time breakdown
  app.get('/api/apps', (req, res) => {
    if (!checkAuth(req, res)) return;
    const date = req.query.date as string;
    // Validate date format if provided (#14)
    if (date && !isValidDate(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    const breakdown = getAppBreakdown(date);
    res.json({ apps: breakdown });
  });

  // POST /api/classify — reclassify an app or domain
  app.post('/api/classify', (req, res) => {
    if (!checkAuth(req, res)) return;
    const body = req.body as ClassifyRequest;

    if (!body.type || !body.name || !body.classification) {
      return res.status(400).json({
        error: 'Required: type (app|domain), name, classification (CREATE|CONSUME|MIXED)',
      });
    }

    if (!['CREATE', 'CONSUME', 'MIXED'].includes(body.classification)) {
      return res.status(400).json({ error: 'classification must be CREATE, CONSUME, or MIXED' });
    }

    if (body.type === 'app') {
      setAppOverride(body.name, body.classification);
    } else if (body.type === 'domain') {
      setDomainOverride(body.name, body.classification, body.grace_minutes);
    } else {
      return res.status(400).json({ error: 'type must be app or domain' });
    }

    res.json({ ok: true, type: body.type, name: body.name, classification: body.classification });
  });

  // POST /api/track — Chrome extension posts active tab domain (#5)
  app.post('/api/track', (req, res) => {
    if (!checkAuth(req, res)) return;
    const body = req.body as TrackRequest;

    // Only accept domain; ignore full URL and title to protect privacy (#5)
    let domain: string | null = null;

    if (body.domain) {
      domain = body.domain;
    } else if (body.url) {
      try {
        domain = new URL(body.url).hostname.replace(/^www\./, '');
      } catch {
        domain = null;
      }
    }

    if (!domain) {
      return res.status(400).json({ error: 'Required: domain' });
    }

    // Sanitize domain — only allow valid hostname characters
    const domainClean = domain.replace(/[^a-zA-Z0-9.\-]/g, '').toLowerCase();
    if (!domainClean) {
      return res.status(400).json({ error: 'Invalid domain' });
    }

    // Update extension data — do NOT store title for browser tabs (privacy)
    setExtensionData(domainClean, '');

    // Classify this domain immediately for the extension badge
    const result = classify('Browser', '', domainClean);

    res.json({
      domain: domainClean,
      classification: result.classification,
      is_grace_period: result.is_grace_period,
      grace_remaining_seconds: result.grace_remaining_seconds,
    });
  });

  // GET /api/presets — current presets
  app.get('/api/presets', (req, res) => {
    if (!checkAuth(req, res)) return;
    res.json(getPresets());
  });

  // PUT /api/presets — update presets (validated + atomic write) (#6)
  app.put('/api/presets', (req, res) => {
    if (!checkAuth(req, res)) return;
    if (!validatePresets(req.body)) {
      return res.status(400).json({
        error: 'Invalid preset structure. Expected { apps?: { create?, consume? }, domains?: { create?, consume?, mixed? } }',
      });
    }
    const { apps, domains } = req.body;
    updatePresets(apps, domains);
    res.json({ ok: true, presets: getPresets() });
  });

  // GET /api/state — current tracking state (filtered — no window titles) (#8)
  app.get('/api/state', (req, res) => {
    if (!checkAuth(req, res)) return;
    const tracking = getTrackingState();
    // Strip window_title from response — only return safe fields
    const safeTracking = {
      current_app: tracking.current_app,
      current_domain: tracking.current_domain,
      current_classification: tracking.current_classification,
      session_start: tracking.session_start,
      is_grace_period: tracking.is_grace_period,
    };
    res.json({
      tracking: safeTracking,
      grace_sessions: getAllGraceSessions(),
    });
  });

  // Serve dashboard for root
  app.get('/', (req, res) => {
    res.sendFile(path.join(dashboardPath, 'index.html'));
  });

  // Global error handler — no stack trace leaks (#15)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('[API] Unhandled error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
