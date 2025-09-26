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
        // Windows: Same directory as mvdcoapp.exe (respects user's installation choice)
        baseDir = path.dirname(process.execPath);
    } else if (platform === 'darwin') {
        // macOS: ~/Library/Logs/MAX Video Downloader CoApp
        baseDir = path.join(os.homedir(), 'Library', 'Logs', 'MAX Video Downloader CoApp');
    } else {
        // Linux/Unix: $XDG_STATE_HOME/mvd-coapp/logs (fallback ~/.local/state/mvd-coapp/logs)
        const xdgStateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
        baseDir = path.join(xdgStateHome, 'mvd-coapp', 'logs');
    }
    
    // Check for directory override
    if (process.env.MVD_LOG_DIR) {
        baseDir = process.env.MVD_LOG_DIR;
    }
    
    // Try to create the directory (skip for Windows exe dir, assume it's writable)
    if (platform !== 'win32') {
        try {
            if (!fs.existsSync(baseDir)) {
                fs.mkdirSync(baseDir, { recursive: true });
            }
        } catch (err) {
            // Fallback to temp directory
            const fallbackDir = path.join(os.tmpdir(), 'mvd-coapp', 'logs');
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
    }
    
    return path.join(baseDir, 'mvdcoapp.log');
}

const LOG_FILE = getLogFilePath();

function logDebug(...args) {
    try {
        const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg) : arg
        ).join(' ');
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
