import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import https from 'https';
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

function normalizeDownloadHeaders(headers) {
    if (!headers || typeof headers !== 'object') return null;

    const normalized = {};
    for (const [name, value] of Object.entries(headers)) {
        if (name === 'timestamp' || value == null) continue;
        normalized[name] = String(value);
    }
    return Object.keys(normalized).length > 0 ? normalized : null;
}

function isRedirectStatus(statusCode) {
    return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

async function startDirectDownload(request, responder, context) {
    const { downloadId, url, headers } = request;
    const { finalPath, finalFilename } = context;
    const normalizedHeaders = normalizeDownloadHeaders(headers);
    const writePath = normalizeForFsWindows(finalPath);
    let requestHandle = null;
    let responseHandle = null;
    let writeStream = null;
    let downloadedBytes = 0;
    let totalBytes = null;
    let lastProgressAt = Date.now();

    const controller = {
        killed: false,
        stdin: null,
        kill() {
            if (this.killed) return false;
            this.killed = true;
            const abortError = new Error('Download canceled');
            abortError.code = 'ABORT_ERR';
            requestHandle?.destroy(abortError);
            responseHandle?.destroy(abortError);
            writeStream?.destroy(abortError);
            return true;
        }
    };

    activeDownloads.set(downloadId, { child: controller, finalPath });
    logDebug('[Downloader] Starting direct download', { downloadId, url, finalPath });

    try {
        await new Promise((resolve, reject) => {
            const requestUrl = (currentUrl, redirectCount = 0) => {
                let parsedUrl;
                try {
                    parsedUrl = new URL(currentUrl);
                } catch {
                    reject(new Error(`Invalid direct download URL: ${currentUrl}`));
                    return;
                }

                const transport = parsedUrl.protocol === 'https:' ? https : http;
                requestHandle = transport.get(currentUrl, normalizedHeaders ? { headers: normalizedHeaders } : undefined, (response) => {
                    responseHandle = response;

                    if (isRedirectStatus(response.statusCode) && response.headers.location) {
                        response.resume();
                        if (redirectCount >= 5) {
                            reject(new Error('Direct download redirect limit exceeded'));
                            return;
                        }

                        if (controller.killed) {
                            const abortError = new Error('Download canceled');
                            abortError.code = 'ABORT_ERR';
                            reject(abortError);
                            return;
                        }

                        requestUrl(new URL(response.headers.location, currentUrl).toString(), redirectCount + 1);
                        return;
                    }

                    if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
                        response.resume();
                        reject(new Error(`Direct download failed with HTTP ${response.statusCode || 0}`));
                        return;
                    }

                    const parsedTotalBytes = Number(response.headers['content-length']);
                    totalBytes = Number.isFinite(parsedTotalBytes) && parsedTotalBytes > 0 ? parsedTotalBytes : null;
                    writeStream = fs.createWriteStream(writePath);

                    response.on('data', (chunk) => {
                        downloadedBytes += chunk.length;
                        if (!totalBytes) return;
                        const now = Date.now();
                        if ((now - lastProgressAt) < 500) return;
                        lastProgressAt = now;
                        responder.send({
                            command: 'download-progress',
                            downloadId,
                            downloadedBytes,
                            totalBytes,
                            progress: Math.min(99.999, Math.round((downloadedBytes / totalBytes) * 100000) / 1000),
                            elapsedTime: Math.round((now - context.startedAt) / 1000)
                        });
                    });

                    response.on('error', reject);
                    writeStream.on('error', reject);
                    writeStream.on('finish', resolve);
                    response.pipe(writeStream);
                });

                requestHandle.on('error', reject);
            };

            requestUrl(url);
        });

        return {
            command: 'download-finished',
            downloadId,
            success: true,
            path: finalPath,
            fileExists: true,
            filename: finalFilename,
            totalBytes: downloadedBytes || totalBytes || 0
        };
    } catch (error) {
        controller.killed = true;
        try { if (fs.existsSync(writePath)) fs.unlinkSync(writePath); } catch { /* ignore best-effort cleanup */  }
        logDebug('[Downloader] Direct download failed', { downloadId, url, finalPath, error: error?.message || String(error) });
        return {
            command: 'download-finished',
            downloadId,
            success: false,
            fileExists: false,
            ...(error?.code === 'ABORT_ERR' ? { canceled: true } : {}),
            error: error?.message || 'Direct download failed'
        };
    } finally {
        activeDownloads.delete(downloadId);
    }
}

// --- Main Handler ---
export async function handleDownload(request, responder) {
    const { command, downloadId } = request;

    if (command === 'cancel-download-v2') {
        const entry = activeDownloads.get(downloadId);
        if (!entry) return { success: false, from: command, downloadId, error: 'Not found', key: 'ENOENT' };

        const gracefulStopWaitMs = request.gracefulStopWaitMs ?? 15000;
        const forceKillWaitMs = 35000;
        
        logDebug(`[Downloader] Canceling ${downloadId} (sigterm in ${gracefulStopWaitMs}ms, sigkill in ${forceKillWaitMs}ms)`);
        const { child } = entry;
        try { if (child.stdin?.writable) child.stdin.write('q\n'); } catch { /* ignore */ }
        setTimeout(() => !child.killed && child.kill('SIGTERM'), gracefulStopWaitMs);
        setTimeout(() => !child.killed && child.kill('SIGKILL'), forceKillWaitMs);
        return { success: true, from: command, downloadId };
    }

    return startDownload(request, responder);
}

async function startDownload(params, responder) {
    const { command, downloadId, argsBeforeOutput, inlineInputs, saveDir, filename, container, allowOverwrite = false } = params;
    logDebug(`[Downloader] Starting download ${downloadId} (name: ${filename}, dir: ${saveDir})`);
    
    const resolvedDir = resolveSaveDir(saveDir);
    if (!resolvedDir) {
        logDebug(`[Downloader] Failed to resolve saveDir: ${saveDir}`);
        return { success: false, command: 'download-finished', downloadId, key: 'ENOENT', error: 'Invalid saveDir' };
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
        return {
            success: false,
            command: 'download-finished',
            downloadId,
            key,
            error: err.message,
            ...(Array.isArray(err.substitutions) && err.substitutions.length ? { substitutions: err.substitutions } : {})
        };
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

    if (command === 'direct-download') {
        return startDirectDownload(params, responder, {
            finalPath,
            finalFilename,
            startedAt: Date.now()
        });
    }

    const spawnResult = await handleRunTool({
        tool: 'ffmpeg',
        args: [...argsBeforeOutput, spawnPath],
        inlineInputs,
        timeoutMs: 0,
        job: { kind: 'download', id: downloadId },
        progressCommand: 'download-progress'
    }, responder, {
        onSpawn: (child) => activeDownloads.set(downloadId, { child, finalPath })
    });

    activeDownloads.delete(downloadId);
    const fileExists = fs.existsSync(finalPath);
    const stderr = String(spawnResult.stderr || '').split(/\r?\n|\r(?!\n)/).filter(Boolean).slice(-50).join('\n');

    const finalResult = {
        command: 'download-finished',
        downloadId,
        success: spawnResult.success,
        ...(spawnResult.code !== undefined ? { code: spawnResult.code } : {}),
        ...(spawnResult.signal ? { signal: spawnResult.signal } : {}),
        ...(fileExists ? { path: finalPath } : {}),
        fileExists,
        timeout: !!spawnResult.timeout,
        ...(spawnResult.key ? { key: spawnResult.key } : {}),
        ...(spawnResult.error ? { error: spawnResult.error } : {}),
        ...(spawnResult.stdout ? { stdout: spawnResult.stdout } : {}),
        ...(stderr ? { stderr } : {}),
        ...(Array.isArray(spawnResult.substitutions) && spawnResult.substitutions.length ? { substitutions: spawnResult.substitutions } : {})
    };

    return finalResult;
}
