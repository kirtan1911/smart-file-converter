# ============================================================
# Smart File Converter — Production Dockerfile
# ============================================================
#
# WHY node:20-bookworm-slim (Debian 12):
#   - Render's Docker runtime is Linux/amd64 (Debian-based).
#   - Bookworm is the current Debian stable, so apt packages
#     (especially libreoffice) are available and up-to-date.
#   - "slim" omits man pages and docs, keeping the image smaller.
#   - Node 20 LTS has Long-Term Support until April 2026.
#
# WHY NOT the "node" Render runtime:
#   Render's built-in Node runtime is a pre-baked environment.
#   You CANNOT run apt-get in it, so LibreOffice can NEVER be
#   installed. Docker is the ONLY way to get soffice on Render.
# ============================================================

FROM node:20-bookworm-slim

# ── Metadata ─────────────────────────────────────────────────
LABEL maintainer="Smart File Converter"
LABEL description="Node.js file converter with LibreOffice + sharp on Render"

# ── [RENDER FIX #1] Install LibreOffice + system dependencies ─
#
# WHY EACH PACKAGE:
#   libreoffice        → provides the `soffice` binary required by
#                        libreoffice-convert npm package. Without this,
#                        every docx-to-pdf conversion returns a 500 error
#                        with "spawn soffice ENOENT" in Render logs.
#
#   libvips-dev        → native C library that sharp (image processing)
#                        links against. Sharp has TWO modes:
#                          a) Prebuilt binary (fast, no compile needed)
#                          b) Build from source via node-gyp (needs libvips)
#                        We need libvips installed so that if the prebuilt
#                        binary doesn't match, npm rebuild sharp can compile.
#
#   python3 make g++   → node-gyp build tools. Required to compile sharp's
#                        native C++ addon when prebuilt binaries don't match
#                        the exact Node ABI + OS combination.
#
#   ca-certificates    → TLS root certs. Required for HTTPS requests at
#                        runtime (npm registry, any external API calls).
#
#   curl               → Used by the Docker HEALTHCHECK CMD below.
#
#   dumb-init          → Proper PID 1 for Node inside Docker.
#                        WHY: Docker containers run the CMD as PID 1.
#                        Node is NOT designed to be PID 1 — it doesn't
#                        reap zombie child processes (LibreOffice spawns
#                        subprocesses). dumb-init acts as a proper init,
#                        forwards signals (SIGTERM for graceful shutdown),
#                        and reaps zombies.
#
# WHY --no-install-recommends:
#   Prevents apt from installing hundreds of optional packages
#   (e.g., LibreOffice extensions, fonts, spell-checkers).
#   Reduces image size by ~500MB.
#
# WHY clean in the SAME RUN layer:
#   Docker builds a new filesystem layer per RUN command.
#   If we clean in a separate RUN, the apt cache is still baked
#   into the previous layer. Cleaning in the same RUN keeps it out.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    libvips-dev \
    python3 \
    make \
    g++ \
    ca-certificates \
    curl \
    dumb-init \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── [RENDER FIX #1] Verify LibreOffice is on PATH ─────────────
# WHY: Fail fast at BUILD time, not silently at runtime.
# If libreoffice package didn't install correctly, this line
# causes the Docker build to fail with a clear error in Render's
# build log instead of mysteriously failing at conversion time.
RUN soffice --version && echo "✅ LibreOffice installed successfully"

# ── Working directory ─────────────────────────────────────────
WORKDIR /app

# ── [RENDER FIX #4] Layer-cache optimization ──────────────────
# WHY copy package*.json BEFORE source code:
#   Docker re-runs layers only when their inputs change.
#   package.json rarely changes; source code changes often.
#   By copying package manifests first, npm ci is cached and
#   NOT re-run on every code change — only on dependency changes.
#   This cuts Render build time from ~3min to ~20s for code-only changes.
COPY package*.json ./

# ── [RENDER FIX #4] Install Node dependencies ─────────────────
#
# WHY npm ci (not npm install):
#   npm ci reads package-lock.json EXACTLY. This means:
#     - Same versions on local and Render (no "works on my machine")
#     - Fails if lock file is out of sync (catches mistakes early)
#     - Faster than npm install (skips dependency resolution)
#
# WHY --omit=dev:
#   nodemon, jest, and other dev tools are NOT needed in production.
#   Omitting them saves ~100MB and reduces attack surface.
#
# WHY NOT --platform=linux here:
#   We're already inside a Linux container. The `--platform` flag
#   is only needed when cross-compiling (e.g., on macOS building
#   for Linux). Inside the container, npm/node-gyp auto-detect Linux.
RUN npm ci --omit=dev

# ── [RENDER FIX #4] Rebuild sharp for Linux ───────────────────
#
# THE PROBLEM:
#   package-lock.json was generated on Windows (your dev machine).
#   npm stores the resolved prebuilt binary URL for Windows (win32-x64).
#   When npm ci runs on Linux, it may download the wrong binary OR
#   the prebuilt binary for a different glibc version.
#
# SYMPTOMS WITHOUT THIS FIX:
#   Error: Could not load the sharp module using the linux-x64 runtime
#   Error: sharp is installed, but requires a different version of Node
#
# THE FIX:
#   npm rebuild sharp tells npm to:
#     1. Check if the installed sharp binary matches current OS/Node/ABI
#     2. If not, download the correct prebuilt linux-x64 binary
#     3. If no prebuilt exists, compile from source using libvips-dev
#   This GUARANTEES sharp works correctly inside the Render container.
RUN npm rebuild sharp --verbose

# ── Copy application source ───────────────────────────────────
# WHY after npm ci:
#   Source changes don't invalidate the npm ci cache layer.
#   See layer-cache comment above.
COPY . .

# ── [RENDER FIX #2] Create writable temp directories ──────────
#
# THE PROBLEM:
#   Render's Docker containers mount /app from the image (read-only).
#   Writing files to /app/uploads or /app/converted throws:
#     EACCES: permission denied
#     EROFS: read-only file system
#
# THE FIX:
#   /tmp is ALWAYS writable in Docker containers, regardless of the
#   image filesystem being read-only. Our tempDir.js uses os.tmpdir()
#   which returns /tmp on Linux → /tmp/sfc_uploads and /tmp/sfc_converted.
#
# WHY create them here in the Dockerfile:
#   So the directories exist immediately on container start, before
#   the Node process runs. The app also calls fs.ensureDirSync() at
#   boot for extra robustness.
RUN mkdir -p /tmp/sfc_uploads /tmp/sfc_converted

# ── Non-root user for security ────────────────────────────────
#
# WHY not root:
#   Running as root in a container is a security risk. If any
#   vulnerability (e.g., in LibreOffice or a malicious file) allows
#   code execution, root gives full container access.
#
# WHY node:node (uid 1000):
#   The node:20 base image ships with a "node" user (uid/gid 1000).
#   We chown /app and /tmp dirs to this user before switching.
#
# IMPORTANT: chown /tmp subdirs too, because mkdir creates them as
#   root (before USER node). Without chown, the node user cannot
#   write to /tmp/sfc_uploads at runtime.
RUN chown -R node:node /app /tmp/sfc_uploads /tmp/sfc_converted
USER node

# ── [RENDER FIX #3] Expose port ───────────────────────────────
# WHY 3000:
#   This is the default port. Render OVERRIDES this with the $PORT
#   environment variable at runtime (usually 10000 on Render).
#   Our server.js reads: process.env.PORT || 3000
#   So EXPOSE here is documentation only — Render uses $PORT.
EXPOSE 3000

# ── Health check ──────────────────────────────────────────────
# WHY this matters:
#   Render pings your /health endpoint to determine container health.
#   If /health returns non-2xx, Render marks the instance unhealthy
#   and may restart it. The Docker HEALTHCHECK below also validates
#   this during `docker run` locally.
#
# WHY --start-period=60s:
#   LibreOffice loads shared libraries on first startup which takes
#   10-30s. Without start-period, the health check fires before the
#   app is ready and Docker marks it unhealthy immediately.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# ── [RENDER FIX] Start command with dumb-init ─────────────────
#
# WHY dumb-init (not just node):
#   Without dumb-init, Node IS PID 1 in the container.
#   PID 1 has special responsibilities:
#     1. It must forward signals to child processes (LibreOffice, sharp)
#     2. It must reap zombie child processes
#   Plain Node does NOT do these things correctly as PID 1.
#
#   When Render deploys a new version, it sends SIGTERM to the container.
#   Without dumb-init, Node may ignore or mishandle SIGTERM and get
#   force-killed after 30s, dropping in-flight conversion requests.
#
#   dumb-init:
#     - Forwards ALL signals (SIGTERM, SIGINT, SIGHUP) to Node
#     - Reaps zombie processes spawned by LibreOffice/soffice
#     - Allows our graceful shutdown handler in server.js to run cleanly
CMD ["dumb-init", "node", "server.js"]