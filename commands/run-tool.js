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

class RunToolCommand extends BaseCommand {
    /**
     * Execute the runTool command
     * @param {Object} params Command parameters
     * @param {string} params.tool Tool to run: 'ffprobe' | 'ffmpeg'
     * @param {string[]} params.args Command line arguments
     * @param {number} [params.timeoutMs] Timeout in milliseconds
     * @param {Object} [params.job] Job metadata
     * @returns {Promise<Object>} RawProcessResult
     */
    async execute(params) {
        const { tool, args, timeoutMs, job } = params;
        
        if (!tool || !['ffprobe', 'ffmpeg'].includes(tool)) {
            return { success: false, error: `Invalid tool: ${tool}. Must be 'ffprobe' or 'ffmpeg'.` };
        }
        
        if (!args || !Array.isArray(args)) {
            return { success: false, error: 'args must be an array of strings' };
        }
        
        // Get tool path
        const { ffprobePath, ffmpegPath } = getBinaryPaths();
        const toolPath = tool === 'ffprobe' ? ffprobePath : ffmpegPath;
        
        // Determine timeout based on job kind
        const defaultTimeout = job?.kind === 'preview' ? 40000 : 30000;
        const timeout = timeoutMs || defaultTimeout;
        
        return this.spawnTool(toolPath, args, timeout, job);
    }
    
    /**
     * Universal tool spawner
     * @param {string} toolPath Path to the tool binary
     * @param {string[]} args Command line arguments
     * @param {number} timeoutMs Timeout in milliseconds
     * @param {Object} [job] Job metadata
     * @returns {Promise<Object>} RawProcessResult
     */
    async spawnTool(toolPath, args, timeoutMs, job = null) {
        // Handle output file generation for preview jobs
        let outputPath = null;
        let finalArgs = [...args];
        
        if (job?.output && job?.kind === 'preview') {
            const format = job.output.format || 'jpg';
            outputPath = path.join(TEMP_DIR, `preview-${Date.now()}.${format}`);
            finalArgs.push('-y', outputPath);
            logDebug(`📁 [runTool] Output path: ${outputPath}`);
        }
        
        // Build shell-reproducible command for debugging
        const quoteForShell = (arg) => `'${String(arg).replace(/'/g, `'\\''`)}'`;
        const shellCmd = [toolPath, ...finalArgs].map(quoteForShell).join(' ');

        // Log for manual reproducibility
        logDebug(`👨‍💻 [runTool] shell command: ${shellCmd}`);
        
        return new Promise((resolve) => {
            const proc = spawn(toolPath, finalArgs, { env: getFullEnv() });
            processManager.register(proc, 'processing');
            
            let stdout = '';
            let stderr = '';
            let killedByTimeout = false;
            
            const timeoutHandle = setTimeout(() => {
                if (proc && !proc.killed) {
                    logDebug(`⏱️ [runTool] Timeout (${timeoutMs}ms), killing process`);
                    killedByTimeout = true;
                    proc.kill('SIGTERM');
                    processManager.unregister(proc);
                }
                resolve({
                    success: false,
                    code: null,
                    signal: 'SIGTERM',
                    stdout,
                    stderr,
                    timeout: true
                });
            }, timeoutMs);
            
            proc.stdout.on('data', (d) => stdout += d.toString());
            proc.stderr.on('data', (d) => stderr += d.toString());
            
            proc.on('close', (code, signal) => {
                clearTimeout(timeoutHandle);
                
                if (killedByTimeout) return;
                
                logDebug(`✅ [runTool] Exited with code ${code}${signal ? `, signal ${signal}` : ''}`);
                
                // Build result
                // Note: We do NOT set 'error' for non-zero exit codes - it's reserved for spawn errors only.
                // Setting 'error' would cause nativeHostService to reject the promise,
                // preventing the extension from processing stderr for stream info.
                const result = {
                    success: code === 0,
                    code,
                    signal: signal || null,
                    stdout,
                    stderr
                };
                
                // Handle job-specific post-processing
                if (job?.kind === 'preview' && job?.mode === 'imageDataUrl' && outputPath) {
                    result.data = this.buildPreviewData(outputPath, stderr, job);
                }
                
                resolve(result);
            });
            
            proc.on('error', (err) => {
                clearTimeout(timeoutHandle);
                if (!killedByTimeout) {
                    resolve({
                        success: false,
                        code: null,
                        signal: null,
                        stdout,
                        stderr,
                        error: err.message
                    });
                }
            });
        });
    }
	
    /**
     * Build preview-specific data payload
     * Note: Stream info parsing happens on extension side using stderr
     * @param {string} outputPath Path to generated preview file
     * @param {string} stderr FFmpeg stderr output
     * @param {Object} job Job metadata
     * @returns {Object} Preview data
     */
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
