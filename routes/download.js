/**
 * routes/download.js
 * Production Optimized Download Route
 */

const express = require('express');

const router = express.Router();

const path = require('path');

const fs = require('fs-extra');

// ═══════════════════════════════════════
// PATHS
// ═══════════════════════════════════════

const CONVERTED_DIR =
  path.join(__dirname, '..', 'converted');

// Ensure folder exists
fs.ensureDirSync(CONVERTED_DIR);

// ═══════════════════════════════════════
// ROUTE
// ═══════════════════════════════════════

router.get('/:downloadId', async (req, res) => {

  try {

    const rawId =
      req.params.downloadId || '';

    const rawName =
      req.query.name || rawId;

    // ═══════════════════════════════════════
    // SANITIZE DOWNLOAD ID
    // ═══════════════════════════════════════

    const downloadId =
      path.basename(rawId);

    // allow only safe chars
    if (
      !/^[a-zA-Z0-9_.\- ]+$/
        .test(downloadId)
    ) {

      return res.status(400).json({

        success: false,

        error: 'Invalid download ID.'

      });

    }

    // ═══════════════════════════════════════
    // SANITIZE DOWNLOAD NAME
    // ═══════════════════════════════════════

    const downloadName =
      path
        .basename(rawName)
        .replace(/[^\w.\- ]/g, '_');

    // ═══════════════════════════════════════
    // BUILD SAFE PATH
    // ═══════════════════════════════════════

    const filePath =
      path.join(
        CONVERTED_DIR,
        downloadId
      );

    const normalizedConverted =
      path.resolve(CONVERTED_DIR);

    const normalizedFile =
      path.resolve(filePath);

    // prevent traversal
    if (
      !normalizedFile.startsWith(
        normalizedConverted
      )
    ) {

      return res.status(403).json({

        success: false,

        error: 'Access denied.'

      });

    }

    // ═══════════════════════════════════════
    // FILE EXISTS?
    // ═══════════════════════════════════════

    const exists =
      await fs.pathExists(filePath);

    if (!exists) {

      return res.status(404).json({

        success: false,

        error:
          'File expired or not found.'

      });

    }

    const stat =
      await fs.stat(filePath);

    // ═══════════════════════════════════════
    // HEADERS
    // ═══════════════════════════════════════

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(downloadName)}"`
    );

    res.setHeader(
      'Content-Type',
      getContentType(downloadId)
    );

    res.setHeader(
      'Content-Length',
      stat.size
    );

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    res.setHeader(
      'X-Content-Type-Options',
      'nosniff'
    );

    // ═══════════════════════════════════════
    // STREAM FILE
    // ═══════════════════════════════════════

    const readStream =
      fs.createReadStream(filePath);

    readStream.pipe(res);

    // ═══════════════════════════════════════
    // DELETE AFTER DOWNLOAD
    // ═══════════════════════════════════════

    readStream.on('close', async () => {

  try {

    setTimeout(async () => {

      if (await fs.pathExists(filePath)) {

        await fs.remove(filePath);

        console.log(
          `[Download] Deleted: ${downloadId}`
        );

      }

    }, 30000);

  } catch (deleteErr) {

    console.warn(
      '[Download Delete Error]',
      deleteErr.message
    );

  }

});

    // ═══════════════════════════════════════
    // STREAM ERROR
    // ═══════════════════════════════════════

    readStream.on('error', err => {

      console.error(
        '[Download Stream Error]',
        err.message
      );

      if (!res.headersSent) {

        return res.status(500).json({

          success: false,

          error:
            'Download failed.'

        });

      }

    });

  } catch (err) {

    console.error(
      '[Download]',
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

// ═══════════════════════════════════════
// MIME TYPES
// ═══════════════════════════════════════

function getContentType(filename) {

  const ext =
    path.extname(filename)
      .toLowerCase();

  const types = {

    '.pdf':
      'application/pdf',

    '.docx':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

    '.jpg':
      'image/jpeg',

    '.jpeg':
      'image/jpeg',

    '.png':
      'image/png',

    '.webp':
      'image/webp',

    '.zip':
      'application/zip'

  };

  return (
    types[ext] ||
    'application/octet-stream'
  );

}

module.exports = router;