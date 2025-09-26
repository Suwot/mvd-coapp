#!/usr/bin/env node
/**
 * MVD CoApp – Main entry point for the native host application
 * - Initializes the native messaging host environment
 * - Establishes connection with browser extensions
 * - Sets up command handling and execution pipeline
 * - Coordinates services and dependency injection
 * - Manages application lifecycle and error handling
 * - Bridges browser extension with system capabilities
 */



// Import core modules
const MessagingService = require('./lib/messaging');
const { logDebug } = require('./utils/logger');

// Handle CLI commands before Chrome messaging setup
const args = process.argv.slice(2);

// If no arguments (double-click), run installer
if (args.length === 0) {
    const installer = require('./lib/installer');
    
    installer.install().then(() => {
        process.exit(0);
    }).catch(err => {
        console.error('Installation failed:', err.message);
        process.exit(1);
    });
    return;
}

if (args.includes('-version')) {
    // Version is embedded at build time by pkg, or fallback for development
    const version = process.env.APP_VERSION || (() => {
        try {
            // Try to read version from package.json (for development/unpackaged runs)
            const fs = require('fs');
            const path = require('path');
            const packageJsonPath = path.join(__dirname, 'package.json');
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            return packageJson.version;
        } catch {
            return 'unknown';
        }
    })();
    console.log(`MVD CoApp v${version}`);
    process.exit(0);
}

if (args.includes('-install')) {
    const installer = require('./lib/installer');
    
    installer.install().then(() => {
        process.exit(0);
    }).catch(err => {
        console.error('Installation failed:', err.message);
        process.exit(1);
    });
    return;
}

if (args.includes('-uninstall')) {
    const installer = require('./lib/installer');
    
    installer.uninstall().then(() => {
        process.exit(0);
    }).catch(err => {
        console.error('Uninstallation failed:', err.message);
        process.exit(1);
    });
    return;
}
// Import services directly
const ffmpegService = require('./services/ffmpeg');

// Import commands directly
const DownloadCommand = require('./commands/download');
const GetQualitiesCommand = require('./commands/get-qualities');
const GeneratePreviewCommand = require('./commands/generate-preview');
const ValidateConnectionCommand = require('./commands/validate-connection');
const FileSystemCommand = require('./commands/file-system');

// Operation-based keep-alive management
let activeOperations = 0;
let idleTimer = null;
const IDLE_TIMEOUT = 60000; // 60 seconds idle timeout (only when no active operations)

function incrementOperations() {
    activeOperations++;
    logDebug(`Active operations: ${activeOperations} (incremented)`);
    clearIdleTimer();
}

function decrementOperations() {
    activeOperations = Math.max(0, activeOperations - 1);
    logDebug(`Active operations: ${activeOperations} (decremented)`);
    if (activeOperations === 0) {
        startIdleTimer();
    }
}

function clearIdleTimer() {
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
}

function startIdleTimer() {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
        if (activeOperations === 0) {
            logDebug('Native host idle timeout - no active operations, exiting gracefully');
            process.exit(0);
        }
    }, IDLE_TIMEOUT);
}

/**
 * Application bootstrap
 */
async function bootstrap() {
    try {
        logDebug('Starting native host application');
        
        // Initialize services directly
        logDebug('Initializing services...');
        if (!ffmpegService.initialize()) {
            logDebug('FFmpeg service initialization failed');
            process.exit(1);
        }
        
        // Create messaging service
        const messagingService = new MessagingService();
        
        // Initialize messaging with direct message handler
        messagingService.initialize(
            (request) => {
                processMessage(request, messagingService).catch(err => {
                    logDebug('Error in message processing:', err.message || err);
                    messagingService.sendMessage({ error: err.message || 'Unknown error' }, request.id);
                });
            }
        );
        
        // Start idle timer (no active operations initially)
        startIdleTimer();
        
        logDebug('Native host application started successfully');
    } catch (err) {
        logDebug('Bootstrap error:', err);
        console.error('Failed to start application:', err);
        process.exit(1);
    }
}

// Command registry - direct mapping
const commands = {
    'download': DownloadCommand,
    'cancel-download': DownloadCommand,
    'getQualities': GetQualitiesCommand,
    'generatePreview': GeneratePreviewCommand,
    'validateConnection': ValidateConnectionCommand,
    'fileSystem': FileSystemCommand,
    'quit': {
        execute: async (params, requestId, messagingService) => {
            logDebug('Received quit command - exiting gracefully');
            messagingService.sendMessage({ success: true, message: 'Shutting down' }, requestId);
            process.exit(0);
        }
    }
};

/**
 * Process incoming messages and route to appropriate command
 */
async function processMessage(request, messagingService) {
    const requestId = request.id;
    const commandType = request.command;
    
    // Track long-running operations
    const isLongRunningOperation = ['download', 'getQualities', 'generatePreview'].includes(commandType);
    
    if (isLongRunningOperation) {
        incrementOperations();
    }
    
    try {
        // Get command handler
        const CommandClass = commands[commandType];
        if (!CommandClass) {
            const error = `Unknown command: ${commandType}`;
            messagingService.sendMessage({ error }, requestId);
            return { error };
        }
        
        // Execute command directly
        const command = new CommandClass(messagingService);
        command.setMessageId(requestId);
        const result = await command.execute(request);
        return result;
    } catch (err) {
        const errorMessage = `Error executing ${commandType || 'command'}: ${err.message}`;
        logDebug(errorMessage);
        messagingService.sendMessage({ error: errorMessage }, requestId);
        return { error: errorMessage };
    } finally {
        if (isLongRunningOperation) {
            decrementOperations();
        }
    }
}

// Start the application
bootstrap();

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logDebug('Uncaught exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logDebug('Unhandled rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Handle process signals
process.on('SIGINT', () => {
    logDebug('Received SIGINT, exiting gracefully');
    if (idleTimer) clearTimeout(idleTimer);
    process.exit(0);
});

process.on('SIGTERM', () => {
    logDebug('Received SIGTERM, exiting gracefully');
    if (idleTimer) clearTimeout(idleTimer);
    process.exit(0);
});
