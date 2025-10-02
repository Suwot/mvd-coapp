#!/usr/bin/env node
/**
 * MVD CoApp – Main entry point for the CoApp
 * - Initializes the native messaging host environment
 * - Establishes connection with browser extensions
 * - Sets up command handling and execution pipeline
 * - Coordinates services and dependency injection
 * - Manages application lifecycle and error handling
 * - Bridges browser extension with system capabilities
 */

// Import core modules
const MessagingService = require('./lib/messaging');
const { logDebug } = require('./utils/utils');

/**
 * Display usage information and available commands
 */
function showUsage() {
    const platform = process.platform;
    
    console.log('MVD CoApp - MAX Video Downloader Native Messaging Host');
    console.log('');
    console.log('Usage:');
    console.log('  mvdcoapp -h, --help, -help        Show this help message');
    console.log('  mvdcoapp -v, --version, -version  Show version information');
    
    // Install/uninstall commands only available on macOS and Linux
    if (platform !== 'win32') {
        console.log('  mvdcoapp -i, --install, -install  Install CoApp for all detected browsers');
        console.log('  mvdcoapp --uninstall, -uninstall  Remove CoApp from all browsers');
    }
    
    console.log('');
    
    if (platform === 'win32') {
        console.log('On Windows, CoApp is managed by the NSIS installer/uninstaller.');
        console.log('When called by browser extensions, CoApp operates as a native messaging host.');
    } else {
        console.log('When called by browser extensions, CoApp operates as a native messaging host');
        if (platform === 'darwin') {
            console.log('and should not be run directly without arguments.');
        } else {
            console.log('Use the install/uninstall commands to configure browser integration.');
        }
    }
}

// Handle CLI commands before Chrome messaging setup
const args = process.argv.slice(2);

// Define command aliases for cross-compatibility
const commandAliases = {
    version: ['-v', '--version', '-version'],
    help: ['-h', '--help', '-help'],
    install: ['-i', '--install', '-install'],
    uninstall: ['--uninstall', '-uninstall']
};

// Helper function to check if args contain any alias for a command
function hasCommand(commandName) {
    return commandAliases[commandName].some(alias => args.includes(alias));
}

// Get all valid command aliases (flattened)
const validCommands = Object.values(commandAliases).flat();

// If no arguments (double-click behavior)
if (args.length === 0) {
    if (process.platform === 'darwin') {
        // macOS: Run installer on double-click
        const installer = require('./lib/installer');
        
        installer.install().then(() => {
            process.exit(0);
        }).catch(err => {
            console.error('Installation failed:', err.message);
            process.exit(1);
        });
        return;
    } else if (process.platform === 'win32') {
        // Windows: Do nothing, exit silently (users should use NSIS installer)
        process.exit(0);
    } else {
        // Linux: Show help message for CLI usage
        console.log('Use -h for help or -i to install CoApp for detected browsers.');
        process.exit(0);
    }
}

// Handle help command first (intentional help request)
if (hasCommand('help')) {
    showUsage();
    process.exit(0);
}

// Skip strict argument validation for native messaging calls
// Chrome may pass internal arguments that we shouldn't treat as errors
// Only validate when we have clear user-intent arguments

// Handle version command
if (hasCommand('version')) {
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

// Handle install command (not available on Windows)
if (hasCommand('install')) {
    if (process.platform === 'win32') {
        console.log('Install command not available on Windows. Use the Installer instead.');
        process.exit(1);
    }
    
    const installer = require('./lib/installer');
    
    installer.install().then(() => {
        process.exit(0);
    }).catch(err => {
        console.error('Installation failed:', err.message);
        process.exit(1);
    });
    return;
}

// Handle uninstall command (not available on Windows)
if (hasCommand('uninstall')) {
    if (process.platform === 'win32') {
        console.log('Uninstall command not available on Windows. Use the Uninstaller instead.');
        process.exit(1);
    }
    
    const installer = require('./lib/installer');
    
    installer.uninstall().then(() => {
        process.exit(0);
    }).catch(err => {
        console.error('Uninstallation failed:', err.message);
        process.exit(1);
    });
    return;
}

// Import commands directly
const DownloadCommand = require('./commands/download');
const GetQualitiesCommand = require('./commands/get-qualities');
const GeneratePreviewCommand = require('./commands/generate-preview');
const ValidateConnectionCommand = require('./commands/validate-connection');
const FileSystemCommand = require('./commands/file-system');
const processManager = require('./lib/process-manager');

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
            logDebug('CoApp idle timeout - no active operations, exiting gracefully');
            process.exit(0);
        }
    }, IDLE_TIMEOUT);
}

/**
 * Application bootstrap
 */
async function bootstrap() {
    try {
        logDebug('Starting CoApp application');
        
        // Services are now inline utilities - no initialization needed
        logDebug('CoApp services ready');
        
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
        
        logDebug('CoApp application started successfully');
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
        'kill-processing': {
        execute: async (params, requestId, messagingService) => {
            logDebug('Received kill-processing command - terminating analysis processes');
            const killCount = processManager.clearAnalysis('cache clear');
            messagingService.sendMessage({ success: true, killedCount: killCount }, requestId);
        }
    },
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
        
        // Handle inline commands (objects with execute function) vs classes
        if (typeof CommandClass.execute === 'function') {
            // Inline command object
            const result = await CommandClass.execute(request, requestId, messagingService);
            return result;
        } else {
            // Command class
            const command = new CommandClass(messagingService);
            command.setMessageId(requestId);
            const result = await command.execute(request);
            return result;
        }
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
