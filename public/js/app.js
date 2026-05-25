/**
 * app.js — Smart File Converter Frontend
 * Fixed: Multi-file upload, Custom filename, Improved conversion cards
 */

'use strict';

// ═══════════════════════════════════════
// API BASE
// ═══════════════════════════════════════

const API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? `${window.location.protocol}//${window.location.host}`
    : window.location.origin;

let currentUploadXHR = null;

// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════

const state = {
  uploadedFiles: [],
  selectedConversion: '',
  sortableInstance: null,
  isConverting: false,
  pendingDownload: null
};

// ═══════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════

const $ = id => document.getElementById(id);

const dropzone            = $('dropzone');
const fileInput           = $('fileInput');
const fileListSection     = $('fileListSection');
const fileGrid            = $('fileGrid');
const conversionSection   = $('conversionSection');
const conversionGrid      = $('conversionGrid');
const convertBtnWrapper   = $('convertBtnWrapper');
const convertBtn          = $('convertBtn');
const downloadSection     = $('downloadSection');
const uploadProgressBar   = $('uploadProgressBar');
const uploadProgressFill  = $('uploadProgressFill');
const uploadProgressLabel = $('uploadProgressLabel');
const themeToggle         = $('themeToggle');
const themeIcon           = $('themeIcon');
const reorderHint         = $('reorderHint');
const uploadedCountBadge  = $('uploadedCountBadge');
const fileCountBadge      = $('fileCountBadge');
const fileCountText       = $('fileCountText');
const customNameSection   = $('customNameSection');
const customNameInput     = $('customFileName');
const customNameClear     = $('customNameClear');

// ═══════════════════════════════════════
// THEME
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
// TOAST
// ═══════════════════════════════════════

function showToast(type, title, msg, duration = 4500) {
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
    <button class="toast-close"><i class="bi bi-x-lg"></i></button>
  `;

  container.appendChild(toastEl);
  toastEl.querySelector('.toast-close').addEventListener('click', () => removeToast(toastEl));
  toastEl._timer = setTimeout(() => removeToast(toastEl), duration);
}

function removeToast(el) {
  clearTimeout(el._timer);
  el.style.opacity = '0';
  el.style.transform = 'translateX(100%)';
  el.style.transition = '0.3s ease';
  setTimeout(() => el.remove(), 300);
}

// ═══════════════════════════════════════
// DRAG & DROP
// ═══════════════════════════════════════

dropzone.addEventListener('click', e => {
  if (e.target.closest('.browse-link') || e.target === fileInput) return;
  fileInput.click();
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
    fileInput.value = '';
  }
});

// ═══════════════════════════════════════
// UPLOAD
// ═══════════════════════════════════════

const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.tif', '.pdf', '.docx'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_FILES = 100;

async function handleFiles(fileList) {
  if (fileList.length === 0) return;

  // Validate total count
  if (state.uploadedFiles.length + fileList.length > MAX_FILES) {
    showToast('error', 'Too Many Files', `Maximum ${MAX_FILES} files allowed total.`);
    return;
  }

  // Validate extensions & size
  const invalid = [];
  const oversized = [];

  for (const f of fileList) {
    const ext = '.' + f.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      invalid.push(f.name);
    } else if (f.size > MAX_FILE_SIZE) {
      oversized.push(f.name);
    }
  }

  if (invalid.length > 0) {
    showToast('error', 'Unsupported Files', `${invalid.length} file(s) not supported: ${invalid.slice(0,3).join(', ')}`);
  }
  if (oversized.length > 0) {
    showToast('error', 'Files Too Large', `${oversized.length} file(s) exceed 100MB limit.`);
  }

  const validList = fileList.filter(f => {
    const ext = '.' + f.name.split('.').pop().toLowerCase();
    return ALLOWED_EXTS.includes(ext) && f.size <= MAX_FILE_SIZE;
  });

  if (validList.length === 0) return;

  showUploadProgress(0, 'Uploading…');

  const formData = new FormData();
  validList.forEach(f => formData.append('files', f));

  try {
    const xhr = new XMLHttpRequest();
    currentUploadXHR = xhr;

    xhr.open('POST', `${API_BASE}/upload`);

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        showUploadProgress(pct, `Uploading ${pct}%…`);
      }
    });

    xhr.addEventListener('load', () => {
      hideUploadProgress();
      let data;
      try { data = JSON.parse(xhr.responseText); }
      catch { showToast('error', 'Upload Failed', 'Invalid server response.'); return; }
      processUploadResponse(data);
    });

    xhr.addEventListener('error', () => {
      hideUploadProgress();
      showToast('error', 'Network Error', 'Could not connect to server.');
    });

    xhr.addEventListener('abort', () => {
      currentUploadXHR = null;
      hideUploadProgress();
      showToast('warning', 'Cancelled', 'Upload was cancelled.');
    });

    xhr.send(formData);
  } catch (err) {
    hideUploadProgress();
    showToast('error', 'Upload Error', err.message);
  }
}

function processUploadResponse(data) {
  const validFiles = (data.files || []).filter(f => f.valid);

  if (validFiles.length === 0) {
    showToast('error', 'No Files Accepted', data.message || 'All files were rejected.');
    return;
  }

  // Reject duplicates by name+size
  const existingKeys = new Set(state.uploadedFiles.map(f => `${f.originalname}-${f.size}`));
  const newFiles = validFiles.filter(f => !existingKeys.has(`${f.originalname}-${f.size}`));

  const dupeCount = validFiles.length - newFiles.length;
  const rejCount = (data.files || []).length - validFiles.length;

  if (newFiles.length === 0) {
    showToast('warning', 'Already Uploaded', 'These files are already in your list.');
    return;
  }

  state.uploadedFiles = [...state.uploadedFiles, ...newFiles];
  renderFileGrid();
  updateConversionOptions();
  updateUI();

  let msg = `${newFiles.length} file(s) added successfully.`;
  if (dupeCount > 0) msg += ` ${dupeCount} duplicate(s) skipped.`;
  if (rejCount > 0) msg += ` ${rejCount} rejected (unsupported format).`;

  showToast('success', 'Upload Complete', msg);
}

// ═══════════════════════════════════════
// FILE GRID
// ═══════════════════════════════════════

function renderFileGrid() {
  fileGrid.innerHTML = '';

  state.uploadedFiles.forEach((file, index) => {
    const card = document.createElement('div');
    card.className = `file-card ${file.isImage ? 'sortable-image' : 'non-sortable'}`;
    card.dataset.index = index;

    let previewHtml = '';
    if (file.isImage && file.thumbnail) {
      previewHtml = `<img src="${file.thumbnail}" class="file-card-preview" loading="lazy" alt="${escHtml(file.originalname)}">`;
    } else if (file.mimeType === 'application/pdf') {
      previewHtml = `<div class="file-card-icon pdf-icon"><i class="bi bi-file-earmark-pdf-fill"></i></div>`;
    } else {
      previewHtml = `<div class="file-card-icon docx-icon"><i class="bi bi-file-earmark-word-fill"></i></div>`;
    }

    const orderBadge = file.isImage
      ? `<div class="file-card-order">${index + 1}</div>`
      : '';

    card.innerHTML = `
      ${previewHtml}
      ${orderBadge}
      <div class="file-card-info">
        <div class="file-card-name" title="${escHtml(file.originalname)}">${escHtml(file.originalname)}</div>
        <div class="file-card-size">${formatBytes(file.size)}</div>
      </div>
      <button class="file-card-remove" data-index="${index}" title="Remove file">
        <i class="bi bi-x"></i>
      </button>
    `;

    fileGrid.appendChild(card);
  });

  fileGrid.querySelectorAll('.file-card-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removeFile(parseInt(btn.dataset.index));
    });
  });

  initSortable();
  updateReorderHint();
}

function removeFile(index) {
  state.uploadedFiles.splice(index, 1);

  if (state.uploadedFiles.length === 0) {
    resetAll();
    return;
  }

  renderFileGrid();
  updateConversionOptions();
  updateUI();
}

function updateReorderHint() {
  const imageCount = state.uploadedFiles.filter(f => f.isImage).length;
  const showHint = imageCount >= 2 && (
    state.selectedConversion === 'images-to-pdf' ||
    state.selectedConversion === 'images-to-docx' ||
    !state.selectedConversion
  );
  reorderHint.style.display = showHint ? 'block' : 'none';
}

// ═══════════════════════════════════════
// SORTABLE
// ═══════════════════════════════════════

function initSortable() {
  if (state.sortableInstance) {
    state.sortableInstance.destroy();
    state.sortableInstance = null;
  }

  const imageCount = state.uploadedFiles.filter(f => f.isImage).length;
  if (imageCount < 2) return;

  state.sortableInstance = Sortable.create(fileGrid, {
    draggable: '.sortable-image',
    animation: 200,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd(evt) {
      if (evt.oldIndex == null || evt.newIndex == null || evt.oldIndex === evt.newIndex) return;
      const moved = state.uploadedFiles.splice(evt.oldIndex, 1)[0];
      if (moved) state.uploadedFiles.splice(evt.newIndex, 0, moved);
      renderFileGrid();
    }
  });
}

// ═══════════════════════════════════════
// CONVERSION OPTIONS
// ═══════════════════════════════════════

const CONVERSION_TYPES = {
  'images-to-pdf': {
    label: 'Images → PDF',
    desc: 'Merge multiple images into a single PDF document.',
    from: { icon: 'bi-file-earmark-image', label: 'IMG' },
    to:   { icon: 'bi-file-earmark-pdf',   label: 'PDF' },
    requires: 'images'
  },
  'images-to-docx': {
    label: 'Images → DOCX',
    desc: 'Embed images into a Word document.',
    from: { icon: 'bi-file-earmark-image', label: 'IMG' },
    to:   { icon: 'bi-file-earmark-word',  label: 'DOCX' },
    requires: 'images'
  },
  'pdf-to-docx': {
    label: 'PDF → DOCX',
    desc: 'Convert a PDF document into editable Word format.',
    from: { icon: 'bi-file-earmark-pdf',  label: 'PDF' },
    to:   { icon: 'bi-file-earmark-word', label: 'DOCX' },
    requires: 'pdf'
  },
  'docx-to-pdf': {
    label: 'DOCX → PDF',
    desc: 'Convert a Word document to PDF format.',
    from: { icon: 'bi-file-earmark-word', label: 'DOCX' },
    to:   { icon: 'bi-file-earmark-pdf',  label: 'PDF' },
    requires: 'docx'
  }
};

function updateConversionOptions() {
  const hasImages = state.uploadedFiles.some(f => f.isImage);
  const hasPDF    = state.uploadedFiles.some(f => f.mimeType === 'application/pdf');
  const hasDOCX   = state.uploadedFiles.some(f =>
    f.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );

  conversionGrid.innerHTML = '';

  let available = 0;

  Object.entries(CONVERSION_TYPES).forEach(([type, cfg]) => {
    const isAvailable =
      (cfg.requires === 'images' && hasImages) ||
      (cfg.requires === 'pdf'    && hasPDF)    ||
      (cfg.requires === 'docx'   && hasDOCX);

    if (!isAvailable) return;
    available++;

    const isSelected = state.selectedConversion === type;
    const card = document.createElement('div');
    card.className = `conversion-card ${isSelected ? 'selected' : ''}`;

    card.innerHTML = `
      <div class="conv-check"><i class="bi bi-check"></i></div>
      <div class="conv-icon-row">
        <div class="conv-icon-from"><i class="bi ${cfg.from.icon}"></i></div>
        <span class="conv-arrow"><i class="bi bi-arrow-right"></i></span>
        <div class="conv-icon-to"><i class="bi ${cfg.to.icon}"></i></div>
      </div>
      <div class="conv-label">${cfg.label}</div>
      <div class="conv-desc">${cfg.desc}</div>
    `;

    card.addEventListener('click', () => selectConversion(type));
    conversionGrid.appendChild(card);
  });

  // Auto-select if only one option
  if (available === 1 && !state.selectedConversion) {
    const firstCard = conversionGrid.querySelector('.conversion-card');
    if (firstCard) {
      const type = Object.keys(CONVERSION_TYPES).find(t => {
        const cfg = CONVERSION_TYPES[t];
        return (cfg.requires === 'images' && hasImages) ||
               (cfg.requires === 'pdf' && hasPDF) ||
               (cfg.requires === 'docx' && hasDOCX);
      });
      if (type) selectConversion(type);
    }
  }

  // Reset invalid selection
  if (state.selectedConversion) {
    const cfg = CONVERSION_TYPES[state.selectedConversion];
    if (cfg) {
      const stillValid =
        (cfg.requires === 'images' && hasImages) ||
        (cfg.requires === 'pdf'    && hasPDF)    ||
        (cfg.requires === 'docx'   && hasDOCX);
      if (!stillValid) {
        state.selectedConversion = '';
        updateConversionOptions();
      }
    }
  }
}

function selectConversion(type) {
  state.selectedConversion = type;
  updateConversionOptions();
  updateReorderHint();
  updateUI();
}

// ═══════════════════════════════════════
// CUSTOM FILE NAME
// ═══════════════════════════════════════

if (customNameInput) {
  customNameInput.addEventListener('input', () => {
    if (customNameClear) {
      customNameClear.style.display = customNameInput.value ? 'flex' : 'none';
    }
  });
}

if (customNameClear) {
  customNameClear.addEventListener('click', () => {
    customNameInput.value = '';
    customNameClear.style.display = 'none';
    customNameInput.focus();
  });
}

function buildFinalName(defaultName) {
  if (!customNameInput || !customNameInput.value.trim()) return defaultName;

  const ext = defaultName.split('.').pop();
  const rawName = customNameInput.value.trim();
  // Remove any extension the user may have typed, then re-add the correct one
  const nameWithoutExt = rawName.replace(/\.[^/.]+$/, '');
  const cleaned = nameWithoutExt.replace(/[^\w\-. ]/g, '_').replace(/\s+/g, '_').slice(0, 80);
  return cleaned ? `${cleaned}.${ext}` : defaultName;
}

// ═══════════════════════════════════════
// UI UPDATE
// ═══════════════════════════════════════

function updateUI() {
  const hasFiles = state.uploadedFiles.length > 0;
  const hasSelection = !!state.selectedConversion;

  fileListSection.style.display    = hasFiles ? 'block' : 'none';
  conversionSection.style.display  = hasFiles ? 'block' : 'none';
  customNameSection.style.display  = hasFiles && hasSelection ? 'block' : 'none';
  convertBtnWrapper.style.display  = hasFiles && hasSelection ? 'block' : 'none';

  uploadedCountBadge.textContent = state.uploadedFiles.length;

  if (hasFiles) {
    fileCountBadge.style.display = 'inline-flex';
    fileCountText.textContent = `${state.uploadedFiles.length} file${state.uploadedFiles.length !== 1 ? 's' : ''}`;
  } else {
    fileCountBadge.style.display = 'none';
  }
}

// ═══════════════════════════════════════
// PROGRESS
// ═══════════════════════════════════════

function showUploadProgress(percent, label) {
  uploadProgressBar.style.display = 'flex';
  uploadProgressFill.style.width = `${percent}%`;
  uploadProgressLabel.textContent = label;
}

function hideUploadProgress() {
  setTimeout(() => {
    uploadProgressBar.style.display = 'none';
    uploadProgressFill.style.width = '0%';
  }, 600);
}

// ═══════════════════════════════════════
// FETCH WITH TIMEOUT
// ═══════════════════════════════════════

async function fetchWithTimeout(url, options = {}, timeout = 300000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ═══════════════════════════════════════
// CONVERT
// ═══════════════════════════════════════

convertBtn.addEventListener('click', async () => {
  if (!state.selectedConversion || state.uploadedFiles.length === 0 || state.isConverting) return;
  await startConversion();
});

async function startConversion() {
  state.isConverting = true;
  setConvertLoading(true);
  downloadSection.style.display = 'none';

  try {
    const payload = {
      type: state.selectedConversion,
      files: state.uploadedFiles.map(f => ({
        filename:     f.filename,
        originalname: f.originalname,
        mimeType:     f.mimeType,
        size:         f.size
      })),
      order: state.uploadedFiles.map((_, i) => i)
    };

    const res = await fetchWithTimeout(
      `${API_BASE}/convert`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      },
      300000
    );

    let data;
    try { data = await res.json(); }
    catch { throw new Error('Invalid server response.'); }

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Conversion failed.');
    }

    state.pendingDownload = data;
    showDownload(data);

    if (data.warnings?.length) {
      $('warningBox').style.display = 'flex';
      $('warningText').textContent = data.warnings.join(' ');
    } else {
      $('warningBox').style.display = 'none';
    }

    showToast('success', 'Conversion Complete', 'Your file is ready to download.');
  } catch (err) {
    const msg = err.name === 'AbortError'
      ? 'Conversion timed out. Try with fewer or smaller files.'
      : err.message;
    showToast('error', 'Conversion Error', msg);
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
  convertBtn.disabled     = loading;
}

// ═══════════════════════════════════════
// DOWNLOAD
// ═══════════════════════════════════════

function showDownload(data) {
  const { downloadId, downloadName, fileSize } = data;

  const finalName = buildFinalName(downloadName);
  const downloadUrl = `${API_BASE}/download/${encodeURIComponent(downloadId)}?name=${encodeURIComponent(finalName)}`;

  $('downloadTitle').textContent = 'Conversion Complete!';
  $('downloadMeta').textContent  = `${finalName} · ${formatBytes(fileSize)}`;

  const downloadBtn = $('downloadBtn');
  downloadBtn.href     = downloadUrl;
  downloadBtn.download = finalName;

  downloadBtn.onclick = async e => {
    e.preventDefault();
    try {
      const check = await fetch(downloadUrl, { method: 'HEAD' }).catch(() => null);
      if (check && !check.ok) throw new Error('expired');
      window.location.href = downloadUrl;
    } catch {
      showToast('error', 'Download Failed', 'File may have expired. Please convert again.');
    }
  };

  downloadSection.style.display = 'block';
  setTimeout(() => {
    downloadSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

// ═══════════════════════════════════════
// RESET
// ═══════════════════════════════════════

function resetAll() {
  if (state.sortableInstance) {
    state.sortableInstance.destroy();
    state.sortableInstance = null;
  }

  state.uploadedFiles      = [];
  state.selectedConversion = '';
  state.isConverting       = false;
  state.pendingDownload    = null;

  if (fileInput) fileInput.value = '';

  fileGrid.innerHTML      = '';
  conversionGrid.innerHTML = '';

  if (customNameInput) { customNameInput.value = ''; }
  if (customNameClear) { customNameClear.style.display = 'none'; }

  fileListSection.style.display    = 'none';
  conversionSection.style.display  = 'none';
  customNameSection.style.display  = 'none';
  convertBtnWrapper.style.display  = 'none';
  downloadSection.style.display    = 'none';
  reorderHint.style.display        = 'none';

  uploadedCountBadge.textContent = '0';
  fileCountText.textContent = '0 files';
  fileCountBadge.style.display = 'none';

  if (currentUploadXHR) {
    currentUploadXHR.abort();
    currentUploadXHR = null;
  }

  hideUploadProgress();

  window.scrollTo({ top: 0, behavior: 'smooth' });

  showToast('info', 'Cleared', 'Ready for a new conversion.');
}

// ═══════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
}

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════

initTheme();

$('clearAllBtn')?.addEventListener('click', resetAll);
$('newConvertBtn')?.addEventListener('click', resetAll);

updateUI();

// Intersection observer for fade-up animations
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.animate-fade-up').forEach(el => observer.observe(el));

window.addEventListener('beforeunload', () => {
  observer.disconnect();
  if (state.sortableInstance) state.sortableInstance.destroy();
});
