/**
 * routes/convert.js
 * Handles all conversion types:
 *   - images-to-pdf
 *   - pdf-to-docx
 *   - docx-to-pdf
 *   - images-to-docx
 * Returns downloadId for the /download route
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');

const { isImage, isPDF, isDOCX, validateFile } = require('../utils/fileValidator');
const { imagesToPDF, docxToPDF, pdfToDocx } = require('../utils/pdfUtils');
const { imagesToDocx } = require('../utils/imageUtils');
const { scheduleDelete } = require('../utils/cleanup');

const UPLOADS_DIR  = path.join(__dirname, '..', 'uploads');
const CONVERTED_DIR = path.join(__dirname, '..', 'converted');

/**
 * Generates a unique output filename
 */
function generateOutputName(prefix, ext) {
  const id = crypto.randomBytes(6).toString('hex');
  return `${prefix}_${Date.now()}_${id}${ext}`;
}

/**
 * POST /convert
 * Body (JSON):
 * {
 *   type: 'images-to-pdf' | 'pdf-to-docx' | 'docx-to-pdf' | 'images-to-docx',
 *   files: [ { filename, originalname, path, mimeType } ],
 *   order: [0, 2, 1, ...]  // optional image reordering
 * }
 */
router.post('/', async (req, res) => {
  const { type, files, order } = req.body;

  // --- Validate input ---
  if (!type || !files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ success: false, error: 'Missing conversion type or files.' });
  }

  const supportedTypes = ['images-to-pdf', 'pdf-to-docx', 'docx-to-pdf', 'images-to-docx'];
  if (!supportedTypes.includes(type)) {
    return res.status(400).json({ success: false, error: `Unknown conversion type: "${type}"` });
  }

  // Build ordered file list (apply custom order if provided)
  let orderedFiles = [...files];
  if (order && Array.isArray(order) && order.length === files.length) {
    orderedFiles = order.map(idx => files[idx]).filter(Boolean);
  }

  // Verify all file paths still exist (in case cleanup already ran)
  const missingFiles = [];
  for (const f of orderedFiles) {
    const filePath = path.join(UPLOADS_DIR, f.filename);
    if (!(await fs.pathExists(filePath))) {
      missingFiles.push(f.originalname);
    } else {
      f.path = filePath; // ensure absolute path
    }
  }

  if (missingFiles.length > 0 && missingFiles.length === orderedFiles.length) {
    return res.status(410).json({
      success: false,
      error: `All uploaded files have expired. Please re-upload. (Missing: ${missingFiles.join(', ')})`
    });
  }

  const validFiles = orderedFiles.filter(f => f.path);
  let result;
  let outputFilename;
  let outputPath;
  let downloadName;

  // ─────────────────────────────────────────────
  // Route conversion to the right handler
  // ─────────────────────────────────────────────

  try {
    // ── Images → PDF ──────────────────────────
    if (type === 'images-to-pdf') {
      const images = validFiles.filter(f => isImage(f.mimeType));
      if (images.length === 0) {
        return res.status(400).json({ success: false, error: 'No valid image files found for conversion.' });
      }
      outputFilename = generateOutputName('merged', '.pdf');
      outputPath = path.join(CONVERTED_DIR, outputFilename);
      downloadName = 'converted_images.pdf';

      result = await imagesToPDF(images, outputPath);
    }

    // ── PDF → DOCX ────────────────────────────
    else if (type === 'pdf-to-docx') {
      const pdfs = validFiles.filter(f => isPDF(f.mimeType));
      if (pdfs.length === 0) {
        return res.status(400).json({ success: false, error: 'No valid PDF files found.' });
      }
      // Convert first PDF (one at a time for simplicity; loop for multiple)
      const pdfFile = pdfs[0];
      outputFilename = generateOutputName('converted', '.docx');
      outputPath = path.join(CONVERTED_DIR, outputFilename);
      const baseName = path.parse(pdfFile.originalname).name;
      downloadName = `${baseName}_converted.docx`;

      result = await pdfToDocx(pdfFile.path, outputPath);
    }

    // ── DOCX → PDF ────────────────────────────
    else if (type === 'docx-to-pdf') {
      const docxFiles = validFiles.filter(f => isDOCX(f.mimeType));
      if (docxFiles.length === 0) {
        return res.status(400).json({ success: false, error: 'No valid DOCX files found.' });
      }
      const docxFile = docxFiles[0];
      outputFilename = generateOutputName('converted', '.pdf');
      outputPath = path.join(CONVERTED_DIR, outputFilename);
      const baseName = path.parse(docxFile.originalname).name;
      downloadName = `${baseName}_converted.pdf`;

      result = await docxToPDF(docxFile.path, outputPath);
    }

    // ── Images → DOCX ─────────────────────────
    else if (type === 'images-to-docx') {
      const images = validFiles.filter(f => isImage(f.mimeType));
      if (images.length === 0) {
        return res.status(400).json({ success: false, error: 'No valid image files found.' });
      }
      outputFilename = generateOutputName('images_doc', '.docx');
      outputPath = path.join(CONVERTED_DIR, outputFilename);
      downloadName = 'images_document.docx';

      result = await imagesToDocx(images, outputPath);
    }

    // ─────────────────────────────────────────────
    // Return result to client
    // ─────────────────────────────────────────────
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Conversion failed.',
        skipped: result.skipped || []
      });
    }

    // Verify output file was actually created
    if (!(await fs.pathExists(outputPath))) {
      return res.status(500).json({ success: false, error: 'Conversion produced no output file.' });
    }

    const stats = await fs.stat(outputPath);

    // Schedule output file for deletion after 15 min
    scheduleDelete(outputPath);

    const warnings = [];
    if (missingFiles.length > 0) {
      warnings.push(`${missingFiles.length} file(s) had already expired and were skipped: ${missingFiles.join(', ')}`);
    }
    if (result.skipped && result.skipped.length > 0) {
      warnings.push(`${result.skipped.length} file(s) were skipped due to corruption: ${result.skipped.join(', ')}`);
    }

    res.json({
      success: true,
      message: `Conversion complete! Your file is ready to download.`,
      downloadId: outputFilename,
      downloadName,
      fileSize: stats.size,
      warnings
    });

  } catch (err) {
    console.error('[Convert] Unhandled error:', err);
    res.status(500).json({
      success: false,
      error: `Internal conversion error: ${err.message}`
    });
  }
});

module.exports = router;
