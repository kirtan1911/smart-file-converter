/**
 * routes/upload.js
 * Handles file uploads with multer, validates with magic bytes,
 * and returns file metadata + thumbnails for the frontend
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');

const { validateFile, isImage } = require('../utils/fileValidator');
const { generateThumbnail } = require('../utils/imageUtils');
const { scheduleDelete } = require('../utils/cleanup');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

/* UPDATED LIMITS */
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const MAX_FILES = 100;

// Ensure uploads folder exists
fs.ensureDirSync(UPLOADS_DIR);

// Configure multer disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),

  filename: (req, file, cb) => {
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();

    cb(null, `${Date.now()}_${uniqueId}${ext}`);
  }
});

// Allowed extensions
const fileFilter = (req, file, cb) => {

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

  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Extension "${ext}" not supported. Allowed: ${allowedExts.join(', ')}`
      )
    );
  }
};

const upload = multer({
  storage,
  fileFilter,

  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES
  }
});

// POST /upload
router.post('/', upload.array('files', MAX_FILES), async (req, res) => {

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No files uploaded.'
    });
  }

  const results = [];
  const deleteList = [];

  for (const file of req.files) {

    const {
      valid,
      mimeType,
      error
    } = await validateFile(file.path, file.originalname);

    if (!valid) {

      // Remove invalid file
      await fs.remove(file.path).catch(() => {});

      results.push({
        originalname: file.originalname,
        valid: false,
        error: error || 'Invalid file type detected'
      });

      continue;
    }

    // Generate image thumbnail
    let thumbnail = null;

    if (isImage(mimeType)) {
      try {
        thumbnail = await generateThumbnail(file.path);
      } catch (thumbErr) {
        console.error('Thumbnail Error:', thumbErr.message);
      }
    }

    deleteList.push(file.path);

    results.push({
      originalname: file.originalname,
      filename: file.filename,
      path: file.path,
      size: file.size,
      mimeType,
      isImage: isImage(mimeType),
      thumbnail,
      valid: true,
      error: null
    });
  }

  // Auto delete uploaded files
  if (deleteList.length > 0) {
    scheduleDelete(deleteList);
  }

  const validCount = results.filter(r => r.valid).length;
  const invalidCount = results.filter(r => !r.valid).length;

  res.json({
    success: validCount > 0,

    message:
      `${validCount} file(s) uploaded successfully` +
      `${invalidCount > 0 ? `, ${invalidCount} rejected` : ''}.`,

    files: results
  });
});

// Multer error handler
router.use((err, req, res, next) => {

  if (err instanceof multer.MulterError) {

    let message = 'Upload error';

    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'File exceeds 500MB size limit.';
    }

    if (err.code === 'LIMIT_FILE_COUNT') {
      message = `Maximum ${MAX_FILES} files allowed.`;
    }

    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      message = 'Unexpected file field.';
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