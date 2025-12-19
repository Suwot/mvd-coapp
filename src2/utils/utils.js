import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { TEMP_DIR, LOG_FILE, BINARIES, IS_WINDOWS, LOG_MAX_SIZE, LOG_KEEP_SIZE } from './config';

export { TEMP_DIR, LOG_FILE };

/**
 * Simplified Logger - Persistent append-only diagnostics
 */
export function logDebug(...args) {
    try {
        // Sliding window: LOG_MAX_SIZE hard limit. 
        // If exceeded, we keep the last LOG_KEEP_SIZE to preserve context without infinite growth.
        try {
            const stats = fs.statSync(LOG_FILE);
            if (stats.size > LOG_MAX_SIZE) {
                const fd = fs.openSync(LOG_FILE, 'r');
                const buffer = Buffer.alloc(LOG_KEEP_SIZE);
                fs.readSync(fd, buffer, 0, LOG_KEEP_SIZE, stats.size - LOG_KEEP_SIZE);
                fs.closeSync(fd);
                
                const newlineOffset = buffer.indexOf(10); // 10 is '\n'
                const start = newlineOffset === -1 ? 0 : newlineOffset + 1;
                fs.writeFileSync(LOG_FILE, buffer.slice(start));
            }
        } catch { /* ignore */ }

        const message = args.map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                try {
                    const seen = new WeakSet();
                    return JSON.stringify(arg, (key, value) => {
                        if (typeof value === 'object' && value !== null) {
                            if (seen.has(value)) return '[Circular]';
                            seen.add(value);
                        }
                        return value;
                    });
                } catch (jsonErr) {
                    return `[Object: ${jsonErr.message}]`;
                }
            }
            return String(arg);
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

export function getBinaryPaths() {
    return {
        ffmpegPath: BINARIES.ffmpeg,
        ffprobePath: BINARIES.ffprobe,
        fileuiPath: BINARIES.fileui,
        diskspacePath: BINARIES.diskspace
    };
}

/**
 * Get free disk space for a specific path using native helper
 */
export function getFreeDiskSpace(targetPath) {
    return new Promise((resolve) => {
        try {
            if (!BINARIES.diskspace || !fs.existsSync(BINARIES.diskspace)) return resolve(null);
            
            let pathToCheck = path.parse(path.resolve(targetPath)).root;
            if (IS_WINDOWS && !pathToCheck.startsWith('\\\\')) {
                // Keep as is
            } else {
                pathToCheck = normalizeForFsWindows(pathToCheck);
            }
            
            execFile(BINARIES.diskspace, [pathToCheck], (err, stdout) => {
                if (err) return resolve(null);
                const match = stdout?.match(/FREE_BYTES=(\d+)/);
                resolve(match ? parseInt(match[1], 10) : null);
            });
        } catch (error) {
            resolve(null);
        }
    });
}
