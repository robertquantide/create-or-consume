// Create or Consume — Popup Logic

// Shared config — single source of truth for API base (#17)
// Note: background.js also defines this constant; both must stay in sync.
// Future: consider chrome.storage for shared config.
const API_BASE = 'http://localhost:9876';

/**
 * Format seconds to "Xh Ym" string
 */
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/**
 * Fetch today's stats from the engine
 */
async function loadToday() {
  try {
    const response = await fetch(`${API_BASE}/api/today`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    console.warn('[CoC] Failed to load today stats:', err.message || err); // #20
    return null;
  }
}

/**
 * Get current tab's classification from the engine state
 * NOTE: Popup no longer POSTs to /api/track — background.js handles all tracking (#19)
 * We read the current state instead.
 */
async function getCurrentTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return null;

    // Extract domain safely
    let domain;
    try {
      domain = new URL(tab.url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }

    // Only read state — do NOT post to /api/track (background handles it, #19)
    const response = await fetch(`${API_BASE}/api/state`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();

    // Use current tracking state if it matches current domain
    if (state && state.tracking && state.tracking.current_domain === domain) {
      return {
        domain,
        classification: state.tracking.current_classification || 'UNKNOWN',
        is_grace_period: state.tracking.is_grace_period || false,
        grace_remaining_seconds: 0,
      };
    }

    // Domain not yet tracked — return domain info without posting
    return { domain, classification: 'UNKNOWN', is_grace_period: false, grace_remaining_seconds: 0 };
  } catch (err) {
    console.warn('[CoC] Failed to get tab info:', err.message || err); // #20
    return null;
  }
}

/**
 * Override classification for current domain
 */
async function overrideDomain(domain, classification) {
  try {
    const response = await fetch(`${API_BASE}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'domain',
        name: domain,
        classification,
      }),
    });

    if (!response.ok) console.warn('[CoC] Override failed:', response.status); // #20
    return response.ok;
  } catch (err) {
    console.warn('[CoC] Override error:', err.message || err); // #20
    return false;
  }
}

/**
 * Update the popup UI
 */
async function updateUI() {
  const popup = document.querySelector('.popup');
  const error = document.getElementById('error');

  // Load today's stats
  const today = await loadToday();

  if (!today) {
    popup.style.display = 'none';
    error.style.display = 'block';
    return;
  }

  popup.style.display = 'block';
  error.style.display = 'none';

  // Update percentage
  const pctEl = document.getElementById('percentage');
  const pct = today.create_percentage || 0;
  pctEl.textContent = `${pct}%`;

  if (pct >= 60) {
    pctEl.className = 'percentage';
  } else if (pct >= 40) {
    pctEl.className = 'percentage mid';
  } else {
    pctEl.className = 'percentage low';
  }

  // Update progress bar
  document.getElementById('progress-fill').style.width = `${pct}%`;

  // Update times
  document.getElementById('create-time').textContent = formatTime(today.create_seconds);
  document.getElementById('consume-time').textContent = formatTime(today.consume_seconds);

  // Get current tab info (reads state, does NOT post tracking, #19)
  const tabInfo = await getCurrentTabInfo();

  if (tabInfo) {
    document.getElementById('current-domain').textContent = tabInfo.domain;

    const dot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const graceBadge = document.getElementById('grace-badge');

    dot.className = `dot ${tabInfo.classification.toLowerCase()}`;
    statusText.textContent = tabInfo.classification;

    if (tabInfo.is_grace_period) {
      graceBadge.style.display = 'inline';
      const remaining = Math.ceil(tabInfo.grace_remaining_seconds / 60);
      graceBadge.textContent = `GRACE ${remaining}m`;
    } else {
      graceBadge.style.display = 'none';
    }

    // Set up override select
    const select = document.getElementById('override-select');
    select.value = '';
    select.onchange = async () => {
      if (select.value) {
        const success = await overrideDomain(tabInfo.domain, select.value);
        if (success) {
          updateUI();
        }
        select.value = '';
      }
    };
  }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', updateUI);
