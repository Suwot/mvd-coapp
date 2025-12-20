import fs from 'fs';
import path from 'path';
import os from 'os';
import { logDebug, getFreeDiskSpace, normalizeForFsWindows, sanitizeFilename, ensureUniqueFilename } from '../utils/utils';
import { handleRunTool } from './tools';

const activeDownloads = new Map();

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

function isPathInUse(fullPath) {
    for (const entry of activeDownloads.values()) {
        if (entry?.finalPath === fullPath) return true;
    }
    return false;
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
        if (!entry) return { success: false, from: command, downloadId, error: 'Not found', key: 'ENOENT' };
        
        logDebug(`[Downloader] Canceling ${downloadId}`);
        const { child } = entry;
        try { if (child.stdin?.writable) child.stdin.write('q\n'); } catch { /* ignore */ }
        setTimeout(() => !child.killed && child.kill('SIGTERM'), 5000);
        setTimeout(() => !child.killed && child.kill('SIGKILL'), 15000);
        return { success: true, from: command, downloadId };
    }

    return startDownload(request, responder);
}

async function startDownload(params, responder) {
    const { downloadId, argsBeforeOutput, saveDir, filename, container, allowOverwrite = false, url } = params;
    logDebug(`[Downloader] Starting download ${downloadId} (name: ${filename}, dir: ${saveDir})`);
    
    const resolvedDir = resolveSaveDir(saveDir);
    if (!resolvedDir) {
        logDebug(`[Downloader] Failed to resolve saveDir: ${saveDir}`);
        return { success: false, command: 'download-error', downloadId, key: 'ENOENT', error: 'Invalid saveDir' };
    }

    try {
        if (!fs.existsSync(resolvedDir)) {
            logDebug(`[Downloader] Creating directory: ${resolvedDir}`);
            fs.mkdirSync(resolvedDir, { recursive: true });
        }
        fs.accessSync(normalizeForFsWindows(resolvedDir), fs.constants.W_OK);
    } catch (err) {
        const key = err.key || err.code || 'internalError';
        logDebug(`[Downloader] FS setup failed for ${resolvedDir}:`, err.message);
				return { success: false, command: 'download-error', downloadId, key, error: err.message, substitutions: err.substitutions || [] };
    }

    // Disk space report (once at start as per original)
    getFreeDiskSpace(resolvedDir).then(free => {
        responder.send({ command: 'download-disk-space', downloadId, targetDir: resolvedDir, freeBytes: free });
    });

    const sanitized = sanitizeFilename(filename, `download-${downloadId}`, container);
    
    // If filename already has the extension and we are in allowOverwrite mode (download-as),
    // we should trust the filename more strictly.
    const finalFilename = (allowOverwrite && !isPathInUse(path.join(resolvedDir, filename))) 
        ? filename 
        : ensureUniqueFilename(resolvedDir, sanitized, isPathInUse);
    
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

    const finalResult = {
        command: 'download-finished',
        downloadId,
        success: spawnResult.success,
        code: spawnResult.code,
        signal: spawnResult.signal,
        path: finalPath,
        fileExists: fs.existsSync(finalPath),
        timeout: !!spawnResult.timeout,
        key: spawnResult.key,
        error: spawnResult.error,
        substitutions: spawnResult.substitutions
    };

    return finalResult;
}
