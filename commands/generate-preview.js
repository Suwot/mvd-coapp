/**
 * GeneratePreviewCommand – Video thumbnail generator
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const BaseCommand = require('./base-command');
const { logDebug, getFullEnv, getFFmpegPaths } = require('../utils/utils');
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
            const { ffmpegPath } = getFFmpegPaths();
            const previewPath = path.join(os.homedir(), '.cache', `video-preview-${Date.now()}.jpg`);
            
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
                args.push('-allowed_extensions', 'ALL', '-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-probesize', '3M');
            } else if (type === 'dash') {
                args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-probesize', '3M', '-dash_allow_hier_sidx', '1');
            }
            
            // Add input, timestamp, and output options
            args.push('-i', url, '-ss', timestamp, '-vframes', '1', '-vf', 'scale=120:-2', '-q:v', '2', previewPath);
            
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
            processManager.register(ffmpeg);
            
            let errorOutput = '';
            ffmpeg.stderr.on('data', data => errorOutput += data.toString());
            
            ffmpeg.on('close', code => {
                if (code === 0) {
                    try {
                        const imageBuffer = fs.readFileSync(previewPath);
                        const dataUrl = 'data:image/jpeg;base64,' + imageBuffer.toString('base64');
                        fs.unlink(previewPath, err => err && logDebug('Failed to delete preview file:', err));
                        
                        this.sendMessage({ previewUrl: dataUrl, success: true });
                        resolve({ success: true, previewUrl: dataUrl });
                    } catch (err) {
                        const error = `Failed to read preview file: ${err.message}`;
                        logDebug(error);
                        this.sendMessage({ error });
                        reject(new Error(error));
                    }
                } else {
                    const error = `FFmpeg failed with code ${code}: ${errorOutput}`;
                    logDebug('FFmpeg preview generation failed:', error);
                    this.sendMessage({ error });
                    reject(new Error(error));
                }
            });
            
            ffmpeg.on('error', err => {
                logDebug('FFmpeg process error:', err);
                this.sendMessage({ error: err.message });
                reject(err);
            });
        });
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
