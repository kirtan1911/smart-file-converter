/**
 * fileValidator.js
 * Validates uploaded files using magic bytes (file signatures)
 * This ensures file type validation beyond just extension checking
 */

const fileType = require('file-type');
const fs = require('fs');

// Allowed MIME types and their human-readable labels
const ALLOWED_TYPES = {
  'image/jpeg': { label: 'JPEG Image', extensions: ['.jpg', '.jpeg'] },
  'image/png':  { label: 'PNG Image',  extensions: ['.png'] },
  'image/webp': { label: 'WebP Image', extensions: ['.webp'] },
  'image/gif':  { label: 'GIF Image',  extensions: ['.gif'] },
  'image/tiff': { label: 'TIFF Image', extensions: ['.tiff', '.tif'] },
  'application/pdf': { label: 'PDF Document', extensions: ['.pdf'] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    label: 'Word Document (DOCX)',
    extensions: ['.docx']
  }
};

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB in bytes

/**
 * Validates a single file using magic byte detection
 * @param {string} filePath - Path to the uploaded file
 * @param {string} originalName - Original filename from the upload
 * @returns {Promise<{valid: boolean, mimeType: string|null, error: string|null}>}
 */
async function validateFile(filePath, originalName) {
  try {
    // Check file exists
    if (!fs.existsSync(filePath)) {
      return { valid: false, mimeType: null, error: 'File not found after upload' };
    }

    // Check file size
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      return { valid: false, mimeType: null, error: 'Uploaded file is empty' };
    }
    if (stats.size > MAX_FILE_SIZE) {
      return {
        valid: false,
        mimeType: null,
        error: `File exceeds 100MB limit (${(stats.size / 1024 / 1024).toFixed(2)}MB)`
      };
    }

    // Read first 4100 bytes for magic byte detection
    const buffer = Buffer.alloc(4100);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 4100, 0);
    fs.closeSync(fd);

    // Detect actual file type from magic bytes
    const detected = await fileType.fromBuffer(buffer);

    // Handle DOCX (ZIP-based format) - file-type may detect it as zip
    if (!detected || detected.mime === 'application/zip') {
      // Check if it might be a DOCX by extension
      const ext = originalName.toLowerCase().split('.').pop();
      if (ext === 'docx') {
        // Additional check: DOCX files start with PK (ZIP magic bytes)
        if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
          return { valid: true, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', error: null };
        }
      }
      return {
        valid: false,
        mimeType: null,
        error: `Unsupported or unrecognized file format for "${originalName}". Supported: JPG, PNG, WebP, GIF, TIFF, PDF, DOCX`
      };
    }

    if (!ALLOWED_TYPES[detected.mime]) {
      return {
        valid: false,
        mimeType: detected.mime,
        error: `File type "${detected.mime}" is not supported. Supported: JPG, PNG, WebP, PDF, DOCX`
      };
    }

    return { valid: true, mimeType: detected.mime, error: null };
  } catch (err) {
    console.error(`[FileValidator] Error validating ${originalName}:`, err.message);
    return { valid: false, mimeType: null, error: `Validation failed: ${err.message}` };
  }
}

/**
 * Returns whether a MIME type is an image type
 */
function isImage(mimeType) {
  return mimeType && mimeType.startsWith('image/');
}

/**
 * Returns whether a MIME type is PDF
 */
function isPDF(mimeType) {
  return mimeType === 'application/pdf';
}

/**
 * Returns whether a MIME type is DOCX
 */
function isDOCX(mimeType) {
  return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

module.exports = { validateFile, isImage, isPDF, isDOCX, ALLOWED_TYPES };
