/**
 * routes/convert.js
 * Production Optimized Version
 *
 * [RENDER FIX #2 — CRITICAL — PART 2]
 * ────────────────────────────────────────────────────────────
 * BEFORE (broken on Render):
 *   UPLOADS_DIR   = path.join(__dirname, '..', 'uploads')   → /app/uploads
 *   CONVERTED_DIR = path.join(__dirname, '..', 'converted') → /app/converted
 *
 * WHY IT FAILS ON RENDER:
 *   1. UPLOADS_DIR mismatch: upload.js writes to /tmp/sfc_uploads but
 *      convert.js was looking in /app/uploads → file not found → 410 error
 *   2. CONVERTED_DIR: /app/converted is read-only on Render → EACCES
 *
 * THE FIX:
 *   Use tempDir.js for BOTH directories. This ensures upload.js and
 *   convert.js use the SAME /tmp/sfc_uploads path. The converted output
 *   goes to /tmp/sfc_converted which download.js can also read.
 */

const express = require('express');
const router = express.Router();

const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');

const {
  isImage,
  isPDF,
  isDOCX
} = require('../utils/fileValidator');

const {
  imagesToPDF,
  docxToPDF,
  pdfToDocx
} = require('../utils/pdfUtils');

const {
  imagesToDocx
} = require('../utils/imageUtils');

const {
  scheduleDelete
} = require('../utils/cleanup');

// ═══════════════════════════════════════
// PATHS — [RENDER FIX] Use writable /tmp
// ═══════════════════════════════════════

// [RENDER FIX] Import both dirs from tempDir.js.
// UPLOADS_DIR   = where upload.js saved the file (→ /tmp/sfc_uploads)
// CONVERTED_DIR = where we write output        (→ /tmp/sfc_converted)
// Both must be the SAME between upload, convert, and download routes.
const {
  UPLOADS_DIR,
  CONVERTED_DIR
} = require('../utils/tempDir');

// Belt-and-suspenders: ensure dirs exist even if server.js restart was skipped
fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(CONVERTED_DIR);

console.log(`[Convert Route] UPLOADS_DIR   = ${UPLOADS_DIR}`);
console.log(`[Convert Route] CONVERTED_DIR = ${CONVERTED_DIR}`);

// ═══════════════════════════════════════
// LIMITS
// ═══════════════════════════════════════

const MAX_FILES = 100;

const MAX_FILE_SIZE =
  500 * 1024 * 1024; // 500MB

const MAX_IMAGE_CONVERSION = 100;

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

function generateOutputName(prefix, ext) {

  const id =
    crypto.randomBytes(6).toString('hex');

  return `${prefix}_${Date.now()}_${id}${ext}`;
}

function safeFileName(name) {

  return path.basename(name || '');
}

function sanitizeBaseName(name) {

  return path
    .parse(name || 'file')
    .name
    .replace(/[^\w\-]/g, '_');
}

// ═══════════════════════════════════════
// ROUTE
// ═══════════════════════════════════════

router.post('/', async (req, res) => {

  try {

    const {
      type,
      files,
      order
    } = req.body;

    // ═══════════════════════════════════════
    // BASIC VALIDATION
    // ═══════════════════════════════════════

    if (
      !type ||
      !files ||
      !Array.isArray(files) ||
      files.length === 0
    ) {

      return res.status(400).json({
        success: false,
        error:
          'Missing conversion type or files.'
      });

    }

    // File count limit
    if (files.length > MAX_FILES) {

      return res.status(400).json({
        success: false,
        error:
          `Maximum ${MAX_FILES} files allowed.`
      });

    }

    const supportedTypes = [
      'images-to-pdf',
      'pdf-to-docx',
      'docx-to-pdf',
      'images-to-docx'
    ];

    if (!supportedTypes.includes(type)) {

      return res.status(400).json({
        success: false,
        error:
          `Unsupported conversion type: ${type}`
      });

    }

    // ═══════════════════════════════════════
    // ORDER HANDLING
    // ═══════════════════════════════════════

    let orderedFiles = [...files];

    if (
      order &&
      Array.isArray(order) &&
      order.length === files.length
    ) {

      orderedFiles =
        order
          .map(index => files[index])
          .filter(Boolean);

    }

    // ═══════════════════════════════════════
    // VERIFY FILES EXIST
    // ═══════════════════════════════════════

    const missingFiles = [];

    for (const file of orderedFiles) {

      const safeName =
        safeFileName(file.filename);

      const filePath =
        path.join(UPLOADS_DIR, safeName);

      // prevent path traversal
      if (
        !filePath.startsWith(UPLOADS_DIR)
      ) {

        continue;
      }

      const exists =
        await fs.pathExists(filePath);

      if (!exists) {

        missingFiles.push(
          file.originalname || file.filename
        );

        continue;
      }

      const stats =
        await fs.stat(filePath);

      // backend size protection
      if (stats.size > MAX_FILE_SIZE) {

        return res.status(400).json({
          success: false,
          error:
            'One or more files exceed 500MB.'
        });

      }

      file.path = filePath;
      file.size = stats.size;

    }

    // All expired
    if (
      missingFiles.length > 0 &&
      missingFiles.length ===
        orderedFiles.length
    ) {

      return res.status(410).json({
        success: false,
        error:
          'All uploaded files expired. Please upload again.'
      });

    }

    const validFiles =
      orderedFiles.filter(f => f.path);

    // ═══════════════════════════════════════
    // OUTPUT VARIABLES
    // ═══════════════════════════════════════

    let result;
    let outputFilename;
    let outputPath;
    let downloadName;

    // ═══════════════════════════════════════
    // IMAGES → PDF
    // ═══════════════════════════════════════

    if (type === 'images-to-pdf') {

      const images =
        validFiles.filter(f =>
          isImage(f.mimeType)
        );

      if (images.length === 0) {

        return res.status(400).json({
          success: false,
          error:
            'No valid image files found.'
        });

      }

      if (
        images.length >
        MAX_IMAGE_CONVERSION
      ) {

        return res.status(400).json({
          success: false,
          error:
            `Maximum ${MAX_IMAGE_CONVERSION} images allowed per conversion.`
        });

      }

      outputFilename =
        generateOutputName(
          'merged',
          '.pdf'
        );

      outputPath =
        path.join(
          CONVERTED_DIR,
          outputFilename
        );

      downloadName =
        'converted_images.pdf';

      result =
        await imagesToPDF(
          images,
          outputPath
        );

    }

    // ═══════════════════════════════════════
    // PDF → DOCX
    // ═══════════════════════════════════════

    else if (type === 'pdf-to-docx') {

      const pdfs =
        validFiles.filter(f =>
          isPDF(f.mimeType)
        );

      if (pdfs.length === 0) {

        return res.status(400).json({
          success: false,
          error:
            'No valid PDF files found.'
        });

      }

      const pdfFile = pdfs[0];

      const baseName =
        sanitizeBaseName(
          pdfFile.originalname
        );

      outputFilename =
        generateOutputName(
          'converted',
          '.docx'
        );

      outputPath =
        path.join(
          CONVERTED_DIR,
          outputFilename
        );

      downloadName =
        `${baseName}_converted.docx`;

      result =
        await pdfToDocx(
          pdfFile.path,
          outputPath
        );

    }

    // ═══════════════════════════════════════
    // DOCX → PDF
    // ═══════════════════════════════════════

    else if (type === 'docx-to-pdf') {

      const docxFiles =
        validFiles.filter(f =>
          isDOCX(f.mimeType)
        );

      if (docxFiles.length === 0) {

        return res.status(400).json({
          success: false,
          error:
            'No valid DOCX files found.'
        });

      }

      const docxFile =
        docxFiles[0];

      const baseName =
        sanitizeBaseName(
          docxFile.originalname
        );

      outputFilename =
        generateOutputName(
          'converted',
          '.pdf'
        );

      outputPath =
        path.join(
          CONVERTED_DIR,
          outputFilename
        );

      downloadName =
        `${baseName}_converted.pdf`;

      result =
        await docxToPDF(
          docxFile.path,
          outputPath
        );

    }

    // ═══════════════════════════════════════
    // IMAGES → DOCX
    // ═══════════════════════════════════════

    else if (type === 'images-to-docx') {

      const images =
        validFiles.filter(f =>
          isImage(f.mimeType)
        );

      if (images.length === 0) {

        return res.status(400).json({
          success: false,
          error:
            'No valid image files found.'
        });

      }

      if (
        images.length >
        MAX_IMAGE_CONVERSION
      ) {

        return res.status(400).json({
          success: false,
          error:
            `Maximum ${MAX_IMAGE_CONVERSION} images allowed per conversion.`
        });

      }

      outputFilename =
        generateOutputName(
          'images_doc',
          '.docx'
        );

      outputPath =
        path.join(
          CONVERTED_DIR,
          outputFilename
        );

      downloadName =
        'images_document.docx';

      result =
        await imagesToDocx(
          images,
          outputPath
        );

    }

    // ═══════════════════════════════════════
    // RESULT VALIDATION
    // ═══════════════════════════════════════

    if (!result?.success) {

      return res.status(500).json({
        success: false,
        error:
          result?.error ||
          'Conversion failed.',
        skipped:
          result?.skipped || []
      });

    }

    const exists =
      await fs.pathExists(outputPath);

    if (!exists) {

      return res.status(500).json({
        success: false,
        error:
          'Output file was not created.'
      });

    }

    const stats =
      await fs.stat(outputPath);

    // ═══════════════════════════════════════
    // AUTO CLEANUP
    // ═══════════════════════════════════════

    scheduleDelete(outputPath);

    // ═══════════════════════════════════════
    // WARNINGS
    // ═══════════════════════════════════════

    const warnings = [];

    if (missingFiles.length > 0) {

      warnings.push(
        `${missingFiles.length} expired file(s) skipped.`
      );

    }

    if (
      result?.skipped &&
      result.skipped.length > 0
    ) {

      warnings.push(
        `${result.skipped.length} corrupted file(s) skipped.`
      );

    }

    // ═══════════════════════════════════════
    // SUCCESS RESPONSE
    // ═══════════════════════════════════════

    return res.json({

      success: true,

      message:
        'Conversion completed successfully.',

      downloadId:
        outputFilename,

      downloadName,

      fileSize:
        stats.size,

      warnings

    });

  } catch (err) {

    console.error(
      '[Convert]',
      new Date().toISOString(),
      err
    );

    return res.status(500).json({

      success: false,

      error:
        process.env.NODE_ENV ===
        'production'
          ? 'Internal server error.'
          : err.message

    });

  }

});

module.exports = router;