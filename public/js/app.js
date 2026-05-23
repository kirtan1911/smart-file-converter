/**
 * app.js — Smart File Converter Frontend
 * Handles: drag-drop upload, file preview, ordering,
 * conversion type selection, API calls, download, toasts, theme
 */

'use strict';

// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════

const state = {
  uploadedFiles: [],      // Array of file metadata from server
  selectedConversion: '', // 'images-to-pdf' | 'pdf-to-docx' | 'docx-to-pdf' | 'images-to-docx'
  fileOrder: [],          // Indices for reordering images
  sortableInstance: null,
  isConverting: false
};

// ═══════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════
const $ = id => document.getElementById(id);

const dropzone          = $('dropzone');
const fileInput         = $('fileInput');
const fileListSection   = $('fileListSection');
const fileGrid          = $('fileGrid');
const conversionSection = $('conversionSection');
const conversionGrid    = $('conversionGrid');
const convertBtnWrapper = $('convertBtnWrapper');
const convertBtn        = $('convertBtn');
const downloadSection   = $('downloadSection');
const uploadProgressBar = $('uploadProgressBar');
const uploadProgressFill= $('uploadProgressFill');
const uploadProgressLabel=$('uploadProgressLabel');
const themeToggle       = $('themeToggle');
const themeIcon         = $('themeIcon');
const reorderHint       = $('reorderHint');
const uploadedCountBadge= $('uploadedCountBadge');
const fileCountBadge    = $('fileCountBadge');
const fileCountText     = $('fileCountText');

// ═══════════════════════════════════════
// THEME TOGGLE
// ═══════════════════════════════════════

function initTheme() {
  const saved = localStorage.getItem('sfc-theme') || 'dark';
  setTheme(saved);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeIcon.className = theme === 'dark' ? 'bi bi-moon-stars-fill' : 'bi bi-sun-fill';
  localStorage.setItem('sfc-theme', theme);
}

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

// ═══════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════

function showToast(type, title, msg, duration = 4000) {
  const container = $('toastContainer');
  const icons = {
    success: 'bi-check-circle-fill',
    error:   'bi-x-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
    info:    'bi-info-circle-fill'
  };

  const toastEl = document.createElement('div');
  toastEl.className = 'toast-custom mb-2';
  toastEl.innerHTML = `
    <div class="toast-icon ${type}">
      <i class="bi ${icons[type] || icons.info}"></i>
    </div>
    <div class="toast-body">
      <div class="toast-title">${escHtml(title)}</div>
      <div class="toast-msg">${escHtml(msg)}</div>
    </div>
    <button class="toast-close" aria-label="Close">
      <i class="bi bi-x-lg"></i>
    </button>
  `;

  container.appendChild(toastEl);

  toastEl.querySelector('.toast-close').addEventListener('click', () => removeToast(toastEl));

  const timer = setTimeout(() => removeToast(toastEl), duration);
  toastEl._timer = timer;
}

function removeToast(el) {
  clearTimeout(el._timer);
  el.style.opacity = '0';
  el.style.transform = 'translateX(100%)';
  el.style.transition = 'all 0.3s ease';
  setTimeout(() => el.remove(), 300);
}

// ═══════════════════════════════════════
// DRAG & DROP
// ═══════════════════════════════════════

dropzone.addEventListener('click', (e) => {
  if (e.target === dropzone || e.target.closest('.dropzone-content')) {
    fileInput.click();
  }
});

dropzone.addEventListener('dragenter', e => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', e => {
  if (!dropzone.contains(e.relatedTarget)) {
    dropzone.classList.remove('drag-over');
  }
});

dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files);
  if (files.length > 0) handleFiles(files);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    handleFiles(Array.from(fileInput.files));
    fileInput.value = ''; // Reset so same file can be re-uploaded
  }
});

// ═══════════════════════════════════════
// FILE UPLOAD HANDLER
// ═══════════════════════════════════════

async function handleFiles(fileList) {
  if (fileList.length === 0) return;

  // Client-side size check
  const oversized = fileList.filter(f => f.size > 100 * 1024 * 1024);
  if (oversized.length > 0) {
    showToast('error', 'File Too Large', `${oversized.map(f=>f.name).join(', ')} exceed 100MB.`);
    return;
  }

  showUploadProgress(0, 'Uploading files…');

  const formData = new FormData();
  fileList.forEach(f => formData.append('files', f));

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload');

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        showUploadProgress(pct, `Uploading… ${pct}%`);
      }
    });

    xhr.addEventListener('load', () => {
      hideUploadProgress();
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        showToast('error', 'Upload Error', 'Server returned an invalid response.');
        return;
      }

      if (!data.success && data.files && data.files.length === 0) {
        showToast('error', 'Upload Failed', data.error || 'No files were accepted.');
        return;
      }

      processUploadResponse(data);
    });

    xhr.addEventListener('error', () => {
      hideUploadProgress();
      showToast('error', 'Network Error', 'Could not reach the server. Is it running?');
    });

    xhr.addEventListener('abort', () => {
      hideUploadProgress();
      showToast('warning', 'Upload Cancelled', 'The upload was cancelled.');
    });

    xhr.send(formData);
  } catch (err) {
    hideUploadProgress();
    showToast('error', 'Upload Error', err.message);
  }
}

function processUploadResponse(data) {
  const validFiles = data.files.filter(f => f.valid);
  const invalidFiles = data.files.filter(f => !f.valid);

  // Show toasts for invalid files
  invalidFiles.forEach(f => {
    showToast('warning', `File Rejected: ${f.originalname}`, f.error, 6000);
  });

  if (validFiles.length === 0) {
    showToast('error', 'No Files Accepted', 'All uploaded files were rejected. Check formats and file integrity.');
    return;
  }

  // Append to state
  state.uploadedFiles = [...state.uploadedFiles, ...validFiles];

  showToast('success', 'Files Uploaded', `${validFiles.length} file(s) ready for conversion.`);

  renderFileGrid();
  updateConversionOptions();
  updateUI();
}

// ═══════════════════════════════════════
// FILE GRID RENDER
// ═══════════════════════════════════════

function renderFileGrid() {
  fileGrid.innerHTML = '';

  state.uploadedFiles.forEach((file, index) => {
    const card = document.createElement('div');
    card.className = 'file-card';
    card.dataset.index = index;

    let previewHtml = '';
    if (file.isImage && file.thumbnail) {
      previewHtml = `<img src="${file.thumbnail}" class="file-card-preview" alt="${escHtml(file.originalname)}" />`;
    } else if (file.mimeType === 'application/pdf') {
      previewHtml = `<div class="file-card-icon pdf-icon"><i class="bi bi-file-earmark-pdf-fill"></i></div>`;
    } else {
      previewHtml = `<div class="file-card-icon docx-icon"><i class="bi bi-file-earmark-word-fill"></i></div>`;
    }

    card.innerHTML = `
      ${previewHtml}
      <div class="file-card-info">
        <div class="file-card-name" title="${escHtml(file.originalname)}">${escHtml(file.originalname)}</div>
        <div class="file-card-size">${formatBytes(file.size)}</div>
      </div>
      <button class="file-card-remove" data-index="${index}" title="Remove file">
        <i class="bi bi-x"></i>
      </button>
      ${file.isImage ? `<div class="file-card-order">${index + 1}</div>` : ''}
    `;

    fileGrid.appendChild(card);
  });

  // Attach remove listeners
  fileGrid.querySelectorAll('.file-card-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(parseInt(btn.dataset.index));
    });
  });

  // Show reorder hint if there are multiple images
  const imageCount = state.uploadedFiles.filter(f => f.isImage).length;
  reorderHint.style.display = imageCount > 1 ? 'block' : 'none';

  // Init sortable drag-to-reorder for images
  initSortable();
}

function removeFile(index) {
  const file = state.uploadedFiles[index];
  state.uploadedFiles.splice(index, 1);
  showToast('info', 'File Removed', `"${file.originalname}" removed.`);
  renderFileGrid();
  updateConversionOptions();
  updateUI();

  if (state.uploadedFiles.length === 0) {
    resetAll();
  }
}

// ═══════════════════════════════════════
// SORTABLE DRAG-TO-REORDER
// ═══════════════════════════════════════

function initSortable() {
  if (state.sortableInstance) {
    state.sortableInstance.destroy();
    state.sortableInstance = null;
  }

  const imageCount = state.uploadedFiles.filter(f => f.isImage).length;
  if (imageCount < 2) return;

  state.sortableInstance = Sortable.create(fileGrid, {
    animation: 200,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd(evt) {
      const moved = state.uploadedFiles.splice(evt.oldIndex, 1)[0];
      state.uploadedFiles.splice(evt.newIndex, 0, moved);
      renderFileGrid(); // Re-render to update order numbers
      showToast('info', 'Order Updated', 'File sequence has been rearranged.');
    }
  });
}

// ═══════════════════════════════════════
// CONVERSION OPTIONS
// ═══════════════════════════════════════

const CONVERSION_TYPES = {
  'images-to-pdf': {
    label: 'Images → PDF',
    desc: 'Merge multiple images into a single PDF file',
    fromIcon: 'bi-file-earmark-image',
    toIcon: 'bi-file-earmark-pdf',
    requires: 'images',
    minFiles: 1
  },
  'pdf-to-docx': {
    label: 'PDF → DOCX',
    desc: 'Convert a PDF document to editable Word format',
    fromIcon: 'bi-file-earmark-pdf',
    toIcon: 'bi-file-earmark-word',
    requires: 'pdf',
    minFiles: 1
  },
  'docx-to-pdf': {
    label: 'DOCX → PDF',
    desc: 'Convert a Word document to PDF format',
    fromIcon: 'bi-file-earmark-word',
    toIcon: 'bi-file-earmark-pdf',
    requires: 'docx',
    minFiles: 1
  },
  'images-to-docx': {
    label: 'Images → DOCX',
    desc: 'Embed images into a Word document',
    fromIcon: 'bi-file-earmark-image',
    toIcon: 'bi-file-earmark-word',
    requires: 'images',
    minFiles: 1
  }
};

function updateConversionOptions() {
  const hasImages = state.uploadedFiles.some(f => f.isImage);
  const hasPDF    = state.uploadedFiles.some(f => f.mimeType === 'application/pdf');
  const hasDOCX   = state.uploadedFiles.some(f =>
    f.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );

  conversionGrid.innerHTML = '';
  let availableCount = 0;

  Object.entries(CONVERSION_TYPES).forEach(([type, cfg]) => {
    const isAvailable =
      (cfg.requires === 'images' && hasImages) ||
      (cfg.requires === 'pdf'    && hasPDF)    ||
      (cfg.requires === 'docx'   && hasDOCX);

    if (!isAvailable) return;
    availableCount++;

    const card = document.createElement('div');
    card.className = `conversion-card${state.selectedConversion === type ? ' selected' : ''}`;
    card.dataset.type = type;

    card.innerHTML = `
      <div class="conv-check"><i class="bi bi-check-lg"></i></div>
      <div class="conv-icon-row">
        <div class="conv-icon-from"><i class="bi ${cfg.fromIcon}"></i></div>
        <div class="conv-arrow"><i class="bi bi-arrow-right"></i></div>
        <div class="conv-icon-to"><i class="bi ${cfg.toIcon}"></i></div>
      </div>
      <div class="conv-label">${cfg.label}</div>
      <div class="conv-desc">${cfg.desc}</div>
    `;

    card.addEventListener('click', () => selectConversion(type));
    conversionGrid.appendChild(card);
  });

  // Auto-select if only one option
  if (availableCount === 1) {
    const onlyType = conversionGrid.querySelector('.conversion-card')?.dataset.type;
    if (onlyType) selectConversion(onlyType);
  }

  // Clear selection if no longer available
  if (state.selectedConversion) {
    const cfg = CONVERSION_TYPES[state.selectedConversion];
    const stillAvailable =
      (cfg?.requires === 'images' && hasImages) ||
      (cfg?.requires === 'pdf'    && hasPDF)    ||
      (cfg?.requires === 'docx'   && hasDOCX);
    if (!stillAvailable) {
      state.selectedConversion = '';
    }
  }
}

function selectConversion(type) {
  state.selectedConversion = type;

  // Update card visuals
  conversionGrid.querySelectorAll('.conversion-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.type === type);
  });

  updateUI();
}

// ═══════════════════════════════════════
// UI STATE MANAGER
// ═══════════════════════════════════════

function updateUI() {
  const hasFiles = state.uploadedFiles.length > 0;
  const hasImages = state.uploadedFiles.some(f => f.isImage);
  const hasPDF    = state.uploadedFiles.some(f => f.mimeType === 'application/pdf');
  const hasDOCX   = state.uploadedFiles.some(f =>
    f.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  const hasCompatible = hasImages || hasPDF || hasDOCX;

  // File list section
  fileListSection.style.display    = hasFiles ? 'block' : 'none';
  conversionSection.style.display  = hasCompatible ? 'block' : 'none';
  convertBtnWrapper.style.display  = (state.selectedConversion && hasFiles) ? 'block' : 'none';

  // Navbar file badge
  if (hasFiles) {
    fileCountBadge.style.removeProperty('display');
    fileCountText.textContent = `${state.uploadedFiles.length} file${state.uploadedFiles.length !== 1 ? 's' : ''}`;
  } else {
    fileCountBadge.style.setProperty('display', 'none', 'important');
  }

  // Count badge
  uploadedCountBadge.textContent = state.uploadedFiles.length;
}

// ═══════════════════════════════════════
// CONVERT
// ═══════════════════════════════════════

$('clearAllBtn').addEventListener('click', () => {
  if (confirm('Remove all uploaded files?')) {
    resetAll();
    showToast('info', 'Cleared', 'All files removed.');
  }
});

convertBtn.addEventListener('click', async () => {
  if (state.isConverting) return;
  if (!state.selectedConversion) {
    showToast('warning', 'No Conversion Selected', 'Please choose a conversion type first.');
    return;
  }
  if (state.uploadedFiles.length === 0) {
    showToast('warning', 'No Files', 'Please upload files first.');
    return;
  }

  await startConversion();
});

async function startConversion() {
  state.isConverting = true;
  setConvertLoading(true);
  downloadSection.style.display = 'none';

  // Build ordered file index array
  const order = state.uploadedFiles.map((_, i) => i);

  const payload = {
    type: state.selectedConversion,
    files: state.uploadedFiles.map(f => ({
      filename: f.filename,
      originalname: f.originalname,
      mimeType: f.mimeType,
      size: f.size
    })),
    order
  };

  try {
    const res = await fetch('/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!data.success) {
      showToast('error', 'Conversion Failed', data.error || 'Unknown error during conversion.');
      return;
    }

    // Show download section
    showDownload(data);
    showToast('success', 'Conversion Complete!', 'Your file is ready to download.');

  } catch (err) {
    showToast('error', 'Network Error', `Could not reach server: ${err.message}`);
  } finally {
    state.isConverting = false;
    setConvertLoading(false);
  }
}

function setConvertLoading(loading) {
  const btnText   = convertBtn.querySelector('.btn-text');
  const btnLoader = convertBtn.querySelector('.btn-loader');
  btnText.style.display   = loading ? 'none' : 'inline-flex';
  btnLoader.style.display = loading ? 'inline-flex' : 'none';
  convertBtn.disabled = loading;
}

// ═══════════════════════════════════════
// DOWNLOAD
// ═══════════════════════════════════════

function showDownload(data) {
  const { downloadId, downloadName, fileSize, warnings } = data;

  $('downloadTitle').textContent = 'Conversion Complete!';
  $('downloadMeta').textContent  = `${downloadName} · ${formatBytes(fileSize)}`;

  // Warnings
  const warningBox = $('warningBox');
  if (warnings && warnings.length > 0) {
    warningBox.style.display = 'block';
    $('warningText').textContent = warnings.join(' ');
  } else {
    warningBox.style.display = 'none';
  }

  // Build download URL
  const downloadUrl = `/download/${encodeURIComponent(downloadId)}?name=${encodeURIComponent(downloadName)}`;
  const downloadBtn = $('downloadBtn');
  downloadBtn.href = downloadUrl;
  downloadBtn.download = downloadName;

  // Trigger download automatically
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = downloadName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Show section
  downloadSection.style.display = 'block';
  downloadSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('newConvertBtn').addEventListener('click', () => {
  resetAll();
  dropzone.scrollIntoView({ behavior: 'smooth' });
});

// ═══════════════════════════════════════
// RESET
// ═══════════════════════════════════════

function resetAll() {
  state.uploadedFiles = [];
  state.selectedConversion = '';
  state.fileOrder = [];
  if (state.sortableInstance) {
    state.sortableInstance.destroy();
    state.sortableInstance = null;
  }

  fileGrid.innerHTML = '';
  conversionGrid.innerHTML = '';

  fileListSection.style.display    = 'none';
  conversionSection.style.display  = 'none';
  convertBtnWrapper.style.display  = 'none';
  downloadSection.style.display    = 'none';
  reorderHint.style.display        = 'none';
  fileCountBadge.style.setProperty('display', 'none', 'important');

  uploadedCountBadge.textContent = '0';
}

// ═══════════════════════════════════════
// PROGRESS BAR HELPERS
// ═══════════════════════════════════════

function showUploadProgress(pct, label) {
  uploadProgressBar.style.display = 'flex';
  uploadProgressFill.style.width = `${pct}%`;
  uploadProgressLabel.textContent = label || `${pct}%`;
}

function hideUploadProgress() {
  setTimeout(() => {
    uploadProgressBar.style.display = 'none';
    uploadProgressFill.style.width = '0%';
  }, 600);
}

// ═══════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════

initTheme();
updateUI();

// Animate elements on scroll
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.animate-fade-up').forEach(el => observer.observe(el));
