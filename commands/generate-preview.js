/**
 * GeneratePreviewCommand – Video thumbnail generator
 * - Creates thumbnail previews from video URLs
 * - Uses FFmpeg to extract frames from remote videos
 * - Converts thumbnails to base64 data URLs
 * - Handles various video source formats
 * - Optimizes thumbnails for UI display
 * - Implements temporary file management
 * - Reports preview generation progress and errors
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const BaseCommand = require('./base-command');
const { logDebug } = require('../utils/logger');
const { getFullEnv } = require('../utils/resources');
const processManager = require('../lib/process-manager');

/**
 * Command for generating video previews/thumbnails
 */
class GeneratePreviewCommand extends BaseCommand {
    /**
     * Execute the preview generation command
     * @param {Object} params Command parameters
     * @param {string} params.url Video URL to generate preview for
     */
    async execute(params) {
        const { url, headers = {}, duration, type } = params;
        logDebug('Generating preview for video:', url);
        
        // Skip for blob URLs
        if (url.startsWith('blob:')) {
            const error = 'Cannot generate preview for blob URLs';
            this.sendMessage({ error: error });
            return { error: error };
        }
        
        // Log received headers
        if (headers && Object.keys(headers).length > 0) {
            logDebug('🔑 Using headers for preview request:', Object.keys(headers));
        }
        
        try {
            // Get required services
            const ffmpegService = this.getService('ffmpeg');
            
            return new Promise((resolve, reject) => {
                const previewPath = path.join(process.env.HOME || os.homedir(), '.cache', 'video-preview-' + Date.now() + '.jpg');
                let ffmpeg = null;
                let killedByTimeout = false;
                
                // Set a timeout to prevent hanging
                const timeout = setTimeout(() => {
                    if (ffmpeg && !ffmpeg.killed) {
                        logDebug('Killing FFmpeg process due to timeout');
                        killedByTimeout = true;
                        ffmpeg.kill('SIGKILL');
                    }
                    // Send a clean timeout response instead of an error
                    logDebug('Preview generation timeout after 30 seconds');
                    this.sendMessage({ timeout: true, success: false });
                    resolve({ timeout: true, success: false });
                }, 40000); // 40 second timeout for preview generation
                
                // Calculate ideal timestamp based on duration if available
                let timestamp = '00:00:01'; // Default timestamp
                if (duration) {
                    // Choose 10% into the video, but not less than 1 sec and not more than 5 secs
                    const durationSecs = parseFloat(duration);
                    if (!isNaN(durationSecs) && durationSecs > 0) {
                        const previewTime = Math.min(Math.max(durationSecs * 0.1, 1), 5);
                        timestamp = new Date(previewTime * 1000).toISOString().substring(11, 19);
                        logDebug(`Using smart timestamp for preview: ${timestamp} (${previewTime}s, 10% of ${durationSecs}s duration)`);
                    }
                }
                
                // Build FFmpeg args
                let ffmpegArgs = ['-ss', timestamp];  // Skip to smart timestamp
                
                // Add headers if provided
                if (headers && Object.keys(headers).length > 0) {
                    // Format headers for FFmpeg as "Key: Value\r\n" pairs
                    const headerLines = Object.entries(headers)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join('\r\n');
                    
                    if (headerLines) {
                        ffmpegArgs.push('-headers', headerLines + '\r\n');
                    }
                }
                
                // Apply format-specific options based on video type
                if (type === 'hls') {
                    ffmpegArgs.push(
                        '-allowed_extensions', 'ALL',
                        '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
                        '-probesize', '3M'
                    );
                } else if (type === 'dash') {
                    ffmpegArgs.push(
                        '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
                        '-probesize', '3M',
                        '-dash_allow_hier_sidx', '1'
                    );
                }
                // Direct media types use default FFmpeg protocol handling (no special options needed)
                
                // Add the rest of the arguments
                ffmpegArgs = ffmpegArgs.concat([
                    '-i', url,
                    '-vframes', '1',     // Extract one frame
                    '-vf', 'scale=120:-1',  // Scale to 120px width
                    '-q:v', '2',         // High quality
                    previewPath
                ]);
                
                // Log the complete FFmpeg command for debugging
                const ffmpegPath = ffmpegService.getFFmpegPath();
                const commandLine = `${ffmpegPath} ${ffmpegArgs.join(' ')}`;
                logDebug('🎬 FFmpeg preview command:', commandLine);
                
                ffmpeg = spawn(ffmpegPath, ffmpegArgs, { env: getFullEnv() });
                processManager.register(ffmpeg);
        
                let errorOutput = '';
        
                ffmpeg.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });
        
                ffmpeg.on('close', (code) => {
                    clearTimeout(timeout);
                    
                    // If killed by timeout, don't try to process the file
                    if (killedByTimeout) {
                        logDebug('FFmpeg process was killed by timeout, skipping file processing');
                        return; // Promise already rejected by timeout handler
                    }
                    
                    if (code === 0) {
                        try {
                            // Convert image to data URL
                            const imageBuffer = fs.readFileSync(previewPath);
                            const dataUrl = 'data:image/jpeg;base64,' + imageBuffer.toString('base64');
                            this.sendMessage({ previewUrl: dataUrl, success: true });
                            // Clean up
                            fs.unlink(previewPath, (err) => {
                                if (err) logDebug('Failed to delete preview file:', err);
                            });
                            resolve({ success: true, previewUrl: dataUrl });
                        } catch (err) {
                            logDebug('Failed to read preview file:', err);
                            this.sendMessage({ error: 'Failed to read preview file: ' + err.message });
                            reject(err);
                        }
                    } else {
                        const error = `Failed to generate preview. FFmpeg exited with code ${code}: ${errorOutput}`;
                        logDebug('FFmpeg preview generation failed:', error);
                        this.sendMessage({ error: error });
                        reject(new Error(error));
                    }
                });
        
                ffmpeg.on('error', (err) => {
                    clearTimeout(timeout);
                    
                    // Don't send duplicate error if already killed by timeout
                    if (!killedByTimeout) {
                        logDebug('FFmpeg process error:', err);
                        this.sendMessage({ error: err.message });
                        reject(err);
                    }
                });
            });
        } catch (err) {
            logDebug('Preview generation error:', err);
            this.sendMessage({ error: err.message });
            return { error: err.message };
        }
    }
}

module.exports = GeneratePreviewCommand;
