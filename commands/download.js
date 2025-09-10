/**
 * DownloadCommand – Central command class for orchestrating video/audio downloads using FFmpeg.
 * - Receives download/cancel requests from the extension and validates parameters.
 * - Determines the correct container format and output filename based on user input, media type, and source data.
 * - Constructs FFmpeg command-line arguments for HLS, DASH, and direct media, including support for HTTP headers and stream selection.
 * - Ensures output file uniqueness and resolves save paths, defaulting to Desktop if unspecified.
 * - Probes media duration with ffprobe if not provided, to enable accurate progress tracking.
 * - Launches FFmpeg as a child process, tracks progress via ProgressTracker, and relays updates to the UI.
 * - Handles download cancellation, process cleanup, and partial file removal.
 * - Logs all key actions, errors, and data flow for transparency and debugging.
 * - Maintains a static map of active download processes for robust cancellation and status management.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const BaseCommand = require('./base-command');
const { logDebug } = require('../utils/logger');
const { getFullEnv } = require('../utils/resources');
const processManager = require('../lib/process-manager');

// Command for downloading videos
class DownloadCommand extends BaseCommand {
    // Static Map for download tracking keyed by downloadId
    static activeDownloads = new Map();

    // Initialize progress tracking state for a download
    initProgressState(downloadId, { type, duration, fileSizeBytes, downloadUrl, isLive }) {
        const now = Date.now();
        return {
            // Basic info
            downloadId,
            type,
            downloadUrl,
            startTime: now,
            
            // Metadata
            duration: duration || 0,
            fileSizeBytes: fileSizeBytes || 0,
            isLive: isLive || false, // Track if this is a livestream
			strategy: isLive ? 'livestream' : (duration ? 'time' : 'size'),

            // Windowed speed calc (10s sliding window of unique byte steps)
            byteSamples: [],            // Array<{t:number, b:number}>, t=Date.now(), b=downloadedBytes
            lastRecordedBytes: 0,       // For de-duping identical total_size updates
            
            // Current progress
            currentTime: 0,
            downloadedBytes: 0,
            currentSegment: 0,            
            // For progress throttling
            lastProgressUpdate: 0,
            lastProgressPercent: 0,
            errorLines: [],
			finalProcessedTime: null, // Final processed time from FFmpeg
            finalStats: null
        };
    }

    // Process FFmpeg stderr output for progress and error collection
    processFFmpegOutput(output, progressState) {
        // Always collect potential error lines
        this.collectErrorLines(output, progressState);
        
        // Parse progress data and send updates
        this.parseAndSendProgress(output, progressState);
        
        // Parse final stats if this is the end
        if (output.includes('progress=end')) {
            this.parseFinalStats(output, progressState);
        }
    }

    // Collect error lines for later use (only attached to message on exitCode !== 0)
    collectErrorLines(output, progressState) {
        const errorKeywords = ['error', 'failed', 'not found', 'permission denied', 'connection refused', 'no such file'];
        
        const lines = output.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && errorKeywords.some(keyword => trimmed.toLowerCase().includes(keyword))) {
                progressState.errorLines.push(trimmed);
                // Keep only last 10 error lines to prevent memory bloat
                if (progressState.errorLines.length > 10) {
                    progressState.errorLines.shift();
                }
            }
        }
    }

    // Record a byte sample only when downloadedBytes increases; keep ~12s history
    recordByteSample(progressState, nowMs) {
        const b = progressState.downloadedBytes || 0;
        if (b <= progressState.lastRecordedBytes) {
            return;
        }
        progressState.lastRecordedBytes = b;
        progressState.byteSamples.push({ t: nowMs, b });
        // Prune to last 12 seconds to give a little buffer over the 10s window
        const cutoff = nowMs - 12000;
        while (progressState.byteSamples.length > 0 && progressState.byteSamples[0].t < cutoff) {
            progressState.byteSamples.shift();
        }
    }

    // Compute average bytes/sec over the last `windowSec` seconds (default 10)
    // Uses a virtual "now" sample so stalls decay toward 0 instead of spiking.
    computeWindowedSpeed(progressState, nowMs, windowSec = 10) {
        const samples = progressState.byteSamples;
        if (!samples || samples.length === 0) return 0;
        const windowMs = windowSec * 1000;
        const windowStart = nowMs - windowMs;
  
        // Prune here as well in case no new bytes arrived (recordByteSample won't run)
        while (samples.length > 0 && samples[0].t < nowMs - 12000) {
            samples.shift();
        }
        if (samples.length === 0) return 0;
  
        // Last known bytes/time from FFmpeg
        const last = samples[samples.length - 1];
  
        // If the last sample is older than the window, then there was no activity in-window.
        // Return 0 and avoid division by tiny dt.
        if (last.t <= windowStart) {
            const dt = nowMs - windowStart;
            if (dt <= 0) return 0;
            return 0;
        }
  
        // Find the oldest sample within the window [windowStart, now]
        let i = 0;
        while (i < samples.length && samples[i].t < windowStart) i++;
  
        // If the window begins between two samples, we could interpolate bytes at windowStart.
        const oldest = samples[i] || last;
  
        // Use a virtual "now" sample with the last known byte count.
        const newestTime = nowMs;
        const newestBytes = last.b;
  
        const dt = Math.max(1, newestTime - oldest.t); // ms
        const db = Math.max(0, newestBytes - oldest.b); // bytes
        return (db * 1000) / dt; // bytes/sec
    }

    // Parse progress data and send throttled updates to UI
    parseAndSendProgress(output, progressState) {
        let hasUpdate = false;
        
        // Parse time data (out_time_ms is in microseconds despite the name)
        const outTimeMs = output.match(/out_time_ms=(\d+)/);
        if (outTimeMs) {
            const timeUs = parseInt(outTimeMs[1], 10);
            progressState.currentTime = timeUs / 1000000; // Convert to seconds
            progressState.finalProcessedTime = timeUs / 1000000; // Store for termination messages
            hasUpdate = true;
        }
        
        // Parse size data
        const totalSize = output.match(/total_size=(\d+)/);
        if (totalSize) {
            const prevBytes = progressState.downloadedBytes || 0;
            progressState.downloadedBytes = parseInt(totalSize[1], 10);
            // Record a speed sample only on monotonic increase of total bytes
            const nowMsForSample = Date.now();
            if (progressState.downloadedBytes > prevBytes) {
                this.recordByteSample(progressState, nowMsForSample);
            }
            hasUpdate = true;
        }

        // Only track segments for HLS type
        if (progressState.type === 'hls') {
            if (output.includes('Opening ') && output.includes(' for reading')) {
                // Match any file being opened for reading, regardless of extension
                const segmentMatch = output.match(/Opening\s+['"]([^'"]+)['"] for reading/);
                if (segmentMatch) {
                    progressState.currentSegment++;
                    hasUpdate = true;
                }
            }
        }
        
        // Send throttled progress updates
        if (hasUpdate) {
            this.sendProgressUpdate(progressState);
        }
    }

    // Calculate and send progress update (throttled)
    sendProgressUpdate(progressState) {
        const now = Date.now();
        
        // Check if download was already canceled - prevent late progress updates
        const downloadEntry = DownloadCommand.activeDownloads.get(progressState.downloadId);
        if (!downloadEntry || downloadEntry.wasCanceled) {
            logDebug('Skipping progress update for canceled download:', progressState.downloadId);
            return;
        }
        
        const strategy = progressState.strategy;

        // Calculate progress based on selected strategy
        let progress = 0;
        if (strategy === 'livestream') {
            progress = -1; // Special value indicating livestream (no percentage)
        } else if (strategy === 'time') {
            if (progressState.duration > 0 && progressState.currentTime > 0) {
                progress = (progressState.currentTime / progressState.duration) * 100;
            }
        } else if (strategy === 'size') {
            if (progressState.fileSizeBytes > 0 && progressState.downloadedBytes > 0) {
                progress = (progressState.downloadedBytes / progressState.fileSizeBytes) * 100;
            }
        }

        // Cap at 99.9% until we get final completion
        progress = Math.min(99.9, Math.max(0, progress));

        const progressPercent = strategy === 'livestream' ? -1 : Math.round(progress * 10) / 10; // 1 decimal place
        
        // Throttle updates: only send if significant change or time elapsed
        const significantChange = Math.abs(progressPercent - progressState.lastProgressPercent) >= 0.5;
        const timeElapsed = now - progressState.lastProgressUpdate > 250; // 250ms throttle
        
        if (significantChange || timeElapsed) {
            // Calculate speed using a 10-second sliding window of unique byte deltas
            const speed = this.computeWindowedSpeed(progressState, now, 10);
            const elapsedSeconds = (now - progressState.startTime) / 1000; // kept for UI elapsed timer
            
            // Build progress data matching original structure
            const progressData = {
                progress: progressPercent,
                speed: Math.round(speed),
                elapsedTime: Math.round(elapsedSeconds),
                type: progressState.type,
                strategy,
                speedWindowSec: 10,
                isLive: progressState.isLive, // used to determine dl-tooltip presence
                downloadedBytes: progressState.downloadedBytes,
                totalBytes: progressState.fileSizeBytes || null,
                currentTime: Math.round(progressState.currentTime),
                totalDuration: progressState.isLive ? null : Math.round(progressState.duration),
				currentSegment: progressState.currentSegment || null,
                eta: progressState.isLive ? null : (progress > 0 && speed > 0 ? Math.round(((100 - progress) / 100) * (progressState.fileSizeBytes || (progressState.downloadedBytes / (progress / 100))) / speed) : null)
            };
            
            // Send progress message with only progress data
            this.sendMessage({
                command: 'download-progress',
                downloadId: progressState.downloadId,
                ...progressData
            }, { useMessageId: false });
            
            progressState.lastProgressUpdate = now;
            progressState.lastProgressPercent = progressPercent;
        }
    }

    // Parse final download statistics from FFmpeg output
    parseFinalStats(output, progressState) {
        const stats = {};
        
        // Parse stream sizes: video:0kB audio:7405kB subtitle:0kB other streams:0kB
        // Convert to bytes for consistency with original structure
		const streamMatch = output.match(/video:(\d+)(?:kB|KiB|KB) audio:(\d+)(?:kB|KiB|KB) subtitle:(\d+)(?:kB|KiB|KB) other streams:(\d+)(?:kB|KiB|KB)/);
        if (streamMatch) {
            stats.videoSize = parseInt(streamMatch[1], 10) * 1024; // Convert KB to bytes
            stats.audioSize = parseInt(streamMatch[2], 10) * 1024; // Convert KB to bytes  
            stats.subtitleSize = parseInt(streamMatch[3], 10) * 1024; // Convert KB to bytes
            stats.otherSize = parseInt(streamMatch[4], 10) * 1024; // Convert KB to bytes
        }
        
        // Parse total size: total_size=7694941
        const totalSizeMatch = output.match(/total_size=(\d+)/);
        if (totalSizeMatch) {
            stats.totalSize = parseInt(totalSizeMatch[1], 10);
        }
        
        // Parse final bitrate: bitrate=  95.0kbits/s (keep as kbps, round to integer)
        const bitrateMatch = output.match(/bitrate=\s*([\d.]+)kbits\/s/);
        if (bitrateMatch) {
            stats.bitrateKbps = Math.round(parseFloat(bitrateMatch[1]));
        }
        
        progressState.finalStats = stats;
        logDebug('Parsed final download stats:', stats);
    }

    // Get error message from collected error lines (for any error case)
    getErrorMessage(progressState) {
        if (!progressState.errorLines.length) {
            return null;
        }
        
        return progressState.errorLines.join('\n');
    }

    /**
     * Cancel an ongoing download by downloadId
     * @param {Object} params Command parameters
     * @param {string} params.downloadId The download ID to cancel
     */
    async cancelDownload(params) {
        const downloadId = params.downloadId;
        logDebug('Canceling download with downloadId:', downloadId);
        
        // Find download by downloadId
        const downloadEntry = DownloadCommand.activeDownloads.get(downloadId);
        if (!downloadEntry) {
            logDebug('No active download found for:', downloadId);
            
            // Send confirmation when no process exists - UI needs it
            this.sendMessage({
                command: 'download-canceled',
                downloadId
            }, { useMessageId: false });
            return;
        }
        
        const { process, type, container } = downloadEntry;
        
        try {
            // 1. Mark as canceled for close handler detection
            downloadEntry.wasCanceled = true;

            // 2. Terminate FFmpeg process (will trigger close/error handler)
            if (process && process.pid && !process.killed) {
                logDebug('Terminating FFmpeg process with PID:', process.pid);
                
                // Send SIGTERM for graceful termination (FFmpeg handles this properly)
                try {
                    process.kill('SIGTERM');
                    logDebug('Sent SIGTERM to FFmpeg for graceful termination');
                } catch (termError) {
                    logDebug('Could not send SIGTERM:', termError.message);
                }
                
                // Force kill with SIGKILL after shorter delay for faster cancellation
                setTimeout(() => {
                    if (process && process.pid && !process.killed) {
                        logDebug('FFmpeg still running after SIGTERM, sending SIGKILL');
                        try {
                            process.kill('SIGKILL'); // Use SIGKILL for immediate termination
                        } catch (killError) {
                            logDebug('Error sending SIGKILL:', killError.message);
                        }
                    }
                }, 6000); // Reduced from 8000ms to 2000ms for faster response
            }            
        } catch (error) {
            logDebug('Error during download cancellation:', error);
            // Process termination will still trigger close/error handler
        }
    }

    /**
     * Execute the download command
     * @param {Object} params Command parameters
     * @param {string} params.command The command type ('download' or 'cancel-download')
     * @param {string} params.downloadUrl Video URL to download
     * @param {string} params.filename Filename to save as
     * @param {string} params.savePath Path to save file to
     * @param {string} params.type Media type ('hls', 'dash', 'direct')
     * @param {string} params.container Container format from extension (required)
     * @param {boolean} params.audioOnly Whether to download audio only (optional)
     * @param {boolean} params.subsOnly Whether to download subtitles only (optional)
     * @param {string} params.streamSelection Stream selection spec for DASH (optional)
     * @param {Array} params.inputs Array of input objects for HLS advanced mode (optional)
     * @param {Object} params.duration Video duration (optional)
     * @param {Object} params.headers HTTP headers to use (optional)
     * @param {boolean} params.isLive Whether this is a livestream (optional)
     * @param {string} params.audioLabel Audio track label for filename generation (optional)
     * @param {string} params.subsLabel Subtitle track label for filename generation (optional)
     * @param {boolean} params.allowOverwrite Whether to allow overwriting existing files (optional)
     */
    async execute(params) {
        const { command } = params;
        
        // Route to appropriate method based on command
        if (command === 'cancel-download') {
            return await this.cancelDownload(params);
        } else {
            return await this.executeDownload(params);
        }
    }

    /**
     * Execute the download command
     * @param {Object} params Command parameters (same as execute above)
     */
    async executeDownload(params) {
        const {
            downloadUrl,
            filename,
            savePath,
            type,
            container,
            audioOnly = false,
            subsOnly = false,
            streamSelection,
            headers = {},
            sourceAudioCodec = null,
            sourceAudioBitrate = null,
            fileSizeBytes = null,
            duration = null,
            downloadId = null,
            isLive = false,
            audioLabel = null,
            subsLabel = null,
            allowOverwrite = false
        } = params;

        // Use downloadId directly from extension (no need to generate sessionId)
        if (!downloadId) {
            throw new Error('downloadId is required for download tracking');
        }

        logDebug('Starting download with downloadId:', downloadId, params);
        
        if (headers && Object.keys(headers).length > 0) {
            logDebug('🔑 Using headers for download request:', Object.keys(headers));
        }
        
        try {
            // Get required services
            const ffmpegService = this.getService('ffmpeg');
            
            // Use container from extension (trusted completely)
            logDebug('📦 Using container from extension:', container);
            
            // Generate clean output filename with mode-specific suffixes
            const outputFilename = this.generateOutputFilename(filename, container, audioOnly, subsOnly, audioLabel, subsLabel);
            
            // Resolve final output path with uniqueness check
            const uniqueOutput = this.resolveOutputPath(outputFilename, savePath, allowOverwrite);
            
            // Send resolved filename to extension immediately
            this.sendMessage({
                command: 'filename-resolved',
                downloadId: downloadId,
                resolvedFilename: path.basename(uniqueOutput)
            }, { useMessageId: false });
            
            // Build FFmpeg command arguments
            const ffmpegArgs = this.buildFFmpegArgs({
                downloadUrl,
                type,
                outputPath: uniqueOutput,
                container,
                audioOnly,
                subsOnly,
                streamSelection,
                inputs: params.inputs,
                headers,
                sourceAudioCodec,
                sourceAudioBitrate,
                allowOverwrite,
                trackLabels: params.trackLabels || {}
            });
            
            logDebug('FFmpeg command:', ffmpegService.getFFmpegPath(), ffmpegArgs.join(' '));
            
            // Execute FFmpeg with progress tracking
            return this.executeFFmpegWithProgress({
                ffmpegService,
                ffmpegArgs,
                uniqueOutput,
                downloadUrl,
                type,
                headers, 
                duration,
                fileSizeBytes,
                audioOnly,
                subsOnly,
                downloadId, // Use downloadId instead of sessionId
				isLive
            });
            
        } catch (err) {
            logDebug('Download error:', err);
            // Just throw the error - the promise rejection will handle it
            throw err;
        }
    }

    // Generate clean output filename with mode-specific suffixes
    generateOutputFilename(filename, container, audioOnly = false, subsOnly = false, audioLabel = null, subsLabel = null) {
        // Start with provided filename or default
        let outputFilename = filename || 'video';
        
        // Map unsafe filesystem characters to safe alternatives (preserves meaning)
        outputFilename = outputFilename
            .replace(/[<>]/g, '()') // Angle brackets to parentheses
            .replace(/[:"]/g, '-')  // Colon and quotes to dash
            .replace(/[/\\|]/g, '_') // Slashes and pipe to underscore
            .replace(/[?]/g, '？')   // Question mark to full-width question mark (preserves meaning)
            .replace(/[*]/g, '★')    // Asterisk to star symbol
            .replace(/[\x00-\x1f\x7f]/g, '') // eslint-disable-line no-control-regex
            .replace(/\s+/g, ' ')    // Normalize whitespace
            .trim();
        
        // Remove any existing extension to prevent double extensions
        const extensionMatch = outputFilename.match(/\.[a-zA-Z0-9]{1,5}$/);
        if (extensionMatch) {
            outputFilename = outputFilename.slice(0, -extensionMatch[0].length);
        }
        
        // Add mode-specific suffixes
        if (audioOnly) {
            if (audioLabel && audioLabel !== 'audio') {
                outputFilename += `_audio_${audioLabel}`;
            } else {
                outputFilename += '_audio';
            }
            // Default to 'audio' if no base filename for audio-only downloads
            if (!filename || filename.trim() === '') {
                outputFilename = audioLabel ? `audio_${audioLabel}` : 'audio';
            }
        } else if (subsOnly) {
            if (subsLabel) {
                outputFilename += `_subtitles_${subsLabel}`;
            } else {
                outputFilename += '_subtitles';
            }
            // Default to 'subtitles' if no base filename for subtitle-only downloads
            if (!filename || filename.trim() === '') {
                outputFilename = subsLabel ? `subtitles_${subsLabel}` : 'subtitles';
            }
        }
        
        return `${outputFilename}.${container}`;
    }
    
    /**
     * Resolves output path and ensures uniqueness across both disk and active downloads
     * @param {string} filename - The desired filename
     * @param {string} savePath - The directory to save to
     * @param {boolean} allowOverwrite - Whether to allow overwriting existing files
     * @private
     */
    resolveOutputPath(filename, savePath, allowOverwrite = false) {
        // Default to Desktop if no savePath or if it's "Desktop"
        const defaultDir = path.join(process.env.HOME || os.homedir(), 'Desktop');
        const targetDir = (!savePath || savePath === 'Desktop') ? defaultDir : savePath;

        // Join directory and filename
        let outputPath = path.join(targetDir, filename);
        
        // Simple length check: if path > 260 chars, truncate filename to 250 chars max
        if (outputPath.length > 260) {
            const ext = path.extname(filename);
            const baseName = path.basename(filename, ext);
            const truncatedBase = baseName.length > 250 ? baseName.substring(0, 247) + '...' : baseName;
            outputPath = path.join(targetDir, truncatedBase + ext);
            logDebug(`Truncated long path: ${filename} -> ${truncatedBase + ext}`);
        }

        // Helper to check if output path is in use by any active download
        const isPathInUse = (candidatePath) => {
            for (const downloadEntry of DownloadCommand.activeDownloads.values()) {
                if (downloadEntry && downloadEntry.outputPath === candidatePath) {
                    return true;
                }
            }
            return false;
        };

        // If overwrite is allowed, only check for active downloads (not disk files)
        if (allowOverwrite) {
            let counter = 1;
            let uniqueOutput = outputPath;
            
            // Only avoid conflicts with active downloads, allow disk file overwrite
            while (isPathInUse(uniqueOutput)) {
                const ext = path.extname(outputPath);
                const base = outputPath.slice(0, -ext.length);
                uniqueOutput = `${base} (${counter})${ext}`;
                counter++;
                
                // Re-check path length after adding counter
                if (uniqueOutput.length > 255) {
                    const baseForCounter = base.substring(0, base.length - 10); // Make more room
                    uniqueOutput = `${baseForCounter}... (${counter})${ext}`;
                }
            }
            
            logDebug('Output file (overwrite allowed):', uniqueOutput);
            return uniqueOutput;
        }

        // Default behavior: ensure uniqueness across both disk and active downloads
        let counter = 1;
        let uniqueOutput = outputPath;
        while (fs.existsSync(uniqueOutput) || isPathInUse(uniqueOutput)) {
            const ext = path.extname(outputPath);
            const base = outputPath.slice(0, -ext.length);
            uniqueOutput = `${base} (${counter})${ext}`;
            counter++;
            
            // Re-check path length after adding counter
            if (uniqueOutput.length > 255) {
                const baseForCounter = base.substring(0, base.length - 10); // Make more room
                uniqueOutput = `${baseForCounter}... (${counter})${ext}`;
            }
        }

        logDebug('Output file will be:', uniqueOutput);
        return uniqueOutput;
    }
    
    /**
     * Determine download type based on container and explicit flags
     * @param {string} container - Container format from extension
     * @param {boolean} audioOnly - Explicit audio extraction flag
     * @param {boolean} subsOnly - Explicit subtitle extraction flag
     * @returns {string} Download type: 'audio', 'video', or 'subs'
     * @private
     */
    determineDownloadType(container, audioOnly, subsOnly) {
        // 1. Explicit flags take priority (specific extraction requests)
        if (audioOnly) return 'audio';
        if (subsOnly) return 'subs';
        
        // 2. Container-based detection for general downloads
        const audioContainers = ['m4a', 'mp3', 'flac', 'ogg', 'aac', 'wav', 'wma'];
        const videoContainers = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'flv', 'ts', 'm4v'];
        const subtitleContainers = ['vtt', 'srt', 'ass', 'ssa', 'sub'];
        
        if (audioContainers.includes(container?.toLowerCase())) {
            return 'audio';  // Same as audioOnly flag behavior
        } else if (videoContainers.includes(container?.toLowerCase())) {
            return 'video';  // Copy streams
        } else if (subtitleContainers.includes(container?.toLowerCase())) {
            return 'subs';   // Subtitle extraction
        } else {
            return 'video';  // Default fallback
        }
    }

    // Builds FFmpeg command arguments based on input parameters
    buildFFmpegArgs({
        downloadUrl,  type, outputPath, container, audioOnly = false, subsOnly = false, streamSelection, inputs = null, 
		headers = {}, sourceAudioCodec = null, sourceAudioBitrate = null, allowOverwrite = false, trackLabels = {}
	}) {
        const args = [];
        
        // Determine download type using container-first logic
        const downloadType = this.determineDownloadType(container, audioOnly, subsOnly);
        logDebug('📦 Container-first detection:', { container, downloadType, audioOnly, subsOnly });
        
        // Add overwrite flag if allowed
        if (allowOverwrite) {
            args.push('-y');
        }
        
        // Progress tracking arguments
        args.push('-stats', '-progress', 'pipe:2');
        
		// Increase timeouts to avoid false triggers during long stream startup/handshakes.
		args.push('-timeout', '30000000', '-rw_timeout', '30000000', '-icy', '0'); // 30s timeouts for startup
        if (type === 'hls' || type === 'dash') {
            args.push(
                '-reconnect', '1',
                '-reconnect_streamed', '1', 
                '-reconnect_on_network_error', '1',
                '-reconnect_delay_max', '10'
            );
        }
        
        // Prepare headers for per-input application
        let headerArgs = [];
        if (headers && Object.keys(headers).length > 0) {
            const headerLines = Object.entries(headers)
                .map(([key, value]) => `${key}: ${value}`)
                .join('\r\n');
            if (headerLines) {
                headerArgs = ['-headers', headerLines + '\r\n'];
            }
        }
        
        // Add inputs with headers, protocols, and stream mapping
        if (inputs?.length > 0) {
            // HLS advanced mode: multiple inputs with separate tracks (DASH never uses inputs array)
            // FFmpeg requires: [global opts] [input opts -i url]... [output opts -map -c]... [output]
            inputs.forEach(input => {
                if (headerArgs.length > 0) {
                    args.push(...headerArgs);
                }
                // Only HLS can have multiple inputs - DASH always uses single input + streamSelection
                args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-f', 'hls', '-allowed_extensions', 'ALL', '-probesize', '5M', '-analyzeduration', '10M');
                args.push('-i', input.url);
            });
            
            // Add stream mapping for all inputs and metadata (output options must come after all inputs)
            let audioIndex = 0;
            let subtitleIndex = 0;
            
            inputs.forEach(input => {
                args.push('-map', input.streamMap);
                
                // Add metadata directly from input label
                if (input.label) {
                    if (input.streamMap.includes(':a:')) {
                        args.push(`-metadata:s:a:${audioIndex}`, `title=${input.label}`);
                        audioIndex++;
                    } else if (input.streamMap.includes(':s:')) {
                        args.push(`-metadata:s:s:${subtitleIndex}`, `title=${input.label}`);
                        subtitleIndex++;
                    }
                }
            });
            
            // Add codec arguments with subtitle transcoding for video mode
            if (downloadType === 'video') {
                args.push('-c:v', 'copy', '-c:a', 'copy');
                this.addSubtitleCodecArgs(args, container);
            } else {
                args.push('-c', 'copy');
            }
            logDebug('🎯 Added multiple inputs for HLS advanced mode:', inputs.length);
        } else {
            // Single input mode (all other cases)
            if (headerArgs.length > 0) {
                args.push(...headerArgs);
            }
            if (type === 'hls') {
                args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-allowed_extensions', 'ALL', '-probesize', '5M', '-analyzeduration', '10M');
            } else if (type === 'dash') {
                args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-probesize', '5M', '-analyzeduration', '10M', '-dash_allow_hier_sidx', '1');
            }
            args.push('-i', downloadUrl);
            logDebug('🎯 Added single input:', type);
            
            // Stream mapping for single input
            if (type === 'dash' && streamSelection) {
                // DASH: map selected streams from single URL and add metadata
                const streams = streamSelection.split(',');
                let audioIndex = 0;
                let subtitleIndex = 0;
                
                streams.forEach(streamSpec => {
                    args.push('-map', streamSpec);
                    
                    // Add metadata while we're iterating
                    if (trackLabels && Object.keys(trackLabels).length > 0) {
                        if (streamSpec.includes(':a:')) {
                            const audioLabel = trackLabels[`audio_${audioIndex}`];
                            if (audioLabel) {
                                args.push(`-metadata:s:a:${audioIndex}`, `title=${audioLabel}`);
                            }
                            audioIndex++;
                        } else if (streamSpec.includes(':s:')) {
                            const subtitleLabel = trackLabels[`subtitle_${subtitleIndex}`];
                            if (subtitleLabel) {
                                args.push(`-metadata:s:s:${subtitleIndex}`, `title=${subtitleLabel}`);
                            }
                            subtitleIndex++;
                        }
                    }
                });
                
                // Add codec arguments with subtitle transcoding for video mode
                if (downloadType === 'video') {
                    args.push('-c:v', 'copy', '-c:a', 'copy');
                    this.addSubtitleCodecArgs(args, container);
                } else {
                    args.push('-c', 'copy');
                }
            } else {
                // All other cases: simple download based on container type
                if (downloadType === 'audio') {
                    args.push('-map', '0:a:0', '-vn', '-sn');
                    this.addAudioCodecArgs(args, container, sourceAudioCodec, sourceAudioBitrate);
                } else if (downloadType === 'subs') {
                    args.push('-map', '0:s:0', '-vn', '-an', '-c:s', 'copy');
                } else {
                    // Video: copy all streams with subtitle transcoding
                    if (downloadType === 'video') {
                        args.push('-c:v', 'copy', '-c:a', 'copy');
                        this.addSubtitleCodecArgs(args, container);
                        
                        // Add metadata for video downloads with multiple tracks
                        if (trackLabels && Object.keys(trackLabels).length > 0) {
                            let audioIndex = 0;
                            let subtitleIndex = 0;
                            
                            Object.keys(trackLabels).forEach(key => {
                                if (key.startsWith('audio_')) {
                                    args.push(`-metadata:s:a:${audioIndex}`, `title=${trackLabels[key]}`);
                                    audioIndex++;
                                } else if (key.startsWith('subtitle_')) {
                                    args.push(`-metadata:s:s:${subtitleIndex}`, `title=${trackLabels[key]}`);
                                    subtitleIndex++;
                                }
                            });
                        }
                    } else {
                        args.push('-c', 'copy');
                    }
                }
            }
        }
        
        // Format-specific optimizations
        if ((type === 'hls' && downloadType === 'video') || (downloadType === 'audio' && container === 'm4a')) {
            args.push('-bsf:a', 'aac_adtstoasc');
        }
        
        // MP4/MOV faststart optimization (not for subtitles)
        if (downloadType !== 'subs' && ['mp4', 'mov', 'm4v'].includes(container.toLowerCase())) {
            args.push('-movflags', '+faststart');
        }
        
        // Output path
        args.push(outputPath);
        
        return args;
    }
    
    /**
     * Add appropriate audio codec arguments based on container format
     * @param {Array} args - FFmpeg arguments array
     * @param {string} container - Output container format (from extension)
     * @param {string} sourceAudioCodec - Source audio codec (unused, kept for compatibility)
     * @param {number} sourceAudioBitrate - Source audio bitrate in bps
     * @private
     */
    addAudioCodecArgs(args, container, sourceAudioCodec, sourceAudioBitrate) {
        logDebug('🎵 Audio codec selection for container:', container);
        
		if (container === 'mp3') {
            // MP3 container: Always re-encode with libmp3lame for universal compatibility
            args.push('-c:a', 'libmp3lame', '-preset', 'superfast');
            
            // Use source bitrate if available, otherwise high-quality VBR
            if (sourceAudioBitrate && sourceAudioBitrate > 0) {
                // Convert from bps to kbps and cap at reasonable limits
                const bitrateKbps = Math.min(Math.max(Math.round(sourceAudioBitrate / 1000), 64), 320);
                args.push('-b:a', `${bitrateKbps}k`);
                logDebug(`🎵 MP3 container: re-encoding at ${bitrateKbps}kbps (matched source)`);
            } else {
                // High-quality VBR when no bitrate info available
                args.push('-q:a', '2'); // ~190kbps VBR
                logDebug('🎵 MP3 container: re-encoding with VBR quality 2');
            }
        } else {
            // Other containers (m4a, flac, ogg, etc.): Copy by default
            args.push('-c:a', 'copy');
            logDebug(`🎵 ${container} container: copying audio stream`);
        }
    }

    /**
     * Add appropriate subtitle codec arguments based on container format
     * @param {Array} args - FFmpeg arguments array
     * @param {string} container - Output container format (from extension)
     * @private
     */
    addSubtitleCodecArgs(args, container) {
        logDebug('📝 Subtitle codec selection for container:', container);
        
        // Container-specific subtitle format mapping
        switch (container.toLowerCase()) {
            case 'mp4':
            case 'mov':
            case 'm4v':
                // MP4 containers: transcode to mov_text (native MP4 subtitle format)
                args.push('-c:s', 'mov_text');
                logDebug('📝 MP4 container: transcoding subtitles to mov_text');
                break;
                
            case 'mkv':
                // MKV containers: transcode to srt (widely compatible, no positioning artifacts)
                args.push('-c:s', 'srt');
                logDebug('📝 MKV container: transcoding subtitles to srt');
                break;
                
            case 'webm':
                // WebM containers: keep as webvtt (native WebM subtitle format)
                args.push('-c:s', 'webvtt');
                logDebug('📝 WebM container: transcoding subtitles to webvtt');
                break;
                
            default:
                // Other containers: copy by default
                args.push('-c:s', 'copy');
                logDebug(`📝 ${container} container: copying subtitle streams`);
                break;
        }
    }

    /**
     * Probe media duration using ffprobe
     * @param {Object} ffmpegService - FFmpeg service instance
     * @param {string} url - Media URL to probe
     * @param {Object} headers - HTTP headers to use for the request
     * @returns {Promise<number>} - Duration in seconds
     * @private
     */
    async probeMediaDuration(ffmpegService, url, headers = {}) {
        logDebug('Probing media duration for:', url);
        
        try {
            // Build headers argument if provided
            let headerArgs = [];
            if (headers && Object.keys(headers).length > 0) {
                const headerLines = Object.entries(headers)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\r\n');
                
                if (headerLines) {
                    headerArgs = ['-headers', headerLines + '\r\n'];
                    logDebug('🔑 Using headers for probe request');
                }
            }
            
            // Get path to ffprobe
            const ffprobePath = ffmpegService.getFFprobePath();
            if (!ffprobePath) {
                throw new Error('FFprobe path not available');
            }
            
            logDebug('Using FFprobe path:', ffprobePath);
            
            // Build probe command arguments
            const args = [
                ...headerArgs,
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'json',
                url
            ];
            
            logDebug('FFprobe command:', ffprobePath, args.join(' '));
            
            // Execute ffprobe as a child process
            const probeStartTime = Date.now();
            const { stdout } = await new Promise((resolve, reject) => {
                const ffprobe = spawn(ffprobePath, args, { 
                    env: getFullEnv(),
                    windowsVerbatimArguments: process.platform === 'win32'
                });
                processManager.register(ffprobe);
                
                logDebug('FFprobe process started with PID:', ffprobe.pid);
                
                let stdout = '';
                let stderr = '';
                
                ffprobe.stdout.on('data', (data) => {
                    stdout += data.toString();
                });
                
                ffprobe.stderr.on('data', (data) => {
                    stderr += data.toString();
                });
                
                ffprobe.on('close', (code, signal) => {
                    const probeDuration = Date.now() - probeStartTime;
                    logDebug(`FFprobe completed in ${probeDuration}ms with code ${code}${signal ? ` (signal: ${signal})` : ''}`);
                    
                    if (code === 0) {
                        resolve({ stdout, stderr });
                    } else {
                        reject(new Error(`FFprobe exited with code ${code}${signal ? ` (signal: ${signal})` : ''}: ${stderr}`));
                    }
                });
                
                ffprobe.on('error', (err) => {
                    const probeDuration = Date.now() - probeStartTime;
                    logDebug(`FFprobe spawn error after ${probeDuration}ms:`, err.message);
                    reject(err);
                });
            });
            
            // Parse the JSON output
            const result = JSON.parse(stdout);
            const duration = parseFloat(result?.format?.duration);
            
            if (isNaN(duration) || duration <= 0) {
                logDebug('Invalid duration returned from probe:', result);
                return null;
            }
            
            logDebug(`Probed duration: ${duration} seconds`);
            return duration;
        } catch (error) {
            logDebug('Error probing media duration:', error);
            return null;
        }
    }
    
    // Executes FFmpeg with progress tracking
    executeFFmpegWithProgress({
        ffmpegService,
        ffmpegArgs,
        uniqueOutput,
        downloadUrl,
        type,
        headers,
        duration,
        fileSizeBytes,
        audioOnly,
        subsOnly,
        downloadId, // Use downloadId instead of sessionId
		isLive
    }) {
        return new Promise((resolve, _reject) => {
            // Use an IIFE to handle async operations properly
            (async () => {
                // Track spawn retry attempts
                let spawnRetried = false;
                
                // Probe duration upfront if not provided to avoid race conditions
                // Skip probing for livestreams as duration is meaningless
                let finalDuration = duration;
                if (isLive) {
                    logDebug('Skipping duration probe for livestream');
                    finalDuration = null; // Ensure duration is null for livestreams
                } else if (!isLive && (!duration || typeof duration !== 'number' || duration <= 0)) {
					logDebug('No valid duration provided, probing media...');
					finalDuration = await this.probeMediaDuration(ffmpegService, downloadUrl, headers);
					finalDuration
						? logDebug('Got duration from probe:', finalDuration)
						: logDebug('Could not probe duration, will rely on FFmpeg output parsing');
				}
            
                // Initialize progress state
                const progressState = this.initProgressState(downloadId, {
                    type,
                    duration: finalDuration,
                    fileSizeBytes,
                    downloadUrl,
                    isLive
                });
                
                logDebug('Initialized progress state for downloadId:', downloadId);
                
                // Start FFmpeg process
                const downloadStartTime = Date.now();
                const ffmpeg = spawn(ffmpegService.getFFmpegPath(), ffmpegArgs, { 
                    env: getFullEnv(),
                    windowsVerbatimArguments: process.platform === 'win32',
                    stdio: ['pipe', 'pipe', 'pipe'] // Enable stdin for graceful termination
                });
                processManager.register(ffmpeg);
                
                logDebug('FFmpeg process started with PID:', ffmpeg.pid);
                
                // Track this process as active (keyed by downloadId with minimal data)
                DownloadCommand.activeDownloads.set(downloadId, {
                    process: ffmpeg,
                    startTime: downloadStartTime,
                    outputPath: uniqueOutput,
                    type,
                    headers: headers || null,
                    progressState
                });
                
                logDebug('Added download to activeDownloads Map. Total downloads:', DownloadCommand.activeDownloads.size);
                
                let hasError = false;
                
                // Direct FFmpeg output processing
                ffmpeg.stderr.on('data', (data) => {
                    if (hasError) return;
                    
                    const output = data.toString();
                    
                    // Process output directly for progress and error collection
                    this.processFFmpegOutput(output, progressState);
                });
            
            ffmpeg.on('close', (code, signal) => {
                // Guard against multiple event handling
                if (hasError) return;
                
                // Get download info from activeDownloads BEFORE deletion
                const downloadEntry = DownloadCommand.activeDownloads.get(downloadId);
                const downloadDuration = downloadEntry?.startTime ? Math.round((Date.now() - downloadEntry.startTime) / 1000) : null;
                
                // Clean up activeDownloads
                if (DownloadCommand.activeDownloads.has(downloadId)) {
                    DownloadCommand.activeDownloads.delete(downloadId);
                }

                // Get minimal state needed for decision
                const userCanceled = downloadEntry?.wasCanceled || false;
                const isLivestream = progressState.isLive || false;
                const fileExists = fs.existsSync(uniqueOutput);
                const fileSize = fileExists ? fs.statSync(uniqueOutput).size : 0;
                
                // Configurable thresholds
                const MIN_MEDIA_BYTES = 50 * 1024; // 50KB for media files
                const MIN_SUBS_BYTES = 100; // 100 bytes for subtitle files
                
                // Ground truth signals
                const completed = (code === 0 && signal === null);
                const wasKilled = (signal !== null); // SIGTERM/SIGKILL 
                const isGracefulCancel = (code === 255 && signal === null); // q/Ctrl-C style
                const wasCanceled = userCanceled || isGracefulCancel || wasKilled;
                const bigEnough = subsOnly ? fileSize >= MIN_SUBS_BYTES : fileSize >= MIN_MEDIA_BYTES;
                
                logDebug(`FFmpeg process (PID: ${downloadEntry?.process?.pid}) terminated after ${downloadDuration}s:`, 
                    { code, signal, completed, wasKilled, isGracefulCancel, wasCanceled, fileExists, fileSize, bigEnough, type });
                
                // Enhanced downloadStats
                    const rawDuration = progressState.finalProcessedTime || progressState.duration || null;
                    const downloadStats = {
                        ...(progressState.finalStats || {}),
                        finalDuration: rawDuration != null ? Math.round(rawDuration) : null,
                        downloadDurationSeconds: downloadDuration
                    };
                
                // Single decision ladder - simplified rules
                let outcome, message, shouldPreserveFile = false;
                
                if (wasCanceled && fileExists && bigEnough) {
                    // Canceled with valid file above threshold = always preserve and send as success
                    const isPartial = !isLivestream;
                    outcome = { command: 'download-success', success: true, isPartial };
                    message = isLivestream ? 'Livestream recording completed successfully (user stopped)' : 'Partial download completed (file preserved)';
                    shouldPreserveFile = true;
                } else if (wasCanceled) {
                    // Canceled without valid file = true cancellation
                    outcome = { command: 'download-canceled', success: false };
                    message = 'Download was canceled by user';
                    shouldPreserveFile = false;
                } else if (completed && bigEnough) {
                    // Process completed successfully with valid file
                    outcome = { command: 'download-success', success: true, isPartial: false };
                    message = 'Download completed successfully';
                    shouldPreserveFile = true;
                } else {
                    // All other cases = error (includes completed but too small, crashes, etc.)
                    outcome = { command: 'download-error', success: false };
                    message = completed ? 'Download completed but output file is too small or empty' : 
                             `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`;
                    shouldPreserveFile = false;
                }
                
                // Handle file operations based on decision
                if (fileExists && !shouldPreserveFile) {
                    try {
                        fs.unlinkSync(uniqueOutput);
                        logDebug('Removed file (not preservable for this outcome):', uniqueOutput);
                    } catch (deleteError) {
                        logDebug('Could not delete file:', deleteError.message);
                    }
                }
                
                logDebug(message);
                
                // Send appropriate message - FFmpeg-only data
                if (outcome.command === 'download-success') {
                    this.sendMessage({
                        command: 'download-success',
                        downloadId,
                        ...(shouldPreserveFile && {
                            path: uniqueOutput,
                            filename: path.basename(uniqueOutput),
                            downloadStats
                        }),
                        completedAt: Date.now(),
                        isPartial: outcome.isPartial || false,
                        ...(outcome.message && { message: outcome.message })
                    }, { useMessageId: false });
                    
                    resolve({ 
                        success: true, 
                        downloadStats, 
                        ...(shouldPreserveFile && { path: uniqueOutput }), 
                        ...(outcome.isPartial && { isPartial: true }) 
                    });
                    
                } else if (outcome.command === 'download-canceled') {
                    this.sendMessage({
                        command: 'download-canceled',
                        downloadId,
                        timestamp: Date.now()
                    }, { useMessageId: false });
                    
                    resolve({ success: false, downloadStats, wasCanceled: true });
                    
                } else if (outcome.command === 'download-error') {
                    hasError = true;
                    const collectedErrors = this.getErrorMessage(progressState);
                    if (collectedErrors) logDebug('Collected error lines:', collectedErrors);
                    
                    this.sendMessage({
                        command: 'download-error',
                        downloadId,
                        filename: path.basename(uniqueOutput),
                        success: false,
                        message: message,
                        errorMessage: collectedErrors || null,
                        downloadStats,
                        completedAt: Date.now()
                    }, { useMessageId: false });
                    
                    resolve({ success: false, downloadStats, error: message });
                }
            });
            
            ffmpeg.on('error', (err) => {
                // Guard against multiple event handling
                if (hasError) return;
                hasError = true;
                
                logDebug(`FFmpeg spawn failed for downloadId ${downloadId}:`, err.message);
                
                // Clean up activeDownloads (spawn failed, so no close event will fire)
                if (DownloadCommand.activeDownloads.has(downloadId)) {
                    DownloadCommand.activeDownloads.delete(downloadId);
                }
                
                // Only retry for transient spawn errors (filesystem/system level)
                const code = err && err.code;
                const retriable = code === 'EAGAIN' || code === 'ETXTBSY'; // transient spawn errors only
                if (retriable && !spawnRetried) {
                    spawnRetried = true;
                    logDebug(`FFmpeg spawn failed with ${code}; retrying once…`);
                    // Re-run the same pipeline once. We don't emit any terminal message here; the retried run will.
                    this.executeFFmpegWithProgress({
                        ffmpegService,
                        ffmpegArgs,
                        uniqueOutput,
                        downloadUrl,
                        type,
                        headers,
                        duration,
                        fileSizeBytes,
                        audioOnly,
                        subsOnly,
                        downloadId, // reuse the same id
                        isLive
                    }).then(resolve);
                    return;
                }
                
                // Send minimal error message (no stats available since FFmpeg never started)
                this.sendMessage({
                    command: 'download-error',
                    downloadId,
                    success: false,
                    message: `FFmpeg failed to start: ${err.message}`,
                    completedAt: Date.now()
                }, { useMessageId: false });

                resolve({ 
                    success: false, 
                    error: `FFmpeg spawn error: ${err.message}`
                });
            });
            })(); // Close the IIFE
        });
    }
}

module.exports = DownloadCommand;