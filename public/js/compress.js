/**
 * compress.js — Compress Image Module (Frontend)
 * Self-contained controller for POST /api/compress-image
 * Works with the redesigned 2-column layout in index.html
 */

'use strict';

// ── API base (mirrors app.js logic) ───────────────────────
const CMP_API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? `${window.location.protocol}//${window.location.host}`
    : window.location.origin;

// ── Utility helpers ────────────────────────────────────────
function cmpFmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function cmpSanitiseName(raw) {
  return (raw || 'compressed')
    .replace(/[^\w\-. ]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 80) || 'compressed';
}

/** Use existing app.js showToast if present, else simple fallback */
function cmpToast(type, title, msg) {
  if (typeof showToast === 'function') {
    showToast(type, title, msg);
    return;
  }
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const icons = {
    success: 'bi-check-circle-fill',
    error:   'bi-x-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
    info:    'bi-info-circle-fill'
  };
  const el = document.createElement('div');
  el.className = 'toast-custom mb-2';
  el.innerHTML = `
    <div class="toast-icon ${type}"><i class="bi ${icons[type] || icons.info}"></i></div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${msg}</div>
    </div>
    <button class="toast-close"><i class="bi bi-x-lg"></i></button>
  `;
  container.appendChild(el);
  const dismiss = () => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(100%)';
    el.style.transition = '0.3s ease';
    setTimeout(() => el.remove(), 300);
  };
  el.querySelector('.toast-close').addEventListener('click', dismiss);
  setTimeout(dismiss, 4500);
}

// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════

const cmp = {
  file:          null,
  originalBytes: 0,
  targetBytes:   0,
  outputFormat:  'original',
  isCompressing: false,
  resultBlobUrl: null,
  resultExt:     '.jpg'
};

// ═══════════════════════════════════════════════════════
// DOM REFS  (matching the redesigned index.html)
// ═══════════════════════════════════════════════════════

const $c = id => document.getElementById(id);

const cmpDropzone      = $c('cmpDropzone');
const cmpFileInput     = $c('cmpFileInput');
const cmpFileInfo      = $c('cmpFileInfo');
const cmpThumb         = $c('cmpThumb');
const cmpFileName      = $c('cmpFileName');
const cmpFileSize      = $c('cmpFileSize');
const cmpFileClear     = $c('cmpFileClear');
const cmpControlsWrap  = $c('cmpControlsWrap');
const cmpChips         = $c('cmpChips');
const cmpCustomSize    = $c('cmpCustomSize');
const cmpUnit          = $c('cmpUnit');
const cmpValidHint     = $c('cmpValidationHint');
const cmpBtn           = $c('cmpBtn');
const cmpEmptyState    = $c('cmpEmptyState');
const cmpResultCard    = $c('cmpResultCard');
const cmpStatOrig      = $c('cmpStatOrig');
const cmpStatNew       = $c('cmpStatNew');
const cmpReductionPct  = $c('cmpReductionPct');
const cmpBarFill       = $c('cmpBarFill');
const cmpBarMiddle     = $c('cmpBarMiddle');
const cmpNote          = $c('cmpNote');
const cmpNoteText      = $c('cmpNoteText');
const cmpPreviewImg    = $c('cmpPreviewImg');
const cmpDownloadName  = $c('cmpDownloadName');
const cmpExtLabel      = $c('cmpExtLabel');
const cmpDownloadBtn   = $c('cmpDownloadBtn');
const cmpAgainBtn      = $c('cmpAgainBtn');

// ═══════════════════════════════════════════════════════
// DRAG & DROP on the compress dropzone
// ═══════════════════════════════════════════════════════

cmpDropzone.addEventListener('click', e => {
  if (e.target.closest('label') || e.target === cmpFileInput) return;
  cmpFileInput.click();
});

cmpDropzone.addEventListener('dragover', e => {
  e.preventDefault();
  cmpDropzone.classList.add('drag-over');
});

cmpDropzone.addEventListener('dragleave', e => {
  if (!cmpDropzone.contains(e.relatedTarget))
    cmpDropzone.classList.remove('drag-over');
});

cmpDropzone.addEventListener('drop', e => {
  e.preventDefault();
  cmpDropzone.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0)
    cmpHandleFile(e.dataTransfer.files[0]);
});

cmpFileInput.addEventListener('change', () => {
  if (cmpFileInput.files.length > 0) {
    cmpHandleFile(cmpFileInput.files[0]);
    cmpFileInput.value = '';
  }
});

cmpFileClear.addEventListener('click', cmpReset);

// ═══════════════════════════════════════════════════════
// FILE HANDLING
// ═══════════════════════════════════════════════════════

const CMP_ALLOWED = ['.jpg', '.jpeg', '.png', '.webp'];
const CMP_MAX     = 25 * 1024 * 1024;

function cmpHandleFile(file) {
  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();

  if (!CMP_ALLOWED.includes(ext)) {
    cmpToast('error', 'Unsupported File', 'Only JPG, PNG, and WebP images are supported.');
    return;
  }
  if (file.size > CMP_MAX) {
    cmpToast('error', 'File Too Large', `Max 25 MB. Your file is ${cmpFmtBytes(file.size)}.`);
    return;
  }

  cmp.file          = file;
  cmp.originalBytes = file.size;

  // Local thumbnail preview
  const reader = new FileReader();
  reader.onload = e => { cmpThumb.src = e.target.result; };
  reader.readAsDataURL(file);

  // Update file info strip
  cmpFileName.textContent = file.name;
  cmpFileSize.textContent = `Original: ${cmpFmtBytes(file.size)}`;

  // UI transitions
  cmpDropzone.style.display    = 'none';
  cmpFileInfo.style.display    = 'flex';
  cmpControlsWrap.style.display = 'block';

  // Reset result panel to empty state
  cmpResultCard.style.display = 'none';
  cmpEmptyState.style.display = 'flex';

  // Pre-fill download name
  cmpDownloadName.value = file.name.replace(/\.[^/.]+$/, '') + '_compressed';

  // Reset controls
  cmpDeselectChips();
  cmpCustomSize.value = '';
  cmpUnit.value = 'KB';
  cmpClearValidation();
  cmpBtn.disabled = true;

  // Reset bar
  cmpBarFill.style.width = '100%';
  cmpNote.classList.remove('visible');
}

// ═══════════════════════════════════════════════════════
// PRESET CHIPS
// ═══════════════════════════════════════════════════════

cmpChips.querySelectorAll('.compress-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    cmpDeselectChips();
    chip.classList.add('active');

    const kb = parseInt(chip.dataset.kb, 10);
    if (kb >= 1024 && kb % 1024 === 0) {
      cmpCustomSize.value = kb / 1024;
      cmpUnit.value = 'MB';
    } else {
      cmpCustomSize.value = kb;
      cmpUnit.value = 'KB';
    }

    cmpValidateTarget();
  });
});

function cmpDeselectChips() {
  cmpChips.querySelectorAll('.compress-chip').forEach(c => c.classList.remove('active'));
}

// ═══════════════════════════════════════════════════════
// CUSTOM SIZE INPUT
// ═══════════════════════════════════════════════════════

cmpCustomSize.addEventListener('input', () => {
  cmpDeselectChips();
  // Try to auto-highlight matching chip
  const val  = parseFloat(cmpCustomSize.value);
  const unit = cmpUnit.value;
  if (!isNaN(val) && val > 0) {
    const kbVal = unit === 'MB' ? val * 1024 : val;
    cmpChips.querySelectorAll('.compress-chip').forEach(chip => {
      if (parseInt(chip.dataset.kb, 10) === Math.round(kbVal))
        chip.classList.add('active');
    });
  }
  cmpValidateTarget();
});

cmpUnit.addEventListener('change', cmpValidateTarget);

// ═══════════════════════════════════════════════════════
// OUTPUT FORMAT
// ═══════════════════════════════════════════════════════

document.querySelectorAll('.compress-fmt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.compress-fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    cmp.outputFormat = btn.dataset.fmt;
  });
});

// ═══════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════

function cmpValidateTarget() {
  cmpClearValidation();
  const raw  = parseFloat(cmpCustomSize.value);
  const unit = cmpUnit.value;

  if (!cmp.file || isNaN(raw) || raw <= 0) {
    cmpBtn.disabled = true;
    return;
  }

  const targetBytes = unit === 'MB'
    ? Math.round(raw * 1024 * 1024)
    : Math.round(raw * 1024);

  cmp.targetBytes = targetBytes;

  if (targetBytes < 1024) {
    cmpShowValidation('error', '⚠ Target must be at least 1 KB.');
    cmpBtn.disabled = true;
    return;
  }

  if (targetBytes >= cmp.originalBytes) {
    const origKB = (cmp.originalBytes / 1024).toFixed(1);
    cmpShowValidation('error', `⚠ Target must be smaller than the original (${origKB} KB). Choose a lower value.`);
    cmpBtn.disabled = true;
    return;
  }

  const pct = (targetBytes / cmp.originalBytes) * 100;
  if (pct < 1) {
    cmpShowValidation('warn', `⚠ Target is ${pct.toFixed(1)}% of original — closest achievable result will be returned if unreachable.`);
  }

  cmpBtn.disabled = false;
}

function cmpShowValidation(cls, msg) {
  cmpValidHint.className = `compress-validation-hint ${cls}`;
  cmpValidHint.textContent = msg;
}

function cmpClearValidation() {
  cmpValidHint.className = 'compress-validation-hint';
  cmpValidHint.textContent = '';
}

// ═══════════════════════════════════════════════════════
// COMPRESS BUTTON
// ═══════════════════════════════════════════════════════

cmpBtn.addEventListener('click', async () => {
  if (cmpBtn.disabled || cmp.isCompressing || !cmp.file) return;
  await cmpRunCompression();
});

async function cmpRunCompression() {
  cmp.isCompressing = true;
  cmpSetLoading(true);

  // Keep empty state visible while compressing, hide result
  cmpResultCard.style.display = 'none';
  cmpEmptyState.style.display = 'flex';

  try {
    const formData = new FormData();
    formData.append('image',        cmp.file);
    formData.append('targetSize',   cmpCustomSize.value);
    formData.append('unit',         cmpUnit.value);
    formData.append('outputFormat', cmp.outputFormat);

    const res = await fetch(`${CMP_API_BASE}/api/compress-image`, {
      method: 'POST',
      body: formData
    });

    // JSON = error
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const err = await res.json();
      throw new Error(err.error || 'Compression failed.');
    }
    if (!res.ok) throw new Error(`Server error ${res.status}`);

    // Parse response headers
    const actualBytes   = parseInt(res.headers.get('X-Compress-ActualBytes')   || '0', 10);
    const originalBytes = parseInt(res.headers.get('X-Compress-OriginalBytes') || String(cmp.originalBytes), 10);
    const wasExact      = res.headers.get('X-Compress-WasExact') === '1';
    const noteEnc       = res.headers.get('X-Compress-Note') || '';
    const note          = noteEnc ? decodeURIComponent(noteEnc) : '';
    const ext           = res.headers.get('X-Compress-Extension') || '.jpg';

    // Read blob for preview + download
    const blob    = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    // Release old blob
    if (cmp.resultBlobUrl) URL.revokeObjectURL(cmp.resultBlobUrl);
    cmp.resultBlobUrl = blobUrl;
    cmp.resultExt     = ext;

    cmpShowResult({ blobUrl, actualBytes, originalBytes, wasExact, note, ext });
    cmpToast('success', 'Compression Complete', `Compressed to ${cmpFmtBytes(actualBytes)} — ready to download!`);

  } catch (err) {
    cmpToast('error', 'Compression Failed', err.message || 'An error occurred. Please try again.');
    console.error('[CMP]', err);
  } finally {
    cmp.isCompressing = false;
    cmpSetLoading(false);
  }
}

// ═══════════════════════════════════════════════════════
// SHOW RESULT
// ═══════════════════════════════════════════════════════

function cmpShowResult({ blobUrl, actualBytes, originalBytes, wasExact, note, ext }) {
  // Stats
  cmpStatOrig.textContent = cmpFmtBytes(originalBytes);
  cmpStatNew.textContent  = cmpFmtBytes(actualBytes);

  // Reduction
  const reduction = ((1 - actualBytes / originalBytes) * 100).toFixed(1);
  cmpReductionPct.textContent = `↓ ${reduction}% smaller`;

  // Bar animation (animate after short delay so CSS transition fires)
  const fillPct = Math.max(2, Math.min(97, (actualBytes / originalBytes) * 100));
  cmpBarFill.style.width = '100%'; // reset
  setTimeout(() => { cmpBarFill.style.width = `${fillPct}%`; }, 80);

  // Middle label on bar
  if (cmpBarMiddle) cmpBarMiddle.textContent = cmpFmtBytes(actualBytes);

  // Note
  if (!wasExact && note) {
    cmpNoteText.textContent = note;
    cmpNote.classList.add('visible');
  } else {
    cmpNote.classList.remove('visible');
  }

  // Preview
  cmpPreviewImg.src = blobUrl;

  // Extension label
  cmpExtLabel.textContent = ext;

  // Switch panels
  cmpEmptyState.style.display = 'none';
  cmpResultCard.style.display  = 'block';

  // Smooth scroll to result on mobile
  if (window.innerWidth < 900) {
    setTimeout(() => {
      cmpResultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 150);
  }
}

// ═══════════════════════════════════════════════════════
// DOWNLOAD
// ═══════════════════════════════════════════════════════

cmpDownloadBtn.addEventListener('click', () => {
  if (!cmp.resultBlobUrl) return;

  const raw      = cmpDownloadName.value.trim();
  const baseName = raw ? cmpSanitiseName(raw) : 'compressed';
  const fullName = baseName + cmp.resultExt;

  const a = document.createElement('a');
  a.href     = cmp.resultBlobUrl;
  a.download = fullName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  cmpToast('success', 'Downloaded!', `Saved as "${fullName}"`);
});

// ═══════════════════════════════════════════════════════
// COMPRESS AGAIN (keep file, reset result)
// ═══════════════════════════════════════════════════════

cmpAgainBtn.addEventListener('click', () => {
  cmpResultCard.style.display  = 'none';
  cmpEmptyState.style.display  = 'flex';
  cmpBarFill.style.width = '100%';
  cmpNote.classList.remove('visible');
  cmpDeselectChips();
  cmpClearValidation();
  cmpCustomSize.value = '';
  cmpUnit.value = 'KB';
  cmpBtn.disabled = true;
});

// ═══════════════════════════════════════════════════════
// LOADING STATE
// ═══════════════════════════════════════════════════════

function cmpSetLoading(loading) {
  const btnText   = cmpBtn.querySelector('.btn-text');
  const btnLoader = cmpBtn.querySelector('.btn-loader');
  if (btnText)   btnText.style.display   = loading ? 'none' : 'inline-flex';
  if (btnLoader) btnLoader.classList.toggle('d-none', !loading);
  cmpBtn.disabled = loading;
}

// ═══════════════════════════════════════════════════════
// FULL RESET (back to dropzone)
// ═══════════════════════════════════════════════════════

function cmpReset() {
  if (cmp.resultBlobUrl) {
    URL.revokeObjectURL(cmp.resultBlobUrl);
    cmp.resultBlobUrl = null;
  }

  cmp.file          = null;
  cmp.originalBytes = 0;
  cmp.targetBytes   = 0;
  cmp.isCompressing = false;
  cmp.resultExt     = '.jpg';
  cmp.outputFormat  = 'original';

  cmpFileInput.value    = '';
  cmpThumb.src          = '';
  cmpCustomSize.value   = '';
  cmpUnit.value         = 'KB';

  cmpDeselectChips();
  cmpClearValidation();
  cmpBtn.disabled = true;

  // Reset format buttons
  document.querySelectorAll('.compress-fmt-btn').forEach(b => b.classList.remove('active'));
  const orig = document.getElementById('cmpFmtOriginal');
  if (orig) orig.classList.add('active');

  // Reset bar + note
  cmpBarFill.style.width = '100%';
  cmpNote.classList.remove('visible');
  cmpDownloadName.value  = '';

  // Show/hide panels
  cmpDropzone.style.display     = 'block';
  cmpFileInfo.style.display     = 'none';
  cmpControlsWrap.style.display = 'none';
  cmpResultCard.style.display   = 'none';
  cmpEmptyState.style.display   = 'flex';
}
