/**
 * Token-based authentication for the Create or Consume engine.
 *
 * On first run, a random 32-byte hex token is generated and saved to
 * ~/.config/create-or-consume/auth.token. On subsequent runs the existing
 * token is read from that file.
 *
 * The token can also be supplied via the COC_AUTH_TOKEN environment variable
 * (useful for testing or automated setups).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const TOKEN_DIR = path.join(os.homedir(), '.config', 'create-or-consume');
const TOKEN_FILE = path.join(TOKEN_DIR, 'auth.token');

let _token: string | null = null;

/**
 * Load (or generate) the auth token.
 * Call once at startup.
 */
export function initAuthToken(): string {
  // Environment variable override (useful for CI/testing)
  if (process.env.COC_AUTH_TOKEN) {
    _token = process.env.COC_AUTH_TOKEN;
    console.log('[Auth] Using token from COC_AUTH_TOKEN env var');
    return _token;
  }

  // Try to read existing token
  if (fs.existsSync(TOKEN_FILE)) {
    const raw = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
    if (raw && /^[0-9a-f]{64}$/.test(raw)) {
      _token = raw;
      console.log(`[Auth] Loaded token from ${TOKEN_FILE}`);
      return _token;
    }
  }

  // Generate new token
  _token = crypto.randomBytes(32).toString('hex');

  // Persist to disk
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }
  fs.writeFileSync(TOKEN_FILE, _token, { mode: 0o600 });

  console.log('');
  console.log('[Auth] ⚠️  New auth token generated and saved to:');
  console.log(`[Auth]   ${TOKEN_FILE}`);
  console.log('[Auth] Add this token to your Chrome extension settings.');
  console.log('[Auth] Token:', _token);
  console.log('');

  return _token;
}

/**
 * Return the current auth token (must call initAuthToken first).
 */
export function getAuthToken(): string {
  if (!_token) throw new Error('Auth token not initialized. Call initAuthToken() first.');
  return _token;
}

/**
 * Validate a Bearer token from an Authorization header value.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function validateToken(headerValue: string | undefined): boolean {
  if (!_token) return false;
  if (!headerValue || !headerValue.startsWith('Bearer ')) return false;
  const provided = headerValue.slice('Bearer '.length).trim();
  if (provided.length !== _token.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(_token));
  } catch {
    return false;
  }
}
