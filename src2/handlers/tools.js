import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logDebug, getFullEnv } from '../utils/utils';
import { BINARIES, TEMP_DIR, DEFAULT_TOOL_TIMEOUT, PREVIEW_TOOL_TIMEOUT } from '../utils/config';
import { register } from '../core/processes';
import { wrapError } from '../utils/errors';

const quoteForShell = (arg) => `'${String(arg).replace(/'/g, "'\\''")}'`;

/**
 * Universal Tool Handler
 * Supports both standalone mapping and internal calls from other handlers
 */
export async function handleRunTool(params, responder, hooks = {}) {
    // If called from routeRequest, hooks will be empty.
    // If called from handleDownload, hooks will contains onSpawn/onStderr
    const { tool, args, timeoutMs, job, progressCommand } = params;
    const { onSpawn, onStderr } = hooks;
    
    if (!tool || !['ffprobe', 'ffmpeg'].includes(tool)) {
        logDebug(`[Tools] Invalid tool requested: ${tool}`);
        return { success: false, error: `Invalid tool: ${tool}` };
    }

    const toolPath = BINARIES[tool];
    // Trim arguments to avoid trailing newlines (especially in headers)
    let finalArgs = args.map(arg => typeof arg === 'string' ? arg.trim() : arg);
    let outputPath = null;

    if (job?.kind === 'preview' && job?.output) {
        const format = job.output.format || 'jpg';
        outputPath = path.join(TEMP_DIR, `preview-${Date.now()}.${format}`);
        finalArgs.push('-y', outputPath);
    }

    const fallbackTimeout = job?.kind === 'preview' ? PREVIEW_TOOL_TIMEOUT : DEFAULT_TOOL_TIMEOUT;
    const effectiveTimeout = typeof timeoutMs === 'number' ? timeoutMs : (job?.kind === 'download' ? 0 : fallbackTimeout);

    const fullCommand = [toolPath, ...finalArgs].map(quoteForShell).join(' ');
    logDebug(`[Tools] Executing: ${fullCommand}`);

    return new Promise((resolve) => {
        const child = spawn(toolPath, finalArgs, { env: getFullEnv() });
        
        register(child, job?.kind !== 'download' ? { type: 'processing' } : {});
        
        if (onSpawn) onSpawn(child);

        let stdout = '';
        let stderr = '';
        let timeoutHandle = null;

        // Progress buffering (only if progressCommand is provided)
        let stderrBuffer = '';
        let stderrTimer = null;

        const flushStderrBuffer = () => {
            if (!stderrBuffer) return;
            responder.send({ 
                command: progressCommand, 
                downloadId: job?.id, // Parity with download-v2
                chunk: stderrBuffer 
            });
            stderrBuffer = '';
            if (stderrTimer) {
                clearTimeout(stderrTimer);
                stderrTimer = null;
            }
        };

        if (effectiveTimeout > 0) {
            timeoutHandle = setTimeout(() => {
                if (!child.killed) {
                    logDebug(`[Tools] Timeout reached (${effectiveTimeout}ms), killing: ${tool}`);
                    child.kill('SIGTERM');
                    resolve({ success: false, timeout: true, stdout, stderr, code: null, signal: 'SIGTERM', key: 'timeout' });
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
                if (!stderrTimer) {
                    stderrTimer = setTimeout(flushStderrBuffer, 100);
                }
            }
        });

        child.on('close', (code, signal) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (stderrTimer) {
                clearTimeout(stderrTimer);
                flushStderrBuffer();
            }

            const jobInfo = job ? ` (${job.kind}${job.id ? `: ${job.id}` : ''})` : '';
            logDebug(`[Tools] Finished ${tool}${jobInfo} with code ${code}${signal ? `, signal ${signal}` : ''}`);
            const result = { success: code === 0, code, signal, stdout, stderr };

            if (!result.success && !signal) {
                result.key = 'toolError';
            }

            // Preview Post-processing
            if (job?.kind === 'preview' && job?.mode === 'imageDataUrl' && outputPath && fs.existsSync(outputPath)) {
                try {
                    const buffer = fs.readFileSync(outputPath);
                    const mime = job.output?.format === 'png' ? 'image/png' : 'image/jpeg';
                    result.data = {
                        previewUrl: `data:${mime};base64,${buffer.toString('base64')}`,
                        noVideoStream: stderr.includes('Output file does not contain any stream')
                    };
                    if (job.output?.temp !== false) fs.unlink(outputPath, () => {});
                } catch (e) {
                    logDebug('[Tools] Preview conversion failed:', e.message);
                }
            }

            resolve(result);
        });

        child.on('error', (err) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            const wrapped = wrapError(err);
            logDebug(`[Tools] Process error (${tool}):`, wrapped.message);
            resolve({ success: false, error: wrapped.message, key: wrapped.key, stdout, stderr });
        });
    });
}
