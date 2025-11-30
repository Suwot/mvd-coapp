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
    async execute(params) {
        const { url, headers = {}, duration, type } = params;
        logDebug('Generating preview for video:', url);
        
        if (url.startsWith('blob:')) {
            const error = 'Cannot generate preview for blob URLs';
            this.sendMessage({ error });
            return { error };
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
                    '-probesize', '3M',
                    '-f', 'hls'
                );
                    
				// Add HLS query parameter inheritance for specific domains
				const inheritQueryParams = shouldInheritHlsQueryParams(url);
				
				if (inheritQueryParams) {
					args.push('-hls_inherit_query_params', '1');
					logDebug('🔗 Enabling HLS query parameter inheritance for URL:', url);
				}
            } else if (type === 'dash') {
                args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto,subfile,data', '-probesize', '3M', '-dash_allow_hier_sidx', '1');
            }
            
            // Add input, timestamp, and output options
            args.push('-i', url, '-ss', timestamp, '-vf', 'scale=120:-2', '-q:v', '2', '-nostdin', '-f', 'image2', '-frames:v', '1', '-update', '1', '-y', previewPath);
            
            logDebug('🎬 FFmpeg preview command:', ffmpegPath, args.join(' '));
            
            return Promise.race([
                this.runFFmpeg(ffmpegPath, args, previewPath),
                this.timeoutPromise(40000)
            ]);
        } catch (err) {
            logDebug('Preview generation error:', err);
            this.sendMessage({ error: err.message });
            return { error: err.message };
        }
    }
    
    runFFmpeg(ffmpegPath, args, previewPath) {
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, args, { env: getFullEnv() });
            processManager.register(ffmpeg, 'processing');
            
            let errorOutput = '';
            ffmpeg.stderr.on('data', data => errorOutput += data.toString());
            
            ffmpeg.on('close', code => {
                // Always parse stream info from stderr
                const streamInfo = this.parseStreamInfo(errorOutput);
                logDebug('Parsed stream info:', streamInfo);

                if (code === 0) {
                    try {
                        const imageBuffer = fs.readFileSync(previewPath);
                        const dataUrl = 'data:image/jpeg;base64,' + imageBuffer.toString('base64');
                        fs.unlink(previewPath, err => err && logDebug('Failed to delete preview file:', err));
                        
                        this.sendMessage({ previewUrl: dataUrl, success: true, streamInfo });
                        resolve({ success: true, previewUrl: dataUrl, streamInfo });
                    } catch (err) {
                        const error = `Failed to read preview file: ${err.message}`;
                        logDebug(error);
                        this.sendMessage({ error });
                        reject(new Error(error));
                    }
                } else {
                    // Check if process was killed (code null = killed)
                    if (code === null) {
                        // Process was killed (likely by cache clear) - exit silently
                        reject(new Error('killed'));
                    } else {
                        // Check for specific "no video stream" error
                        if (errorOutput.includes('Output file does not contain any stream')) {
                            const error = 'No video stream found';
                            logDebug('FFmpeg preview generation failed: No video stream detected');
                            
                            // Send as success:false but with specific flag and stream info
                            this.sendMessage({ success: false, noVideoStream: true, streamInfo });
                            resolve({ success: false, noVideoStream: true, streamInfo });
                            return;
                        }

                        const error = `FFmpeg failed with code ${code}: ${errorOutput}`;
                        logDebug('FFmpeg preview generation failed:', error);
                        this.sendMessage({ error });
                        reject(new Error(error));
                    }
                }
            });
            
            ffmpeg.on('error', err => {
                logDebug('FFmpeg process error:', err);
                this.sendMessage({ error: err.message });
                reject(err);
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
    
    timeoutPromise(ms) {
        return new Promise(resolve => {
            setTimeout(() => {
                logDebug(`Preview generation timeout after ${ms/1000} seconds`);
                this.sendMessage({ timeout: true, success: false });
                resolve({ timeout: true, success: false });
            }, ms);
        });
    }
}

module.exports = GeneratePreviewCommand;
