/**
 * routes/compress.js
 * POST /api/compress-image
 *
 * Accepts a single image (JPG/PNG/WEBP, max 25MB), a target size in bytes,
 * and an output format. Returns the compressed image as a downloadable buffer.
 *
 * Algorithm:
 *  Phase 1 — Binary-search quality (80 → 10) at original resolution.
 *  Phase 2 — If quality floor is hit and still too large, proportionally
 *             downscale resolution (step down by 10% each iteration).
 *  Max total iterations: 20. Returns closest-achievable result if exact
 *  match within ±3% tolerance is not found.
 */

'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const fs      = require('fs-extra');
const sharp   = require('sharp');

const { UPLOADS_DIR } = require('../utils/tempDir');
const { scheduleDelete } = require('../utils/cleanup');

const router = express.Router();

// ── Constants ─────────────────────────────────────────────────
const MAX_INPUT_BYTES  = 25 * 1024 * 1024; // 25 MB input cap
const TOLERANCE        = 0.03;             // ±3% of target
const MAX_ITERATIONS   = 20;
const MIN_QUALITY      = 10;
const INITIAL_QUALITY  = 80;

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
]);

// ── Multer config ──────────────────────────────────────────────
const storage = multer.diskStorage({
  destination(req, file, cb) { cb(null, UPLOADS_DIR); },
  filename(req, file, cb) {
    const ext = path.extname(path.basename(file.originalname)).toLowerCase();
    const uid = crypto.randomBytes(8).toString('hex');
    cb(null, `compress_${Date.now()}_${uid}${ext}`);
  }
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
  if (!allowedExts.includes(ext)) {
    return cb(new Error('Only JPG, PNG, and WEBP images are supported for compression.'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_INPUT_BYTES, files: 1 }
});

// ── Helper: compress to buffer with sharp ──────────────────────
/**
 * @param {Buffer} inputBuf - Source image buffer
 * @param {number} quality  - JPEG/WebP quality 1–100; PNG uses compressionLevel
 * @param {object} resize   - { width, height } or null
 * @param {string} format   - 'jpeg' | 'png' | 'webp'
 * @returns {Promise<Buffer>}
 */
async function compressToBuffer(inputBuf, quality, resize, format) {
  let pipeline = sharp(inputBuf, { failOnError: false });

  if (resize) {
    pipeline = pipeline.resize(resize.width, resize.height, {
      fit: 'inside',
      withoutEnlargement: false
    });
  }

  switch (format) {
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality, progressive: true, mozjpeg: false });
      break;
    case 'png':
      // PNG quality maps to compressionLevel 0–9 (inverse of quality)
      // quality 80 → level 2, quality 10 → level 9
      {
        const level = Math.round(9 - Math.floor(quality / 100 * 9));
        pipeline = pipeline.png({ compressionLevel: Math.min(9, Math.max(0, level)), adaptiveFiltering: true });
      }
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality, effort: 4 });
      break;
    default:
      pipeline = pipeline.jpeg({ quality, progressive: true });
  }

  return pipeline.toBuffer();
}

// ── Core compression algorithm ─────────────────────────────────
/**
 * Binary-search quality + optional resolution downscale to hit target size.
 *
 * @param {string} filePath    - Path to uploaded source image
 * @param {number} targetBytes - Desired output size in bytes
 * @param {string} outFormat   - 'jpeg' | 'png' | 'webp' | 'original'
 * @returns {Promise<{
 *   buffer: Buffer,
 *   actualBytes: number,
 *   qualityUsed: number,
 *   dimensionsUsed: {width, height},
 *   wasExact: boolean,
 *   note: string|null
 * }>}
 */
async function compressToTarget(filePath, targetBytes, outFormat) {
  const srcBuf = await fs.readFile(filePath);
  const meta   = await sharp(srcBuf, { failOnError: false }).metadata();

  const origWidth  = meta.width  || 800;
  const origHeight = meta.height || 600;

  // Resolve actual output format
  let fmt = outFormat;
  if (fmt === 'original') {
    const f = (meta.format || 'jpeg').toLowerCase();
    fmt = f === 'jpg' ? 'jpeg' : f;
    if (!['jpeg', 'png', 'webp'].includes(fmt)) fmt = 'jpeg';
  }

  const toleranceLow  = targetBytes * (1 - TOLERANCE);
  const toleranceHigh = targetBytes * (1 + TOLERANCE);

  let bestBuffer    = null;
  let bestBytes     = Infinity;
  let bestQuality   = INITIAL_QUALITY;
  let bestDims      = { width: origWidth, height: origHeight };
  let iterations    = 0;

  // ─────────────────────────────────────
  // Phase 1: Binary-search on quality
  // ─────────────────────────────────────
  let lo = MIN_QUALITY;
  let hi = 95;
  let scaleFactor = 1.0; // full resolution

  while (lo <= hi && iterations < MAX_ITERATIONS) {
    const q = Math.round((lo + hi) / 2);
    const dims = {
      width:  Math.max(1, Math.round(origWidth  * scaleFactor)),
      height: Math.max(1, Math.round(origHeight * scaleFactor))
    };
    const buf   = await compressToBuffer(srcBuf, q, dims, fmt);
    const bytes = buf.length;
    iterations++;

    // Track closest result
    if (Math.abs(bytes - targetBytes) < Math.abs(bestBytes - targetBytes)) {
      bestBuffer  = buf;
      bestBytes   = bytes;
      bestQuality = q;
      bestDims    = { ...dims };
    }

    if (bytes >= toleranceLow && bytes <= toleranceHigh) {
      // ✅ Hit tolerance window — done
      return {
        buffer: buf,
        actualBytes: bytes,
        qualityUsed: q,
        dimensionsUsed: dims,
        wasExact: true,
        note: null
      };
    }

    if (bytes > targetBytes) {
      hi = q - 1; // too large → lower quality
    } else {
      lo = q + 1; // too small → raise quality
    }
  }

  // ─────────────────────────────────────
  // Phase 2: Quality floor hit, still too large → downscale dimensions
  // ─────────────────────────────────────
  if (bestBytes > targetBytes && iterations < MAX_ITERATIONS) {
    scaleFactor = 0.9; // start 10% downscale

    while (scaleFactor >= 0.1 && iterations < MAX_ITERATIONS) {
      const dims = {
        width:  Math.max(1, Math.round(origWidth  * scaleFactor)),
        height: Math.max(1, Math.round(origHeight * scaleFactor))
      };

      // Binary-search quality at this scale
      let qLo = MIN_QUALITY;
      let qHi = 85;

      while (qLo <= qHi && iterations < MAX_ITERATIONS) {
        const q   = Math.round((qLo + qHi) / 2);
        const buf = await compressToBuffer(srcBuf, q, dims, fmt);
        const bytes = buf.length;
        iterations++;

        if (Math.abs(bytes - targetBytes) < Math.abs(bestBytes - targetBytes)) {
          bestBuffer  = buf;
          bestBytes   = bytes;
          bestQuality = q;
          bestDims    = { ...dims };
        }

        if (bytes >= toleranceLow && bytes <= toleranceHigh) {
          return {
            buffer: buf,
            actualBytes: bytes,
            qualityUsed: q,
            dimensionsUsed: dims,
            wasExact: true,
            note: null
          };
        }

        if (bytes > targetBytes) {
          qHi = q - 1;
        } else {
          qLo = q + 1;
        }
      }

      // If we got under the target at this scale, try stepping back up slightly
      if (bestBytes <= targetBytes) break;

      scaleFactor = Math.round((scaleFactor - 0.1) * 100) / 100;
    }
  }

  // Return closest achievable result
  const closestKB = (bestBytes / 1024).toFixed(1);
  const targetKB  = (targetBytes / 1024).toFixed(1);
  const note = bestBytes > targetBytes
    ? `Closest achievable: ${closestKB} KB (target was ${targetKB} KB). Target may be unrealistically small.`
    : `Closest achievable: ${closestKB} KB (target was ${targetKB} KB).`;

  return {
    buffer: bestBuffer || Buffer.alloc(0),
    actualBytes: bestBytes,
    qualityUsed: bestQuality,
    dimensionsUsed: bestDims,
    wasExact: false,
    note
  };
}

// ── Route: POST /api/compress-image ───────────────────────────
router.post(
  '/',
  upload.single('image'),

  async (req, res) => {
    req.setTimeout(5 * 60 * 1000);
    const uploadedPath = req.file?.path;

    try {
      // ── Validate file ────────────────────────────────────────
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No image file uploaded.' });
      }

      // Double-check MIME via sharp metadata
      const meta = await sharp(uploadedPath, { failOnError: false }).metadata().catch(() => null);
      if (!meta || !meta.format) {
        await fs.remove(uploadedPath).catch(() => {});
        return res.status(400).json({ success: false, error: 'Cannot read image file. It may be corrupted or in an unsupported format.' });
      }

      // ── Parse & validate target size ─────────────────────────
      const rawTarget = parseFloat(req.body.targetSize);
      const unit      = (req.body.unit || 'KB').toUpperCase();

      if (!rawTarget || isNaN(rawTarget) || rawTarget <= 0) {
        await fs.remove(uploadedPath).catch(() => {});
        return res.status(400).json({ success: false, error: 'Invalid target size. Please enter a positive number.' });
      }

      const targetBytes = unit === 'MB'
        ? Math.round(rawTarget * 1024 * 1024)
        : Math.round(rawTarget * 1024);

      const originalBytes = req.file.size;

      if (targetBytes >= originalBytes) {
        await fs.remove(uploadedPath).catch(() => {});
        return res.status(400).json({
          success: false,
          error: `Target size (${unit === 'MB' ? rawTarget + ' MB' : rawTarget + ' KB'}) must be smaller than the original (${(originalBytes / 1024).toFixed(1)} KB).`
        });
      }

      if (targetBytes < 1024) {
        await fs.remove(uploadedPath).catch(() => {});
        return res.status(400).json({ success: false, error: 'Target size must be at least 1 KB.' });
      }

      // ── Validate output format ────────────────────────────────
      const outFormat = (['jpeg', 'png', 'webp', 'original'].includes(req.body.outputFormat))
        ? req.body.outputFormat
        : 'original';

      // ── Run compression ───────────────────────────────────────
      const result = await compressToTarget(uploadedPath, targetBytes, outFormat);

      if (!result.buffer || result.buffer.length === 0) {
        throw new Error('Compression produced an empty output.');
      }

      // ── Schedule cleanup of original upload ───────────────────
      scheduleDelete(uploadedPath);

      // ── Determine MIME & extension for response ───────────────
      let resolvedFmt = outFormat;
      if (resolvedFmt === 'original') {
        const f = (meta.format || 'jpeg').toLowerCase();
        resolvedFmt = f === 'jpg' ? 'jpeg' : f;
        if (!['jpeg', 'png', 'webp'].includes(resolvedFmt)) resolvedFmt = 'jpeg';
      }

      const mimeMap = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
      const extMap  = { jpeg: '.jpg', png: '.png', webp: '.webp' };

      const contentType = mimeMap[resolvedFmt] || 'image/jpeg';
      const fileExt     = extMap[resolvedFmt]  || '.jpg';

      // ── Send result ───────────────────────────────────────────
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', result.buffer.length);
      res.setHeader('X-Compress-ActualBytes',   result.actualBytes);
      res.setHeader('X-Compress-OriginalBytes', originalBytes);
      res.setHeader('X-Compress-WasExact',      result.wasExact ? '1' : '0');
      res.setHeader('X-Compress-Note',          result.note ? encodeURIComponent(result.note) : '');
      res.setHeader('X-Compress-Extension',     fileExt);
      res.setHeader('X-Compress-Quality',       result.qualityUsed);
      res.setHeader('X-Compress-Width',         result.dimensionsUsed.width);
      res.setHeader('X-Compress-Height',        result.dimensionsUsed.height);

      return res.send(result.buffer);

    } catch (err) {
      console.error('[Compress]', new Date().toISOString(), err.message);
      if (uploadedPath) await fs.remove(uploadedPath).catch(() => {});
      return res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'production'
          ? 'Compression failed. Please try again.'
          : err.message
      });
    }
  }
);

// ── Multer error handler ───────────────────────────────────────
router.use(async (err, req, res, next) => {
  if (req.file?.path) await fs.remove(req.file.path).catch(() => {});

  if (err instanceof multer.MulterError) {
    let message = 'Upload failed.';
    if (err.code === 'LIMIT_FILE_SIZE') message = `File exceeds 25 MB limit.`;
    if (err.code === 'LIMIT_FILE_COUNT') message = 'Only one image can be compressed at a time.';
    return res.status(400).json({ success: false, error: message });
  }

  if (err) {
    return res.status(400).json({ success: false, error: err.message });
  }

  next();
});

module.exports = router;
