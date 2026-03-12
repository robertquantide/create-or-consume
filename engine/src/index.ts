import path from 'path';
import { fileURLToPath } from 'url';
import { initDB, closeDB } from './db.js';
import { loadPresets } from './classifier.js';
import { startTracking, stopTracking } from './tracker.js';
import { createAPI } from './api.js';
import { CONFIG } from './types.js';
import { cleanupGraceSessions } from './grace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function main(): void {
  console.log('');
  console.log('  ╔═══════════════════════════════════╗');
  console.log('  ║       CREATE  or  CONSUME          ║');
  console.log('  ║                                     ║');
  console.log('  ║  Track what you BUILD,              ║');
  console.log('  ║  not what you scroll.               ║');
  console.log('  ╚═══════════════════════════════════╝');
  console.log('');

  // Resolve DB path relative to engine root
  const dbPath = path.resolve(__dirname, '..', CONFIG.DB_PATH);

  // Initialize database
  console.log(`[DB] Initializing at ${dbPath}`);
  initDB(dbPath);

  // Load classification presets
  console.log('[Classifier] Loading presets...');
  loadPresets();

  // Start the tracking loop
  startTracking();

  // Grace period cleanup every 5 minutes
  const cleanupInterval = setInterval(cleanupGraceSessions, 5 * 60 * 1000);

  // Start HTTP server
  const app = createAPI();
  const server = app.listen(CONFIG.API_PORT, () => {
    console.log(`[API] Server running at http://localhost:${CONFIG.API_PORT}`);
    console.log(`[API] Dashboard: http://localhost:${CONFIG.API_PORT}/`);
    console.log('');
    console.log('[Ready] Tracking active windows...');
    console.log('[Note] Install the Chrome extension for browser tab tracking.');
    console.log('');
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Shutdown] Stopping...');
    stopTracking();
    clearInterval(cleanupInterval);
    server.close(() => {
      closeDB();
      console.log('[Shutdown] Done.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
