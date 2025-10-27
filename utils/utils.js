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

// Core directories - simple and universal across all OSes
const TEMP_DIR = path.join(os.tmpdir(), 'mvdcoapp');
const LOG_FILE = path.join(TEMP_DIR, 'mvdcoapp.log');

// Ensure temp directory exists
try {
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
} catch (err) {
    // If directory creation fails, continue with fallback behavior
}

function logDebug(...args) {
    try {
        // Check for log rotation (rotate at 10MB)
        try {
            const stats = fs.statSync(LOG_FILE);
            if (stats.size > 10 * 1024 * 1024) { // 10MB
                const backupFile = `${LOG_FILE}.1`;
                try {
                    fs.renameSync(LOG_FILE, backupFile);
                } catch (rotateErr) {
                    // If rotation fails, truncate the current file
                    fs.truncateSync(LOG_FILE, 0);
                }
            }
        } catch (statErr) {
            // File doesn't exist yet, that's fine
        }
        
        // Safer stringify with circular reference protection
        const message = args.map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                try {
                    // Use a WeakSet to track circular references without mutation
                    const seen = new WeakSet();
                    return JSON.stringify(arg, (key, value) => {
                        if (typeof value === 'object' && value !== null) {
                            if (seen.has(value)) {
                                return '[Circular]';
                            }
                            seen.add(value);
                        }
                        return value;
                    });
                } catch (jsonErr) {
                    return `[Object: ${jsonErr.message}]`;
                }
            }
            return arg;
        }).join(' ');
        
        fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} - ${message}\n`);
    } catch (err) {
        // Silently drop log lines if writing fails (disk full, permissions, etc.)
        // This prevents logging from crashing the process
    }
}

/**
 * Get binary paths (co-located with executable)
 */
function getBinaryPaths() {
    const dir = typeof process.pkg !== 'undefined' 
        ? path.dirname(process.execPath)
        : path.dirname(__dirname);
    const ext = process.platform === 'win32' ? '.exe' : '';
    return {
        ffmpegPath: path.join(dir, `ffmpeg${ext}`),
        ffprobePath: path.join(dir, `ffprobe${ext}`),
        fileuiPath: process.platform === 'win32' ? path.join(dir, `mvd-fileui${ext}`) : null
    };
}

/**
 * Get enhanced environment with common system paths
 */
function getFullEnv() {
    const extraPaths = [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin'
    ];
    
    const pathDelimiter = process.platform === 'win32' ? ';' : ':';
    const pathValue = extraPaths.join(pathDelimiter);
    
    return {
        ...process.env,
        PATH: `${pathValue}${pathDelimiter}${process.env.PATH || ''}`
    };
}

module.exports = {
    logDebug,
    LOG_FILE,
    TEMP_DIR,
    getBinaryPaths,
    getFullEnv
};
