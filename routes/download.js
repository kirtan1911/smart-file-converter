/**
 * routes/download.js
 * Serves converted files for download and deletes them after delivery
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');

const CONVERTED_DIR = path.join(__dirname, '..', 'converted');

// GET /download/:downloadId?name=filename.pdf
router.get('/:downloadId', async (req, res) => {
  const { downloadId } = req.params;
  const downloadName = req.query.name || downloadId;

  // Basic security: prevent path traversal attacks
  // Only allow alphanumeric characters, underscores, hyphens, dots
  if (!/^[\w\-. ]+$/.test(downloadId)) {
    return res.status(400).json({ success: false, error: 'Invalid download ID.' });
  }

  const filePath = path.join(CONVERTED_DIR, downloadId);

  try {
    if (!(await fs.pathExists(filePath))) {
      return res.status(404).json({
        success: false,
        error: 'Download file not found. It may have expired (files are deleted after 15 minutes). Please convert again.'
      });
    }

    const stat = await fs.stat(filePath);

    // Set headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
    res.setHeader('Content-Type', getContentType(downloadId));
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'no-store');

    // Stream the file
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);

    // Delete file after it's been sent
    readStream.on('end', async () => {
      try {
        await fs.remove(filePath);
        console.log(`[Download] Served and deleted: ${downloadId}`);
      } catch (deleteErr) {
        console.warn(`[Download] Could not delete after serving: ${deleteErr.message}`);
      }
    });

    readStream.on('error', (err) => {
      console.error(`[Download] Stream error for ${downloadId}:`, err.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'File read error during download.' });
      }
    });

  } catch (err) {
    console.error('[Download] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Returns the MIME type for a given filename
 */
function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const types = {
    '.pdf':  'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png':  'image/png',
    '.zip':  'application/zip'
  };
  return types[ext] || 'application/octet-stream';
}

module.exports = router;
