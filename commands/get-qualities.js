/**
 * GetQualitiesCommand – Video stream quality analyzer
 * - Analyzes video streams for available quality options
 * - Uses FFprobe to extract stream metadata
 * - Identifies resolution, bitrate, and codec information
 * - Maps technical stream data to user-friendly quality labels
 * - Returns structured quality options to the extension UI
 * - Handles various streaming protocol formats
 */

const { spawn } = require('child_process');
const BaseCommand = require('./base-command');
const { logDebug, getFullEnv, getBinaryPaths, shouldInheritHlsQueryParams } = require('../utils/utils');
const processManager = require('../lib/process-manager');

/**
 * Command for analyzing media streams and getting available qualities
 */
class GetQualitiesCommand extends BaseCommand {
    /**
     * Execute the getQualities command
     * Reusable media analysis method - can be called internally or via execute
     * @param {Object} params Analysis parameters
     * @param {string} params.url Video URL to analyze
     * @param {string} [params.type] Media type: 'hls', 'dash', 'direct'
     * @param {string} [params.representationId] For DASH: specific representation ID
     * @param {Object} [params.headers] HTTP headers for requests
     * @param {boolean} [params.isLocal] True if the URL points to a local file
     * @param {string[]} [params.customArgs] Additional custom FFprobe arguments
     * @returns {Promise<Object>} Structured media information
     */
    async examineMedia(params) {
        const { 
            url, 
            type, 
            representationId = null,
            headers = {},
            isLocal = false,
            customArgs = []
        } = params;
        
        logDebug(`🎥 Analyzing media from: ${url} (type: ${type || 'auto'}, local: ${isLocal})`);
        
        // Skip for blob URLs
        if (url?.startsWith('blob:')) {
            return { success: false, error: 'Cannot analyze blob URLs' };
        }
        
        try {
            // Get FFmpeg directly
            const { ffprobePath } = getBinaryPaths();
            
            return new Promise((resolve, reject) => {
                // Build FFprobe args
                const ffprobeArgs = [
                    '-v', 'quiet',
                    '-print_format', 'json',
                    '-show_streams',
                    '-show_format',
                ];

                // Add default network parameters if not local
                if (!isLocal) {
                    ffprobeArgs.push(
                        '-probesize', '32768',       // 32 KB max to probe
                        '-analyzeduration', '500000', // 0.5 s duration
                        '-rw_timeout', '5000000'      // 5 s timeout
                    );
                }

                // Append any custom arguments provided (Future-proofing)
                if (customArgs && Array.isArray(customArgs)) ffprobeArgs.push(...customArgs)
                
                // Add format-specific options
                if (type === 'hls') {
                    ffprobeArgs.push('-f', 'hls');
                    
                    // Add HLS query parameter inheritance for specific domains
                    const inheritQueryParams = shouldInheritHlsQueryParams(url);
                    
                    if (inheritQueryParams) ffprobeArgs.push('-hls_inherit_query_params', '1');
                }
                
                // Add headers if provided
                if (headers && Object.keys(headers).length > 0) {
                    // Format headers for FFprobe as "Key: Value\r\n" pairs
                    const headerLines = Object.entries(headers)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join('\r\n');
                    
                    if (headerLines) ffprobeArgs.push('-headers', headerLines + '\r\n');
                }
                
                // Handle DASH-specific representation selection
                let analyzeUrl = url;
                if (type === 'dash' && representationId) analyzeUrl = `${url}#${representationId}`;
                
                // Add URL as the last argument
                ffprobeArgs.push(analyzeUrl);
                
                const ffprobe = spawn(ffprobePath, ffprobeArgs, { env: getFullEnv() });
                processManager.register(ffprobe, 'processing');
                let killedByTimeout = false;
    
                // Set timeout for FFprobe analysis (skipping for local files as they are fast, but keeping safety net)
                const timeoutDuration = isLocal ? 10000 : 30000;
                const timeout = setTimeout(() => {
                    if (ffprobe && !ffprobe.killed) {
                        logDebug('Killing FFprobe process due to timeout');
                        killedByTimeout = true;
                        ffprobe.kill('SIGTERM');
                    }
                    resolve({ success: false, timeout: true, error: 'Analysis timed out' });
                }, timeoutDuration);
    
                let output = '';
                let errorOutput = '';
    
                ffprobe.stdout.on('data', (data) => {
                    output += data;
                });
    
                ffprobe.stderr.on('data', (data) => {
                    errorOutput += data;
                });
    
                ffprobe.on('close', (code) => {
                    clearTimeout(timeout);
                    
                    // If killed by timeout, don't process results
                    if (killedByTimeout) return;
                    
                    if (code === 0 && output) {
                        try {
                            const info = JSON.parse(output);
                            const videoStream = info.streams.find(s => s.codec_type === 'video');
                            const audioStreams = info.streams.filter(s => s.codec_type === 'audio');
                            const subtitleStreams = info.streams.filter(s => s.codec_type === 'subtitle');

                            // Helper functions for stream-based container mapping
                            const getVideoContainer = (codecName) => {
                                if (!codecName) return 'mp4';
                                const codec = codecName.toLowerCase();
                                if (codec.includes('vp8') || codec.includes('vp9') || codec.includes('av01')) return 'webm';
                                if (codec.includes('h264') || codec.includes('h265') || codec.includes('hevc')) return 'mp4';
                                return 'mp4';
                            };

                            const getAudioContainer = (codecName) => {
                                if (!codecName) return 'm4a';
                                const codec = codecName.toLowerCase();
                                if (codec.includes('opus') || codec.includes('vorbis')) return 'webm';
                                if (codec.includes('aac')) return 'm4a';
                                if (codec.includes('mp3')) return 'mp3';
                                if (codec.includes('flac')) return 'flac';
                                return 'm4a';
                            };

                            const getSubtitleContainer = (codecName) => {
                                if (!codecName) return 'srt';
                                const codec = codecName.toLowerCase();
                                if (codec.includes('webvtt')) return 'vtt';
                                if (codec.includes('ass') || codec.includes('ssa')) return 'ass';
                                if (codec.includes('srt') || codec.includes('subrip')) return 'srt';
                                return 'srt';
                            };

                            // Structure result
                            const streamInfo = {
                                format: info.format?.format_name || 'unknown',
                                container: info.format?.format_long_name || 'unknown',
								sizeBytes: info.format?.size,
                                type: type,
                                inputUrl: url,
                                analyzeUrl: analyzeUrl,
                                tags: info.format?.tags || {}
                            };

                            // Video stream info
                            if (videoStream) {
                                streamInfo.width = parseInt(videoStream.width) || null;
                                streamInfo.height = parseInt(videoStream.height) || null;
                                streamInfo.hasVideo = true;
                                streamInfo.videoCodec = {
                                    name: videoStream.codec_name || 'unknown',
                                    longName: videoStream.codec_long_name || 'unknown',
                                    profile: videoStream.profile || null,
                                    level: videoStream.level || null,
                                    pixFmt: videoStream.pix_fmt || null,
                                    colorSpace: videoStream.color_space || null
                                };

                                // Calculate framerate
                                let fps = null;
                                try {
                                    if (videoStream.r_frame_rate) {
                                        const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
                                        if (den && num) fps = Math.round(num / den);
                                    } else if (videoStream.avg_frame_rate) {
                                        const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
                                        if (den && num) fps = Math.round(num / den);
                                    }
                                } catch (e) { logDebug('⚠️ Error parsing framerate:', e); }
								
                                streamInfo.fps = fps;

                                if (videoStream.bit_rate) streamInfo.videoBitrate = parseInt(videoStream.bit_rate);

                                streamInfo.videoContainer = getVideoContainer(videoStream.codec_name);
                            } else {
                                streamInfo.hasVideo = false;
                            }

                            // Audio stream info
                            if (audioStreams.length > 0) {
                                const firstAudioStream = audioStreams[0];
                                streamInfo.hasAudio = true;
                                streamInfo.audioCodec = {
                                    name: firstAudioStream.codec_name || 'unknown',
                                    longName: firstAudioStream.codec_long_name || 'unknown',
                                    profile: firstAudioStream.profile || null,
                                    sampleRate: parseInt(firstAudioStream.sample_rate) || null,
                                    channels: parseInt(firstAudioStream.channels) || null,
                                    channelLayout: firstAudioStream.channel_layout || null
                                };

                                // Check for default audio stream
                                const defaultAudioStream = audioStreams.find(stream => stream.disposition?.default === 1);
                                if (defaultAudioStream?.index !== firstAudioStream.index) {
                                    streamInfo.defaultAudioIndex = defaultAudioStream.index;
                                }

                                if (firstAudioStream.bit_rate) {
                                    streamInfo.audioBitrate = parseInt(firstAudioStream.bit_rate);
                                }

                                streamInfo.audioContainer = getAudioContainer(firstAudioStream.codec_name);
                                
                                if (audioStreams.length > 1) {
                                    streamInfo.audioStreamIndexes = audioStreams.map(s => s.index).join(',');
                                }
                            } else {
                                streamInfo.hasAudio = false;
                            }

                            // Subtitle stream info
                            if (subtitleStreams?.length > 0) {
                                streamInfo.hasSubs = true;
                                streamInfo.subtitles = subtitleStreams.map(sub => ({
                                    index: sub.index,
                                    codec: sub.codec_name || 'unknown',
                                    language: (sub.tags && (sub.tags.language || sub.tags.LANGUAGE)) || null,
                                    title: (sub.tags && (sub.tags.title || sub.tags.TITLE)) || null,
                                    default: sub.disposition?.default === 1,
                                    forced: sub.disposition?.forced === 1
                                }));

                                if (subtitleStreams.length === 1) {
                                    streamInfo.subtitleContainer = getSubtitleContainer(subtitleStreams[0].codec_name);
                                } else if (subtitleStreams.length > 1) {
                                    streamInfo.subtitleContainer = getSubtitleContainer(subtitleStreams[0].codec_name);
                                    streamInfo.subsStreamIndexes = subtitleStreams.map(s => s.index).join(',');
                                }
                            } else {
                                streamInfo.hasSubs = false;
                                streamInfo.subtitles = [];
                            }

                            if (info.format.bit_rate) streamInfo.totalBitrate = parseInt(info.format.bit_rate); // Total bitrate
                            if (info.format.duration) streamInfo.duration = Math.round(parseFloat(info.format.duration)); // Duration
                            
                            // Include raw probe info for advanced debugging/decisions if needed
                            streamInfo.raw = info; 

                            logDebug('✅ Media analysis complete');
                            resolve({ success: true, streamInfo });
                            
                        } catch (error) {
                            logDebug('❌ Error parsing FFprobe output:', error);
                            resolve({ success: false, error: 'Failed to parse stream info' });
                        }
                    } else {
                         // Check if process was killed (code null = killed)
                         if (code === null) {
                            resolve({ success: false, killed: true });
                        } else {
                            const errMsg = errorOutput?.trim() || 'Failed to analyze video';
                            logDebug('❌ FFprobe failed with code:', code, 'Error:', errorOutput);
                            resolve({ success: false, error: errMsg });
                        }
                    }
                });
    
                ffprobe.on('error', (err) => {
                    clearTimeout(timeout);
                    if (!killedByTimeout) {
                        logDebug('❌ FFprobe spawn error:', err);
                        resolve({ success: false, error: 'Failed to start FFprobe: ' + err.message });
                    }
                });
            });
        } catch (err) {
            logDebug('❌ GetQualities error:', err);
            return { success: false, error: err.message };
        }
    }
}

module.exports = GetQualitiesCommand;
