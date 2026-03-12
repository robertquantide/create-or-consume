// Create or Consume — Popup Logic

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
    if (!response.ok) throw new Error('Engine error');
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Get current tab's classification
 */
async function getCurrentTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return null;

    // Only track http:// and https:// URLs
    if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) return null;

    const url = new URL(tab.url);
    const domain = url.hostname.replace(/^www\./, '');

    const response = await fetch(`${API_BASE}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Send domain only — do NOT send title or full URL (privacy)
      body: JSON.stringify({ domain }),
    });

    if (!response.ok) throw new Error('Engine error');
    return await response.json();
  } catch {
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

    return response.ok;
  } catch {
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

  // Get current tab info
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
          // Refresh UI
          updateUI();
        }
        select.value = '';
      }
    };
  }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', updateUI);
