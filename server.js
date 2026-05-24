/**
 * server.js
 * Smart File Converter
 * Fully Production Optimized
 */

'use strict';

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

// ensure folders exist
fs.ensureDirSync(PUBLIC_DIR);

fs.ensureDirSync(UPLOADS_DIR);

fs.ensureDirSync(CONVERTED_DIR);

// ═══════════════════════════════════════
// TRUST PROXY
// Required for Render / Railway / Nginx
// ═══════════════════════════════════════

app.set('trust proxy', 1);

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
    limit: '500mb'
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '500mb'
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

// optional direct mappings
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

// ═══════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════

app.use('/upload', uploadRouter);

app.use('/convert', convertRouter);

app.use('/download', downloadRouter);

// ═══════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════

app.get('/health', (req, res) => {

  return res.status(200).json({

    success: true,

    status: 'ok',

    uptime:
      process.uptime(),

    timestamp:
      new Date().toISOString(),

    memory: process.memoryUsage()

  });

});

// ═══════════════════════════════════════
// ROOT ROUTE
// ═══════════════════════════════════════

app.get('/', (req, res) => {

  return res.sendFile(
    path.join(PUBLIC_DIR, 'index.html')
  );

});

// ═══════════════════════════════════════
// 404 API HANDLER
// ═══════════════════════════════════════

app.use('/api', (req, res) => {

  return res.status(404).json({

    success: false,

    error: 'API route not found.'

  });

});

// ═══════════════════════════════════════
// SPA FALLBACK
// Only for frontend routes
// ═══════════════════════════════════════

app.get('*', (req, res) => {

  // avoid interfering with APIs
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
    path.join(PUBLIC_DIR, 'index.html')
  );

});

// ═══════════════════════════════════════
// GLOBAL ERROR HANDLER
// ═══════════════════════════════════════

app.use((err, req, res, next) => {

  console.error(
    '[Server Error]',
    new Date().toISOString(),
    err
  );

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
        '🧹 Temporary files cleaned.'
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