import { spawn } from 'child_process';
import fs, { promises as fsp } from 'fs';
import path from 'path';
import { logDebug, getFullEnv, CoAppError, checkBinaries } from '../utils/utils';
import { BINARIES, TEMP_DIR, DEFAULT_TOOL_TIMEOUT, PREVIEW_TOOL_TIMEOUT } from '../utils/config';
import { register } from '../core/processes';

const MAX_HEAD_TAIL = 128 * 1024; // 128KB

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

/**
 * Universal Tool Handler
 */
export async function handleRunTool(params, responder, hooks = {}) {
    const { tool, args, timeoutMs, job, progressCommand } = params;
    const { onSpawn, onStderr } = hooks;
    
    try {
        if (!tool || !['ffprobe', 'ffmpeg'].includes(tool)) {
            throw new CoAppError(`Invalid tool: ${tool}`, 'EINVAL');
        }

        const toolPath = checkBinaries(tool);

        const finalArgs = args.map(arg => typeof arg === 'string' ? arg.trim() : arg);
        let outputPath = null;

        if (job?.kind === 'preview' && job?.output) {
            const format = job.output.format || 'jpg';
            outputPath = path.join(TEMP_DIR, `preview-${Date.now()}.${format}`);
            finalArgs.push('-y', outputPath);
        }

        const fallbackTimeout = job?.kind === 'preview' ? PREVIEW_TOOL_TIMEOUT : DEFAULT_TOOL_TIMEOUT;
        const effectiveTimeout = typeof timeoutMs === 'number' ? timeoutMs : (job?.kind === 'download' ? 0 : fallbackTimeout);

        logDebug(`[Tools] Executing: ${[toolPath, ...finalArgs].map(quoteForShell).join(' ')}`);

        return new Promise((resolve) => {
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
                        resolve({ success: false, timeout: true, ...truncateOutput(stdout, 'stdout'), ...truncateOutput(stderr, 'stderr'), code: null, signal: 'SIGTERM', key: 'ETIMEDOUT' });
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
                    if (!stderrTimer) stderrTimer = setTimeout(flushStderr, 100);
                }
            });

            child.on('close', async (code, signal) => {
                if (timeoutHandle) clearTimeout(timeoutHandle);
                if (stderrTimer) flushStderr();

                logDebug(`[Tools] Finished ${tool}${job ? ` (${job.kind})` : ''} with code ${code}${signal ? `, signal ${signal}` : ''}`);
                
                const result = { success: code === 0, code, signal, ...truncateOutput(stdout, 'stdout'), ...truncateOutput(stderr, 'stderr') };
                
                // Map exit state to unique keys
                // FFmpeg/FFprobe might exit with a code (e.g. 251, 255) instead of a signal when interrupted
                if (signal || child.killed || stderr.includes('received signal 15')) {
                    result.key = 'USER_CANCELLED';
                } else if (!result.success && !result.key) {
                    result.key = 'EIO';
                }

                if (job?.kind === 'preview' && job?.mode === 'imageDataUrl' && outputPath && fs.existsSync(outputPath)) {
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
                resolve(result);
            });

            child.on('error', (err) => {
                if (timeoutHandle) clearTimeout(timeoutHandle);
                logDebug(`[Tools] Process error (${tool}):`, err.message);
                resolve({ 
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
