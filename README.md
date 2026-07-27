# 🚀 Smart File Converter

A modern, production-ready file converter web application built with Node.js, Express, and a glassmorphism dark-theme frontend.

---

## ✅ Features

| Feature | Status |
|---|---|
| Drag & Drop Upload | ✅ |
| Multiple File Upload (up to 100) | ✅ |
| Images → PDF | ✅ |
| PDF → DOCX | ✅ |
| DOCX → PDF | ✅ |
| Images → DOCX | ✅ |
| Image Preview Thumbnails | ✅ |
| Drag-to-Reorder Images | ✅ |
| Auto Download After Convert | ✅ |
| Progress Bar During Upload | ✅ |
| Toast Notifications | ✅ |
| Corrupted File Recovery | ✅ |
| Magic Byte File Validation | ✅ |
| File Size Limit (100MB) | ✅ |
| Auto-Delete Temp Files (15min) | ✅ |
| Dark / Light Mode | ✅ |
| **Compress Image to Exact KB/MB** | ✅ |
| **Mobile Responsive (Touch-Optimised)** | ✅ |
| Error Handling | ✅ |

---

## 📱 Mobile UX

SmartConvert is fully optimised for mobile browsers (tested at 375px iPhone SE and 360px Android):

| UX Concern | Implementation |
|---|---|
| Touch targets | All tappable elements ≥ 44×44px (Apple/Google guideline) |
| iOS auto-zoom prevention | All `<input>` and `<select>` elements use `font-size: 16px` |
| Nav tabs on mobile | Convert/Compress tabs scroll horizontally — never hidden |
| Drag-to-reorder (SortableJS) | `touch-action: manipulation` on cards; `touch-action: none` during active drag |
| Fat-finger spacing | Minimum 8px gap between all adjacent tappable elements |
| Small-screen custom size row | Stacks to two lines at ≤ 400px viewport width |
| File remove button | Always visible on touch devices (`@media (hover: none)`) |

---

## 📁 Folder Structure

```
smart-file-converter/
├── public/                   # Frontend static files
│   ├── index.html            # Main HTML (UI)
│   ├── css/
│   │   └── style.css         # Glassmorphism dark/light CSS (mobile-optimised)
│   └── js/
│       ├── app.js            # Convert module frontend logic
│       └── compress.js       # Compress module frontend logic
├── routes/                   # Express route handlers
│   ├── upload.js             # POST /upload
│   ├── convert.js            # POST /convert
│   ├── compress.js           # POST /api/compress-image
│   └── download.js           # GET /download/:id
├── utils/                    # Shared utility modules
│   ├── fileValidator.js      # Magic byte validation
│   ├── pdfUtils.js           # PDF operations (repair, merge, convert)
│   ├── imageUtils.js         # Image recovery, DOCX embedding
│   ├── tempDir.js            # Centralised writable temp directory
│   └── cleanup.js            # Auto-delete temp files
├── uploads/                  # Temporary uploaded files (auto-cleaned)
├── converted/                # Temporary converted output (auto-cleaned)
├── server.js                 # Express entry point
├── package.json
├── Dockerfile
├── render.yaml
└── README.md
```

---

## ⚡ Quick Start (Local)

### Prerequisites
- **Node.js v18+** — https://nodejs.org
- **npm** (comes with Node.js)
- Optional: **LibreOffice** (for best DOCX→PDF quality)

### 1. Clone / Download
```bash
git clone https://github.com/kirtan1911/smart-file-converter.git
cd smart-file-converter
```

### 2. Install Dependencies
```bash
npm install
```

> If you get a `sharp` error on Windows, run:
> ```bash
> npm install --ignore-scripts
> npm rebuild sharp
> ```

### 3. Start the Server
```bash
npm start
```

### 4. Open in Browser
```
http://localhost:3000
```

### Development Mode (auto-restart on changes)
```bash
npm run dev
```

---

## 🛠 VS Code Setup

1. **Open the project folder** in VS Code
2. Install recommended extensions:
   - **ESLint** — `dbaeumer.vscode-eslint`
   - **Prettier** — `esbenp.prettier-vscode`
   - **REST Client** — `humao.rest-client` (for testing API)
3. Open **integrated terminal** (`Ctrl + ~`) and run `npm install`
4. Press **F5** to debug, or `npm run dev` in terminal

---

## 🔌 API Reference

### `POST /upload`
Upload one or more files.

**Form Data:**
```
files: [File, File, ...]
```

**Response:**
```json
{
  "success": true,
  "message": "2 file(s) uploaded successfully.",
  "files": [
    {
      "originalname": "photo.jpg",
      "filename": "1718000000_abc123.jpg",
      "mimeType": "image/jpeg",
      "size": 204800,
      "isImage": true,
      "thumbnail": "data:image/jpeg;base64,...",
      "valid": true
    }
  ]
}
```

### `POST /convert`
Convert uploaded files.

**Request Body (JSON):**
```json
{
  "type": "images-to-pdf",
  "files": [
    { "filename": "1718000000_abc.jpg", "originalname": "photo.jpg", "mimeType": "image/jpeg" }
  ],
  "order": [0, 1, 2]
}
```

### `POST /api/compress-image`
Compress an image to a target file size.

**Form Data:**
```
image:        File          (JPG / PNG / WebP, max 25 MB)
targetSize:   number        (e.g. 50)
unit:         "KB" | "MB"
outputFormat: "original" | "jpeg" | "png" | "webp"
```

**Response:** Binary image stream with headers:
```
X-Compress-ActualBytes    — resulting file size in bytes
X-Compress-OriginalBytes  — original file size in bytes
X-Compress-WasExact       — "1" if target was hit exactly
X-Compress-Extension      — output extension (.jpg / .png / .webp)
X-Compress-Note           — warning if target was unreachable
```

### `GET /download/:downloadId?name=filename.pdf`
Stream the converted file for download.

---

## 🔒 Corrupted File Handling

| Scenario | Behavior |
|---|---|
| Corrupted PDF | Attempts repair via pdf-lib before converting |
| Corrupted image | Sharp attempts recovery; skips if unrecoverable |
| Wrong extension | Magic byte validation rejects the file with a user-friendly error |
| Empty file | Rejected immediately with error |
| File too large | Rejected before upload (100MB limit) |
| Server crash | Startup cleanup removes stale files from previous session |

---

## 🌍 Deployment

### Option A: Render.com (Docker — Recommended)

1. Push your project to GitHub
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Runtime:** Docker
   - **Environment:** `NODE_ENV=production`
5. Click **Deploy**
6. Live URL: https://smart-file-converter-45kw.onrender.com/

> ⚠️ Note: Free Render instances sleep after 15min inactivity. Upgrade to `starter` plan for always-on.

### Option B: Railway.app

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### Option C: VPS / DigitalOcean

```bash
# On your server:
git clone https://github.com/kirtan1911/smart-file-converter.git
cd smart-file-converter
npm install

# Install PM2 for process management
npm install -g pm2
pm2 start server.js --name smart-file-converter
pm2 save
pm2 startup
```

---

## 🐛 Troubleshooting

| Problem | Solution |
|---|---|
| `sharp` install fails | Run `npm rebuild sharp` or check Node version ≥18 |
| `DOCX→PDF` looks plain | Install LibreOffice: `sudo apt install libreoffice` |
| Upload fails 413 error | Express body limit hit; check `express.json` limit in `server.js` |
| Port 3000 already in use | Change `PORT` in server.js or set `PORT=3001 npm start` |
| Files not deleting | Check write permissions on `uploads/` and `converted/` folders |
| `Cannot find module` | Run `npm install` again |
| Compress fails on Render | Ensure sharp rebuilt for Linux: `npm rebuild sharp` in Dockerfile |

---

## 📦 Dependencies

| Package | Purpose |
|---|---|
| `express` | Web server |
| `multer` | File upload handling |
| `pdf-lib` | PDF creation, reading, repair |
| `pdfkit` | PDF generation from text |
| `mammoth` | DOCX text extraction |
| `docx` | DOCX file creation |
| `sharp` | Image processing, compression & recovery |
| `libreoffice-convert` | High-quality DOCX↔PDF |
| `file-type` | Magic byte file validation |
| `fs-extra` | Enhanced file system operations |
| `cors` | Cross-Origin Resource Sharing |

---

## 📄 License

MIT — Use freely for personal and commercial projects.

---

Built with ❤️ by [Kirtan Barot](https://github.com/kirtan1911)
