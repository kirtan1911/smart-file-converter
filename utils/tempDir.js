/**
 * utils/tempDir.js
 * ─────────────────────────────────────────────────────────────
 * RENDER-SPECIFIC FIX: Writable temp directory management.
 *
 * THE PROBLEM ON RENDER:
 *   Render's Docker containers have a read-only filesystem EXCEPT
 *   for /tmp. Writing uploads to ./uploads (relative to /app) causes:
 *     EACCES: permission denied, open '/app/uploads/...'
 *   or on some configurations:
 *     EROFS: read-only file system
 *
 * THE FIX:
 *   All temporary files (uploads + converted output) are written
 *   to /tmp/uploads and /tmp/converted respectively.
 *   These directories are always writable on:
 *     - Render Docker containers
 *     - Railway
 *     - Fly.io
 *     - Local Linux/macOS/Windows (os.tmpdir() resolves to the right place)
 *
 * LOCAL WINDOWS BEHAVIOR:
 *   os.tmpdir() on Windows = C:\Users\<user>\AppData\Local\Temp
 *   This is fine for local dev. The paths are still writable.
 *
 * ENVIRONMENT VARIABLE OVERRIDE:
 *   Set TEMP_DIR=/data in render.yaml if you add a persistent disk.
 *   This module reads TEMP_DIR env var, falling back to os.tmpdir().
 */

'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs-extra');

// ── Base temp directory ───────────────────────────────────────
// Priority: TEMP_DIR env var → os.tmpdir() (/tmp on Linux)
// On Render, os.tmpdir() returns /tmp which is writable.
// On Windows, it returns C:\Users\...\AppData\Local\Temp.
const BASE_TEMP = process.env.TEMP_DIR || os.tmpdir();

// ── Application-specific subdirectories ──────────────────────
const UPLOADS_DIR   = path.join(BASE_TEMP, 'sfc_uploads');
const CONVERTED_DIR = path.join(BASE_TEMP, 'sfc_converted');

/**
 * Ensures both temp directories exist (creates if missing).
 * Called once at server startup.
 *
 * WHY fs.ensureDirSync (not mkdirSync):
 *   ensureDirSync is idempotent — does nothing if the dir already exists.
 *   mkdirSync throws EEXIST on the second call unless { recursive: true }
 *   is passed. ensureDirSync handles this cleanly.
 */
function ensureTempDirs() {
  try {
    fs.ensureDirSync(UPLOADS_DIR);
    fs.ensureDirSync(CONVERTED_DIR);
    console.log(`[TempDir] Uploads  → ${UPLOADS_DIR}`);
    console.log(`[TempDir] Converted → ${CONVERTED_DIR}`);
  } catch (err) {
    // If we can't create temp dirs, the app cannot function.
    // Log clearly so Render's build log shows the exact failure.
    console.error('[TempDir] FATAL: Cannot create temp directories:', err.message);
    console.error('[TempDir] BASE_TEMP was:', BASE_TEMP);
    console.error('[TempDir] This usually means the filesystem is read-only.');
    console.error('[TempDir] On Render: ensure you are using Docker runtime, not Node runtime.');
    process.exit(1); // Hard fail — do not start the server silently broken
  }
}

/**
 * Returns a unique file path inside the uploads temp dir.
 * @param {string} filename - The filename to place inside uploads dir
 * @returns {string} Full absolute path
 */
function getUploadPath(filename) {
  return path.join(UPLOADS_DIR, path.basename(filename));
}

/**
 * Returns a unique file path inside the converted temp dir.
 * @param {string} filename - The output filename
 * @returns {string} Full absolute path
 */
function getConvertedPath(filename) {
  return path.join(CONVERTED_DIR, path.basename(filename));
}

module.exports = {
  UPLOADS_DIR,
  CONVERTED_DIR,
  ensureTempDirs,
  getUploadPath,
  getConvertedPath
};
