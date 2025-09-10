/**
 * ResourceUtils – Utilities for system resources and environment management
 * - Provides enhanced environment variables
 * - Manages application cache directory
 * - Ensures proper system paths are available
 * - Creates necessary directory structures
 * - Supports cross-platform path handling
 * - Offers consistent system resource access
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const { logDebug } = require('./logger');

/**
 * Utility for handling resources and system-level operations
 */

function getFullEnv() {
    // Get a complete environment with PATH that includes common locations
    const extraPaths = [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin'
    ];
    
    const pathDelimiter = process.platform === 'win32' ? ';' : ':';
    const pathValue = extraPaths.join(pathDelimiter);
    
    return {
        ...process.env,
        PATH: `${pathValue}${pathDelimiter}${process.env.PATH || ''}`
    };
}

// Ensure cache directory exists
function ensureCacheDirectory() {
    const cacheDir = path.join(process.env.HOME || os.homedir(), '.cache');
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
    return cacheDir;
}

module.exports = {
    getFullEnv,
    ensureCacheDirectory
};
