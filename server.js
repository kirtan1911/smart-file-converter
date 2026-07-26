/**
 * server.js
 * Smart File Converter — Production Entry Point
 * ─────────────────────────────────────────────
 * Render-specific fixes applied (see inline comments marked [RENDER FIX]):
 *   1. app.listen binds to '0.0.0.0' — required on Render/Docker
 *   2. UPLOADS_DIR / CONVERTED_DIR → /tmp (writable on Render)
 *   3. trust proxy = 1 (Render sits behind nginx/load balancer)
 *   4. All errors logged to console.error for Render log visibility
 */

'use strict';

// ── Core imports ──────────────────────────────────────────────
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const path        = require('path');
const fs          = require('fs-extra');

require('dotenv').config();

// ── [RENDER FIX #2] Use writable temp directories ─────────────
// See utils/tempDir.js for the full explanation.
// TLDR: Render's container filesystem is read-only except /tmp.
// We must resolve UPLOADS_DIR / CONVERTED_DIR to /tmp/sfc_*
// before requiring any routes (they import these paths too).
const {
  UPLOADS_DIR,
  CONVERTED_DIR,
  ensureTempDirs
} = require('./utils/tempDir');

// Create /tmp/sfc_uploads and /tmp/sfc_converted if they don't exist.
// This runs synchronously before any route is loaded.
ensureTempDirs();

// ── Routes ────────────────────────────────────────────────────
const uploadRouter   = require('./routes/upload');
const convertRouter  = require('./routes/convert');
const downloadRouter = require('./routes/download');
const { cleanupOldFiles } = require('./utils/cleanup');

// ── App ───────────────────────────────────────────────────────
const app = express();

// ── [RENDER FIX #3] PORT must come from process.env.PORT ─────
// Render injects $PORT at runtime (usually 10000).
// NEVER hardcode 3000/5000 — Render's router won't forward traffic.
// We bind to 0.0.0.0 (see app.listen below) — 'localhost' only
// listens on the loopback interface and Render cannot reach it.
const PORT = process.env.PORT || 3000;

// ── Static files path ─────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.ensureDirSync(PUBLIC_DIR);

// ── [RENDER FIX #4] Trust proxy ───────────────────────────────
// Render (and most PaaS providers) sit behind a reverse proxy / nginx.
// Without trust proxy = 1:
//   - req.ip returns the proxy IP, not the client IP
//   - express-rate-limit breaks (if you add it later)
//   - HTTPS detection breaks (req.secure is always false)
app.set('trust proxy', 1);

// ── Request timeout ───────────────────────────────────────────
// Render's free/starter HTTP timeout is 30s per request.
// For large file conversions (100MB PDF via LibreOffice), this is
// often not enough. We extend the socket timeout here.
// NOTE: Render's load balancer has its own 30s hard limit on free plans.
// Upgrade to a paid plan for long-running conversions (>30s).
app.use((req, res, next) => {
  // 10 minutes: gives LibreOffice time to convert large files
  req.setTimeout(10 * 60 * 1000);
  res.setTimeout(10 * 60 * 1000);
  next();
});

// ── Security middleware ───────────────────────────────────────
app.use(
  helmet({
    // crossOriginResourcePolicy: false → allows frontend to load
    // files from /uploads and /converted static endpoints.
    crossOriginResourcePolicy: false,
    // contentSecurityPolicy: false → avoids blocking inline scripts
    // in the frontend. You can re-enable and configure CSP later.
    contentSecurityPolicy: false
  })
);

app.use(
  cors({
    // origin: true reflects the request Origin header.
    // For production, set this to your specific domain:
    //   origin: process.env.ALLOWED_ORIGIN || true
    origin: true,
    credentials: true
  })
);

app.use(compression());

// ── Body parser ───────────────────────────────────────────────
// WHY 100mb limit:
//   The convert route receives a JSON body containing file metadata
//   (not the actual binary — that's handled by multer on /upload).
//   100mb is overkill but safe for large filename arrays.
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// ── Static files ──────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR, { maxAge: '1d', etag: true }));
app.use('/css',    express.static(path.join(PUBLIC_DIR, 'css')));
app.use('/js',     express.static(path.join(PUBLIC_DIR, 'js')));
app.use('/images', express.static(path.join(PUBLIC_DIR, 'images')));

// Serve converted files for direct access
// WHY: The frontend may try to preview the file before downloading.
// We expose the /tmp/sfc_converted directory as /converted.
app.use('/uploads',  express.static(UPLOADS_DIR));
app.use('/converted', express.static(CONVERTED_DIR));

// ── API routes ────────────────────────────────────────────────
app.use('/upload',   uploadRouter);
app.use('/convert',  convertRouter);
app.use('/download', downloadRouter);

// ── Health check ──────────────────────────────────────────────
// WHY: Render pings this endpoint. If it returns non-2xx,
// Render marks the instance unhealthy and may restart it.
// We report useful diagnostic info for debugging.
app.get('/health', async (req, res) => {
  try {
    const uploadsExists   = await fs.pathExists(UPLOADS_DIR);
    const convertedExists = await fs.pathExists(CONVERTED_DIR);

    // Check LibreOffice is on PATH
    let libreOfficeVersion = 'unknown';
    try {
      const { execSync } = require('child_process');
      libreOfficeVersion = execSync('soffice --version', { timeout: 5000 })
        .toString().trim();
    } catch {
      libreOfficeVersion = 'NOT FOUND — docx-to-pdf will use PDFKit fallback';
    }

    return res.status(200).json({
      success:           true,
      status:            'ok',
      uploadsDir:        UPLOADS_DIR,
      uploadsDirExists:  uploadsExists,
      convertedDir:      CONVERTED_DIR,
      convertedDirExists: convertedExists,
      libreOffice:       libreOfficeVersion,
      nodeVersion:       process.version,
      uptime:            process.uptime(),
      timestamp:         new Date().toISOString(),
      memory:            process.memoryUsage(),
      env:               process.env.NODE_ENV || 'development'
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Root route ────────────────────────────────────────────────
app.get('/', (req, res) => {
  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── 404 for unknown API routes ────────────────────────────────
app.use('/api', (req, res) => {
  return res.status(404).json({ success: false, error: 'API route not found.' });
});

// ── SPA fallback ──────────────────────────────────────────────
app.get('*', (req, res) => {
  if (
    req.path.startsWith('/upload') ||
    req.path.startsWith('/convert') ||
    req.path.startsWith('/download')
  ) {
    return res.status(404).json({ success: false, error: 'Route not found.' });
  }
  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── Global error handler ──────────────────────────────────────
// WHY we log full error objects (not just err.message):
//   Render's log viewer truncates output. Logging the full err object
//   ensures the stack trace appears in Render dashboard → Logs.
app.use((err, req, res, next) => {
  console.error('\n[SERVER ERROR]', new Date().toISOString());
  console.error('  Path:  ', req.method, req.path);
  console.error('  Error: ', err.message);
  console.error('  Stack: ', err.stack);

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      error: 'File too large. Maximum allowed size is 100MB.'
    });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({
      success: false,
      error: 'Maximum 100 files allowed.'
    });
  }

  return res.status(500).json({
    success: false,
    // In production, never expose internal error details to clients.
    // They appear in Render logs, not in the browser response.
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error.'
      : err.message
  });
});

// ── [RENDER FIX #1] Listen on 0.0.0.0 ───────────────────────
// THE MOST COMMON RENDER DEPLOYMENT BUG:
//   app.listen(PORT) defaults to 'localhost' / 127.0.0.1.
//   Inside a Docker container, Render's load balancer connects
//   to the container's eth0 interface (e.g., 10.x.x.x), NOT localhost.
//   Listening only on localhost means Render CANNOT reach your server.
//   Symptom: "Site loads but shows connection refused or blank page."
//
//   FIX: Always bind to '0.0.0.0' which means "all interfaces".
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log('\n═══════════════════════════════════════');
  console.log('🚀 Smart File Converter Started');
  console.log(`🌍 Port:       ${PORT}`);
  console.log(`📁 Uploads:    ${UPLOADS_DIR}`);
  console.log(`📁 Converted:  ${CONVERTED_DIR}`);
  console.log(`🔗 URL:        http://0.0.0.0:${PORT}`);
  console.log(`📦 Node:       ${process.version}`);
  console.log(`🌱 Env:        ${process.env.NODE_ENV || 'development'}`);
  console.log('═══════════════════════════════════════\n');

  // Startup cleanup: remove temp files left over from a previous crash
  try {
    await cleanupOldFiles(UPLOADS_DIR, CONVERTED_DIR);
    console.log('🧹 Startup cleanup completed.');
  } catch (cleanupErr) {
    // Non-fatal: log but do not crash the server
    console.error('[Cleanup Error]', cleanupErr.message);
  }
});

// ── Graceful shutdown ─────────────────────────────────────────
// WHY: Render sends SIGTERM when deploying a new version or scaling down.
// Without this handler, Node exits immediately, dropping in-flight requests.
// server.close() waits for active connections to finish before exiting.
function shutdown(signal) {
  console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('✅ Server closed. Goodbye.');
    process.exit(0);
  });
  // Force exit after 15s in case connections stall
  setTimeout(() => {
    console.error('⚠️  Forced exit after 15s timeout.');
    process.exit(1);
  }, 15000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Unhandled errors ─────────────────────────────────────────
// WHY both handlers:
//   unhandledRejection: catches async/await errors without try/catch
//   uncaughtException:  catches sync errors outside any try/catch
// Both print to stderr so they appear in Render's log panel.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]');
  console.error('  Promise:', promise);
  console.error('  Reason: ', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err.message);
  console.error(err.stack);
  // Do NOT exit here for recoverable errors; let the process continue.
  // For truly fatal errors (e.g., OOM), Node will exit on its own.
});

module.exports = app;