import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import type {
  Session,
  DailySummary,
  AppOverride,
  DomainOverride,
  AppBreakdown,
  Classification,
} from './types.js';

let db: Database;

export function initDB(dbPath: string): Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath, { create: true });

  // Enable WAL mode for better concurrent access
  db.run('PRAGMA journal_mode = WAL');

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      app_name TEXT NOT NULL,
      window_title TEXT,
      domain TEXT,
      classification TEXT NOT NULL,
      duration_seconds INTEGER,
      is_grace_period INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS app_overrides (
      app_name TEXT PRIMARY KEY,
      classification TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS domain_overrides (
      domain TEXT PRIMARY KEY,
      classification TEXT NOT NULL,
      grace_minutes INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_summary (
      date TEXT PRIMARY KEY,
      create_seconds INTEGER DEFAULT 0,
      consume_seconds INTEGER DEFAULT 0,
      mixed_seconds INTEGER DEFAULT 0,
      total_seconds INTEGER DEFAULT 0
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(start_time)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_classification ON sessions(classification)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_app ON sessions(app_name)');

  return db;
}

export function getDB(): Database {
  if (!db) throw new Error('Database not initialized. Call initDB first.');
  return db;
}

// --- Session operations ---

export function insertSession(session: Omit<Session, 'id'>): number {
  const stmt = getDB().prepare(`
    INSERT INTO sessions (start_time, end_time, app_name, window_title, domain, classification, duration_seconds, is_grace_period)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    session.start_time,
    session.end_time,
    session.app_name,
    session.window_title,
    session.domain,
    session.classification,
    session.duration_seconds,
    session.is_grace_period ? 1 : 0
  );
  return Number(result.lastInsertRowid);
}

export function updateSession(
  id: number,
  updates: Partial<Pick<Session, 'end_time' | 'duration_seconds' | 'classification' | 'is_grace_period'>>
): void {
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.end_time !== undefined) {
    sets.push('end_time = ?');
    values.push(updates.end_time);
  }
  if (updates.duration_seconds !== undefined) {
    sets.push('duration_seconds = ?');
    values.push(updates.duration_seconds);
  }
  if (updates.classification !== undefined) {
    sets.push('classification = ?');
    values.push(updates.classification);
  }
  if (updates.is_grace_period !== undefined) {
    sets.push('is_grace_period = ?');
    values.push(updates.is_grace_period ? 1 : 0);
  }

  if (sets.length === 0) return;

  values.push(id);
  getDB().prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getLastSession(): Session | null {
  const row = getDB().prepare('SELECT * FROM sessions ORDER BY id DESC LIMIT 1').get() as any;
  if (!row) return null;
  return { ...row, is_grace_period: !!row.is_grace_period };
}

export function getSessionsForDate(date: string): Session[] {
  const startOfDay = new Date(date + 'T00:00:00').getTime();
  const endOfDay = startOfDay + 86400000;

  const rows = getDB().prepare(
    'SELECT * FROM sessions WHERE start_time >= ? AND start_time < ? ORDER BY start_time ASC'
  ).all(startOfDay, endOfDay) as any[];

  return rows.map((r) => ({ ...r, is_grace_period: !!r.is_grace_period }));
}

export function getRecentSessions(limit: number = 50, offset: number = 0): Session[] {
  const rows = getDB().prepare(
    'SELECT * FROM sessions ORDER BY start_time DESC LIMIT ? OFFSET ?'
  ).all(limit, offset) as any[];

  return rows.map((r) => ({ ...r, is_grace_period: !!r.is_grace_period }));
}

// --- Daily summary operations ---

export function getTodaySummary(): DailySummary {
  const today = new Date().toISOString().split('T')[0];
  return getDaySummary(today);
}

export function getDaySummary(date: string): DailySummary {
  const row = getDB().prepare('SELECT * FROM daily_summary WHERE date = ?').get(date) as any;
  if (row) return row;
  return {
    date,
    create_seconds: 0,
    consume_seconds: 0,
    mixed_seconds: 0,
    total_seconds: 0,
  };
}

export function updateDailySummary(date: string, classification: Classification, seconds: number): void {
  const existing = getDaySummary(date);
  const column =
    classification === 'CREATE' ? 'create_seconds' :
    classification === 'CONSUME' ? 'consume_seconds' :
    'mixed_seconds';

  const newTotal = existing.total_seconds + seconds;
  const newValue = (existing as any)[column] + seconds;

  getDB().prepare(`
    INSERT INTO daily_summary (date, create_seconds, consume_seconds, mixed_seconds, total_seconds)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      ${column} = ?,
      total_seconds = ?
  `).run(
    date,
    classification === 'CREATE' ? newValue : existing.create_seconds,
    classification === 'CONSUME' ? newValue : existing.consume_seconds,
    classification === 'MIXED' ? newValue : existing.mixed_seconds,
    newTotal,
    newValue,
    newTotal
  );
}

export function getWeeklySummaries(): DailySummary[] {
  const rows = getDB().prepare(
    'SELECT * FROM daily_summary ORDER BY date DESC LIMIT 7'
  ).all() as DailySummary[];
  return rows.reverse();
}

export function getMonthlySummaries(): DailySummary[] {
  const rows = getDB().prepare(
    'SELECT * FROM daily_summary ORDER BY date DESC LIMIT 30'
  ).all() as DailySummary[];
  return rows.reverse();
}

// --- App breakdown ---

export function getAppBreakdown(date?: string): AppBreakdown[] {
  let query: string;
  let params: any[];

  if (date) {
    const startOfDay = new Date(date + 'T00:00:00').getTime();
    const endOfDay = startOfDay + 86400000;
    query = `
      SELECT app_name, classification, 
        COALESCE(SUM(duration_seconds), 0) as total_seconds,
        COUNT(*) as session_count
      FROM sessions 
      WHERE start_time >= ? AND start_time < ?
      GROUP BY app_name, classification
      ORDER BY total_seconds DESC
    `;
    params = [startOfDay, endOfDay];
  } else {
    const today = new Date().toISOString().split('T')[0];
    const startOfDay = new Date(today + 'T00:00:00').getTime();
    const endOfDay = startOfDay + 86400000;
    query = `
      SELECT app_name, classification,
        COALESCE(SUM(duration_seconds), 0) as total_seconds,
        COUNT(*) as session_count
      FROM sessions
      WHERE start_time >= ? AND start_time < ?
      GROUP BY app_name, classification
      ORDER BY total_seconds DESC
    `;
    params = [startOfDay, endOfDay];
  }

  return getDB().prepare(query).all(...params) as AppBreakdown[];
}

// --- Override operations ---

export function getAppOverrides(): AppOverride[] {
  return getDB().prepare('SELECT * FROM app_overrides').all() as AppOverride[];
}

export function setAppOverride(appName: string, classification: Classification): void {
  getDB().prepare(
    'INSERT INTO app_overrides (app_name, classification) VALUES (?, ?) ON CONFLICT(app_name) DO UPDATE SET classification = ?'
  ).run(appName, classification, classification);
}

export function getDomainOverrides(): DomainOverride[] {
  return getDB().prepare('SELECT * FROM domain_overrides').all() as DomainOverride[];
}

export function setDomainOverride(domain: string, classification: Classification, graceMinutes?: number): void {
  getDB().prepare(
    'INSERT INTO domain_overrides (domain, classification, grace_minutes) VALUES (?, ?, ?) ON CONFLICT(domain) DO UPDATE SET classification = ?, grace_minutes = ?'
  ).run(domain, classification, graceMinutes ?? null, classification, graceMinutes ?? null);
}

export function deleteAppOverride(appName: string): void {
  getDB().prepare('DELETE FROM app_overrides WHERE app_name = ?').run(appName);
}

export function deleteDomainOverride(domain: string): void {
  getDB().prepare('DELETE FROM domain_overrides WHERE domain = ?').run(domain);
}

// --- Recalculate daily summary from sessions ---

export function recalculateDailySummary(date: string): void {
  const sessions = getSessionsForDate(date);
  let create = 0, consume = 0, mixed = 0;

  for (const s of sessions) {
    const dur = s.duration_seconds ?? 0;
    if (s.classification === 'CREATE') create += dur;
    else if (s.classification === 'CONSUME') consume += dur;
    else mixed += dur;
  }

  getDB().prepare(`
    INSERT INTO daily_summary (date, create_seconds, consume_seconds, mixed_seconds, total_seconds)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      create_seconds = ?,
      consume_seconds = ?,
      mixed_seconds = ?,
      total_seconds = ?
  `).run(date, create, consume, mixed, create + consume + mixed, create, consume, mixed, create + consume + mixed);
}

export function closeDB(): void {
  if (db) db.close();
}
