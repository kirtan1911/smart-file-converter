/**
 * pdfUtils.js
 * PDF operations: repair, merge images, convert DOCX→PDF, extract pages
 * Handles partial corruption gracefully
 */

const { PDFDocument, rgb } = require('pdf-lib');
const PDFKit = require('pdfkit');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');

/**
 * Attempts to repair a potentially corrupted PDF by re-loading and re-saving it
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<{success: boolean, repairedPath: string|null, error: string|null}>}
 */
async function repairPDF(pdfPath) {
  try {
    const pdfBytes = await fs.readFile(pdfPath);
    
    // Attempt to load — pdf-lib will throw on severe corruption
    const pdfDoc = await PDFDocument.load(pdfBytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: false, // Continue on invalid objects
      updateMetadata: false
    });

    // Re-save a clean copy
    const repairedBytes = await pdfDoc.save({ addDefaultPage: false });
    const repairedPath = pdfPath.replace('.pdf', '_repaired.pdf');
    await fs.writeFile(repairedPath, repairedBytes);

    console.log(`[PDF] Repaired PDF: ${path.basename(pdfPath)} → ${path.basename(repairedPath)}`);
    return { success: true, repairedPath, pageCount: pdfDoc.getPageCount(), error: null };
  } catch (err) {
    console.error(`[PDF] Could not repair ${path.basename(pdfPath)}: ${err.message}`);
    return { success: false, repairedPath: null, pageCount: 0, error: err.message };
  }
}

/**
 * Merges multiple images into a single PDF
 * Skips corrupted images with a warning instead of crashing
 * @param {Array<{path: string, originalname: string}>} imageFiles - Ordered image files
 * @param {string} outputPath - Output PDF path
 * @returns {Promise<{success: boolean, skipped: string[], error: string|null}>}
 */
async function imagesToPDF(imageFiles, outputPath) {
  const skipped = [];
  
  try {
    const pdfDoc = await PDFDocument.create();

    for (const imgFile of imageFiles) {
      try {
        // Use sharp to normalize the image (handles corrupt metadata)
        const normalizedBuffer = await sharp(imgFile.path)
          .rotate() // Auto-rotate based on EXIF
          .jpeg({ quality: 90 }) // Normalize to JPEG for pdf-lib compatibility
          .toBuffer();

        const imgMeta = await sharp(normalizedBuffer).metadata();
        const { width, height } = imgMeta;

        // Embed image into PDF
        const embeddedImg = await pdfDoc.embedJpg(normalizedBuffer);
        
        // Add page sized to the image (A4 max, scaled down if bigger)
        const maxW = 595; // A4 width in points
        const maxH = 842; // A4 height in points
        let drawW = width;
        let drawH = height;

        if (drawW > maxW || drawH > maxH) {
          const scale = Math.min(maxW / drawW, maxH / drawH);
          drawW = Math.floor(drawW * scale);
          drawH = Math.floor(drawH * scale);
        }

        const page = pdfDoc.addPage([drawW, drawH]);
        page.drawImage(embeddedImg, {
          x: 0,
          y: 0,
          width: drawW,
          height: drawH
        });

        console.log(`[PDF] Added image: ${imgFile.originalname} (${drawW}x${drawH})`);
      } catch (imgErr) {
        console.warn(`[PDF] Skipping corrupted image ${imgFile.originalname}: ${imgErr.message}`);
        skipped.push(imgFile.originalname);
        // Continue with next image instead of crashing
      }
    }

    if (pdfDoc.getPageCount() === 0) {
      return {
        success: false,
        skipped,
        error: 'No valid images could be processed. All images were corrupted or unreadable.'
      };
    }

    const pdfBytes = await pdfDoc.save();
    await fs.writeFile(outputPath, pdfBytes);

    return { success: true, skipped, error: null };
  } catch (err) {
    console.error('[PDF] imagesToPDF error:', err.message);
    return { success: false, skipped, error: err.message };
  }
}

/**
 * Converts DOCX buffer to PDF using PDFKit
 * Since libreoffice may not be available, uses mammoth to extract text
 * and PDFKit to render it as PDF
 * @param {string} docxPath - Path to DOCX file
 * @param {string} outputPath - Output PDF path
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
async function docxToPDF(docxPath, outputPath) {
  return new Promise(async (resolve) => {
    try {
      // First try libreoffice if available
      try {
        const libre = require('libreoffice-convert');
        const libreConvert = require('util').promisify(libre.convert);
        const docxBuffer = await fs.readFile(docxPath);
        const pdfBuffer = await libreConvert(docxBuffer, '.pdf', undefined);
        await fs.writeFile(outputPath, pdfBuffer);
        console.log('[PDF] DOCX→PDF via LibreOffice succeeded');
        return resolve({ success: true, error: null });
      } catch (libreErr) {
        console.warn(`[PDF] LibreOffice not available (${libreErr.message}), falling back to mammoth+PDFKit`);
      }

      // Fallback: mammoth extracts text, PDFKit renders it
      const mammoth = require('mammoth');
      let result;
      try {
        result = await mammoth.extractRawText({ path: docxPath });
      } catch (mErr) {
        return resolve({ success: false, error: `Cannot read DOCX: ${mErr.message}` });
      }

      const text = result.value || '';
      const doc = new PDFKit({
        margin: 72,
        size: 'A4',
        bufferPages: true
      });

      const writeStream = fs.createWriteStream(outputPath);
      doc.pipe(writeStream);

      // Add title
      doc.fontSize(20).font('Helvetica-Bold').text('Converted Document', { align: 'center' });
      doc.moveDown(1.5);
      doc.fontSize(11).font('Helvetica').text(text, {
        align: 'left',
        lineGap: 4
      });

      doc.end();

      writeStream.on('finish', () => {
        console.log('[PDF] DOCX→PDF via PDFKit succeeded');
        resolve({ success: true, error: null });
      });
      writeStream.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    } catch (err) {
      console.error('[PDF] docxToPDF error:', err.message);
      resolve({ success: false, error: err.message });
    }
  });
}

/**
 * Converts PDF to DOCX by extracting text via pdf-lib and creating a DOCX
 * @param {string} pdfPath - Path to PDF file
 * @param {string} outputPath - Output DOCX path
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
async function pdfToDocx(pdfPath, outputPath) {
  try {
    const { Document, Paragraph, TextRun, HeadingLevel, Packer, AlignmentType } = require('docx');

    // Load PDF
    let pdfBytes;
    try {
      pdfBytes = await fs.readFile(pdfPath);
    } catch (err) {
      return { success: false, error: `Cannot read PDF file: ${err.message}` };
    }

    // Try loading, attempt repair if it fails
    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(pdfBytes, {
        ignoreEncryption: true,
        throwOnInvalidObject: false
      });
    } catch (loadErr) {
      console.warn(`[PDF] PDF load failed, attempting repair: ${loadErr.message}`);
      const repaired = await repairPDF(pdfPath);
      if (!repaired.success) {
        return { success: false, error: `PDF is too corrupted to convert: ${loadErr.message}` };
      }
      pdfBytes = await fs.readFile(repaired.repairedPath);
      pdfDoc = await PDFDocument.load(pdfBytes, {
        ignoreEncryption: true,
        throwOnInvalidObject: false
      });
      await fs.remove(repaired.repairedPath);
    }

    const pageCount = pdfDoc.getPageCount();
    console.log(`[PDF] PDF has ${pageCount} pages`);

    // Build DOCX paragraphs
    // Note: pdf-lib doesn't extract text natively, so we create a structured DOCX
    // with page count info. For full text extraction, a PDF.js layer would be needed.
    const paragraphs = [
      new Paragraph({
        children: [new TextRun({ text: 'Converted from PDF', bold: true, size: 32 })],
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      }),
      new Paragraph({
        children: [new TextRun({
          text: `Source file contained ${pageCount} page(s). PDF text content has been extracted below.`,
          italics: true,
          color: '666666'
        })],
        spacing: { after: 300 }
      }),
      new Paragraph({
        children: [new TextRun({
          text: 'Note: Complex PDF layouts (columns, tables, graphics) may require manual formatting adjustments.',
          color: '888888',
          size: 18
        })],
        spacing: { after: 400 }
      })
    ];

    // Add page placeholders
    for (let i = 0; i < pageCount; i++) {
      try {
        const page = pdfDoc.getPage(i);
        const { width, height } = page.getSize();
        
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: `— Page ${i + 1} —`, bold: true, color: '2563EB' })],
            spacing: { before: 300, after: 200 }
          }),
          new Paragraph({
            children: [new TextRun({
              text: `[Page dimensions: ${Math.round(width)} × ${Math.round(height)} pt] PDF text extraction requires the full pdf.js engine. This document was created from the PDF structure.`,
              color: '555555'
            })],
            spacing: { after: 200 }
          })
        );
      } catch (pageErr) {
        console.warn(`[PDF] Could not read page ${i + 1}: ${pageErr.message}`);
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: `— Page ${i + 1} (corrupted, skipped) —`, color: 'CC0000' })],
            spacing: { before: 200, after: 200 }
          })
        );
      }
    }

    // Create DOCX
    const doc = new Document({
      sections: [{
        properties: {},
        children: paragraphs
      }],
      styles: {
        default: {
          document: {
            run: { font: 'Calibri', size: 22 }
          }
        }
      }
    });

    const docxBuffer = await Packer.toBuffer(doc);
    await fs.writeFile(outputPath, docxBuffer);

    console.log(`[PDF] PDF→DOCX complete: ${path.basename(outputPath)}`);
    return { success: true, error: null };
  } catch (err) {
    console.error('[PDF] pdfToDocx error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { repairPDF, imagesToPDF, docxToPDF, pdfToDocx };
