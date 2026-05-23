/**
 * cleanup.js
 * Auto-deletes temporary uploaded and converted files after a delay
 * Prevents disk space from filling up over time
 */

const fs = require('fs-extra');
const path = require('path');

// Delete files after 15 minutes (in ms)
const FILE_TTL = 15 * 60 * 1000;

/**
 * Schedules a file for deletion after FILE_TTL milliseconds
 * @param {string|string[]} filePaths - File path(s) to delete
 * @param {number} delay - Optional custom delay in ms
 */
function scheduleDelete(filePaths, delay = FILE_TTL) {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];

  setTimeout(async () => {
    for (const filePath of paths) {
      try {
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
          console.log(`[Cleanup] Deleted: ${path.basename(filePath)}`);
        }
      } catch (err) {
        console.warn(`[Cleanup] Could not delete ${filePath}: ${err.message}`);
      }
    }
  }, delay);
}

/**
 * Immediately deletes a list of files (best-effort, no throw)
 * @param {string|string[]} filePaths
 */
async function deleteNow(filePaths) {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  for (const filePath of paths) {
    try {
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
        console.log(`[Cleanup] Immediately deleted: ${path.basename(filePath)}`);
      }
    } catch (err) {
      console.warn(`[Cleanup] Could not immediately delete ${filePath}: ${err.message}`);
    }
  }
}

/**
 * Cleans up old files in uploads/ and converted/ directories on server start
 * Removes any files older than FILE_TTL that survived a previous crash
 */
async function cleanupOldFiles(uploadsDir, convertedDir) {
  const dirsToClean = [uploadsDir, convertedDir];
  const cutoff = Date.now() - FILE_TTL;

  for (const dir of dirsToClean) {
    try {
      if (!(await fs.pathExists(dir))) continue;
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file === '.gitkeep') continue;
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);
        if (stat.mtimeMs < cutoff) {
          await fs.remove(filePath);
          console.log(`[Cleanup] Startup cleanup removed old file: ${file}`);
        }
      }
    } catch (err) {
      console.warn(`[Cleanup] Error cleaning ${dir}: ${err.message}`);
    }
  }
}

module.exports = { scheduleDelete, deleteNow, cleanupOldFiles };
