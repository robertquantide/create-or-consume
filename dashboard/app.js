// Create or Consume — Dashboard Logic

const API_BASE = window.location.origin;

// --- Utilities ---

function formatTime(seconds) {
  if (!seconds || seconds === 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatTimeShort(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h`;
}

function getDayName(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en', { weekday: 'short' });
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

// --- API calls ---

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`Fetch error: ${url}`, err);
    return null;
  }
}

async function postJSON(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`Post error: ${url}`, err);
    return null;
  }
}

// --- Render functions ---

function renderHero(today) {
  const pct = today.create_percentage || 0;

  const heroEl = document.getElementById('hero-percentage');
  heroEl.textContent = `${pct}%`;
  heroEl.className = 'hero-percentage' +
    (pct >= 60 ? '' : pct >= 40 ? ' mid' : ' low');

  document.getElementById('hero-create-time').textContent = formatTime(today.create_seconds);
  document.getElementById('hero-consume-time').textContent = formatTime(today.consume_seconds);
  document.getElementById('hero-mixed-time').textContent = formatTime(today.mixed_seconds);

  document.getElementById('main-progress').style.width = `${pct}%`;
}

function renderTimeline(sessions) {
  const container = document.getElementById('timeline-bar');
  container.innerHTML = '';

  if (!sessions || sessions.length === 0) {
    container.innerHTML = '<div class="empty" style="width:100%;display:flex;align-items:center;justify-content:center;font-size:12px;color:#555">No sessions recorded today</div>';
    return;
  }

  // Find time range
  const firstStart = sessions[0].start_time;
  const lastEnd = sessions[sessions.length - 1].end_time || Date.now();
  const totalRange = lastEnd - firstStart;

  if (totalRange <= 0) return;

  for (const session of sessions) {
    const start = session.start_time;
    const end = session.end_time || Date.now();
    const duration = end - start;
    const widthPct = Math.max(0.5, (duration / totalRange) * 100);
    const knownClasses = ['create', 'consume', 'mixed', 'unknown'];
    const rawCls = (session.classification || '').toLowerCase();
    const cls = knownClasses.includes(rawCls) ? rawCls : 'unknown';

    const seg = document.createElement('div');
    seg.className = `timeline-segment ${cls}`;
    seg.style.width = `${widthPct}%`;

    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.textContent = `${session.app_name}${session.domain ? ' (' + session.domain + ')' : ''} — ${formatTime(session.duration_seconds || 0)}`;
    seg.appendChild(tooltip);

    container.appendChild(seg);
  }

  // Update time labels
  const startTime = new Date(firstStart).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  const endTime = new Date(lastEnd).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('timeline-start').textContent = startTime;
  document.getElementById('timeline-end').textContent = endTime;
}

function renderApps(apps) {
  const list = document.getElementById('app-list');
  list.innerHTML = '';

  if (!apps || apps.length === 0) {
    list.innerHTML = '<li class="empty">No apps tracked today</li>';
    return;
  }

  const maxTime = Math.max(...apps.map(a => a.total_seconds));

  for (const app of apps) {
    // Sanitize classification to only allow known safe values for class names
    const knownClasses = ['create', 'consume', 'mixed', 'unknown'];
    const rawCls = (app.classification || '').toLowerCase();
    const cls = knownClasses.includes(rawCls) ? rawCls : 'unknown';
    const barWidth = maxTime > 0 ? (app.total_seconds / maxTime) * 100 : 0;

    const li = document.createElement('li');
    li.className = 'app-item';
    // Use escapeHTML on all user-controlled string data to prevent XSS
    li.innerHTML = `
      <span class="app-badge ${cls}">${escapeHTML(app.classification)}</span>
      <span class="app-name">${escapeHTML(app.app_name)}</span>
      <span class="app-time">${formatTime(app.total_seconds)}</span>
      <div class="app-bar-container">
        <div class="app-bar ${cls}" style="width: ${barWidth.toFixed(2)}%"></div>
      </div>
    `;
    list.appendChild(li);
  }
}

function renderWeekly(days) {
  const chart = document.getElementById('weekly-chart');
  chart.innerHTML = '';

  if (!days || days.length === 0) {
    chart.innerHTML = '<div class="empty" style="width:100%">No weekly data yet</div>';
    return;
  }

  const maxTotal = Math.max(...days.map(d => d.total_seconds), 1);

  for (const day of days) {
    const total = day.total_seconds || 1;
    const createPct = Math.round((day.create_seconds / total) * 100);
    const createHeight = (day.create_seconds / maxTotal) * 100;
    const consumeHeight = (day.consume_seconds / maxTotal) * 100;

    const col = document.createElement('div');
    col.className = 'weekly-day';
    col.innerHTML = `
      <div class="weekly-bar-container">
        <div class="weekly-bar consume" style="height: ${consumeHeight}%"></div>
        <div class="weekly-bar create" style="height: ${createHeight}%"></div>
      </div>
      <span class="weekly-label">${getDayName(day.date)}</span>
      <span class="weekly-pct">${createPct}%</span>
    `;
    chart.appendChild(col);
  }
}

function renderOverrides(presets) {
  // This would render current overrides in settings
  // For MVP, we just show the add form
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Settings ---

async function handleOverrideSubmit(e) {
  e.preventDefault();

  const typeEl = document.getElementById('override-type');
  const nameEl = document.getElementById('override-name');
  const classEl = document.getElementById('override-class');

  const type = typeEl.value;
  const name = nameEl.value.trim();
  const classification = classEl.value;

  if (!name) return;

  const result = await postJSON(`${API_BASE}/api/classify`, {
    type,
    name,
    classification,
  });

  if (result && result.ok) {
    nameEl.value = '';
    // Refresh data
    loadAll();
  }
}

// --- Load all data ---

async function loadAll() {
  const [today, sessions, apps, weekly] = await Promise.all([
    fetchJSON(`${API_BASE}/api/today`),
    fetchJSON(`${API_BASE}/api/sessions?date=${new Date().toISOString().split('T')[0]}`),
    fetchJSON(`${API_BASE}/api/apps`),
    fetchJSON(`${API_BASE}/api/stats/weekly`),
  ]);

  if (today) renderHero(today);
  if (sessions) renderTimeline(sessions.sessions);
  if (apps) renderApps(apps.apps);
  if (weekly) renderWeekly(weekly.days);

  // Update date
  document.getElementById('nav-date').textContent =
    new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' });
}

// --- Initialize ---

document.addEventListener('DOMContentLoaded', () => {
  loadAll();

  // Set up override form
  const form = document.getElementById('override-form');
  if (form) form.addEventListener('submit', handleOverrideSubmit);

  // Auto-refresh every 30 seconds
  setInterval(loadAll, 30000);
});
