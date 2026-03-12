import { CONFIG } from './types.js';

interface GraceSession {
  domain: string;
  started_at: number;
  grace_minutes: number;
  last_seen: number;
}

// In-memory grace period tracking
const graceSessions = new Map<string, GraceSession>();

/**
 * Start a grace period for a domain
 */
export function startGrace(domain: string, graceMinutes: number): void {
  const now = Date.now();
  graceSessions.set(domain, {
    domain,
    started_at: now,
    grace_minutes: graceMinutes,
    last_seen: now,
  });
}

/**
 * Get grace period status for a domain
 * Returns null if no grace session exists
 */
export function getGraceStatus(domain: string): {
  expired: boolean;
  remaining_seconds: number;
  elapsed_seconds: number;
} | null {
  const session = graceSessions.get(domain);
  if (!session) return null;

  const now = Date.now();
  const timeSinceLastSeen = now - session.last_seen;

  // If user was away for 30+ minutes, reset the grace period
  if (timeSinceLastSeen > CONFIG.GRACE_RESET_MS) {
    graceSessions.delete(domain);
    return null; // Will trigger a new grace period
  }

  // Update last seen
  session.last_seen = now;

  const elapsedMs = now - session.started_at;
  const graceDurationMs = session.grace_minutes * 60 * 1000;
  const expired = elapsedMs >= graceDurationMs;
  const remainingMs = Math.max(0, graceDurationMs - elapsedMs);

  return {
    expired,
    remaining_seconds: Math.floor(remainingMs / 1000),
    elapsed_seconds: Math.floor(elapsedMs / 1000),
  };
}

/**
 * Touch a grace session (update last_seen)
 * Call this on each poll to prevent premature reset
 */
export function touchGrace(domain: string): void {
  const session = graceSessions.get(domain);
  if (session) {
    session.last_seen = Date.now();
  }
}

/**
 * Remove a grace session
 */
export function removeGrace(domain: string): void {
  graceSessions.delete(domain);
}

/**
 * Get all active grace sessions (for debugging/API)
 */
export function getAllGraceSessions(): GraceSession[] {
  return Array.from(graceSessions.values());
}

/**
 * Clean up expired or stale grace sessions
 * Should be called periodically
 */
export function cleanupGraceSessions(): void {
  const now = Date.now();
  for (const [domain, session] of graceSessions.entries()) {
    const timeSinceLastSeen = now - session.last_seen;
    // Remove if not seen for 30+ minutes
    if (timeSinceLastSeen > CONFIG.GRACE_RESET_MS) {
      graceSessions.delete(domain);
    }
  }
}
