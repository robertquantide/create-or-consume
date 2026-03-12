// Classification types
export type Classification = 'CREATE' | 'CONSUME' | 'MIXED' | 'UNKNOWN';

// Database session record
export interface Session {
  id?: number;
  start_time: number;
  end_time: number | null;
  app_name: string;
  window_title: string | null;
  domain: string | null;
  classification: Classification;
  duration_seconds: number | null;
  is_grace_period: boolean;
}

// Daily summary record
export interface DailySummary {
  date: string;
  create_seconds: number;
  consume_seconds: number;
  mixed_seconds: number;
  total_seconds: number;
}

// App/domain override
export interface AppOverride {
  app_name: string;
  classification: Classification;
}

export interface DomainOverride {
  domain: string;
  classification: Classification;
  grace_minutes: number | null;
}

// Active window info from tracker
export interface WindowInfo {
  app_name: string;
  window_title: string;
  timestamp: number;
}

// Chrome extension track request
export interface TrackRequest {
  domain: string;
  title: string;
  url: string;
}

// Classification result
export interface ClassificationResult {
  classification: Classification;
  source: 'preset' | 'override' | 'extension' | 'default';
  is_grace_period: boolean;
  grace_remaining_seconds?: number;
}

// App presets schema
export interface AppPresets {
  create: string[];
  consume: string[];
}

// Domain presets schema
export interface DomainPresets {
  create: string[];
  consume: string[];
  mixed: Record<string, { graceMinutes: number }>;
}

// API response types
export interface TodayResponse {
  date: string;
  create_seconds: number;
  consume_seconds: number;
  mixed_seconds: number;
  total_seconds: number;
  create_percentage: number;
  consume_percentage: number;
  mixed_percentage: number;
}

export interface AppBreakdown {
  app_name: string;
  classification: Classification;
  total_seconds: number;
  session_count: number;
}

export interface StatsResponse {
  period: string;
  days: DailySummary[];
}

// Classify request body
export interface ClassifyRequest {
  type: 'app' | 'domain';
  name: string;
  classification: Classification;
  grace_minutes?: number;
}

// Presets update request
export interface PresetsUpdateRequest {
  apps?: AppPresets;
  domains?: DomainPresets;
}

// Current tracking state
export interface TrackingState {
  current_app: string | null;
  current_domain: string | null;
  current_classification: Classification | null;
  session_start: number | null;
  is_grace_period: boolean;
}

// Config
export const CONFIG = {
  POLL_INTERVAL_MS: 5000,
  SESSION_GAP_MS: 30000, // 30 seconds gap = new session
  GRACE_RESET_MS: 30 * 60 * 1000, // 30 min away resets grace
  API_PORT: 9876,
  DB_PATH: './data/create-or-consume.db',
} as const;
