// Create or Consume — Popup Logic (redesign)

// Shared config — single source of truth for API base (#17)
// Note: background.js also defines this constant; both must stay in sync.
const API_BASE = 'http://localhost:9876';

/**
 * Get auth token from chrome.storage (#A — extension auth)
 */
async function getAuthToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get('authToken', (result) => resolve(result.authToken || ''));
  });
}

/**
 * Get Authorization headers with stored token
 */
async function getAuthHeaders() {
  const token = await getAuthToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

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
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/api/today`, { headers });
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
 */
async function getCurrentTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return null;

    let domain;
    try {
      domain = new URL(tab.url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }

    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/api/state`, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();

    if (state && state.tracking && state.tracking.current_domain === domain) {
      return {
        domain,
        classification: state.tracking.current_classification || 'UNKNOWN',
        is_grace_period: state.tracking.is_grace_period || false,
        grace_remaining_seconds: 0,
      };
    }

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
    const authHeaders = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ type: 'domain', name: domain, classification }),
    });
    if (!response.ok) console.warn('[CoC] Override failed:', response.status); // #20
    return response.ok;
  } catch (err) {
    console.warn('[CoC] Override error:', err.message || err); // #20
    return false;
  }
}

/**
 * Update the popup UI with fresh data
 */
async function updateUI() {
  const popupView = document.getElementById('popup-view');
  const errorView = document.getElementById('error');
  const settingsPanel = document.getElementById('settings-panel');

  // Don't update if settings is open
  if (settingsPanel.classList.contains('active')) return;

  const today = await loadToday();

  if (!today) {
    popupView.style.display = 'none';
    errorView.style.display = 'flex';
    return;
  }

  popupView.style.display = 'flex';
  errorView.style.display = 'none';

  // Percentage
  const pctEl = document.getElementById('percentage');
  const pct = today.create_percentage || 0;
  pctEl.textContent = `${pct}%`;

  // Color class on the big number
  pctEl.className = 'percentage';
  if (pct < 40) pctEl.classList.add('consume');
  else if (pct < 60) pctEl.classList.add('mixed');
  // else stays green (default)

  // Progress bar
  document.getElementById('progress-fill').style.width = `${pct}%`;

  // Time labels
  document.getElementById('create-time').textContent = `${formatTime(today.create_seconds)} CREATE`;
  document.getElementById('consume-time').textContent = `${formatTime(today.consume_seconds)} CONSUME`;

  // Current tab info
  const tabInfo = await getCurrentTabInfo();

  if (tabInfo) {
    document.getElementById('current-domain').textContent = tabInfo.domain || '--';

    const dot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const classBadge = document.getElementById('class-badge');
    const graceBadge = document.getElementById('grace-badge');

    const cls = (tabInfo.classification || 'UNKNOWN').toLowerCase();
    dot.className = `badge-dot ${cls}`;
    statusText.textContent = tabInfo.classification || 'UNKNOWN';
    classBadge.className = `class-badge ${cls}`;

    if (tabInfo.is_grace_period) {
      graceBadge.style.display = 'inline-flex';
      const remaining = Math.ceil((tabInfo.grace_remaining_seconds || 0) / 60);
      graceBadge.textContent = `GRACE${remaining > 0 ? ' ' + remaining + 'm' : ''}`;
    } else {
      graceBadge.style.display = 'none';
    }

    // Show override section only when a real domain is tracked
    const overrideSection = document.getElementById('override-section');
    overrideSection.style.display = tabInfo.domain ? 'block' : 'none';

    // Set up override select
    const select = document.getElementById('override-select');
    select.value = '';
    select.onchange = async () => {
      if (select.value) {
        const success = await overrideDomain(tabInfo.domain, select.value);
        if (success) updateUI();
        select.value = '';
      }
    };
  }
}

/**
 * Render the settings panel's connection status
 */
function renderSettingsState(hasToken) {
  const connectedRow = document.getElementById('connected-row');
  const tokenInputRow = document.getElementById('token-input-row');

  if (hasToken) {
    connectedRow.style.display = 'flex';
    tokenInputRow.style.display = 'none';
  } else {
    connectedRow.style.display = 'none';
    tokenInputRow.style.display = 'flex';
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const popupView    = document.getElementById('popup-view');
  const settingsPanel = document.getElementById('settings-panel');
  const gearBtn       = document.getElementById('gear-btn');
  const closeBtn      = document.getElementById('settings-close-btn');
  const saveBtn       = document.getElementById('save-token-btn');
  const changeBtn     = document.getElementById('change-token-btn');
  const tokenInput    = document.getElementById('auth-token-input');

  // ── Gear button: open settings ──
  gearBtn.addEventListener('click', () => {
    popupView.style.display = 'none';
    settingsPanel.classList.add('active');

    // Reflect current token state in settings UI
    chrome.storage.local.get('authToken', (result) => {
      renderSettingsState(!!(result.authToken));
    });
  });

  // ── Close button: back to main view ──
  closeBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('active');
    popupView.style.display = 'flex';
    updateUI();
  });

  // ── Save token ──
  saveBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    if (!token) return;
    chrome.storage.local.set({ authToken: token }, () => {
      tokenInput.value = '';
      renderSettingsState(true);
      updateUI();
    });
  });

  // Allow Enter key in token input
  tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
  });

  // ── Change token (show input again) ──
  changeBtn.addEventListener('click', () => {
    document.getElementById('connected-row').style.display = 'none';
    document.getElementById('token-input-row').style.display = 'flex';
    tokenInput.focus();
  });

  // ── Initial load ──
  // If no token stored, open settings immediately so user can set it up
  chrome.storage.local.get('authToken', (result) => {
    if (!result.authToken) {
      popupView.style.display = 'none';
      settingsPanel.classList.add('active');
      renderSettingsState(false);
    } else {
      updateUI();
    }
  });
});
