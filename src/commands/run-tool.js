/**
 * RunToolCommand – Universal dumb worker for spawning ffprobe/ffmpeg
 * 
 * Design principles:
 * - Truly dumb: just spawn, collect output, return result
 * - Extension controls all args, parsing, and interpretation
 * - Unified RawProcessResult schema for all tool types
 * - Supports job.output for file operations (preview generation)
 * 
 * Request schema:
 * {
 *   command: 'runTool',
 *   tool: 'ffprobe' | 'ffmpeg',
 *   args: string[],
 *   timeoutMs?: number,
 *   job?: {
 *     kind: 'probe' | 'preview' | 'download',
 *     id?: string,
 *     mode?: 'imageDataUrl' | 'file',
 *     output?: { format?: string, temp?: boolean }
 *   }
 * }
 * 
 * Response schema (RawProcessResult):
 * {
 *   success: boolean,      // code === 0
 *   code: number | null,
 *   signal: string | null,
 *   stdout: string,
 *   stderr: string,
 *   timeout?: boolean,
 *   error?: string | null,
 *   data?: any             // job-specific payload
 * }
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const BaseCommand = require('./base-command');
const { getBinaryPaths, getFullEnv, TEMP_DIR, logDebug } = require('../utils/utils');
const processManager = require('../lib/process-manager');

const DEFAULT_TIMEOUT_MS = 30000;
const PREVIEW_TIMEOUT_MS = 40000;

const quoteForShell = (arg) => `'${String(arg).replace(/'/g, `'\'"\'"\''`)}'`; // eslint-disable-line no-useless-escape

function safeInvoke(callback, ...args) {
    if (typeof callback !== 'function') return;
    try {
        callback(...args);
    } catch (err) {
        logDebug('spawnTool callback failed:', err?.message ? err.message : err);
    }
}

async function spawnTool(toolPath, args, options = {}) {
    const {
        timeoutMs,
        job = null,
        env = getFullEnv(),
        onStdout,
        onStderr,
        onExit,
        onSpawn,
        registrationType = 'processing',
        onComplete
    } = options;

    let finalArgs = args.map(arg => typeof arg === 'string' ? arg.trim() : arg);
    let outputPath = null;

    if (job?.output && job?.kind === 'preview') {
        const format = job.output.format || 'jpg';
        outputPath = path.join(TEMP_DIR, `preview-${Date.now()}.${format}`);
        finalArgs.push('-y', outputPath);
        logDebug(`📁 [spawnTool] Output path: ${outputPath}`);
    }

    const shellCmd = [toolPath, ...finalArgs].map(quoteForShell).join(' ');
    logDebug(`👨‍💻 [spawnTool] shell command: ${shellCmd}`);

    const fallbackTimeout = job?.kind === 'preview' ? PREVIEW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
    const effectiveTimeout = typeof timeoutMs === 'number' ? timeoutMs : fallbackTimeout;
    const hasTimeout = typeof effectiveTimeout === 'number' && effectiveTimeout > 0;

    return new Promise((resolve) => {
        const process = spawn(toolPath, finalArgs, { env });
        processManager.register(process, registrationType);
        safeInvoke(onSpawn, process);

        let stdout = '';
        let stderr = '';
        let killedByTimeout = false;
        let timeoutHandle = null;

        const cleanupTimeout = () => {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                timeoutHandle = null;
            }
        };

        if (hasTimeout) {
            timeoutHandle = setTimeout(() => {
                if (process && !process.killed) {
                    logDebug(`⏱️ [spawnTool] Timeout (${effectiveTimeout}ms), killing process`);
                    killedByTimeout = true;
                    process.kill('SIGTERM');
                    processManager.unregister(process);
                    resolve({
                        success: false,
                        code: null,
                        signal: 'SIGTERM',
                        stdout,
                        stderr,
                        timeout: true
                    });
                }
            }, effectiveTimeout);
        }

        const handleStdout = (chunk) => {
            const text = chunk.toString();
            stdout += text;
            safeInvoke(onStdout, chunk);
        };

        const handleStderr = (chunk) => {
            const text = chunk.toString();
            stderr += text;
            safeInvoke(onStderr, chunk);
        };

        if (process.stdout) process.stdout.on('data', handleStdout);
        if (process.stderr) process.stderr.on('data', handleStderr);

        process.once('close', (code, signal) => {
            cleanupTimeout();
            if (killedByTimeout) return;

            const result = {
                success: code === 0,
                code,
                signal: signal || null,
                stdout,
                stderr
            };

            safeInvoke(onExit, { code, signal });
            safeInvoke(onComplete, result, outputPath, stderr, job);

            logDebug(`✅ [spawnTool] Exited with code ${code}${signal ? `, signal ${signal}` : ''}`);
            resolve(result);
        });

        process.once('error', (err) => {
            cleanupTimeout();
            if (killedByTimeout) return;
            resolve({
                success: false,
                code: null,
                signal: null,
                stdout,
                stderr,
                error: err.message
            });
        });
    });
}

class RunToolCommand extends BaseCommand {
    async execute(params) {
        const { tool, args, timeoutMs, job } = params;
		
        if (!tool || !['ffprobe', 'ffmpeg'].includes(tool)) return { success: false, error: `Invalid tool: ${tool}. Must be 'ffprobe' or 'ffmpeg'.` };
        if (!Array.isArray(args)) 							return { success: false, error: 'args must be an array of strings' };

        const { ffprobePath, ffmpegPath } = getBinaryPaths();
        const toolPath = tool === 'ffprobe' ? ffprobePath : ffmpegPath;

        const result = await spawnTool(toolPath, args, {
            timeoutMs,
            job,
            onComplete: (processResult, outputPath, stderrOutput, jobMeta) => {
                if (jobMeta?.kind === 'preview' && jobMeta?.mode === 'imageDataUrl' && outputPath) {
                    processResult.data = this.buildPreviewData(outputPath, stderrOutput, jobMeta);
                }
            }
        });

        return result;
    }

    buildPreviewData(outputPath, stderr, job) {
        const data = {
            previewUrl: null,
            noVideoStream: stderr.includes('Output file does not contain any stream')
        };

        const shouldCleanup = job.output?.temp !== false;
        const format = job.output?.format || 'jpg';

        if (fs.existsSync(outputPath)) {
            try {
                const imageBuffer = fs.readFileSync(outputPath);
                const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
                data.previewUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

                if (shouldCleanup) {
                    fs.unlink(outputPath, (err) => err && logDebug('Failed to delete preview:', err));
                }
            } catch (e) {
                logDebug('Failed to read preview file:', e.message);
            }
        }

        return data;
    }
}

module.exports = RunToolCommand;
module.exports.spawnTool = spawnTool;
