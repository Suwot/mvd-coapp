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
const { logDebug } = require('../utils/logger');
const { getFullEnv } = require('../utils/resources');
const processManager = require('../lib/process-manager');

/**
 * Command for analyzing media streams and getting available qualities
 */
class GetQualitiesCommand extends BaseCommand {
    /**
     * Execute the getQualities command
     * @param {Object} params Command parameters
     * @param {string} params.url Video URL to analyze
     * @param {string} [params.type] Media type: 'hls', 'dash', 'direct'
     * @param {string} [params.representationId] For DASH: specific representation ID
     * @param {Object} [params.headers] HTTP headers for requests
     */
    async execute(params) {
        const { 
            url, 
            type, 
            representationId = null,
            headers = {}
        } = params;
        
        logDebug(`🎥 Analyzing media from: ${url} (type: ${type})`);
        
        // Skip for blob URLs
        if (url.startsWith('blob:')) {
            logDebug('❌ Cannot analyze blob URLs');
            this.sendMessage('Cannot analyze blob URLs');
            return { error: 'Cannot analyze blob URLs' };
        }
        
        // Log received headers
        if (headers && Object.keys(headers).length > 0) {
            logDebug('🔑 Received headers:', headers);
        }
        
        try {
            // Get required services
            const ffmpegService = this.getService('ffmpeg');
            
            return new Promise((resolve, reject) => {
                // Build FFprobe args
                const ffprobeArgs = [
                    '-v', 'quiet',
                    '-print_format', 'json',
                    '-show_streams',
                    '-show_format'
                ];
                
                // Add headers if provided
                if (headers && Object.keys(headers).length > 0) {
                    // Format headers for FFprobe as "Key: Value\r\n" pairs
                    const headerLines = Object.entries(headers)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join('\r\n');
                    
                    if (headerLines) {
                        ffprobeArgs.push('-headers', headerLines + '\r\n');
                        logDebug('🔑 Using headers for FFprobe request');
                    }
                }
                
                // Handle DASH-specific representation selection
                let analyzeUrl = url;
                if (type === 'dash' && representationId) {
                    analyzeUrl = `${url}#${representationId}`;
                    logDebug(`🎯 Targeting specific DASH representation: ${representationId}`);
                }
                
                // Add URL as the last argument
                ffprobeArgs.push(analyzeUrl);
                
                // Log the complete FFprobe command for debugging
                const ffprobePath = ffmpegService.getFFprobePath();
                const commandLine = `${ffprobePath} ${ffprobeArgs.join(' ')}`;
                logDebug('🔍 FFprobe analysis command:', commandLine);
                
                const ffprobe = spawn(ffprobePath, ffprobeArgs, { env: getFullEnv() });
                processManager.register(ffprobe);
                let killedByTimeout = false;
    
                // Set timeout for FFprobe analysis
                const timeout = setTimeout(() => {
                    if (ffprobe && !ffprobe.killed) {
                        logDebug('Killing FFprobe process due to timeout');
                        killedByTimeout = true;
                        ffprobe.kill('SIGTERM');
                    }
                    logDebug('Media analysis timeout after 30 seconds');
                    this.sendMessage({ timeout: true, success: false });
                    resolve({ timeout: true, success: false });
                }, 30000); // 30 second timeout for media analysis
    
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
                    if (killedByTimeout) {
                        logDebug('FFprobe process was killed by timeout, skipping result processing');
                        return; // Promise already resolved by timeout handler
                    }
                    
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

                            // ORIGINAL STRUCTURE - Keep all existing fields for compatibility
                            const streamInfo = {
                                format: info.format?.format_name || 'unknown',
                                container: info.format?.format_long_name || 'unknown',
								sizeBytes: info.format?.size,
                                type: type,
                                inputUrl: url,
                                analyzeUrl: analyzeUrl
                            };

                            logDebug('📊 Media analysis results:');
                            logDebug(`Container: ${streamInfo.container}`);

                            // Video stream info - ORIGINAL STRUCTURE
                            if (videoStream) {
                                streamInfo.width = parseInt(videoStream.width) || null;
                                streamInfo.height = parseInt(videoStream.height) || null;
                                streamInfo.hasVideo = true;
                                streamInfo.videoCodec = {
                                    name: videoStream.codec_name || 'unknown',
                                    longName: videoStream.codec_long_name || 'unknown',
                                    profile: videoStream.profile || null,
                                    level: videoStream.level || null, // H.264 level for quality assessment
                                    pixFmt: videoStream.pix_fmt || null,
                                    colorSpace: videoStream.color_space || null,
                                    bitDepth: videoStream.bits_per_raw_sample || null
                                };

                                // Calculate framerate - ORIGINAL LOGIC
                                let fps = null;
                                try {
                                    if (videoStream.r_frame_rate) {
                                        const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
                                        if (den && num) fps = Math.round(num / den);
                                    } else if (videoStream.avg_frame_rate) {
                                        const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
                                        if (den && num) fps = Math.round(num / den);
                                    }
                                } catch (e) {
                                    logDebug('⚠️ Error parsing framerate:', e);
                                }
                                streamInfo.fps = fps;

                                // Get video bitrate - ORIGINAL LOGIC
                                if (videoStream.bit_rate) {
                                    streamInfo.videoBitrate = parseInt(videoStream.bit_rate);
                                }

                                // NEW: Add stream-based video container
                                streamInfo.videoContainer = getVideoContainer(videoStream.codec_name);

                                logDebug('🎬 Video stream:', {
                                    codec: streamInfo.videoCodec.name,
                                    resolution: `${streamInfo.width}x${streamInfo.height}`,
                                    fps: `${streamInfo.fps}fps`,
                                    bitrate: streamInfo.videoBitrate ? `${(streamInfo.videoBitrate / 1000000).toFixed(2)}Mbps` : 'unknown',
                                    container: streamInfo.videoContainer
                                });
                            } else {
                                streamInfo.hasVideo = false;
                                logDebug('ℹ️ No video stream found');
                            }

                            // Audio stream info - STREAMLINED WITH MULTI-STREAM SUPPORT
                            if (audioStreams.length > 0) {
                                const firstAudioStream = audioStreams[0]; // Use first stream for codec info
                                
                                streamInfo.hasAudio = true;
                                streamInfo.audioCodec = {
                                    name: firstAudioStream.codec_name || 'unknown',
                                    longName: firstAudioStream.codec_long_name || 'unknown',
                                    profile: firstAudioStream.profile || null,
                                    sampleRate: parseInt(firstAudioStream.sample_rate) || null,
                                    channels: parseInt(firstAudioStream.channels) || null,
                                    channelLayout: firstAudioStream.channel_layout || null,
                                    bitDepth: firstAudioStream.bits_per_raw_sample || null
                                };

                                // Check for default audio stream (useful for multi-audio selection)
                                const defaultAudioStream = audioStreams.find(stream => stream.disposition?.default === 1);
                                if (defaultAudioStream && defaultAudioStream.index !== firstAudioStream.index) {
                                    streamInfo.defaultAudioIndex = defaultAudioStream.index;
                                }

                                if (firstAudioStream.bit_rate) {
                                    streamInfo.audioBitrate = parseInt(firstAudioStream.bit_rate);
                                }

                                // Stream-based audio container (same codec for all streams in container)
                                streamInfo.audioContainer = getAudioContainer(firstAudioStream.codec_name);
                                
                                // Add stream indexes only for multiple streams
                                if (audioStreams.length > 1) {
                                    streamInfo.audioStreamIndexes = audioStreams.map(s => s.index).join(',');
                                }

                                logDebug('🔊 Audio stream:', {
                                    codec: streamInfo.audioCodec.name,
                                    channels: streamInfo.audioCodec.channels,
                                    sampleRate: streamInfo.audioCodec.sampleRate ? `${streamInfo.audioCodec.sampleRate}Hz` : 'unknown',
                                    bitrate: streamInfo.audioBitrate ? `${(streamInfo.audioBitrate / 1000).toFixed(0)}kbps` : 'unknown',
                                    container: streamInfo.audioContainer,
                                    ...(streamInfo.audioStreamIndexes && { multiStream: `indexes: ${streamInfo.audioStreamIndexes}` })
                                });
                            } else {
                                streamInfo.hasAudio = false;
                                logDebug('ℹ️ No audio stream found');
                            }

                            // Subtitle stream info - ORIGINAL STRUCTURE + NEW MULTI-STREAM SUPPORT
                            if (subtitleStreams?.length > 0) {
                                streamInfo.hasSubs = true;
                                streamInfo.subtitles = subtitleStreams.map(sub => ({
                                    index: sub.index,
                                    codec: sub.codec_name || 'unknown',
                                    language: (sub.tags && (sub.tags.language || sub.tags.LANGUAGE)) || null,
                                    title: (sub.tags && (sub.tags.title || sub.tags.TITLE)) || null,
                                    // Enhanced disposition info for better track selection
                                    default: sub.disposition?.default === 1,
                                    forced: sub.disposition?.forced === 1,
                                    hearingImpaired: sub.disposition?.hearing_impaired === 1,
                                    disposition: sub.disposition || {},
                                }));

                                // NEW: Stream-based subtitle container and multi-stream support
                                if (subtitleStreams.length === 1) {
                                    streamInfo.subtitleContainer = getSubtitleContainer(subtitleStreams[0].codec_name);
                                } else if (subtitleStreams.length > 1) {
                                    streamInfo.subtitleContainer = getSubtitleContainer(subtitleStreams[0].codec_name);
                                    streamInfo.subsStreamIndexes = subtitleStreams.map(s => s.index).join(',');
                                }

                                logDebug(`📝 Found ${subtitleStreams.length} subtitle stream(s):`, {
                                    subtitles: streamInfo.subtitles,
                                    container: streamInfo.subtitleContainer,
                                    ...(streamInfo.subsStreamIndexes && { multiStream: `indexes: ${streamInfo.subsStreamIndexes}` })
                                });
                            } else {
                                streamInfo.hasSubs = false;
                                streamInfo.subtitles = [];
                                logDebug('ℹ️ No subtitle streams found');
                            }

                            // Total bitrate from format if available
                            if (info.format.bit_rate) {
                                streamInfo.totalBitrate = parseInt(info.format.bit_rate);
                            }

                            // Duration if available
                            if (info.format.duration) {
                                streamInfo.duration = Math.round(parseFloat(info.format.duration));
                                const hours = Math.floor(streamInfo.duration / 3600);
                                const minutes = Math.floor((streamInfo.duration % 3600) / 60);
                                const seconds = streamInfo.duration % 60;
                                if (hours > 0) {
                                    logDebug(`⏱️ Duration: ${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
                                } else {
                                    logDebug(`⏱️ Duration: ${minutes}:${seconds.toString().padStart(2, '0')}`);
                                }
                            }

                            this.sendMessage({ streamInfo, success: true });
                            logDebug('✅ Media analysis complete with enhanced stream-based containers');
                            resolve({ success: true, streamInfo });
                            
                        } catch (error) {
                            logDebug('❌ Error parsing FFprobe output:', error);
                            this.sendMessage('Failed to parse stream info');
                            resolve({ error: 'Failed to parse stream info' });
                        }
                    } else {
                        logDebug('❌ FFprobe failed with code:', code, 'Error:', errorOutput);
                        this.sendMessage('Failed to analyze video');
                        resolve({ error: 'Failed to analyze video' });
                    }
                });
    
                ffprobe.on('error', (err) => {
                    clearTimeout(timeout);
                    
                    // Don't send duplicate error if already killed by timeout
                    if (!killedByTimeout) {
                        logDebug('❌ FFprobe spawn error:', err);
                        this.sendMessage('Failed to start FFprobe: ' + err.message);
                        resolve({ error: 'Failed to start FFprobe: ' + err.message });
                    }
                });
            });
        } catch (err) {
            logDebug('❌ GetQualities error:', err);
            this.sendMessage(err.message);
            return { error: err.message };
        }
    }
}

module.exports = GetQualitiesCommand;
