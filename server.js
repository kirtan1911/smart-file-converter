/**
 * server.js — Smart File Converter
 * Main Express server: sets up middleware, routes, and starts listening
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');

const uploadRouter   = require('./routes/upload');
const convertRouter  = require('./routes/convert');
const downloadRouter = require('./routes/download');
const { cleanupOldFiles } = require('./utils/cleanup');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Ensure required directories exist ─────────────────
const UPLOADS_DIR   = path.join(__dirname, 'uploads');
const CONVERTED_DIR = path.join(__dirname, 'converted');
const PUBLIC_DIR    = path.join(__dirname, 'public');

fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(CONVERTED_DIR);
fs.ensureDirSync(PUBLIC_DIR);

// ── Middleware ─────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve frontend static files
app.use(express.static(PUBLIC_DIR));

// ── API Routes ─────────────────────────────────────────
app.use('/upload',   uploadRouter);
app.use('/convert',  convertRouter);
app.use('/download', downloadRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Catch-all: serve index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── Global Error Handler ───────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({
    success: false,
    error: err.message || 'An unexpected server error occurred.'
  });
});

// ── Startup ────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║       Smart File Converter — Started     ║`);
  console.log(`║   http://localhost:${PORT}                  ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);

  // Clean up any stale files from previous runs
  await cleanupOldFiles(UPLOADS_DIR, CONVERTED_DIR);
  console.log('[Server] Startup cleanup complete.');
});

// ── Graceful Shutdown ──────────────────────────────────
process.on('SIGTERM', () => {
  console.log('\n[Server] Shutting down gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled Promise Rejection:', reason);
});

module.exports = app;