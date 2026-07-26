/**
 * routes/upload.js
 * Enterprise Production Upload Route
 *
 * [RENDER FIX #2 — CRITICAL]
 * ─────────────────────────────────────────────────────────────
 * BEFORE (broken on Render):
 *   UPLOADS_DIR = path.join(__dirname, '..', 'uploads')  → /app/uploads
 *   multer destination: cb(null, 'uploads/')             → relative path
 *
 * WHY IT FAILS ON RENDER:
 *   Render's Docker containers mount the /app directory from the image
 *   layer, which is READ-ONLY at runtime. Any attempt to write to
 *   /app/uploads throws: EACCES: permission denied
 *   or: EROFS: read-only file system
 *
 * THE FIX:
 *   Import UPLOADS_DIR from utils/tempDir.js which resolves to:
 *     → /tmp/sfc_uploads  (on Linux / Render)
 *     → C:\Users\...\AppData\Local\Temp\sfc_uploads  (on Windows dev)
 *   /tmp is ALWAYS writable on Docker containers.
 *
 * LOCAL IMPACT: Zero. os.tmpdir() works fine on Windows too.
 */

const express = require('express');

const router = express.Router();

const multer = require('multer');

const path = require('path');

const crypto = require('crypto');

const fs = require('fs-extra');

const {
  validateFile,
  isImage
} = require('../utils/fileValidator');

const {
  generateThumbnail
} = require('../utils/imageUtils');

const {
  scheduleDelete
} = require('../utils/cleanup');

// ═══════════════════════════════════════
// PATHS — [RENDER FIX] Use writable /tmp
// ═══════════════════════════════════════

// [RENDER FIX] Import from tempDir.js instead of hardcoding a relative path.
// tempDir.js uses os.tmpdir() which returns /tmp on Linux (Render/Docker)
// and a writable temp path on Windows (local dev). Both are always writable.
const {
  UPLOADS_DIR
} = require('../utils/tempDir');

// ensureDirSync is idempotent — safe to call here even though server.js
// already called ensureTempDirs() at startup. Belt-and-suspenders.
fs.ensureDirSync(UPLOADS_DIR);

console.log(`[Upload Route] UPLOADS_DIR = ${UPLOADS_DIR}`);

// ═══════════════════════════════════════
// LIMITS
// ═══════════════════════════════════════

const MAX_FILE_SIZE =
  500 * 1024 * 1024;

const MAX_FILES = 100;

// ═══════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════

const storage = multer.diskStorage({

  destination(req, file, cb) {

    // [RENDER FIX] Was: cb(null, 'uploads/') — a hardcoded relative path.
    // On Render, the working dir /app is read-only. Writing to 'uploads/'
    // resolves to /app/uploads which throws EACCES / EROFS.
    //
    // FIX: Use UPLOADS_DIR from tempDir.js → /tmp/sfc_uploads on Linux.
    // This is the EXACT same directory the convert route reads from,
    // so the file will be found when the frontend calls /convert.
    cb(null, UPLOADS_DIR);

  },

  filename(req, file, cb) {

    const safeOriginal =
      path.basename(file.originalname);

    const ext =
      path.extname(safeOriginal)
        .toLowerCase();

    const uniqueId =
      crypto.randomBytes(8)
        .toString('hex');

    cb(
      null,
      `${Date.now()}_${uniqueId}${ext}`
    );

  }

});

// ═══════════════════════════════════════
// FILE FILTER
// ═══════════════════════════════════════

const allowedExts = [

  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.tiff',
  '.tif',
  '.pdf',
  '.docx'

];

function fileFilter(req, file, cb) {

  const safeOriginal =
    path.basename(file.originalname);

  const ext =
    path.extname(safeOriginal)
      .toLowerCase();

  if (!allowedExts.includes(ext)) {

    return cb(
      new Error(
        `Unsupported file type: ${ext}`
      )
    );

  }

  cb(null, true);

}

// ═══════════════════════════════════════
// MULTER
// ═══════════════════════════════════════

const upload = multer({

  storage,

  fileFilter,

  limits: {

    fileSize: MAX_FILE_SIZE,

    files: MAX_FILES

  }

});

// ═══════════════════════════════════════
// ROUTE
// ═══════════════════════════════════════

router.post(
  '/',
  upload.array('files', MAX_FILES),

  async (req, res) => {

    req.setTimeout(
      5 * 60 * 1000
    );

    try {

      if (
        !req.files ||
        req.files.length === 0
      ) {

        return res.status(400).json({

          success: false,

          error:
            'No files uploaded.'

        });

      }

      const results = [];

      const deleteList = [];

      for (const file of req.files) {

        const validation =
          await validateFile(
            file.path,
            file.originalname
          );

        const {
          valid,
          mimeType,
          error
        } = validation;

        // ═══════════════════════════════════════
        // INVALID FILE
        // ═══════════════════════════════════════

        if (!valid) {

          await fs
            .remove(file.path)
            .catch(() => {});

          results.push({

            originalname:
              file.originalname,

            valid: false,

            error:
              error ||
              'Invalid file type'

          });

          continue;

        }

        // ═══════════════════════════════════════
        // THUMBNAIL
        // ═══════════════════════════════════════

        let thumbnail = null;

        if (isImage(mimeType)) {

          try {

            thumbnail =
              await generateThumbnail(
                file.path
              );

          } catch (thumbErr) {

            console.warn(
              '[Thumbnail]',
              thumbErr.message
            );

          }

        }

        deleteList.push(file.path);

        results.push({

          originalname:
            file.originalname,

          filename:
            file.filename,

          size:
            file.size,

          mimeType,

          isImage:
            isImage(mimeType),

          thumbnail,

          valid: true,

          error: null

        });

      }

      // ═══════════════════════════════════════
      // AUTO DELETE
      // ═══════════════════════════════════════

      if (deleteList.length > 0) {

        scheduleDelete(deleteList);

      }

      const validCount =
        results.filter(
          r => r.valid
        ).length;

      const invalidCount =
        results.filter(
          r => !r.valid
        ).length;

      return res.json({

        success:
          validCount > 0,

        message:
          `${validCount} uploaded, ` +
          `${invalidCount} rejected.`,

        files: results

      });

    } catch (err) {

      console.error(
        '[Upload]',
        new Date().toISOString(),
        err
      );

      // cleanup partial uploads
      if (req.files?.length) {

        for (const file of req.files) {

          await fs
            .remove(file.path)
            .catch(() => {});

        }

      }

      return res.status(500).json({

        success: false,

        error:
          process.env.NODE_ENV ===
          'production'
            ? 'Upload failed.'
            : err.message

      });

    }

  }

);

// ═══════════════════════════════════════
// MULTER ERROR HANDLER
// ═══════════════════════════════════════

router.use(async (
  err,
  req,
  res,
  next
) => {

  // cleanup partial uploads
  if (req.files?.length) {

    for (const file of req.files) {

      await fs
        .remove(file.path)
        .catch(() => {});

    }

  }

  if (
    err instanceof multer.MulterError
  ) {

    let message =
      'Upload failed.';

    switch (err.code) {

      case 'LIMIT_FILE_SIZE':

        message =
          'File exceeds 500MB limit.';
        break;

      case 'LIMIT_FILE_COUNT':

        message =
          `Maximum ${MAX_FILES} files allowed.`;
        break;

      case 'LIMIT_UNEXPECTED_FILE':

        message =
          'Unexpected file upload.';
        break;

    }

    return res.status(400).json({

      success: false,

      error: message

    });

  }

  if (err) {

    return res.status(400).json({

      success: false,

      error: err.message

    });

  }

  next();

});

module.exports = router;