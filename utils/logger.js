/**
 * Logger – Simple logging utility for application diagnostics
 * - Provides centralized logging functionality
 * - Creates and manages log file storage
 * - Formats log messages with timestamps
 * - Handles object serialization for logging
 * - Ensures log directory structure exists
 * - Exports consistent logging interface
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Debug logging
const LOG_FILE = path.join(process.env.HOME || os.homedir(), '.cache', 'video-downloader.log');

function ensureLogDirectory() {
    const cacheDir = path.join(process.env.HOME || os.homedir(), '.cache');
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
}

function logDebug(...args) {
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : arg
    ).join(' ');
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} - ${message}\n`);
}

// Initialize log directory at module load
ensureLogDirectory();

module.exports = {
    logDebug,
    LOG_FILE
};
