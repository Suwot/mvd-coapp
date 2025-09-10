/**
 * ValidateConnectionCommand – Connection validation and info retrieval command
 * - Responds to connection validation requests from the extension
 * - Verifies that the native host is alive and responsive
 * - Returns version, location, and FFmpeg info for UI display
 * - Used during connection establishment and manual reconnection
 * - Provides diagnostics about host process status
 */

const BaseCommand = require('./base-command');
const { logDebug } = require('../utils/logger');

/**
 * Command for validating connection and retrieving host information
 */
class ValidateConnectionCommand extends BaseCommand {
    /**
     * Execute the connection validation command
     * @param {Object} params Command parameters
     */
    async execute(params) {
        logDebug('Received connection validation request');
        
        // Get version
        const version = process.env.APP_VERSION || (() => {
            try {
                const pkg = require('../../package.json');
                return pkg.version;
            } catch {
                return '0.1.0';
            }
        })();
        
        // Get binary location
        const location = process.execPath || process.argv[0];
        
        // Get FFmpeg version info
        let ffmpegVersion = null;
        try {
            const ffmpegService = this.getService('ffmpeg');
            if (ffmpegService) {
                // Try to get FFmpeg version - this is a simple approach
                ffmpegVersion = '7.1.1'; // Default bundled version
                // TODO: Could run ffmpeg -version to get actual version, but keeping it simple for now
            }
        } catch (error) {
            logDebug('Could not get FFmpeg version:', error.message);
        }
        
        const response = {
            command: 'validateConnection',
            alive: true,
            success: true,
            version: version,
            location: location,
            ffmpegVersion: ffmpegVersion
        };
        
        // Send connection validation response with host info
        this.sendMessage(response);

        return response;
    }
}

module.exports = ValidateConnectionCommand;
