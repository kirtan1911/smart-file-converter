/**
 * server.js
 * Smart File Converter
 * Fully Production Ready
 * Optimized for Render / Railway / Docker
 */

'use strict';

// ═══════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════

const express = require('express');

const cors = require('cors');

const helmet = require('helmet');

const compression = require('compression');

const path = require('path');

const fs = require('fs-extra');

require('dotenv').config();

// ═══════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════

const uploadRouter =
  require('./routes/upload');

const convertRouter =
  require('./routes/convert');

const downloadRouter =
  require('./routes/download');

const {
  cleanupOldFiles
} = require('./utils/cleanup');

// ═══════════════════════════════════════
// APP
// ═══════════════════════════════════════

const app = express();

const PORT =
  process.env.PORT || 3000;

// ═══════════════════════════════════════
// PATHS
// ═══════════════════════════════════════

const ROOT_DIR = __dirname;

const PUBLIC_DIR =
  path.join(ROOT_DIR, 'public');

const UPLOADS_DIR =
  path.join(ROOT_DIR, 'uploads');

const CONVERTED_DIR =
  path.join(ROOT_DIR, 'converted');

// ═══════════════════════════════════════
// ENSURE DIRECTORIES EXIST
// ═══════════════════════════════════════

fs.ensureDirSync(PUBLIC_DIR);

fs.ensureDirSync(UPLOADS_DIR);

fs.ensureDirSync(CONVERTED_DIR);

// create .gitkeep automatically if missing
const ensureGitkeep = async dir => {

  const gitkeep =
    path.join(dir, '.gitkeep');

  if (!(await fs.pathExists(gitkeep))) {

    await fs.writeFile(gitkeep, '');

  }

};

ensureGitkeep(UPLOADS_DIR);

ensureGitkeep(CONVERTED_DIR);

// ═══════════════════════════════════════
// TRUST PROXY
// Required for Render / Railway / Nginx
// ═══════════════════════════════════════

app.set('trust proxy', 1);

// ═══════════════════════════════════════
// REQUEST TIMEOUT FIX
// Prevent Render timeout issues
// ═══════════════════════════════════════

app.use((req, res, next) => {

  req.setTimeout(
    10 * 60 * 1000
  );

  res.setTimeout(
    10 * 60 * 1000
  );

  next();

});

// ═══════════════════════════════════════
// SECURITY
// ═══════════════════════════════════════

app.use(
  helmet({

    crossOriginResourcePolicy: false,

    contentSecurityPolicy: false

  })
);

app.use(
  cors({

    origin: true,

    credentials: true

  })
);

app.use(compression());

// ═══════════════════════════════════════
// BODY PARSER
// ═══════════════════════════════════════

app.use(
  express.json({

    limit: '100mb'

  })
);

app.use(
  express.urlencoded({

    extended: true,

    limit: '100mb'

  })
);

// ═══════════════════════════════════════
// STATIC FILES
// ═══════════════════════════════════════

app.use(
  express.static(PUBLIC_DIR, {

    maxAge: '1d',

    etag: true

  })
);

app.use(
  '/css',
  express.static(
    path.join(PUBLIC_DIR, 'css')
  )
);

app.use(
  '/js',
  express.static(
    path.join(PUBLIC_DIR, 'js')
  )
);

app.use(
  '/images',
  express.static(
    path.join(PUBLIC_DIR, 'images')
  )
);

// uploads access
app.use(
  '/uploads',
  express.static(UPLOADS_DIR)
);

// converted access
app.use(
  '/converted',
  express.static(CONVERTED_DIR)
);

// ═══════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════

app.use(
  '/upload',
  uploadRouter
);

app.use(
  '/convert',
  convertRouter
);

app.use(
  '/download',
  downloadRouter
);

// ═══════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════

app.get('/health', async (req, res) => {

  try {

    const uploadsExists =
      await fs.pathExists(
        UPLOADS_DIR
      );

    const convertedExists =
      await fs.pathExists(
        CONVERTED_DIR
      );

    return res.status(200).json({

      success: true,

      status: 'ok',

      uploadsDir:
        uploadsExists,

      convertedDir:
        convertedExists,

      uptime:
        process.uptime(),

      timestamp:
        new Date().toISOString(),

      memory:
        process.memoryUsage()

    });

  } catch (err) {

    return res.status(500).json({

      success: false,

      error: err.message

    });

  }

});

// ═══════════════════════════════════════
// ROOT ROUTE
// ═══════════════════════════════════════

app.get('/', (req, res) => {

  return res.sendFile(
    path.join(
      PUBLIC_DIR,
      'index.html'
    )
  );

});

// ═══════════════════════════════════════
// 404 API HANDLER
// ═══════════════════════════════════════

app.use('/api', (req, res) => {

  return res.status(404).json({

    success: false,

    error:
      'API route not found.'

  });

});

// ═══════════════════════════════════════
// SPA FALLBACK
// ═══════════════════════════════════════

app.get('*', (req, res) => {

  if (

    req.path.startsWith('/upload') ||

    req.path.startsWith('/convert') ||

    req.path.startsWith('/download')

  ) {

    return res.status(404).json({

      success: false,

      error: 'Route not found.'

    });

  }

  return res.sendFile(
    path.join(
      PUBLIC_DIR,
      'index.html'
    )
  );

});

// ═══════════════════════════════════════
// GLOBAL ERROR HANDLER
// ═══════════════════════════════════════

app.use((err, req, res, next) => {

  console.error(
    '\n[SERVER ERROR]',
    new Date().toISOString(),
    '\n',
    err
  );

  // multer file size
  if (
    err.code ===
    'LIMIT_FILE_SIZE'
  ) {

    return res.status(400).json({

      success: false,

      error:
        'File too large. Maximum allowed size is 100MB.'

    });

  }

  // too many files
  if (
    err.code ===
    'LIMIT_FILE_COUNT'
  ) {

    return res.status(400).json({

      success: false,

      error:
        'Maximum 100 files allowed.'

    });

  }

  return res.status(500).json({

    success: false,

    error:
      process.env.NODE_ENV ===
      'production'
        ? 'Internal server error.'
        : err.message

  });

});

// ═══════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════

const server =
  app.listen(PORT, async () => {

    console.log(
      '\n═══════════════════════════════════════'
    );

    console.log(
      '🚀 Smart File Converter Started'
    );

    console.log(
      `🌍 Port: ${PORT}`
    );

    console.log(
      `📂 Uploads: ${UPLOADS_DIR}`
    );

    console.log(
      `📂 Converted: ${CONVERTED_DIR}`
    );

    console.log(
      `🔗 http://localhost:${PORT}`
    );

    console.log(
      '═══════════════════════════════════════\n'
    );

    try {

      await cleanupOldFiles(
        UPLOADS_DIR,
        CONVERTED_DIR
      );

      console.log(
        '🧹 Old temp files cleaned.'
      );

    } catch (cleanupErr) {

      console.error(
        '[Cleanup Error]',
        cleanupErr.message
      );

    }

  });

// ═══════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════

function shutdown(signal) {

  console.log(
    `\n🛑 ${signal} received. Shutting down...`
  );

  server.close(() => {

    console.log(
      '✅ Server closed gracefully.'
    );

    process.exit(0);

  });

}

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);

// ═══════════════════════════════════════
// UNHANDLED ERRORS
// ═══════════════════════════════════════

process.on(
  'unhandledRejection',
  reason => {

    console.error(
      '[Unhandled Rejection]',
      reason
    );

  }
);

process.on(
  'uncaughtException',
  err => {

    console.error(
      '[Uncaught Exception]',
      err
    );

  }
);

// ═══════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════

module.exports = app;