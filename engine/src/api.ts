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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createAPI(): express.Application {
  const app = express();

  app.use(express.json());

  // CORS for Chrome extension
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Serve dashboard
  const dashboardPath = path.resolve(__dirname, '../../dashboard');
  app.use(express.static(dashboardPath));

  // --- API Routes ---

  // GET /api/today — today's CREATE/CONSUME ratio
  app.get('/api/today', (req, res) => {
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
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const date = req.query.date as string;

    if (date) {
      const sessions = getSessionsForDate(date);
      res.json({ sessions, total: sessions.length });
    } else {
      const sessions = getRecentSessions(limit, offset);
      res.json({ sessions, limit, offset });
    }
  });

  // GET /api/stats/:period — daily/weekly/monthly stats
  app.get('/api/stats/:period', (req, res) => {
    const { period } = req.params;
    let days;

    switch (period) {
      case 'weekly':
        days = getWeeklySummaries();
        break;
      case 'monthly':
        days = getMonthlySummaries();
        break;
      case 'daily':
        const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
        days = [getDaySummary(date)];
        break;
      default:
        return res.status(400).json({ error: 'Invalid period. Use: daily, weekly, monthly' });
    }

    const response: StatsResponse = { period, days };
    res.json(response);
  });

  // GET /api/apps — per-app time breakdown
  app.get('/api/apps', (req, res) => {
    const date = req.query.date as string;
    const breakdown = getAppBreakdown(date);
    res.json({ apps: breakdown });
  });

  // POST /api/classify — reclassify an app or domain
  app.post('/api/classify', (req, res) => {
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

  // POST /api/track — Chrome extension posts active tab info
  app.post('/api/track', (req, res) => {
    const body = req.body as TrackRequest;

    if (!body.domain && !body.url) {
      return res.status(400).json({ error: 'Required: domain or url' });
    }

    const domain = body.domain || (() => {
      try {
        return new URL(body.url).hostname.replace(/^www\./, '');
      } catch {
        return null;
      }
    })();

    if (!domain) {
      return res.status(400).json({ error: 'Could not extract domain' });
    }

    // Update extension data for the tracker
    setExtensionData(domain, body.title || '');

    // Classify this domain immediately for the extension badge
    const result = classify('Browser', body.title, domain);

    res.json({
      domain,
      classification: result.classification,
      is_grace_period: result.is_grace_period,
      grace_remaining_seconds: result.grace_remaining_seconds,
    });
  });

  // GET /api/presets — current presets
  app.get('/api/presets', (req, res) => {
    res.json(getPresets());
  });

  // PUT /api/presets — update presets
  app.put('/api/presets', (req, res) => {
    const { apps, domains } = req.body;
    updatePresets(apps, domains);
    res.json({ ok: true, presets: getPresets() });
  });

  // GET /api/state — current tracking state (for debugging)
  app.get('/api/state', (req, res) => {
    res.json({
      tracking: getTrackingState(),
      grace_sessions: getAllGraceSessions(),
    });
  });

  // Serve dashboard for root
  app.get('/', (req, res) => {
    res.sendFile(path.join(dashboardPath, 'index.html'));
  });

  return app;
}
