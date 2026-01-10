import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { 
    TEMP_DIR, LOG_FILE, BINARIES, IS_WINDOWS, LOG_MAX_SIZE, LOG_KEEP_SIZE,
    INVALID_FILENAME_CHARS, WINDOWS_RESERVED_NAMES, APP_VERSION 
} from './config';

export { TEMP_DIR, LOG_FILE };

let logCounter = 0;

/**
 * Simplified Logger - Persistent append-only diagnostics
 */
export function logDebug(...args) {
    try {
        // Sliding window cleanup - only check every 100 calls for performance
        if (++logCounter % 100 === 0) {
            try {
                const stats = fs.statSync(LOG_FILE);
                if (stats.size > LOG_MAX_SIZE) {
                    const buffer = Buffer.alloc(LOG_KEEP_SIZE);
                    const fd = fs.openSync(LOG_FILE, 'r');
                    fs.readSync(fd, buffer, 0, LOG_KEEP_SIZE, stats.size - LOG_KEEP_SIZE);
                    fs.closeSync(fd);
                    const start = Math.max(0, buffer.indexOf(10) + 1);
                    fs.writeFileSync(LOG_FILE, buffer.slice(start));
                }
            } catch { /* ignore */ }
        }

        const message = args.map(arg => {
            if (typeof arg !== 'object' || arg === null) return String(arg);
            try {
                const seen = new WeakSet();
                return JSON.stringify(arg, (k, v) => {
                    if (typeof v === 'object' && v !== null) {
                        if (seen.has(v)) return '[Circular]';
                        seen.add(v);
                    }
                    return v;
                });
            } catch { return '[Object]'; }
        }).join(' ');

        fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} - ${message}\n`);
    } catch { /* ignore */ }
}

/**
 * Reports current log statistics to the extension
 */
export function reportLogStatus(responder) {
    try {
        const stats = fs.statSync(LOG_FILE);
        responder.send({
            command: 'log-status',
            logFileSize: stats.size,
            logFile: LOG_FILE,
            logsFolder: TEMP_DIR
        });
    } catch { /* ignore */ }
}

/**
 * Check if required binaries are present.
 * If name is provided, returns the path or throws CoAppError.
 * If no name is provided, returns a status object for all platform-specific binaries.
 */
export function checkBinaries(name) {
    if (name) {
        const binaryPath = BINARIES[name];
        if (binaryPath && fs.existsSync(binaryPath)) return binaryPath;
        throw new CoAppError(`${name} not found, please reinstall`, 'binaryNotFound', [name]);
    }

    const missing = Object.keys(BINARIES).filter(k => BINARIES[k] && !fs.existsSync(BINARIES[k]));
    if (missing.length > 0) {
        const namesStr = missing.join(', ');
        return {
            success: false,
            error: `${namesStr} not found, please reinstall`,
            key: 'binaryNotFound',
            substitutions: [namesStr]
        };
    }
    return { success: true };
}

/**
 * Get unified connection and system information
 */
export function getConnectionInfo() {
    let logFileSize = 0;
    try {
        if (fs.existsSync(LOG_FILE)) logFileSize = fs.statSync(LOG_FILE).size;
    } catch { /* ignore */ }

    return {
        command: 'validateConnection',
        alive: true,
        success: true,
        version: APP_VERSION,
        location: process.execPath,
        ffmpegVersion: 'n8.0.1-1.8.1',
        arch: process.arch,
        platform: process.platform,
        osRelease: os.release(),
        osVersion: typeof os.version === 'function' ? os.version() : os.release(), // type check for older node support
        pid: process.pid,
        lastValidation: Date.now(),
        logsFolder: TEMP_DIR,
        logFile: LOG_FILE,
        logFileSize,
        capabilities: ['download-v2', 'cancel-download-v2', 'fileSystem', 'kill-processing', 'runTool', 'get-disk-space']
    };
}

/**
 * High-priority startup event - records entry arguments
 */
export function logStartup() {
    logDebug(`[BOOT] PID: ${process.pid} | platform: ${process.platform} | argv: ${JSON.stringify(process.argv)}`);
}

/**
 * Get enhanced environment with common system paths
 */
export function getFullEnv() {
    const extraPaths = IS_WINDOWS 
        ? [] 
        : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
    
    const pathDelimiter = IS_WINDOWS ? ';' : ':';
    const pathValue = extraPaths.join(pathDelimiter);
    
    return {
        ...process.env,
        PATH: `${pathValue}${pathDelimiter}${process.env.PATH || ''}`
    };
}

/**
 * Normalize path for Windows FS operations (long path support)
 */
export function normalizeForFsWindows(filePath) {
    if (!IS_WINDOWS) return filePath;
    const abs = path.resolve(filePath);
    if (abs.startsWith('\\\\?\\')) return abs;
    if (abs.length <= 240) return abs;

    if (abs.startsWith('\\\\')) {
        return '\\\\?\\UNC\\' + abs.slice(2);
    } else {
        return '\\\\?\\' + abs;
    }
}

/**
 * Get free disk space for a specific path using native helper
 */
export function getFreeDiskSpace(targetPath) {
    return new Promise((resolve) => {
        try {
            const diskspacePath = checkBinaries('diskspace');
            
            let pathToCheck = path.parse(path.resolve(targetPath)).root;
            if (IS_WINDOWS && !pathToCheck.startsWith('\\\\')) {
                // Keep as is
            } else {
                pathToCheck = normalizeForFsWindows(pathToCheck);
            }
            
            execFile(diskspacePath, [pathToCheck], (err, stdout) => {
                if (err) return resolve(null);
                const match = stdout?.match(/FREE_BYTES=(\d+)/);
                resolve(match ? parseInt(match[1], 10) : null);
            });
        } catch (error) {
            resolve(null);
        }
    });
}

/**
 * CoApp Error Class
 */
export class CoAppError extends Error {
    constructor(message, key, substitutions = []) {
        super(message);
        this.key = key;
        this.substitutions = substitutions;
    }
}

/**
 * Sanitize filename for cross-platform compatibility
 */
export function sanitizeFilename(filename, fallback, container) {
    const raw = filename?.trim() || fallback || 'output';
    let base = path.basename(raw);
    
    // If container is provided, ensure base doesn't already end with it
    const ext = container ? `.${container.trim().replace(INVALID_FILENAME_CHARS, '')}` : '';
    if (ext) {
        const dotExt = ext.toLowerCase();
        // Strip the extension if it's already there (case-insensitive)
        while (base.toLowerCase().endsWith(dotExt)) {
            base = base.slice(0, -dotExt.length);
        }
    }

    // Remove invalid chars and trim dots/spaces
    base = base.replace(INVALID_FILENAME_CHARS, '').replace(/^[.\s]+|[.\s]+$/g, '');
    if (!base) base = fallback || 'output';
    if (WINDOWS_RESERVED_NAMES.has(base.toUpperCase())) base += '_';
    
    return `${base}${ext}`;
}

/**
 * Ensure filename is unique in directory
 */
export function ensureUniqueFilename(dir, candidate, isPathInUseCallback) {
    const lastDot = candidate.lastIndexOf('.');
    let base, ext;
    
    if (lastDot > 0 && !candidate.slice(lastDot).includes(' ')) {
        base = candidate.slice(0, lastDot);
        ext = candidate.slice(lastDot);
    } else {
        base = candidate;
        ext = '';
    }

    let attempt = 0;
    let candidateName = candidate;
    let fullPath = path.join(dir, candidateName);

    while (fs.existsSync(fullPath) || (isPathInUseCallback && isPathInUseCallback(fullPath))) {
        attempt += 1;
        candidateName = `${base} (${attempt})${ext}`;
        fullPath = path.join(dir, candidateName);
    }
    return candidateName;
}
