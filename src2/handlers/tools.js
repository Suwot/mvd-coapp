import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logDebug, getFullEnv } from '../utils/utils';
import { BINARIES, TEMP_DIR } from '../utils/config';
import { register, unregister } from '../core/processes';

const DEFAULT_TIMEOUT = 30000;
const PREVIEW_TIMEOUT = 40000;

const quoteForShell = (arg) => `'${String(arg).replace(/'/g, "'\\''")}'`;

/**
 * Universal Tool Handler
 * Supports both standalone mapping and internal calls from other handlers
 */
export async function handleRunTool(params, responder, hooks = {}) {
    // If called from routeRequest, hooks will be empty.
    // If called from handleDownload, hooks will contains onSpawn/onStderr
    const { tool, args, timeoutMs, job } = params;
    const { onSpawn, onStderr } = hooks;
    
    if (!tool || !['ffprobe', 'ffmpeg'].includes(tool)) {
        logDebug(`[Tools] Invalid tool requested: ${tool}`);
        return { success: false, error: `Invalid tool: ${tool}` };
    }

    const toolPath = BINARIES[tool];
    let finalArgs = [...args];
    let outputPath = null;

    if (job?.kind === 'preview' && job?.output) {
        const format = job.output.format || 'jpg';
        outputPath = path.join(TEMP_DIR, `preview-${Date.now()}.${format}`);
        finalArgs.push('-y', outputPath);
    }

    const fallbackTimeout = job?.kind === 'preview' ? PREVIEW_TIMEOUT : DEFAULT_TIMEOUT;
    const effectiveTimeout = typeof timeoutMs === 'number' ? timeoutMs : (job?.kind === 'download' ? 0 : fallbackTimeout);

    const fullCommand = [toolPath, ...finalArgs].map(quoteForShell).join(' ');
    logDebug(`[Tools] Executing: ${fullCommand}`);

    return new Promise((resolve) => {
        const child = spawn(toolPath, finalArgs, { env: getFullEnv() });
        
        const registrationType = job?.kind === 'download' ? 'general' : 'processing';
        register(child, registrationType);
        
        if (onSpawn) onSpawn(child);

        let stdout = '';
        let stderr = '';
        let timeoutHandle = null;

        if (effectiveTimeout > 0) {
            timeoutHandle = setTimeout(() => {
                if (!child.killed) {
                    logDebug(`[Tools] Timeout reached (${effectiveTimeout}ms), killing: ${tool}`);
                    child.kill('SIGTERM');
                    resolve({ success: false, timeout: true, stdout, stderr, code: null, signal: 'SIGTERM' });
                }
            }, effectiveTimeout);
        }

        child.stdout?.on('data', d => stdout += d.toString());
        child.stderr?.on('data', d => {
            stderr += d.toString();
            if (onStderr) onStderr(d);
        });

        child.on('close', (code, signal) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            unregister(child);

            logDebug(`[Tools] Finished ${tool} with code ${code}${signal ? `, signal ${signal}` : ''}`);
            const result = { success: code === 0, code, signal, stdout, stderr };

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
            unregister(child);
            logDebug(`[Tools] Process error (${tool}):`, err.message);
            resolve({ success: false, error: err.message });
        });
    });
}
