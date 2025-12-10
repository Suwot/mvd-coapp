/**
 * GeneratePreviewCommand – Video thumbnail generator
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const BaseCommand = require('./base-command');
const { logDebug, getFullEnv, getBinaryPaths, shouldInheritHlsQueryParams, TEMP_DIR } = require('../utils/utils');
const processManager = require('../lib/process-manager');

class GeneratePreviewCommand extends BaseCommand {
    /**
     * ⚠️ LEGACY COMMAND – To be removed after extension v0.19.0+ migration
     * 
     * This command implements the old smart-worker pattern where the CoApp
     * builds FFmpeg arguments, runs the process, and parses output.
     * 
     * New flow (v0.19.0+): Use `runTool` command for dumb-worker pattern
     * where extension controls args and parsing.
     * 
     * Current implementation supports both flows temporarily for backward compatibility.
     */

    /**
     * Execute the generatePreview command
     * @param {Object} params Command parameters
     * @param {string} params.url Video URL
     * @param {Object} [params.headers] HTTP headers
     * @param {number} [params.duration] Video duration in seconds
     * @param {string} [params.type] Media type: 'hls', 'dash', 'direct'
     * @returns {Promise<Object>} Preview result
     */
    async execute(params) {
        const { url, headers = {}, duration, type } = params;
        logDebug('Generating preview for video:', url);
        
        if (url.startsWith('blob:')) {
            const error = 'Cannot generate preview for blob URLs';
            return { success: false, error };
        }
        
        if (headers && Object.keys(headers).length > 0) {
            logDebug('🔑 Using headers for preview request:', Object.keys(headers));
        }
		
        try {
            const { ffmpegPath } = getBinaryPaths();
            const previewPath = path.join(TEMP_DIR, `video-preview-${Date.now()}.jpg`);
            
            // Calculate timestamp (10% into video, 1-5s range)
            let timestamp = '00:00:01';
            if (duration) {
                const durationSecs = parseFloat(duration);
                if (!isNaN(durationSecs) && durationSecs > 0) {
                    const previewTime = Math.min(Math.max(durationSecs * 0.1, 1), 5);
                    timestamp = new Date(previewTime * 1000).toISOString().substring(11, 19);
                    logDebug(`Using smart timestamp: ${timestamp}`);
                }
            }
            
            // Build FFmpeg arguments
            const args = [];
            
            // Add headers if provided
            if (headers && Object.keys(headers).length > 0) {
                const headerLines = Object.entries(headers)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\r\n');
                if (headerLines) args.push('-headers', headerLines + '\r\n');
            }
            
            // Add format-specific options
            if (type === 'hls') {
                args.push(
                    '-skip_png_bytes', '1',
                    '-allowed_extensions', 'ALL',
                    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,subfile,data',
                    '-probesize', '64k',
                    '-analyzeduration', '500000',
                    '-f', 'hls'
                );
                    
				// Add HLS query parameter inheritance for specific domains
				const inheritQueryParams = shouldInheritHlsQueryParams(url);
				
				if (inheritQueryParams) {
					args.push('-hls_inherit_query_params', '1');
					logDebug('🔗 Enabling HLS query parameter inheritance for URL:', url);
				}
            } else if (type === 'dash') {
                args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto,subfile,data', '-probesize', '64k', '-analyzeduration', '500000', '-dash_allow_hier_sidx', '1');
            }
            
            // Add robustness flags
            args.push(
                '-fflags', '+discardcorrupt+genpts',
                '-err_detect', 'ignore_err'
            );
            
            // Add global timeouts
            args.push('-rw_timeout', '5000000');
            
            // Add input, timestamp, and output options
            args.push(
                '-i', url,
                '-ss', timestamp,
                '-an',
                '-sn',
                '-vf', 'scale=120:-2',
                '-q:v', '2',
				'-strict', 'unofficial',
                '-nostdin',
                '-f', 'image2',
                '-frames:v', '1',
                '-update', '1',
                '-y', previewPath
            );
            
            logDebug('🎬 FFmpeg preview command:', ffmpegPath, args.join(' '));
            
            return this.runFFmpeg(ffmpegPath, args, previewPath);
        } catch (err) {
            logDebug('Preview generation error:', err);
            return { success: false, error: err.message };
        }
    }
    
    runFFmpeg(ffmpegPath, args, previewPath) {
        return new Promise((resolve) => {
            const ffmpeg = spawn(ffmpegPath, args, { env: getFullEnv() });
            processManager.register(ffmpeg, 'processing');
            let killedByTimeout = false;
            
            // Set timeout for preview generation
            const timeout = setTimeout(() => {
                if (ffmpeg && !ffmpeg.killed) {
                    logDebug('Killing FFmpeg process due to timeout');
                    killedByTimeout = true;
                    ffmpeg.kill('SIGTERM');
                    processManager.unregister(ffmpeg);
                }
                logDebug('Preview generation timeout after 40 seconds');
                resolve({ success: false, timeout: true });
            }, 40000); // 40 second timeout for preview generation
            
            let errorOutput = '';
            ffmpeg.stderr.on('data', data => errorOutput += data.toString());
            
            ffmpeg.on('close', (code, signal) => {
                clearTimeout(timeout);
                
                // If killed by timeout, don't process results
                if (killedByTimeout) {
                    logDebug('FFmpeg process was killed by timeout, skipping result processing');
                    return; // Promise already resolved by timeout handler
                }
                
                // Always parse stream info from stderr
                const streamInfo = errorOutput.length > 0 ? this.parseStreamInfo(errorOutput) : {};
                logDebug('Parsed stream info:', streamInfo);

                if (code === 0) {
                    try {
                        if (fs.existsSync(previewPath)) {
                            const imageBuffer = fs.readFileSync(previewPath);
                            const dataUrl = 'data:image/jpeg;base64,' + imageBuffer.toString('base64');
                            fs.unlink(previewPath, err => err && logDebug('Failed to delete preview file:', err));
                            
                            resolve({ success: true, previewUrl: dataUrl, streamInfo });
                        } else {
                            const error = 'Preview file was not created';
                            logDebug(error);
                            resolve({ success: false, error });
                        }
                    } catch (err) {
                        const error = `Failed to read preview file: ${err.message}`;
                        logDebug(error);
                        // Try to delete orphan file
                        if (fs.existsSync(previewPath)) {
                            fs.unlink(previewPath, err => err && logDebug('Failed to delete orphan preview file:', err));
                        }
                        resolve({ success: false, error });
                    }
                } else {
                    // Check if process was killed by signal
                    if (signal) {
                        resolve({ success: false, killed: true });
                    } else {
                        // Check for specific "no video stream" error
                        if (errorOutput.includes('Output file does not contain any stream')) {
                            const error = 'No video stream found';
                            logDebug('FFmpeg preview generation failed: No video stream detected');
                            
                            // Delete any orphan file
                            if (fs.existsSync(previewPath)) {
                                fs.unlink(previewPath, err => err && logDebug('Failed to delete orphan preview file:', err));
                            }
                            
                            resolve({ success: false, noVideoStream: true, streamInfo });
                            return;
                        }

                        const error = `FFmpeg failed with code ${code}: ${errorOutput}`;
                        logDebug('FFmpeg preview generation failed:', error);
                        
                        // Delete any orphan file
                        if (fs.existsSync(previewPath)) {
                            fs.unlink(previewPath, err => err && logDebug('Failed to delete orphan preview file:', err));
                        }
                        
                        resolve({ success: false, error });
                    }
                }
            });
            
            ffmpeg.on('error', err => {
                clearTimeout(timeout);
                
                // Don't send duplicate error if already killed by timeout
                if (!killedByTimeout) {
                    logDebug('FFmpeg process error:', err);
                    resolve({ success: false, error: err.message });
                }
            });
        });
    }

    parseStreamInfo(output) {
        const info = {};

        // Parse Video Stream, e.g. Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 4996 kb/s, 25 fps...
        const videoMatch = output.match(/Stream #\d+:\d+(?:\([^)]+\))?: Video: ([^,]+), .*?(\d+x\d+)(?:.*?, (\d+) kb\/s)?/);
        if (videoMatch) {
            info.video = {
                codec: videoMatch[1].trim().split(' ')[0], // Take first word (e.g. "h264" from "h264 (High)")
                resolution: videoMatch[2],
                bitrate: videoMatch[3] ? parseInt(videoMatch[3]) * 1000 : null // kb/s to bps, or null
            };
            
            // Try to extract FPS separately as it's not always in the same position
            const fpsMatch = output.match(/, (\d+(?:\.\d+)?) fps/);
            if (fpsMatch) info.video.fps = Math.round(parseFloat(fpsMatch[1]));
        }

        // Parse Audio Stream, e.g. Stream #0:1(und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s
        const audioMatch = output.match(/Stream #\d+:\d+(?:\([^)]+\))?: Audio: ([^,]+), (\d+) Hz, ([^,]+)(?:, [^,]+, (\d+) kb\/s)?/);
        if (audioMatch) {
            info.audio = {
                codec: audioMatch[1].trim(),
                sampleRate: parseInt(audioMatch[2]),
                channels: audioMatch[3].trim(),
                bitrate: audioMatch[4] ? parseInt(audioMatch[4]) * 1000 : null // kb/s to bps, or null
            };
        }

        return info;
    }
}

module.exports = GeneratePreviewCommand;
