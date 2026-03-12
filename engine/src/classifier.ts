import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  Classification,
  ClassificationResult,
  AppPresets,
  DomainPresets,
} from './types.js';
import { getAppOverrides, getDomainOverrides } from './db.js';
import { getGraceStatus, startGrace } from './grace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESETS_DIR = path.resolve(__dirname, '../presets');

let appPresets: AppPresets;
let domainPresets: DomainPresets;

// Known browser process names
const BROWSER_PROCESSES = new Set([
  'google chrome', 'chrome', 'chromium', 'chromium-browser',
  'firefox', 'mozilla firefox',
  'safari',
  'microsoft edge', 'msedge', 'edge',
  'brave browser', 'brave',
  'opera', 'vivaldi', 'arc',
  'zen', 'zen browser',
]);

export function loadPresets(): void {
  const appsPath = path.join(PRESETS_DIR, 'apps.json');
  const domainsPath = path.join(PRESETS_DIR, 'domains.json');

  appPresets = JSON.parse(fs.readFileSync(appsPath, 'utf-8'));
  domainPresets = JSON.parse(fs.readFileSync(domainsPath, 'utf-8'));
}

export function getPresets(): { apps: AppPresets; domains: DomainPresets } {
  return { apps: appPresets, domains: domainPresets };
}

/**
 * Atomically write a JSON file: write to .tmp first, then rename (#6)
 */
function atomicWriteJSON(filePath: string, data: object): void {
  const tmpPath = filePath + '.tmp';
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, json, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function updatePresets(apps?: AppPresets, domains?: DomainPresets): void {
  if (apps) {
    appPresets = apps;
    atomicWriteJSON(path.join(PRESETS_DIR, 'apps.json'), apps);
  }
  if (domains) {
    domainPresets = domains;
    atomicWriteJSON(path.join(PRESETS_DIR, 'domains.json'), domains);
  }
}

/**
 * Normalize app name for matching (case-insensitive, trim extensions)
 */
function normalizeAppName(name: string): string {
  return name
    .replace(/\.exe$/i, '')
    .replace(/\.app$/i, '')
    .trim()
    .toLowerCase();
}

/**
 * Extract domain from a URL string
 */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Try to extract domain from a browser window title
 * Common patterns: "Page Title - Site Name — Google Chrome"
 */
export function extractDomainFromTitle(title: string): string | null {
  // Some browsers show URL in title for certain pages
  const urlMatch = title.match(/https?:\/\/([^\s/]+)/);
  if (urlMatch) {
    return urlMatch[1].replace(/^www\./, '');
  }
  return null;
}

/**
 * Check if a process name is a known browser
 */
export function isBrowser(processName: string): boolean {
  return BROWSER_PROCESSES.has(normalizeAppName(processName));
}

/**
 * Classify an app by process name
 */
function classifyApp(appName: string): { classification: Classification; source: 'override' | 'preset' | 'default' } {
  const normalized = normalizeAppName(appName);

  // Check overrides first
  const overrides = getAppOverrides();
  for (const o of overrides) {
    if (normalizeAppName(o.app_name) === normalized) {
      return { classification: o.classification, source: 'override' };
    }
  }

  // Check presets
  for (const preset of appPresets.create) {
    if (normalizeAppName(preset) === normalized) {
      return { classification: 'CREATE', source: 'preset' };
    }
  }
  for (const preset of appPresets.consume) {
    if (normalizeAppName(preset) === normalized) {
      return { classification: 'CONSUME', source: 'preset' };
    }
  }

  return { classification: 'UNKNOWN', source: 'default' };
}

/**
 * Classify a domain
 */
function classifyDomain(domain: string): ClassificationResult {
  const normalized = domain.toLowerCase().replace(/^www\./, '');

  // Check domain overrides first
  const overrides = getDomainOverrides();
  for (const o of overrides) {
    if (o.domain === normalized) {
      if (o.classification === 'MIXED' && o.grace_minutes) {
        const graceStatus = getGraceStatus(normalized);
        if (!graceStatus) {
          startGrace(normalized, o.grace_minutes);
          return {
            classification: 'CREATE',
            source: 'override',
            is_grace_period: true,
            grace_remaining_seconds: o.grace_minutes * 60,
          };
        }
        return {
          classification: graceStatus.expired ? 'CONSUME' : 'CREATE',
          source: 'override',
          is_grace_period: !graceStatus.expired,
          grace_remaining_seconds: graceStatus.remaining_seconds,
        };
      }
      return { classification: o.classification, source: 'override', is_grace_period: false };
    }
  }

  // Check mixed domains (grace period logic)
  if (domainPresets.mixed[normalized]) {
    const graceMinutes = domainPresets.mixed[normalized].graceMinutes;
    const graceStatus = getGraceStatus(normalized);

    if (!graceStatus) {
      startGrace(normalized, graceMinutes);
      return {
        classification: 'CREATE',
        source: 'preset',
        is_grace_period: true,
        grace_remaining_seconds: graceMinutes * 60,
      };
    }

    return {
      classification: graceStatus.expired ? 'CONSUME' : 'CREATE',
      source: 'preset',
      is_grace_period: !graceStatus.expired,
      grace_remaining_seconds: graceStatus.remaining_seconds,
    };
  }

  // Check create domains
  for (const d of domainPresets.create) {
    // Support path-based matching (e.g., "medium.com/new-story")
    if (d.includes('/')) {
      if (normalized.startsWith(d.split('/')[0])) {
        // Path-based domain — needs URL for full matching, but domain-level match is CREATE
        return { classification: 'CREATE', source: 'preset', is_grace_period: false };
      }
    } else if (normalized === d || normalized.endsWith('.' + d)) {
      return { classification: 'CREATE', source: 'preset', is_grace_period: false };
    }
  }

  // Check consume domains
  for (const d of domainPresets.consume) {
    if (normalized === d || normalized.endsWith('.' + d)) {
      return { classification: 'CONSUME', source: 'preset', is_grace_period: false };
    }
  }

  return { classification: 'UNKNOWN', source: 'default', is_grace_period: false };
}

/**
 * Main classification entry point
 * 
 * @param appName - Process/app name
 * @param windowTitle - Window title (optional)
 * @param domain - Domain from Chrome extension (optional, takes priority)
 */
export function classify(
  appName: string,
  windowTitle?: string | null,
  domain?: string | null
): ClassificationResult {
  // If we have a domain (from extension or title), classify by domain first
  if (domain) {
    const domainResult = classifyDomain(domain);
    if (domainResult.classification !== 'UNKNOWN') {
      return domainResult;
    }
  }

  // If it's a browser, try to extract domain from window title
  if (isBrowser(appName) && windowTitle) {
    const titleDomain = extractDomainFromTitle(windowTitle);
    if (titleDomain) {
      const domainResult = classifyDomain(titleDomain);
      if (domainResult.classification !== 'UNKNOWN') {
        return domainResult;
      }
    }
  }

  // Fall back to app classification
  const appResult = classifyApp(appName);
  if (appResult.classification !== 'UNKNOWN') {
    return {
      classification: appResult.classification,
      source: appResult.source,
      is_grace_period: false,
    };
  }

  // Default: UNKNOWN → treat as CONSUME (conservative)
  return {
    classification: 'CONSUME',
    source: 'default',
    is_grace_period: false,
  };
}
