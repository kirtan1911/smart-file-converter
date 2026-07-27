# CHANGELOG

All notable changes and bug fixes made to this project are documented here.

---

## [1.1.0] - 2026-07-26

### 🚨 Critical Bug Fixes (Render.com Deployment)

---

### Fix 1 — LibreOffice Binary Missing on Render

**Problem:**
Render's default Node runtime does NOT have LibreOffice installed.
The `libreoffice-convert` npm package requires the `soffice` binary to
exist on the system PATH. Without it, every `docx-to-pdf` conversion
returns a 500 error with `spawn soffice ENOENT` in the logs.

**Root Cause:**
`render.yaml` was not explicitly setting `runtime: docker`, which meant
Render could not run `apt-get install libreoffice` during build.

**Fix Applied:**
- `render.yaml` → Set `runtime: docker` (the ONLY way to install
  system packages on Render)
- `Dockerfile` → Added `apt-get install -y libreoffice`
- `Dockerfile` → Added `RUN soffice --version` as a fail-fast build
  verification step (fails at build time if LibreOffice didn't install,
  not silently at runtime)

**Files Changed:** `Dockerfile`, `render.yaml`

---

### Fix 2 — Hardcoded Temp Directory Paths (Root Cause of All Upload/Convert/Download Failures)

**Problem:**
All three route files used hardcoded relative paths to store and read
files. These paths pointed to `/app/uploads` and `/app/converted`
inside the Docker container — which are part of the read-only image
layer on Render. Writing to them throws:
```
EACCES: permission denied
EROFS: read-only file system
```

Additionally, each route pointed to a **different** directory, so even
if writes had succeeded, the convert route would not find files that
the upload route had saved.

| File | Was Using (Broken) | Should Use |
|------|--------------------|------------|
| `routes/upload.js` multer `destination` | `'uploads/'` (relative path) | `/tmp/sfc_uploads` |
| `routes/upload.js` `UPLOADS_DIR` | `path.join(__dirname, '..', 'uploads')` | `/tmp/sfc_uploads` |
| `routes/convert.js` `UPLOADS_DIR` | `path.join(__dirname, '..', 'uploads')` | `/tmp/sfc_uploads` |
| `routes/convert.js` `CONVERTED_DIR` | `path.join(__dirname, '..', 'converted')` | `/tmp/sfc_converted` |
| `routes/download.js` `CONVERTED_DIR` | `path.join(__dirname, '..', 'converted')` | `/tmp/sfc_converted` |

**Root Cause:**
`utils/tempDir.js` already existed and correctly used `os.tmpdir()`
(`/tmp` on Linux, writable on Render). However, **none of the three
routes ever imported it** — they each hardcoded their own paths.

**Fix Applied:**
- `routes/upload.js` → Import `UPLOADS_DIR` from `../utils/tempDir`.
  Changed multer `destination` callback from `cb(null, 'uploads/')` to
  `cb(null, UPLOADS_DIR)`.
- `routes/convert.js` → Import both `UPLOADS_DIR` and `CONVERTED_DIR`
  from `../utils/tempDir`. Removed both hardcoded `path.join` lines.
- `routes/download.js` → Import `CONVERTED_DIR` from `../utils/tempDir`.
  Removed hardcoded `path.join` line.

All three routes now share the **same** base paths from `tempDir.js`:
- Local Windows dev: `C:\Users\...\AppData\Local\Temp\sfc_uploads`
- Render / Linux Docker: `/tmp/sfc_uploads` and `/tmp/sfc_converted`

**Files Changed:** `routes/upload.js`, `routes/convert.js`, `routes/download.js`

---

### Fix 3 — PORT Binding

**Problem:**
Apps that bind to `localhost` / `127.0.0.1` are unreachable on Render
because Render's load balancer connects to the container's `eth0`
interface (e.g., `10.x.x.x`), not the loopback.

**Status:** Already correct in `server.js` — no change required.
```js
app.listen(PORT, '0.0.0.0', ...)  // ✅ binds to all interfaces
const PORT = process.env.PORT || 3000  // ✅ uses Render-injected $PORT
```

**Files Changed:** None (was already correct)

---

### Fix 4 — Sharp Native Binary Mismatch

**Problem:**
`package-lock.json` was generated on Windows, so it contains the
resolved prebuilt binary URL for `win32-x64`. Inside Render's Linux
container, Node needs `linux-x64` binaries. Without rebuilding, sharp
throws:
```
Error: Could not load the sharp module using the linux-x64 runtime
```

**Fix Applied:**
- `Dockerfile` → Added `RUN npm rebuild sharp --verbose` after `npm ci`.
  This downloads/compiles the correct Linux binary for the current
  Node version and CPU architecture.
- `package.json` → Added `"postinstall": "npm rebuild sharp"` script
  as an npm-level fallback that runs after every `npm install` / `npm ci`.

**Files Changed:** `Dockerfile`, `package.json`

---

### Fix 5 — Timeouts and Memory Limits

**Problem:**
Render's free plan has:
- 512 MB RAM → LibreOffice (~200 MB) + sharp (~300 MB spike) + Node (~80 MB)
  can OOM-kill the process silently
- Containers **spin down** after 15 minutes of idle → 30–60s cold start
  on the next request
- 30s HTTP timeout on the load balancer level on free plan

**Fix Applied:**
- `render.yaml` → Set `plan: starter` (no spin-down, 512 MB RAM,
  always-on). Comment added to upgrade to `standard` (2 GB) for
  production heavy usage.
- `server.js` → `req.setTimeout(10 * 60 * 1000)` already present —
  gives LibreOffice 10 minutes to convert large files.
- Added documentation comment in `render.yaml` explaining memory
  requirements and when to upgrade.

**Files Changed:** `render.yaml`

---

### Fix 6 — CORS / Multer / Request Size Limits

**Problem:**
Multer file size limits and CORS config needed to be verified for
production use, not just localhost.

**Status:** Already correct — no change required.
```js
cors({ origin: true, credentials: true })         // ✅ works on any domain
express.json({ limit: '100mb' })                  // ✅ handles large payloads
multer limits: { fileSize: 500MB, files: 100 }    // ✅ enforced server-side
```

**Files Changed:** None (was already correct)

---

### Fix 7 — Logging and Error Visibility

**Problem:**
Errors were failing silently — no way to tell from Render logs
WHERE exactly the conversion pipeline was breaking.

**Status:** Already implemented — no change required.
All routes already use structured logging:
```js
console.error('[Upload]', new Date().toISOString(), err);
console.error('[Convert]', new Date().toISOString(), err);
console.error('[Download]', new Date().toISOString(), err);
```

**Additional logging added in this release:**
- `routes/upload.js` → `console.log('[Upload Route] UPLOADS_DIR = ...')`
- `routes/convert.js` → `console.log('[Convert Route] UPLOADS_DIR = ...')`
- `routes/download.js` → `console.log('[Download Route] CONVERTED_DIR = ...')`

These startup logs make it immediately visible in Render's log panel
whether the routes are using the correct `/tmp` paths.

**Files Changed:** `routes/upload.js`, `routes/convert.js`, `routes/download.js`

---

### New Files Added

| File | Purpose |
|------|---------|
| `.env.example` | Documents all environment variables with Render-specific notes |
| `render.yaml` | Render Infrastructure-as-Code (was missing from repo) |
| `utils/tempDir.js` | Centralized writable temp directory management (was missing from routes) |

---

### Files Modified Summary

| File | What Changed |
|------|-------------|
| `routes/upload.js` | Import `UPLOADS_DIR` from `tempDir.js`; fix multer destination |
| `routes/convert.js` | Import both dirs from `tempDir.js`; remove hardcoded paths |
| `routes/download.js` | Import `CONVERTED_DIR` from `tempDir.js`; remove hardcoded path |
| `Dockerfile` | Added LibreOffice install, `soffice --version` verify, `npm rebuild sharp`, `dumb-init`, full inline documentation |
| `render.yaml` | Set `runtime: docker`, added env vars, full inline documentation |
| `package.json` | Added `postinstall: npm rebuild sharp`; updated `engines` to `>=18.0.0` |
| `.dockerignore` | Expanded to exclude Windows `node_modules`, `.env`, local upload/converted dirs |

---

### Render Dashboard Checklist (Required After Deploy)

- [ ] Runtime = **Docker** (not Node)
- [ ] `NODE_ENV` = `production`
- [ ] `TEMP_DIR` = `/tmp`
- [ ] `SOFFICE_PATH` = `/usr/bin/soffice`
- [ ] Health check path = `/health`
- [ ] Visit `/health` after deploy — verify `libreOffice` shows a version string

---

## [1.0.0] - Initial Release

- Node.js + Express backend with file conversion support
- Supported conversions: Images → PDF, DOCX → PDF, PDF → DOCX, Images → DOCX
- sharp for image processing
- pdf-lib for PDF generation
- mammoth + PDFKit as LibreOffice fallback for DOCX → PDF
- Multer for file uploads with drag-and-drop frontend
- SortableJS for image reordering
- XHR upload progress bar
- Auto-deletion of files after 15-minute TTL
- Dark/light theme toggle
