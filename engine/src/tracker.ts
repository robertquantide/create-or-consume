import type { WindowInfo, Classification, TrackingState, CONFIG as ConfigType } from './types.js';
import { CONFIG } from './types.js';
import { classify } from './classifier.js';
import {
  insertSession,
  updateSession,
  getLastSession,
  updateDailySummary,
} from './db.js';
import { touchGrace } from './grace.js';

// Current tracking state
let state: TrackingState = {
  current_app: null,
  current_domain: null,
  current_classification: null,
  session_start: null,
  is_grace_period: false,
};

let currentSessionId: number | null = null;
let lastPollTime: number | null = null;

// Extension-provided domain for the current browser tab
let extensionDomain: string | null = null;
let extensionTitle: string | null = null;
let extensionLastUpdate: number = 0;

/**
 * Set domain info from Chrome extension
 */
export function setExtensionData(domain: string, title: string): void {
  extensionDomain = domain;
  extensionTitle = title;
  extensionLastUpdate = Date.now();
}

/**
 * Get current tracking state
 */
export function getTrackingState(): TrackingState {
  return { ...state };
}

/**
 * Get active window info using active-win
 * Returns null on headless/unsupported systems
 */
async function getActiveWindow(): Promise<WindowInfo | null> {
  try {
    // Dynamic import since active-win is ESM-only
    const { activeWindow: getWin } = await import('active-win');
    const win = await getWin();
    if (!win) return null;

    return {
      app_name: win.owner.name,
      window_title: win.title,
      timestamp: Date.now(),
    };
  } catch (err) {
    // active-win won't work on headless servers — that's expected
    return null;
  }
}

/**
 * Get the best available domain for current context
 */
function getCurrentDomain(appName: string): string | null {
  // If extension data is fresh (< 10 seconds), use it
  if (extensionDomain && Date.now() - extensionLastUpdate < 10000) {
    return extensionDomain;
  }
  return null;
}

/**
 * Main tracking poll — called every POLL_INTERVAL_MS
 */
export async function poll(): Promise<void> {
  const now = Date.now();

  // Try to get active window
  let windowInfo = await getActiveWindow();

  // If no window info (headless), check if extension is providing data
  if (!windowInfo && extensionDomain && Date.now() - extensionLastUpdate < 10000) {
    windowInfo = {
      app_name: 'Browser',
      window_title: extensionTitle || '',
      timestamp: now,
    };
  }

  // No data at all — skip this poll
  if (!windowInfo) return;

  const domain = getCurrentDomain(windowInfo.app_name);
  const result = classify(windowInfo.app_name, windowInfo.window_title, domain);

  // Touch grace period if applicable
  if (domain && result.is_grace_period) {
    touchGrace(domain);
  }

  // Check if this is the same session as before
  const isSameSession =
    state.current_app === windowInfo.app_name &&
    state.current_domain === domain &&
    lastPollTime !== null &&
    now - lastPollTime < CONFIG.SESSION_GAP_MS;

  if (isSameSession && currentSessionId !== null) {
    // Continue existing session — update end time
    const durationSeconds = Math.floor((now - (state.session_start ?? now)) / 1000);

    updateSession(currentSessionId, {
      end_time: now,
      duration_seconds: durationSeconds,
      classification: result.classification,
      is_grace_period: result.is_grace_period,
    });

    // Update daily summary with the increment
    if (lastPollTime) {
      const incrementSeconds = Math.floor((now - lastPollTime) / 1000);
      const today = new Date().toISOString().split('T')[0];
      updateDailySummary(today, result.classification, incrementSeconds);
    }
  } else {
    // New session
    // Close previous session if exists
    if (currentSessionId !== null && state.session_start !== null) {
      const finalDuration = Math.floor(((lastPollTime ?? now) - state.session_start) / 1000);
      updateSession(currentSessionId, {
        end_time: lastPollTime ?? now,
        duration_seconds: finalDuration,
      });
    }

    // Start new session — window_title not stored (privacy, #8)
    state.session_start = now;
    currentSessionId = insertSession({
      start_time: now,
      end_time: null,
      app_name: windowInfo.app_name,
      domain: domain,
      classification: result.classification,
      duration_seconds: 0,
      is_grace_period: result.is_grace_period,
    });

    // Initial daily summary increment (first poll of session)
    const today = new Date().toISOString().split('T')[0];
    const incrementSeconds = Math.floor(CONFIG.POLL_INTERVAL_MS / 1000);
    updateDailySummary(today, result.classification, incrementSeconds);
  }

  // Update state
  state.current_app = windowInfo.app_name;
  state.current_domain = domain;
  state.current_classification = result.classification;
  state.is_grace_period = result.is_grace_period;
  lastPollTime = now;
}

let pollInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the tracking loop
 */
export function startTracking(): void {
  if (pollInterval) return;

  console.log(`[Tracker] Starting — polling every ${CONFIG.POLL_INTERVAL_MS / 1000}s`);

  // Initial poll
  poll().catch((err) => console.error('[Tracker] Poll error:', err));

  // Set up interval
  pollInterval = setInterval(() => {
    poll().catch((err) => console.error('[Tracker] Poll error:', err));
  }, CONFIG.POLL_INTERVAL_MS);
}

/**
 * Stop the tracking loop
 */
export function stopTracking(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('[Tracker] Stopped');
  }

  // Close current session
  if (currentSessionId !== null && state.session_start !== null) {
    const now = Date.now();
    const finalDuration = Math.floor((now - state.session_start) / 1000);
    updateSession(currentSessionId, {
      end_time: now,
      duration_seconds: finalDuration,
    });
    currentSessionId = null;
  }
}
