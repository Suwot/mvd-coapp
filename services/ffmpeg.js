/**
 * FFmpegService – Core service for video processing using FFmpeg
 * - Always looks for FFmpeg binaries in the same directory as the executable
 * - No hardcoded paths, works in both development and production
 * - Simple and reliable path resolution
 */

const fs = require('fs');
const path = require('path');
const { logDebug } = require('../utils/logger');

/**
 * FFmpeg service for handling video processing operations
 */
class FFmpegService {
    constructor() {
        this.ffmpegPath = null;
        this.ffprobePath = null;
        this.initialized = false;
    }

    /**
     * Initialize the FFmpeg service
     */
    initialize() {
        if (this.initialized) {
            return true;
        }

        try {
            // Get FFmpeg paths (always in same directory as executable)
            const execDir = typeof process.pkg !== 'undefined' 
                ? path.dirname(process.execPath)
                : path.dirname(__dirname);
            
            const extension = process.platform === 'win32' ? '.exe' : '';
            const ffmpegPath = path.join(execDir, `ffmpeg${extension}`);
            const ffprobePath = path.join(execDir, `ffprobe${extension}`);
            
            // Check if binaries exist
            if (fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)) {
                this.ffmpegPath = ffmpegPath;
                this.ffprobePath = ffprobePath;
                
                logDebug('Using FFmpeg at:', this.ffmpegPath);
                logDebug('Using FFprobe at:', this.ffprobePath);
                
                this.initialized = true;
                return true;
            }

            // Fallback to system paths if bundled binaries not found
            return this.trySystemPaths();
        } catch (err) {
            logDebug('FFmpeg initialization failed:', err);
            return false;
        }
    }

    /**
     * Try system-installed FFmpeg as fallback
     */
    trySystemPaths() {
        logDebug('Trying system FFmpeg paths as fallback');
        
        const systemPaths = process.platform === 'darwin' ? [
            '/opt/homebrew/bin',  // M1 Mac Homebrew
            '/usr/local/bin',     // Intel Mac Homebrew
            '/opt/local/bin',     // MacPorts
            '/usr/bin'            // System
        ] : process.platform === 'win32' ? [
            'C:\\ffmpeg\\bin',
            'C:\\Program Files\\ffmpeg\\bin'
        ] : [
            '/usr/bin',
            '/usr/local/bin'
        ];
        
        const extension = process.platform === 'win32' ? '.exe' : '';
        
        for (const basePath of systemPaths) {
            const ffmpegPath = path.join(basePath, `ffmpeg${extension}`);
            const ffprobePath = path.join(basePath, `ffprobe${extension}`);
            
            if (fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)) {
                this.ffmpegPath = ffmpegPath;
                this.ffprobePath = ffprobePath;
                logDebug('Using system FFmpeg at:', this.ffmpegPath);
                logDebug('Using system FFprobe at:', this.ffprobePath);
                return true;
            }
        }
        
        logDebug('No system FFmpeg found');
        return false;
    }

    /**
     * Get the detected FFmpeg path
     */
    getFFmpegPath() {
        return this.ffmpegPath;
    }

    /**
     * Get the detected FFprobe path
     */
    getFFprobePath() {
        return this.ffprobePath;
    }
}

module.exports = new FFmpegService();
