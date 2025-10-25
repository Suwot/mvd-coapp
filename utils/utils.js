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
const { spawnSync } = require('child_process');

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

/**
 * Detect available dialog tool on Linux systems
 * @returns {string|null} Tool name or null if none available
 */
function detectDialogTool() {
    if (process.platform !== 'linux') return null;
    
    const candidates = ['zenity', 'kdialog', 'yad', 'qarma'];
    for (const cmd of candidates) {
        try {
            const { status } = spawnSync('which', [cmd], { stdio: 'ignore' });
            if (status === 0) return cmd;
        } catch {} // eslint-disable-line no-empty
    }
    return null;
}

/**
 * Get Linux dialog command for directory or save dialogs
 * @param {string} type - 'directory' or 'save'
 * @param {string} title - Dialog title
 * @param {string} defaultPath - Default path (optional)
 * @param {string} defaultName - Default filename (for save dialogs)
 * @returns {Object} Command object with cmd and args
 */
function getLinuxDialogCommand(type, title, defaultPath, defaultName) {
    const tool = detectDialogTool();
    if (!tool) {
        const error = new Error('File dialog not available on this system/environment');
        error.key = 'noDialogTool';
        throw error;
    }

    // Generate tool-specific arguments
    const args = (() => {
        switch (tool) {
            case 'zenity':
                return type === 'directory' 
                    ? ['--file-selection', '--directory', '--title', title]
                    : ['--file-selection', '--save', '--title', title];
            case 'kdialog':
                return type === 'directory'
                    ? ['--getexistingdirectory']
                    : ['--getsavefilename'];
            case 'yad':
                return type === 'directory'
                    ? ['--file', '--directory', '--title', title]
                    : ['--file', '--save', '--confirm-overwrite', '--title', title];
            case 'qarma':
                return type === 'directory'
                    ? ['--file-selection', '--directory', '--title', title]
                    : ['--file-selection', '--save', '--confirm-overwrite', '--title', title];
        }
    })();

    // Add path/filename
    if (type === 'directory') {
        const dirPath = defaultPath && fs.existsSync(defaultPath) ? defaultPath : require('os').homedir();
        switch (tool) {
            case 'zenity':
            case 'qarma':
                args.push('--filename', dirPath);
                break;
            case 'kdialog':
                args.push(dirPath);
                break;
            case 'yad':
                args.push(`--filename=${dirPath}`);
                break;
        }
    } else { // save dialog
        const filePath = (defaultPath && fs.existsSync(defaultPath)) 
            ? path.join(defaultPath, defaultName)
            : defaultName;
        
        switch (tool) {
            case 'zenity':
            case 'qarma':
                args.push('--filename', filePath);
                break;
            case 'kdialog':
                args.push(filePath, title);
                break;
            case 'yad':
                args.push(`--filename=${filePath}`);
                break;
        }
    }

    return { cmd: tool, args };
}

/**
 * Get Linux modal dialog command for info/question dialogs
 * @param {string} type - 'info' or 'question'
 * @param {string} text - Dialog text content
 * @param {string} title - Dialog title
 * @returns {Object} Command object with cmd and args
 */
function getLinuxModalCommand(type, text, title) {
    const tool = detectDialogTool();
    if (!tool) {
        return null; // No GUI tool available, will fall back to console
    }

    const args = (() => {
        switch (tool) {
            case 'zenity':
                if (type === 'info') {
                    return ['--info', '--text=' + text, '--title=' + title, '--width=350'];
                } else { // question
                    return ['--question', '--text=' + text, '--title=' + title, '--ok-label=OK', '--cancel-label=Uninstall', '--width=350'];
                }
            case 'kdialog':
                if (type === 'info') {
                    return ['--msgbox', text, '--title', title];
                } else { // question
                    return ['--yesno', text, '--title', title, '--yes-label', 'OK', '--no-label', 'Uninstall'];
                }
            case 'yad':
                if (type === 'info') {
                    return ['--info', '--text=' + text, '--title=' + title, '--button=OK:0', '--width=350'];
                } else { // question
                    return ['--question', '--text=' + text, '--title=' + title, '--button=Uninstall:1', '--button=OK:0', '--width=350'];
                }
            case 'qarma':
                if (type === 'info') {
                    return ['--messagebox', '--text=' + text, '--title=' + title, '--width=350'];
                } else { // question
                    return ['--messagebox', '--text=' + text, '--title=' + title, '--button=Uninstall:1', '--button=OK:0', '--width=350'];
                }
            default:
                return null;
        }
    })();

    return { cmd: tool, args };
}

module.exports = {
    logDebug,
    LOG_FILE,
    TEMP_DIR,
    getFFmpegPaths,
    getFullEnv,
    detectDialogTool,
    getLinuxDialogCommand,
    getLinuxModalCommand
};
