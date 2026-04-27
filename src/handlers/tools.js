import { spawn } from 'child_process';
import http from 'http';
import fs, { promises as fsp } from 'fs';
import path from 'path';
import { logDebug, getFullEnv, CoAppError, checkBinaries } from '../utils/utils';
import { TEMP_DIR, DEFAULT_TOOL_TIMEOUT, PREVIEW_TOOL_TIMEOUT } from '../utils/config';
import { register } from '../core/processes';

const MAX_HEAD_TAIL = 128 * 1024; // 128KB
const STDERR_PROGRESS_FLUSH_MS = 500;
const LOOPBACK_HOST = '127.0.0.1';

const quoteForShell = (arg) => {
    const s = String(arg);
    if (process.platform === 'win32') return `"${s.replace(/"/g, '""')}"`;
    return `'${s.replace(/'/g, "'\\''")}'`;
};

const truncateOutput = (output, prefix) => {
    const buffer = Buffer.from(String(output ?? ''), 'utf8');
    const totalBytes = buffer.length;
    const truncated = totalBytes > 2 * MAX_HEAD_TAIL;
    const head = buffer.subarray(0, MAX_HEAD_TAIL).toString('utf8');
    const tail = truncated ? buffer.subarray(totalBytes - MAX_HEAD_TAIL).toString('utf8') : '';
    const marker = truncated ? `\n...[truncated ${totalBytes - 2 * MAX_HEAD_TAIL} bytes]...\n` : '';
    return { [prefix]: head + marker + tail, [prefix + 'Truncated']: truncated, [prefix + 'TotalSize']: totalBytes };
};

async function closeServer(server) {
    if (!server) return;
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(() => resolve()));
}

async function startManifestLoopbackServer(manifestEntries) {
    return new Promise((resolve, reject) => {
        const entryByPath = new Map(manifestEntries.map(entry => [entry.routePath, entry]));
        const server = http.createServer((req, res) => {
            let requestPath = '/';
            try {
                requestPath = new URL(req.url || '/', `http://${LOOPBACK_HOST}`).pathname;
            } catch {
                res.writeHead(400);
                res.end();
                return;
            }
            const entry = entryByPath.get(requestPath);

            if (!entry || (req.method !== 'GET' && req.method !== 'HEAD')) {
                res.writeHead(404);
                res.end();
                return;
            }

            res.writeHead(200, {
                'Content-Type': entry.mimeType,
                'Content-Length': entry.byteLength,
                'Cache-Control': 'no-store'
            });

            if (req.method === 'HEAD') {
                res.end();
                return;
            }

            res.end(entry.content);
        });
        server.keepAliveTimeout = 0;
        server.headersTimeout = 5000;

        server.once('error', reject);
        server.listen(0, LOOPBACK_HOST, () => {
            server.removeListener('error', reject);
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Failed to resolve manifest loopback port')));
                return;
            }
            resolve({ server, port: address.port });
        });
    });
}

async function stageInlineManifestInputs(args, inlineInputs = []) {
    const stagedArgs = [...args];

    if (!Array.isArray(inlineInputs) || inlineInputs.length === 0) {
        return {
            args: stagedArgs,
            async cleanup() {}
        };
    }

    const manifestEntries = [];
    let manifestServer = null;

    try {
        for (const inlineInput of inlineInputs) {
            const argIndexes = [];
            for (let index = 0; index < stagedArgs.length; index += 1) {
                if (stagedArgs[index] === inlineInput?.token) {
                    argIndexes.push(index);
                }
            }

            if (argIndexes.length === 0) continue;
            if (typeof inlineInput?.content !== 'string') {
                throw new Error(`Inline input ${inlineInput?.token || 'unknown'} is missing text content`);
            }

            let extension = null;
            let mimeType = inlineInput?.mimeType || null;
            if (inlineInput?.format === 'dash') {
                extension = 'mpd';
                mimeType ||= 'application/dash+xml';
            } else if (inlineInput?.format === 'hls') {
                extension = 'm3u8';
                mimeType ||= 'application/vnd.apple.mpegurl';
            } else {
                throw new Error(`Unsupported inline input format: ${inlineInput?.format || 'unknown'}`);
            }

            const inlineId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            manifestEntries.push({
                argIndexes,
                routePath: `/manifest-${inlineId}.${extension}`,
                mimeType,
                format: inlineInput.format,
                content: inlineInput.content,
                byteLength: Buffer.byteLength(inlineInput.content, 'utf8')
            });
        }

        if (manifestEntries.length > 0) {
            manifestServer = await startManifestLoopbackServer(manifestEntries);
            for (const entry of manifestEntries) {
                const servedUrl = `http://${LOOPBACK_HOST}:${manifestServer.port}${entry.routePath}`;
                for (const argIndex of entry.argIndexes) {
                    stagedArgs[argIndex] = servedUrl;
                }
                logDebug(`[Tools] Serving inline ${entry.format} manifest via ${servedUrl}`);
            }
        }
    } catch (error) {
        await closeServer(manifestServer?.server).catch(() => {});
        throw error;
    }

    return {
        args: stagedArgs,
        async cleanup() {
            await closeServer(manifestServer?.server).catch(() => {});
        }
    };
}

/**
 * Universal Tool Handler
 */
export async function handleRunTool(params, responder, hooks = {}) {
    const { tool, args, timeoutMs, job, progressCommand, inlineInputs } = params;
    const { onSpawn, onStderr } = hooks;
    
    try {
        if (!tool || !['ffprobe', 'ffmpeg'].includes(tool)) {
            throw new CoAppError(`Invalid tool: ${tool}`, 'EINVAL');
        }

        const toolPath = checkBinaries(tool);

        let finalArgs = [...args];
        let outputPath = null;

        if (job?.kind === 'preview' && job?.output) {
            const format = job.output.format || 'jpg';
            outputPath = path.join(TEMP_DIR, `preview-${Date.now()}.${format}`);
            finalArgs.push('-y', outputPath);
        }

        const stagedInputs = await stageInlineManifestInputs(finalArgs, inlineInputs);
        finalArgs = stagedInputs.args;

        const fallbackTimeout = job?.kind === 'preview' ? PREVIEW_TOOL_TIMEOUT : DEFAULT_TOOL_TIMEOUT;
        const effectiveTimeout = typeof timeoutMs === 'number' ? timeoutMs : (job?.kind === 'download' ? 0 : fallbackTimeout);

        logDebug(`[Tools] Executing: ${[toolPath, ...finalArgs].map(quoteForShell).join(' ')}`);

        return new Promise((resolve) => {
            let stagedInputsCleaned = false;
            let settled = false;
            const cleanupStagedInputs = async () => {
                if (stagedInputsCleaned) return;
                stagedInputsCleaned = true;
                await stagedInputs.cleanup();
            };
            const finish = async (result) => {
                if (settled) return;
                settled = true;
                if (timeoutHandle) clearTimeout(timeoutHandle);
                if (stderrTimer) flushStderr();
                await cleanupStagedInputs();
                resolve(result);
            };
            const child = spawn(toolPath, finalArgs, { env: getFullEnv() });
            register(child, job?.kind !== 'download' ? { type: 'processing' } : {});
            if (onSpawn) onSpawn(child);

            let stdout = '';
            let stderr = '';
            let timeoutHandle = null;
            let stderrBuffer = '';
            let stderrTimer = null;

            const flushStderr = () => {
                if (!stderrBuffer) return;
                let chunkToSend = stderrBuffer;
                const bufferBytes = Buffer.byteLength(stderrBuffer, 'utf8');
                if (bufferBytes > 64 * 1024) { // 64KB cap
                    const buffer = Buffer.from(stderrBuffer, 'utf8');
                    const head = buffer.subarray(0, 32 * 1024).toString('utf8');
                    const tail = buffer.subarray(buffer.length - 32 * 1024).toString('utf8');
                    const marker = `\n...[progress truncated ${buffer.length - 64 * 1024} bytes]...\n`;
                    chunkToSend = head + marker + tail;
                }
                responder.send({ command: progressCommand, downloadId: job?.id, chunk: chunkToSend });
                stderrBuffer = '';
                if (stderrTimer) { clearTimeout(stderrTimer); stderrTimer = null; }
            };

            if (effectiveTimeout > 0) {
                timeoutHandle = setTimeout(() => {
                    if (!child.killed) {
                        logDebug(`[Tools] Timeout reached (${effectiveTimeout}ms): ${tool}`);
                        child.kill('SIGTERM');
                        void finish({ success: false, timeout: true, ...truncateOutput(stdout, 'stdout'), ...truncateOutput(stderr, 'stderr'), code: null, signal: 'SIGTERM', key: 'ETIMEDOUT' });
                    }
                }, effectiveTimeout);
            }

            child.stdout?.on('data', d => stdout += d.toString());
            child.stderr?.on('data', d => {
                const chunk = d.toString();
                stderr += chunk;
                if (onStderr) onStderr(d);
                if (progressCommand) {
                    stderrBuffer += chunk;
                    if (!stderrTimer) stderrTimer = setTimeout(flushStderr, STDERR_PROGRESS_FLUSH_MS);
                }
            });

            child.on('close', async (code, signal) => {
                if (settled) return;

                logDebug(`[Tools] Finished ${tool}${job ? ` (${job.kind})` : ''} with code ${code}${signal ? `, signal ${signal}` : ''}`);
                
                const result = { success: code === 0, code, signal, ...truncateOutput(stdout, 'stdout'), ...truncateOutput(stderr, 'stderr') };
                
                // Map exit state to unique keys
                // FFmpeg/FFprobe might exit with a code (e.g. 251, 255) instead of a signal when interrupted
                if (signal || child.killed || stderr.includes('received signal 15')) {
                    result.key = 'USER_CANCELLED';
                } else if (!result.success && !result.key) {
                    result.key = 'EIO';
                }

                if (job?.kind === 'preview' && outputPath && fs.existsSync(outputPath)) {
                    try {
                        const buffer = await fsp.readFile(outputPath);
                        const mime = job.output?.format === 'png' ? 'image/png' : 'image/jpeg';
                        result.data = {
                            previewUrl: `data:${mime};base64,${buffer.toString('base64')}`,
                            noVideoStream: stderr.includes('Output file does not contain any stream')
                        };
                        if (job.output?.temp !== false) fsp.unlink(outputPath).catch(() => {});
                    } catch (e) {
                        logDebug('[Tools] Preview conversion failed:', e.message);
                    }
                }
                await finish(result);
            });

            child.on('error', async (err) => {
                if (settled) return;
                logDebug(`[Tools] Process error (${tool}):`, err.message);
                await finish({ 
                    success: false, 
                    error: err.message, 
                    key: err.code === 'ENOENT' ? 'ENOENT' : 'EIO', 
                    ...truncateOutput(stdout, 'stdout'), 
                    ...truncateOutput(stderr, 'stderr')
                });
            });
        });
    } catch (err) {
        return { 
            success: false, 
            error: err.message, 
            key: err.key || 'internalError', 
            substitutions: err.substitutions || [] 
        };
    }
}
