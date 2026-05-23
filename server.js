/**
 * server.js — Smart File Converter
 * Production Ready Express Server
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const path = require('path');
const fs = require('fs-extra');

const uploadRouter = require('./routes/upload');
const convertRouter = require('./routes/convert');
const downloadRouter = require('./routes/download');

const { cleanupOldFiles } = require('./utils/cleanup');

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// Ensure Required Directories Exist
// ─────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const CONVERTED_DIR = path.join(__dirname, 'converted');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(CONVERTED_DIR);
fs.ensureDirSync(PUBLIC_DIR);

// ─────────────────────────────────────────────
// Security Middleware
// ─────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(compression());

// ─────────────────────────────────────────────
// Body Parser
// ─────────────────────────────────────────────
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({
  extended: true,
  limit: '500mb'
}));

// ─────────────────────────────────────────────
// STATIC FILES (IMPORTANT FIX)
// ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// Optional direct static mappings
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// ─────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────
app.use('/upload', uploadRouter);
app.use('/convert', convertRouter);
app.use('/download', downloadRouter);

// ─────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ─────────────────────────────────────────────
// Root Route
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ─────────────────────────────────────────────
// SPA Fallback
// ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ─────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {

  console.error('[Server Error]', err);

  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });

});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
app.listen(PORT, async () => {

  console.log('\n═══════════════════════════════════════');
  console.log('🚀 Smart File Converter Started');
  console.log(`🌍 Running on Port: ${PORT}`);
  console.log(`🔗 URL: http://localhost:${PORT}`);
  console.log('═══════════════════════════════════════\n');

  try {

    // Cleanup old temp files
    await cleanupOldFiles(UPLOADS_DIR, CONVERTED_DIR);

    console.log('🧹 Old temporary files cleaned.');

  } catch (cleanupError) {

    console.error('Cleanup Error:', cleanupError.message);

  }

});

// ─────────────────────────────────────────────
// Graceful Shutdown
// ─────────────────────────────────────────────
process.on('SIGTERM', () => {

  console.log('\n🛑 Server shutting down gracefully...');
  process.exit(0);

});

// ─────────────────────────────────────────────
// Unhandled Promise Rejections
// ─────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {

  console.error('Unhandled Promise Rejection:', reason);

});

// ─────────────────────────────────────────────
// Export App
// ─────────────────────────────────────────────
module.exports = app;