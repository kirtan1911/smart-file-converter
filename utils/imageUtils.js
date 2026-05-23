/**
 * imageUtils.js
 * Image processing utilities: recovery, normalization, DOCX embedding
 */

const sharp = require('sharp');
const fs = require('fs-extra');
const path = require('path');

/**
 * Attempts to recover/normalize a potentially corrupted image using sharp
 * @param {string} imagePath - Path to the image
 * @param {string} outputPath - Path for recovered image
 * @returns {Promise<{success: boolean, outputPath: string|null, warning: string|null}>}
 */
async function recoverImage(imagePath, outputPath) {
  try {
    // sharp is quite resilient; it reads raw pixel data even with damaged metadata
    await sharp(imagePath, {
      failOnError: false,     // Don't fail on truncated files
      limitInputPixels: false // Allow very large images
    })
    .rotate()                 // Auto-correct rotation from EXIF
    .jpeg({ quality: 92, progressive: true })
    .toFile(outputPath);

    return { success: true, outputPath, warning: null };
  } catch (err) {
    // Try with raw mode as a last resort
    try {
      const meta = await sharp(imagePath, { failOnError: false }).metadata();
      await sharp(imagePath, { failOnError: false, raw: { width: meta.width || 800, height: meta.height || 600, channels: 3 } })
        .jpeg({ quality: 80 })
        .toFile(outputPath);
      return { success: true, outputPath, warning: `Image was partially corrupted; metadata was reconstructed` };
    } catch (rawErr) {
      return { success: false, outputPath: null, warning: `Cannot recover image: ${err.message}` };
    }
  }
}

/**
 * Gets image metadata safely, returning defaults on failure
 * @param {string} imagePath
 */
async function safeGetMetadata(imagePath) {
  try {
    const meta = await sharp(imagePath, { failOnError: false }).metadata();
    return {
      width: meta.width || 800,
      height: meta.height || 600,
      format: meta.format || 'unknown',
      hasAlpha: meta.hasAlpha || false
    };
  } catch {
    return { width: 800, height: 600, format: 'unknown', hasAlpha: false };
  }
}

/**
 * Converts images to DOCX with embedded images
 * @param {Array<{path: string, originalname: string}>} imageFiles
 * @param {string} outputPath
 * @returns {Promise<{success: boolean, skipped: string[], error: string|null}>}
 */
async function imagesToDocx(imageFiles, outputPath) {
  const skipped = [];
  const { Document, Paragraph, ImageRun, AlignmentType, Packer, TextRun } = require('docx');

  const paragraphs = [
    new Paragraph({
      children: [new TextRun({ text: 'Image Collection', bold: true, size: 36 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 }
    }),
    new Paragraph({
      children: [new TextRun({
        text: `Generated from ${imageFiles.length} image(s) | Smart File Converter`,
        italics: true,
        color: '666666',
        size: 18
      })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 }
    })
  ];

  for (let i = 0; i < imageFiles.length; i++) {
    const imgFile = imageFiles[i];
    try {
      // Normalize image to PNG for DOCX embedding
      const normalizedBuf = await sharp(imgFile.path, { failOnError: false })
        .rotate()
        .resize({ width: 600, withoutEnlargement: true }) // Max 600px wide for A4
        .png()
        .toBuffer();

      const meta = await sharp(normalizedBuf).metadata();
      const imgWidth = Math.min(meta.width || 500, 600);
      const imgHeight = Math.round((meta.height || 400) * (imgWidth / (meta.width || imgWidth)));

      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `Image ${i + 1}: ${imgFile.originalname}`, bold: true, color: '2563EB' })],
          spacing: { before: 300, after: 150 }
        }),
        new Paragraph({
          children: [
            new ImageRun({
              data: normalizedBuf,
              transformation: { width: imgWidth, height: imgHeight }
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 }
        })
      );

      console.log(`[Image] Embedded ${imgFile.originalname} into DOCX`);
    } catch (imgErr) {
      console.warn(`[Image] Skipping corrupted image ${imgFile.originalname}: ${imgErr.message}`);
      skipped.push(imgFile.originalname);
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({
            text: `⚠ Image ${i + 1} (${imgFile.originalname}) could not be embedded — file may be corrupted.`,
            color: 'CC0000',
            italics: true
          })],
          spacing: { before: 200, after: 200 }
        })
      );
    }
  }

  if (paragraphs.length <= 2) {
    return { success: false, skipped, error: 'No valid images could be embedded in the document.' };
  }

  try {
    const doc = new Document({
      sections: [{ properties: {}, children: paragraphs }],
      styles: {
        default: { document: { run: { font: 'Calibri', size: 22 } } }
      }
    });

    const docxBuffer = await Packer.toBuffer(doc);
    await fs.writeFile(outputPath, docxBuffer);
    console.log(`[Image] DOCX created: ${path.basename(outputPath)}`);
    return { success: true, skipped, error: null };
  } catch (err) {
    return { success: false, skipped, error: err.message };
  }
}

/**
 * Generates a thumbnail for preview
 * @param {string} imagePath
 * @returns {Promise<string>} Base64-encoded JPEG thumbnail
 */
async function generateThumbnail(imagePath) {
  try {
    const buf = await sharp(imagePath, { failOnError: false })
      .rotate()
      .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

module.exports = { recoverImage, safeGetMetadata, imagesToDocx, generateThumbnail };
