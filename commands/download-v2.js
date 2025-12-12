const fs = require('fs');
const path = require('path');
const os = require('os');
const BaseCommand = require('./base-command');
const { spawnTool } = require('./run-tool');
const { logDebug, getBinaryPaths, normalizeForFsWindows, getFreeDiskSpace } = require('../utils/utils');

// eslint-disable-next-line no-control-regex
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const WINDOWS_RESERVED_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);
const CANCEL_GRACE_MS = 5000;
const CANCEL_FORCE_MS = 15000;
const STDERR_BUFFER_MAX_BYTES = 32 * 1024;
const STDERR_BUFFER_MAX_DELAY = 100;

function resolveSaveDir(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let expanded = raw;
    if (expanded === '~') {
        expanded = os.homedir();
    } else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
        expanded = path.join(os.homedir(), expanded.slice(2));
    }
    return path.resolve(expanded);
}

function sanitizeFilename(filename, fallback, container) {
    const raw = filename && String(filename).trim() ? filename : (fallback || 'output');

    const parsed = path.parse(path.basename(raw));
    let base = parsed.name || fallback || 'output';
    base = base.replace(INVALID_FILENAME_CHARS, '').replace(/^[.\s]+|[.\s]+$/g, '');
    if (!base) base = fallback || 'output';
    if (WINDOWS_RESERVED_NAMES.has(base.toUpperCase())) base += '_';

    const normalizedContainer = container ? String(container).trim().replace(INVALID_FILENAME_CHARS, '') : '';

    if (normalizedContainer) {
        const dotExt = `.${normalizedContainer.toLowerCase()}`;
        while (dotExt && base.toLowerCase().endsWith(dotExt)) {
            base = base.slice(0, -dotExt.length);
        }
    }

    const extension = normalizedContainer ? `.${normalizedContainer}` : '';
    return `${base}${extension}`;
}

function isPathInUse(fullPath) {
    for (const entry of DownloadCommandV2.activeDownloads.values()) {
        if (entry?.finalPath === fullPath) {
            return true;
        }
    }
    return false;
}

function ensureUniqueFilename(dir, candidate) {
    const parsed = path.parse(candidate);
    const base = parsed.name;
    const extension = parsed.ext;

    let attempt = 0;
    let candidateName = candidate;
    let fullPath = path.join(dir, candidateName);

    while (fs.existsSync(fullPath) || isPathInUse(fullPath)) {
        attempt += 1;
        candidateName = `${base} (${attempt})${extension}`;
        fullPath = path.join(dir, candidateName);
    }

    return candidateName;
}

function classifyFsError(err) {
    if (!err || !err.code) return 'fsError';
    switch (err.code) {
        case 'ENOENT':
        case 'ENOTDIR':
        case 'ELOOP':
            return 'folderNotFound';
        case 'EACCES':
        case 'EPERM':
        case 'EROFS':
            return 'directoryNotWritable';
        default:
            return 'fsError';
    }
}

function buildUiPath(fullPath) {
    const home = os.homedir();
    const relative = path.relative(home, fullPath);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        return path.join('~', relative);
    }
    return fullPath;
}

class DownloadCommandV2 extends BaseCommand {
    static activeDownloads = new Map();

    async execute(params) {
        if (params.command === 'cancel-download-v2') {
            return this.cancelDownload(params);
        }
        return this.startDownload(params);
    }

    sendDownloadError(downloadId, key, message) {
        this.sendMessage({ command: 'download-error', downloadId, key, message }, { useMessageId: false });
    }

    async startDownload(params) {
        const { downloadId, argsBeforeOutput, saveDir, filename, container, allowOverwrite = false } = params;
        if (!downloadId) {
            return { success: false, error: 'downloadId is required' };
        }
        if (!Array.isArray(argsBeforeOutput)) {
            this.sendDownloadError(downloadId, 'fsError', 'argsBeforeOutput must be an array');
            return { success: false, error: 'argsBeforeOutput must be an array' };
        }

        const { ffmpegPath } = getBinaryPaths();
        if (!ffmpegPath) {
            this.sendDownloadError(downloadId, 'fsError', null);
            return { success: false, error: 'FFmpeg binary not found' };
        }

        const resolvedDir = resolveSaveDir(saveDir);
        if (!resolvedDir) {
            this.sendDownloadError(downloadId, 'folderNotFound', null);
            return { success: false, error: 'saveDir missing' };
        }

        try {
            fs.mkdirSync(resolvedDir, { recursive: true });
        } catch (err) {
            const key = classifyFsError(err);
            this.sendDownloadError(downloadId, key, err.message || null);
            return { success: false, error: err.message };
        }

        const normalizedDir = normalizeForFsWindows(resolvedDir);
        try {
            fs.accessSync(normalizedDir, fs.constants.W_OK);
        } catch (err) {
            const key = classifyFsError(err);
            this.sendDownloadError(downloadId, key, err.message || null);
            return { success: false, error: err.message };
        }

        this.reportDiskSpace(downloadId, resolvedDir).catch((err) => {
            logDebug('Disk space report failed:', (err && err.message) || err);
        });

        const diskDir = resolvedDir;
        const fallbackName = `download-${downloadId}`;
        const sanitized = sanitizeFilename(filename, fallbackName, container);
        const parsedSanitized = path.parse(sanitized);
        let finalFilename;

        if (allowOverwrite) {
            let attempt = 0;
            let candidateName = sanitized;
            let candidatePath = path.join(diskDir, candidateName);
            while (isPathInUse(candidatePath)) {
                attempt += 1;
                candidateName = `${parsedSanitized.name} (${attempt})${parsedSanitized.ext}`;
                candidatePath = path.join(diskDir, candidateName);
            }
            finalFilename = candidateName;
        } else {
            finalFilename = ensureUniqueFilename(diskDir, sanitized);
        }
        const finalPath = path.join(diskDir, finalFilename);
        const spawnPath = normalizeForFsWindows(finalPath);
        const uiOutputPath = buildUiPath(finalPath);

        this.sendMessage({
            command: 'filename-resolved',
            downloadId,
            resolvedFilename: finalFilename,
            path: uiOutputPath
        }, { useMessageId: false });

        logDebug('download-v2 resolved path:', finalPath, spawnPath);

        let spawnResult;
        let stderrBuffer = '';
        let stderrTimer = null;

        const flushStderrBuffer = () => {
            if (!stderrBuffer) return;
            this.sendMessage({
                command: 'download-progress',
                downloadId,
                chunk: stderrBuffer
            }, { useMessageId: false });
            stderrBuffer = '';
            if (stderrTimer) {
                clearTimeout(stderrTimer);
                stderrTimer = null;
            }
        };

        const scheduleStderrFlush = () => {
            if (stderrTimer) return;
            stderrTimer = setTimeout(() => {
                stderrTimer = null;
                flushStderrBuffer();
            }, STDERR_BUFFER_MAX_DELAY);
        };

        try {
            spawnResult = await spawnTool(ffmpegPath, [...argsBeforeOutput, spawnPath], {
                timeoutMs: 0,
                registrationType: 'download',
                onStderr: (chunk) => {
                    const text = chunk.toString();
                    if (!text) return;
                    stderrBuffer += text;
                    if (stderrBuffer.length >= STDERR_BUFFER_MAX_BYTES) {
                        flushStderrBuffer();
                        return;
                    }
                    scheduleStderrFlush();
                },
                onSpawn: (child) => {
                    DownloadCommandV2.activeDownloads.set(downloadId, { child, spawnPath, finalPath });
                }
            });
        } catch (err) {
            flushStderrBuffer();
            this.sendDownloadError(downloadId, 'fsError', err.message || null);
            return { success: false, error: err.message };
        } finally {
            flushStderrBuffer();
            DownloadCommandV2.activeDownloads.delete(downloadId);
        }

        let fileExists = false;
        try {
            fileExists = fs.existsSync(spawnPath);
        } catch (err) {
            logDebug('Error checking file existence:', err.message);
        }

        this.sendMessage({
            command: 'download-finished',
            downloadId,
            code: spawnResult.code,
            signal: spawnResult.signal,
            fileExists,
            path: finalPath,
            timeout: !!spawnResult.timeout
        }, { useMessageId: false });

        return spawnResult;
    }

    async reportDiskSpace(downloadId, targetDir) {
        let freeBytes = null;
        try {
            const available = await getFreeDiskSpace(targetDir);
            if (typeof available === 'number' && Number.isFinite(available)) {
                freeBytes = available;
				logDebug(`${freeBytes} bytes are available in ${targetDir} for download ID: ${downloadId}`);
            }
        } catch (err) {
            logDebug('Disk space helper failed:', (err && err.message) || err);
        }

        this.sendMessage({
            command: 'download-disk-space',
            downloadId,
            targetDir,
            freeBytes
        }, { useMessageId: false });
    }

    async cancelDownload(params) {
        const { downloadId } = params;
        if (!downloadId) {
            return { success: false, error: 'downloadId is required' };
        }

        const entry = DownloadCommandV2.activeDownloads.get(downloadId);
        if (!entry || !entry.child) {
            return { success: false, error: 'download not found' };
        }

        const { child } = entry;
        logDebug('download-v2 cancellation requested:', downloadId);
        try {
            if (child.stdin && !child.stdin.destroyed) {
                child.stdin.write('q\n');
                logDebug('download-v2 cancel: sent q to stdin', downloadId);
            }
        } catch (err) {
            logDebug('download-v2 cancel stdin write failed:', err.message);
        }

        setTimeout(() => {
            if (child && !child.killed) {
                try {
                    child.kill('SIGTERM');
                    logDebug('download-v2 cancel: sent SIGTERM', downloadId);
                } catch (err) {
                    logDebug('download-v2 cancel SIGTERM failed:', err.message);
                }
            }
        }, CANCEL_GRACE_MS);

        setTimeout(() => {
            if (child && !child.killed) {
                try {
                    child.kill('SIGKILL');
                    logDebug('download-v2 cancel: sent SIGKILL', downloadId);
                } catch (err) {
                    logDebug('download-v2 cancel SIGKILL failed:', err.message);
                }
            }
        }, CANCEL_FORCE_MS);

        return { success: true };
    }
}

module.exports = DownloadCommandV2;
