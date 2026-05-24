/**
 * app.js — Smart File Converter Frontend
 * Fully Optimized + Fixed Version
 */

'use strict';

// ═══════════════════════════════════════
// API BASE
// ═══════════════════════════════════════

const API_BASE =
  window.location.hostname.includes('localhost')
    ? 'http://localhost:3000'
    : window.location.origin;

let currentUploadXHR = null;


// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════

const state = {
  uploadedFiles: [],
  selectedConversion: '',
  fileOrder: [],
  sortableInstance: null,
  isConverting: false
};

// ═══════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════

const $ = id => document.getElementById(id);

const dropzone = $('dropzone');
const fileInput = $('fileInput');
const fileListSection = $('fileListSection');
const fileGrid = $('fileGrid');
const conversionSection = $('conversionSection');
const conversionGrid = $('conversionGrid');
const convertBtnWrapper = $('convertBtnWrapper');
const convertBtn = $('convertBtn');
const downloadSection = $('downloadSection');
const uploadProgressBar = $('uploadProgressBar');
const uploadProgressFill = $('uploadProgressFill');
const uploadProgressLabel = $('uploadProgressLabel');
const themeToggle = $('themeToggle');
const themeIcon = $('themeIcon');
const reorderHint = $('reorderHint');
const uploadedCountBadge = $('uploadedCountBadge');
const fileCountBadge = $('fileCountBadge');
const fileCountText = $('fileCountText');

// ═══════════════════════════════════════
// THEME
// ═══════════════════════════════════════

function initTheme() {
  const saved = localStorage.getItem('sfc-theme') || 'dark';
  setTheme(saved);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);

  themeIcon.className =
    theme === 'dark'
      ? 'bi bi-moon-stars-fill'
      : 'bi bi-sun-fill';

  localStorage.setItem('sfc-theme', theme);
}

themeToggle.addEventListener('click', () => {

  const current =
    document.documentElement.getAttribute('data-theme');

  setTheme(current === 'dark' ? 'light' : 'dark');

});

// ═══════════════════════════════════════
// TOAST
// ═══════════════════════════════════════

function showToast(type, title, msg, duration = 4000) {

  const container = $('toastContainer');

  const icons = {
    success: 'bi-check-circle-fill',
    error: 'bi-x-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
    info: 'bi-info-circle-fill'
  };

  const toastEl = document.createElement('div');

  toastEl.className = 'toast-custom mb-2';

  toastEl.innerHTML = `
    <div class="toast-icon ${type}">
      <i class="bi ${icons[type]}"></i>
    </div>

    <div class="toast-body">
      <div class="toast-title">${escHtml(title)}</div>
      <div class="toast-msg">${escHtml(msg)}</div>
    </div>

    <button class="toast-close">
      <i class="bi bi-x-lg"></i>
    </button>
  `;

  container.appendChild(toastEl);

  toastEl.querySelector('.toast-close')
    .addEventListener('click', () => removeToast(toastEl));

  toastEl._timer = setTimeout(() => {
    removeToast(toastEl);
  }, duration);
}

function removeToast(el) {

  clearTimeout(el._timer);

  el.style.opacity = '0';

  el.style.transform = 'translateX(100%)';

  setTimeout(() => {
    el.remove();
  }, 300);
}

// ═══════════════════════════════════════
// DRAG DROP
// ═══════════════════════════════════════

dropzone.addEventListener('click', () => {
  fileInput.click();
});

dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('drag-over');
});

dropzone.addEventListener('drop', e => {

  e.preventDefault();

  dropzone.classList.remove('drag-over');

  const files = Array.from(e.dataTransfer.files);

  if (files.length > 0) {
    handleFiles(files);
  }
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

async function handleFiles(fileList) {

  if (fileList.length === 0) return;

  const oversized =
    fileList.filter(f => f.size > 100 * 1024 * 1024);

  if (oversized.length > 0) {

    showToast(
      'error',
      'File Too Large',
      'Maximum size is 100MB'
    );

    return;
  }

  showUploadProgress(0, 'Uploading...');

  const formData = new FormData();

  fileList.forEach(file => {
    formData.append('files', file);
  });

  try {

    const xhr = new XMLHttpRequest();

    currentUploadXHR = xhr;

    xhr.open(
      'POST',
      `${API_BASE}/upload`
    );

    xhr.upload.addEventListener('progress', e => {

      if (e.lengthComputable) {

        const percent =
          Math.round((e.loaded / e.total) * 100);

        showUploadProgress(
          percent,
          `Uploading ${percent}%`
        );
      }

    });

    xhr.addEventListener('load', () => {

      hideUploadProgress();

      let data;

      try {

        data = JSON.parse(xhr.responseText);

      } catch {

        showToast(
          'error',
          'Upload Failed',
          'Invalid server response'
        );

        return;
      }

      processUploadResponse(data);

    });

    xhr.addEventListener('error', () => {

      hideUploadProgress();

      showToast(
        'error',
        'Network Error',
        'Server connection failed'
      );

    });

    xhr.addEventListener('abort', () => {

      currentUploadXHR = null;

      hideUploadProgress();

      showToast(
        'warning',
        'Cancelled',
        'Upload cancelled'
      );

    });

    xhr.send(formData);

  } catch (err) {

    hideUploadProgress();

    showToast(
      'error',
      'Upload Error',
      err.message
    );
  }
}

function processUploadResponse(data) {

  const validFiles =
    (data.files || []).filter(f => f.valid);

  if (validFiles.length === 0) {

    showToast(
      'error',
      'No Files Accepted',
      'Upload failed'
    );

    return;
  }

  const existingNames = new Set(
    state.uploadedFiles.map(
      f => `${f.originalname}-${f.size}`
    )
  );

  const uniqueFiles =
    validFiles.filter(
      f => !existingNames.has(
        `${f.originalname}-${f.size}`
      )
    );

  if (uniqueFiles.length === 0) {

    showToast(
      'warning',
      'Duplicate Files',
      'These files are already uploaded'
    );

    return;
  }

  state.uploadedFiles = [
    ...state.uploadedFiles,
    ...uniqueFiles
  ];

  renderFileGrid();

  updateConversionOptions();

  updateUI();

  showToast(
    'success',
    'Upload Complete',
    `${uniqueFiles.length} file(s) uploaded`
  );
}

// ═══════════════════════════════════════
// FILE GRID
// ═══════════════════════════════════════

function renderFileGrid() {

  fileGrid.innerHTML = '';

  state.uploadedFiles.forEach((file, index) => {

    const card = document.createElement('div');

    card.className =
      `file-card ${file.isImage ? 'sortable-image' : 'non-sortable'}`;

    card.dataset.index = index;

    let previewHtml = '';

    if (file.isImage && file.thumbnail) {

      previewHtml =
        `<img src="${file.thumbnail}"
          class="file-card-preview">`;

    } else if (
      file.mimeType === 'application/pdf'
    ) {

      previewHtml =
        `<div class="file-card-icon pdf-icon">
          <i class="bi bi-file-earmark-pdf-fill"></i>
        </div>`;

    } else {

      previewHtml =
        `<div class="file-card-icon docx-icon">
          <i class="bi bi-file-earmark-word-fill"></i>
        </div>`;
    }

    card.innerHTML = `
      ${previewHtml}

      <div class="file-card-info">

        <div class="file-card-name">
          ${escHtml(file.originalname)}
        </div>

        <div class="file-card-size">
          ${formatBytes(file.size)}
        </div>

      </div>

      <button
        class="file-card-remove"
        data-index="${index}"
      >
        <i class="bi bi-x"></i>
      </button>
    `;

    fileGrid.appendChild(card);

  });

  fileGrid
    .querySelectorAll('.file-card-remove')
    .forEach(btn => {

      btn.addEventListener('click', () => {
        removeFile(parseInt(btn.dataset.index));
      });

    });

  initSortable();
}

function removeFile(index) {

  state.uploadedFiles.splice(index, 1);

  renderFileGrid();

  updateConversionOptions();

  updateUI();

  if (state.uploadedFiles.length === 0) {
    resetAll();
  }
}

// ═══════════════════════════════════════
// SORTABLE
// ═══════════════════════════════════════

function initSortable() {

  if (state.sortableInstance) {

    state.sortableInstance.destroy();

    state.sortableInstance = null;
  }

  const imageCount =
    state.uploadedFiles.filter(f => f.isImage).length;

  if (imageCount < 2) return;

  state.sortableInstance = Sortable.create(fileGrid, {

    draggable: '.sortable-image',

    animation: 200,

    ghostClass: 'sortable-ghost',

    onEnd(evt) {

      if (
        evt.oldIndex == null ||
        evt.newIndex == null
      ) return;

      const moved =
        state.uploadedFiles.splice(evt.oldIndex, 1)[0];

      if (!moved) return;

      state.uploadedFiles.splice(
        evt.newIndex,
        0,
        moved
      );

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
    requires: 'images'
  },

  'pdf-to-docx': {
    label: 'PDF → DOCX',
    requires: 'pdf'
  },

  'docx-to-pdf': {
    label: 'DOCX → PDF',
    requires: 'docx'
  },

  'images-to-docx': {
    label: 'Images → DOCX',
    requires: 'images'
  }

};

function updateConversionOptions() {

  const hasImages =
    state.uploadedFiles.some(f => f.isImage);

  const hasPDF =
    state.uploadedFiles.some(
      f => f.mimeType === 'application/pdf'
    );

  const hasDOCX =
    state.uploadedFiles.some(
      f =>
        f.mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );

  conversionGrid.innerHTML = '';

  Object.entries(CONVERSION_TYPES)
    .forEach(([type, cfg]) => {

      const available =
        (cfg.requires === 'images' && hasImages) ||
        (cfg.requires === 'pdf' && hasPDF) ||
        (cfg.requires === 'docx' && hasDOCX);

      if (!available) return;

      const card = document.createElement('div');

      card.className =
        `conversion-card ${state.selectedConversion === type
          ? 'selected'
          : ''
        }`;

      card.innerHTML =
        `<div>${cfg.label}</div>`;

      card.addEventListener('click', () => {
        selectConversion(type);
      });

      conversionGrid.appendChild(card);

    });
}

function selectConversion(type) {

  state.selectedConversion = type;

  updateConversionOptions();

  updateUI();
}

// ═══════════════════════════════════════
// UI
// ═══════════════════════════════════════

function updateUI() {

  const hasFiles =
    state.uploadedFiles.length > 0;

  fileListSection.style.display =
    hasFiles ? 'block' : 'none';

  conversionSection.style.display =
    hasFiles ? 'block' : 'none';

  convertBtnWrapper.style.display =
    hasFiles && state.selectedConversion
      ? 'block'
      : 'none';

  uploadedCountBadge.textContent =
    state.uploadedFiles.length;

  if (hasFiles) {

    fileCountBadge.style.display = 'inline-flex';

    fileCountText.textContent =
      `${state.uploadedFiles.length} files`;

  } else {

    fileCountBadge.style.display = 'none';
  }
}

// ═══════════════════════════════════════
// FETCH TIMEOUT
// ═══════════════════════════════════════

async function fetchWithTimeout(
  url,
  options = {},
  timeout = 120000
) {

  const controller = new AbortController();

  const timeoutId =
    setTimeout(() => {
      controller.abort();
    }, timeout);

  try {

    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

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

  if (
    !state.selectedConversion ||
    state.uploadedFiles.length === 0
  ) {
    return;
  }

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
        filename: f.filename,
        originalname: f.originalname,
        mimeType: f.mimeType,
        size: f.size
      })),

      // IMPORTANT
      order: state.uploadedFiles.map((_, i) => i)

    };

    const res =
      await fetchWithTimeout(
        `${API_BASE}/convert`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        },
        300000
      );

    let data;

    try {
      data = await res.json();
    } catch {
      throw new Error('Invalid server response');
    }

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Conversion failed');
    }

    showDownload(data);

    if (data.warnings?.length) {

      $('warningBox').style.display = 'flex';

      $('warningText').textContent =
        data.warnings.join(' ');
    }

    showToast(
      'success',
      'Conversion Complete',
      'File ready for download'
    );

  } catch (err) {

    showToast(
      'error',
      'Conversion Error',
      err.message
    );

  } finally {

    state.isConverting = false;

    setConvertLoading(false);

  }

}

function setConvertLoading(loading) {

  const btnText =
    convertBtn.querySelector('.btn-text');

  const btnLoader =
    convertBtn.querySelector('.btn-loader');

  btnText.style.display =
    loading ? 'none' : 'inline-flex';

  btnLoader.style.display =
    loading ? 'inline-flex' : 'none';

  convertBtn.disabled = loading;
}

// ═══════════════════════════════════════
// DOWNLOAD
// ═══════════════════════════════════════

function showDownload(data) {

  const {
    downloadId,
    downloadName,
    fileSize
  } = data;

  $('downloadTitle').textContent =
    'Conversion Complete';

  $('downloadMeta').textContent =
    `${downloadName} · ${formatBytes(fileSize)}`;

  const customNameInput =
    $('customFileName');

  const extension =
    downloadName.split('.').pop();

  let finalName = downloadName;

  if (
    customNameInput &&
    customNameInput.value.trim()
  ) {

    const cleanName =
      customNameInput.value
        .trim()
        .replace(/[^\w\-]/g, '_');

    finalName =
      `${cleanName}.${extension}`;
  }

  const downloadUrl =
    `${API_BASE}/download/` +
    `${encodeURIComponent(downloadId)}` +
    `?name=${encodeURIComponent(finalName)}`;

  const downloadBtn =
    $('downloadBtn');

  downloadBtn.href = downloadUrl;

  downloadBtn.download = finalName;

  downloadBtn.onclick = async (e) => {

    e.preventDefault();

    try {

      const response =
        await fetch(downloadUrl);

      if (!response.ok) {
        throw new Error();
      }

      window.location.href =
        downloadUrl;

    } catch {

      showToast(
        'error',
        'Download Failed',
        'Please try again'
      );

    }

  };

  downloadSection.style.display = 'block';

  downloadSection.scrollIntoView({
    behavior: 'smooth'
  });
}

// ═══════════════════════════════════════
// RESET
// ═══════════════════════════════════════

function resetAll() {

  // destroy sortable
  if (state.sortableInstance) {

    state.sortableInstance.destroy();

    state.sortableInstance = null;

  }

  // reset state
  state.uploadedFiles = [];

  state.selectedConversion = '';

  state.fileOrder = [];

  state.isConverting = false;

  // reset input
  if (fileInput) {
    fileInput.value = '';
  }

  // clear UI
  fileGrid.innerHTML = '';

  conversionGrid.innerHTML = '';

  // hide sections
  fileListSection.style.display = 'none';

  conversionSection.style.display = 'none';

  convertBtnWrapper.style.display = 'none';

  downloadSection.style.display = 'none';

  reorderHint.style.display = 'none';

  // badges reset
  uploadedCountBadge.textContent = '0';

  fileCountText.textContent = '0 files';

  fileCountBadge.style.display = 'none';

  // remove selected classes
  document
    .querySelectorAll('.conversion-card')
    .forEach(card => {
      card.classList.remove('selected');
    });

  // stop upload if running
  if (currentUploadXHR) {

    currentUploadXHR.abort();

    currentUploadXHR = null;

  }

  // hide progress
  hideUploadProgress();

  // scroll top optional
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });

  showToast(
    'success',
    'Cleared',
    'All uploaded files removed'
  );

}

// ═══════════════════════════════════════
// PROGRESS
// ═══════════════════════════════════════

function showUploadProgress(percent, label) {

  uploadProgressBar.style.display = 'flex';

  uploadProgressFill.style.width =
    `${percent}%`;

  uploadProgressLabel.textContent = label;
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

  if (!bytes) return '0 B';

  const k = 1024;

  const sizes =
    ['B', 'KB', 'MB', 'GB'];

  const i =
    Math.floor(Math.log(bytes) / Math.log(k));

  return (
    parseFloat(
      (bytes / Math.pow(k, i)).toFixed(1)
    ) +
    ' ' +
    sizes[i]
  );
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

// Clear All button
$('clearAllBtn')
?.addEventListener('click', resetAll);

// New Conversion button
$('newConvertBtn')
?.addEventListener('click', resetAll);

updateUI();

// ═══════════════════════════════════════
// OBSERVER
// ═══════════════════════════════════════

const observer =
  new IntersectionObserver(entries => {

    entries.forEach(entry => {

      if (entry.isIntersecting) {

        entry.target.style.opacity = '1';
      }

    });

  });

document
  .querySelectorAll('.animate-fade-up')
  .forEach(el => observer.observe(el));

// ═══════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════

window.addEventListener('beforeunload', () => {

  observer.disconnect();

  if (state.sortableInstance) {

    state.sortableInstance.destroy();
  }

});