import fs from 'fs';
import path from 'path';
import os from 'os';
import { logDebug, getFullEnv, getFreeDiskSpace, normalizeForFsWindows } from '../utils/utils';
import { BINARIES, IS_WINDOWS } from '../utils/config';
import { handleRunTool } from './tools';
import { fail, wrapError } from '../utils/errors';

const activeDownloads = new Map();
// eslint-disable-next-line no-control-regex
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const WINDOWS_RESERVED_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

// --- Helpers ---
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
    for (const entry of activeDownloads.values()) {
        if (entry?.finalPath === fullPath) return true;
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

function buildUiPath(fullPath) {
    const home = os.homedir();
    const relative = path.relative(home, fullPath);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        return path.join('~', relative);
    }
    return fullPath;
}

// --- Main Handler ---
export async function handleDownload(request, responder) {
    const { command, downloadId } = request;

    if (command === 'cancel-download-v2') {
        const entry = activeDownloads.get(downloadId);
        if (!entry) return { success: false, error: 'Not found', key: 'notFound' };
        
        logDebug(`[Downloader] Canceling ${downloadId}`);
        const { child } = entry;
        try { if (child.stdin?.writable) child.stdin.write('q\n'); } catch { /* ignore */ }
        setTimeout(() => !child.killed && child.kill('SIGTERM'), 5000);
        setTimeout(() => !child.killed && child.kill('SIGKILL'), 15000);
        return { success: true };
    }

    return startDownload(request, responder);
}

async function startDownload(params, responder) {
    const { downloadId, argsBeforeOutput, saveDir, filename, container, allowOverwrite = false, url } = params;
    logDebug(`[Downloader] Starting download ${downloadId} (name: ${filename}, dir: ${saveDir})`);
    
    const resolvedDir = resolveSaveDir(saveDir);
    if (!resolvedDir) {
        logDebug(`[Downloader] Failed to resolve saveDir: ${saveDir}`);
        responder.send({ command: 'download-error', downloadId, key: 'folderNotFound' });
        return { success: false, error: 'Invalid saveDir' };
    }

    try {
        if (!fs.existsSync(resolvedDir)) {
            logDebug(`[Downloader] Creating directory: ${resolvedDir}`);
            fs.mkdirSync(resolvedDir, { recursive: true });
        }
        fs.accessSync(normalizeForFsWindows(resolvedDir), fs.constants.W_OK);
    } catch (err) {
        const wrapped = wrapError(err);
        logDebug(`[Downloader] FS setup failed for ${resolvedDir}:`, wrapped.message);
        responder.send({ command: 'download-error', downloadId, key: wrapped.key, message: wrapped.message });
        return { success: false, error: wrapped.message };
    }

    // Disk space report (once at start as per original)
    getFreeDiskSpace(resolvedDir).then(free => {
        responder.send({ command: 'download-disk-space', downloadId, targetDir: resolvedDir, freeBytes: free });
    });

    const sanitized = sanitizeFilename(filename, `download-${downloadId}`, container);
    const finalFilename = (allowOverwrite && !isPathInUse(path.join(resolvedDir, sanitized))) 
        ? sanitized 
        : ensureUniqueFilename(resolvedDir, sanitized);
    
    const finalPath = path.resolve(resolvedDir, finalFilename);
    const spawnPath = normalizeForFsWindows(finalPath);
    const uiPath = buildUiPath(finalPath);

    logDebug(`[Downloader] Path resolved: ${finalPath}`);
    responder.send({ command: 'filename-resolved', downloadId, resolvedFilename: finalFilename, path: uiPath });

    const spawnResult = await handleRunTool({
        tool: 'ffmpeg',
        args: [...argsBeforeOutput, spawnPath],
        timeoutMs: 0,
        job: { kind: 'download', id: downloadId, url },
        progressCommand: 'download-progress'
    }, responder, {
        onSpawn: (child) => activeDownloads.set(downloadId, { child, finalPath })
    });

    activeDownloads.delete(downloadId);

    responder.send({
        command: 'download-finished',
        downloadId,
        code: spawnResult.code,
        signal: spawnResult.signal,
        path: finalPath,
        fileExists: fs.existsSync(finalPath),
        timeout: !!spawnResult.timeout
    });

    return spawnResult;
}
