// Create or Consume — Background Service Worker
// Tracks active tab and reports to local engine

const API_BASE = 'http://localhost:9876';
const POLL_INTERVAL_MS = 5000;

let lastDomain = null;
let lastClassification = null;

/**
 * Extract domain from URL
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
 * Send current tab info to the engine
 */
async function trackTab(tab) {
  if (!tab || !tab.url) return;

  // Skip chrome:// and extension pages
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    return;
  }

  const domain = extractDomain(tab.url);
  if (!domain) return;

  try {
    const response = await fetch(`${API_BASE}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Send domain only — do NOT send title or full URL (privacy)
      body: JSON.stringify({
        domain,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      lastDomain = domain;
      lastClassification = data.classification;

      // Update badge
      updateBadge(data.classification, data.is_grace_period);
    }
  } catch (err) {
    // Engine not running — clear badge
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
      color = isGracePeriod ? '#F59E0B' : '#10B981'; // yellow during grace, green otherwise
      break;
    case 'CONSUME':
      text = 'C';
      color = '#EF4444'; // red
      break;
    case 'MIXED':
      text = 'M';
      color = '#F59E0B'; // yellow
      break;
    default:
      text = '?';
      color = '#666666';
  }

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

/**
 * Poll the active tab
 */
async function pollActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await trackTab(tab);
    }
  } catch (err) {
    // Ignore errors during polling
  }
}

// Set up alarm for periodic polling
chrome.alarms.create('poll-tab', { periodInMinutes: POLL_INTERVAL_MS / 60000 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll-tab') {
    pollActiveTab();
  }
});

// Track tab changes immediately
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    trackTab(tab);
  } catch {
    // Tab might not exist anymore
  }
});

// Track URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    // Only track if this is the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id === tabId) {
        trackTab(tab);
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

// Also set up a secondary setInterval as backup (alarms have minimum 1 min)
setInterval(pollActiveTab, POLL_INTERVAL_MS);
