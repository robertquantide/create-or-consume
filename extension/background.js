// Create or Consume — Background Service Worker
// Tracks active tab domain and reports to local engine

// Shared config — single source of truth for API base (#17)
const API_BASE = 'http://localhost:9876';

// Note: Chrome MV3 alarms have a minimum period of 1 minute (#18).
// We use 1 minute for the alarm-based poll. Tab change events provide
// immediate tracking for URL transitions within the same session.
const ALARM_POLL_INTERVAL_MIN = 1;

let lastDomain = null;
let lastClassification = null;

// Debounce tracking: track last-sent domain and timestamp (#21)
let debounceLastDomain = null;
let debounceLastTime = 0;
const DEBOUNCE_MS = 5000; // don't resend same domain within 5 seconds

/**
 * Extract domain from URL, stripping paths, query params, and fragments (#5)
 */
function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Return true if this URL should be tracked (#11)
 * Only track http:// and https://; skip browser-internal and special URLs
 */
function isTrackableURL(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Send current tab domain to the engine (#5 — domain only, no title or URL)
 */
async function trackDomain(domain) {
  if (!domain) return;

  // Debounce: skip if same domain sent recently (#21)
  const now = Date.now();
  if (domain === debounceLastDomain && now - debounceLastTime < DEBOUNCE_MS) {
    return;
  }
  debounceLastDomain = domain;
  debounceLastTime = now;

  try {
    const response = await fetch(`${API_BASE}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Only send domain — no title, no full URL (#5)
      body: JSON.stringify({ domain }),
    });

    if (response.ok) {
      const data = await response.json();
      lastDomain = domain;
      lastClassification = data.classification;
      updateBadge(data.classification, data.is_grace_period);
    } else {
      console.warn('[CoC] Track response error:', response.status); // #20
    }
  } catch (err) {
    // Engine not running — clear badge (#20)
    console.warn('[CoC] Engine unreachable:', err.message || err);
    chrome.action.setBadgeText({ text: '' });
    lastClassification = null;
  }
}

/**
 * Update extension badge based on classification
 */
function updateBadge(classification, isGracePeriod) {
  let text = '';
  let color = '#666666';

  switch (classification) {
    case 'CREATE':
      text = 'C';
      color = isGracePeriod ? '#F59E0B' : '#10B981';
      break;
    case 'CONSUME':
      text = 'C';
      color = '#EF4444';
      break;
    case 'MIXED':
      text = 'M';
      color = '#F59E0B';
      break;
    default:
      text = '?';
      color = '#666666';
  }

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

/**
 * Poll the active tab — extract domain only (#5, #11)
 */
async function pollActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    // Only track trackable URLs (#11)
    if (!isTrackableURL(tab.url)) return;

    const domain = extractDomain(tab.url);
    if (domain) {
      await trackDomain(domain);
    }
  } catch (err) {
    console.warn('[CoC] Poll error:', err.message || err); // #20
  }
}

// Set up chrome.alarms for periodic polling (#12 — replaces unreliable setInterval in MV3)
// Note: Chrome enforces minimum 1-minute alarm interval (#18)
chrome.alarms.create('poll-tab', { periodInMinutes: ALARM_POLL_INTERVAL_MIN });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll-tab') {
    pollActiveTab();
  }
});

// Track tab changes immediately (provides sub-minute tracking despite alarm limit)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url && isTrackableURL(tab.url)) {
      const domain = extractDomain(tab.url);
      if (domain) await trackDomain(domain);
    }
  } catch (err) {
    console.warn('[CoC] onActivated error:', err.message || err); // #20
  }
});

// Track URL changes (#11 — filter non-trackable URLs)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    if (!tab.url || !isTrackableURL(tab.url)) return;
    // Only track if this is the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id === tabId) {
        const domain = extractDomain(tab.url);
        if (domain) trackDomain(domain);
      }
    });
  }
});

// Initial poll on install/startup
chrome.runtime.onInstalled.addListener(() => {
  pollActiveTab();
});

chrome.runtime.onStartup.addListener(() => {
  pollActiveTab();
});

// NOTE: setInterval is intentionally removed (#12).
// MV3 service workers are ephemeral — setInterval is unreliable.
// Tab event listeners + chrome.alarms provide reliable tracking.
