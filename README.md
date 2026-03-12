# Create or Consume

**The first screen time tracker that measures what you BUILD, not what you scroll.**

Most screen time trackers tell you "you spent 6 hours on your computer." That's useless. What matters is *what you did* with those 6 hours. Were you creating — writing code, designing, editing video? Or consuming — scrolling Twitter, watching YouTube, browsing Reddit?

Create or Consume tracks this automatically. No manual timers. No categories to configure. Just install and start getting real answers about your screen time.

<!-- ![Dashboard Screenshot](docs/screenshot.png) -->

## Features

- **Automatic classification** — Apps and websites are classified as CREATE or CONSUME using built-in presets
- **Grace periods** — Mixed-use sites (Twitter, LinkedIn) start as CREATE and flip to CONSUME after a configurable timer
- **Chrome extension** — Tracks your active browser tab and shows real-time classification badge
- **Web dashboard** — Beautiful dark-themed dashboard with daily timeline, app breakdown, and weekly trends
- **Self-hosted** — Everything runs locally. Zero data leaves your machine.
- **Cross-platform** — Works on macOS, Windows, and Linux (with desktop environment)
- **Customizable** — Override any app or domain classification. Adjust grace periods.
- **SQLite** — Lightweight, portable database. Your data is a single file.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- A desktop environment (for window tracking — headless servers can still use the Chrome extension)

### Install & Run

```bash
# Clone the repo
git clone https://github.com/mguleryuz/create-or-consume.git
cd create-or-consume

# Install dependencies
cd engine && bun install && cd ..

# Start the engine
bun run dev
```

The engine starts on `http://localhost:9876`. Open it in your browser to see the dashboard.

### Install Chrome Extension

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder from this repo
5. Done — you'll see a "C" badge on the extension icon

The extension sends your active tab's domain to the local engine for classification. Green badge = CREATE, red badge = CONSUME.

## How It Works

### Classification

Every 5 seconds, the engine checks your active window:

1. **App matching** — Process name is matched against built-in presets (e.g., "Visual Studio Code" → CREATE, "Netflix" → CONSUME)
2. **Domain matching** — For browser windows, the domain is matched against domain presets (e.g., "github.com" → CREATE, "reddit.com" → CONSUME)
3. **Chrome extension** — Provides exact domain info for the active browser tab
4. **Fallback** — Unknown apps default to CONSUME (conservative approach)

### Grace Periods

Some sites are both creative and consuming. Twitter, LinkedIn, YouTube — you might be posting content or doom-scrolling.

Grace periods handle this:

1. When you first visit a mixed-use site, a timer starts
2. During the grace period, the site is classified as **CREATE** (benefit of the doubt)
3. After the grace period expires, it flips to **CONSUME**
4. If you leave the site for 30+ minutes and come back, the grace period resets

Default grace periods:
| Site | Grace Period |
|------|-------------|
| twitter.com / x.com | 10 minutes |
| linkedin.com | 15 minutes |
| discord.com | 15 minutes |
| slack.com | 20 minutes |
| medium.com | 20 minutes |
| youtube.com | 5 minutes |

### Presets

Built-in presets cover 50+ apps and 40+ domains. See:
- `engine/presets/apps.json` — App classifications
- `engine/presets/domains.json` — Domain classifications

**CREATE apps include:** VS Code, Cursor, Figma, Blender, Photoshop, Terminal, Obsidian, and more.

**CONSUME apps include:** Netflix, Spotify, Discord, Mail, and more.

### Customization

Override any classification via the API or dashboard:

```bash
# Mark Discord as CREATE (you use it for work)
curl -X POST http://localhost:9876/api/classify \
  -H "Content-Type: application/json" \
  -d '{"type": "app", "name": "Discord", "classification": "CREATE"}'

# Mark a domain as CONSUME
curl -X POST http://localhost:9876/api/classify \
  -H "Content-Type: application/json" \
  -d '{"type": "domain", "name": "news.ycombinator.com", "classification": "CONSUME"}'
```

## API

The engine exposes a REST API on `localhost:9876`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/today` | Today's CREATE/CONSUME ratio |
| GET | `/api/sessions` | Recent sessions (pagination) |
| GET | `/api/stats/:period` | Stats for daily/weekly/monthly |
| GET | `/api/apps` | Per-app time breakdown |
| POST | `/api/classify` | Override app/domain classification |
| POST | `/api/track` | Chrome extension reports active tab |
| GET | `/api/presets` | Current classification presets |
| PUT | `/api/presets` | Update classification presets |
| GET | `/api/state` | Current tracking state (debug) |
| GET | `/` | Dashboard |

## Architecture

```
┌─────────────┐     POST /api/track     ┌─────────────────┐
│   Chrome     │ ───────────────────────>│                 │
│  Extension   │ <───────────────────────│   Engine        │
│  (MV3)       │   { classification }    │  (Bun/TS)       │
└─────────────┘                          │                 │
                                         │  - Tracker      │
┌─────────────┐   active-win polling     │  - Classifier   │
│   Desktop    │ <──────────────────────>│  - Grace mgr    │
│  (macOS/Win) │                         │  - SQLite DB    │
└─────────────┘                          │  - REST API     │
                                         │                 │
┌─────────────┐     GET /               │                 │
│  Dashboard   │ <──────────────────────│                 │
│  (Browser)   │                         └─────────────────┘
└─────────────┘
```

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript (engine), Vanilla JS (extension + dashboard)
- **Database:** SQLite via better-sqlite3
- **Window tracking:** active-win (cross-platform)
- **HTTP:** Express
- **Extension:** Chrome Manifest V3

## Headless Server Mode

On servers without a GUI (like a VPS), the `active-win` module won't work. That's fine — the Chrome extension can still track your browser tabs. The engine will receive domain data via the `/api/track` endpoint and classify it normally.

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -am 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

### Ideas for contributions:
- **Firefox extension** — Port the Chrome extension to Firefox
- **Tauri wrapper** — Desktop app with system tray and native notifications
- **Activity detection** — Detect keyboard/mouse activity for mixed sites instead of time-based grace
- **Pomodoro integration** — Track CREATE streaks and suggest breaks
- **Weekly email digest** — Summary of your CREATE/CONSUME ratio
- **Export** — CSV/JSON export of your data
- **Mobile companion** — View your stats from your phone

## License

MIT — do whatever you want with it.
