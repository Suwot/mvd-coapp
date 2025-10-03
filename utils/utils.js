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

// Determine log file path with platform-specific defaults and fallbacks
function getLogFilePath() {
    // Check for explicit overrides
    if (process.env.MVD_LOG_FILE) {
        return process.env.MVD_LOG_FILE;
    }
    
    let baseDir;
    const platform = process.platform;
    
    if (platform === 'win32') {
        // Windows: Use ProgramData for system-wide logging (same structure as Program Files)
        const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
        baseDir = path.join(programData, 'MAX Video Downloader CoApp');
    } else if (platform === 'darwin') {
        // macOS: ~/Library/Logs/MAX Video Downloader CoApp
        baseDir = path.join(os.homedir(), 'Library', 'Logs', 'MAX Video Downloader CoApp');
    } else {
        // Linux/Unix: $XDG_STATE_HOME/mvd-coapp (fallback ~/.local/state/mvd-coapp)
        const xdgStateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
        baseDir = path.join(xdgStateHome, 'mvd-coapp');
    }
    
    // Check for directory override
    if (process.env.MVD_LOG_DIR) {
        baseDir = process.env.MVD_LOG_DIR;
    }
    
    // Try to create the directory (always attempt for Windows ProgramData)
    try {
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }
    } catch (err) {
        // Fallback to temp directory
        const fallbackDir = path.join(os.tmpdir(), 'mvd-coapp');
        try {
            if (!fs.existsSync(fallbackDir)) {
                fs.mkdirSync(fallbackDir, { recursive: true });
            }
            baseDir = fallbackDir;
        } catch (fallbackErr) {
            // Last resort: just use temp dir directly
            baseDir = os.tmpdir();
        }
    }
    
    return path.join(baseDir, 'mvdcoapp.log');
}

const LOG_FILE = getLogFilePath();

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
 * Get FFmpeg and FFprobe paths (co-located with executable)
 */
function getFFmpegPaths() {
    const dir = typeof process.pkg !== 'undefined' 
        ? path.dirname(process.execPath)
        : path.dirname(__dirname);
    const ext = process.platform === 'win32' ? '.exe' : '';
    return {
        ffmpegPath: path.join(dir, `ffmpeg${ext}`),
        ffprobePath: path.join(dir, `ffprobe${ext}`)
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
    getFFmpegPaths,
    getFullEnv
};
