/**
 * ConfigService – Application configuration management service
 * - Manages persistent application settings
 * - Handles loading/saving configuration to disk
 * - Provides defaults for missing configuration options
 * - Ensures configuration directory structure exists
 * - Offers consistent API for accessing configuration values
 * - Maintains configuration version compatibility
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logDebug } = require('../utils/logger');

/**
 * Configuration service for handling application settings
 */
class ConfigService {
    constructor() {
        this.config = {};
        this.configPath = path.join(process.env.HOME || os.homedir(), '.config', 'video-downloader-config.json');
        this.initialized = false;
    }

    /**
     * Initialize the configuration service
     */
    initialize() {
        if (this.initialized) {
            return true;
        }

        try {
            // Create config directory if it doesn't exist
            const configDir = path.dirname(this.configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            // Load existing config or create default
            if (fs.existsSync(this.configPath)) {
                try {
                    this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                    logDebug('Configuration loaded from:', this.configPath);
                } catch (err) {
                    logDebug('Error loading configuration, using defaults:', err);
                    this.config = this.getDefaultConfig();
                    this.saveConfig();
                }
            } else {
                logDebug('Configuration file not found, creating default');
                this.config = this.getDefaultConfig();
                this.saveConfig();
            }

            this.initialized = true;
            return true;
        } catch (err) {
            logDebug('Failed to initialize config service:', err);
            return false;
        }
    }

    /**
     * Get default configuration
     */
    getDefaultConfig() {
        return {
            defaultSavePath: path.join(process.env.HOME || os.homedir(), 'Desktop'),
            preferredQuality: 'best',
            useHardwareAcceleration: true,
            showNotifications: true,
            outputFormat: 'mp4',
            ffmpegCustomPaths: {
                enabled: true,
                ffmpegPath: null,  // Will be auto-detected if null
                ffprobePath: null  // Will be auto-detected if null
            },
            version: 1
        };
    }

    /**
     * Save current configuration to disk
     */
    saveConfig() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
            logDebug('Configuration saved to:', this.configPath);
            return true;
        } catch (err) {
            logDebug('Failed to save configuration:', err);
            return false;
        }
    }

    /**
     * Get a configuration value
     */
    get(key, defaultValue) {
        if (!this.initialized) {
            throw new Error('Config service not initialized');
        }

        return key in this.config ? this.config[key] : defaultValue;
    }

    /**
     * Set a configuration value
     */
    set(key, value) {
        if (!this.initialized) {
            throw new Error('Config service not initialized');
        }

        this.config[key] = value;
        this.saveConfig();
    }
}

module.exports = new ConfigService();
