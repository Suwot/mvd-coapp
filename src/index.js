#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const bootLogPath = path.join(process.env.TEMP || process.cwd(), 'mvdcoapp.boot.log');
try {
    fs.appendFileSync(bootLogPath, `BOOT ${new Date().toISOString()} argv=${JSON.stringify(process.argv)} stdinTTY=${!!process.stdin.isTTY}\n`);
} catch (err) {
    // Prevent boot logging failures from affecting startup
}
/**
 * MVD CoApp – Main entry point for the CoApp
 * - Initializes the native messaging host environment
 * - Establishes connection with browser extensions
 * - Sets up command handling and execution pipeline
 * - Coordinates services and dependency injection
 * - Manages application lifecycle and error handling
 * - Bridges browser extension with system capabilities
 */

const os = require('os');

// Import core modules
const MessagingService = require('./lib/messaging');
const { logDebug, TEMP_DIR, LOG_FILE } = require('./utils/utils');

// Platform detection - explicit support for known platforms only
const PLATFORM = process.platform;
const IS_WINDOWS = PLATFORM === 'win32';
const IS_MACOS = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

// Get app version from env or package.json
function getVersion() {
    return process.env.APP_VERSION || (() => {
        try {
            const fs = require('fs');
            const path = require('path');
            const packageJsonPath = path.join(__dirname, '../package.json');
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            return packageJson.version;
        } catch {
            return 'unknown';
        }
    })();
}

// Execute installer operation with error handling
async function runInstallerOperation(operation, operationName) {
    const installer = require('./lib/installer');
    
    try {
        await installer[operation]();
        process.exit(0);
    } catch (err) {
        console.error(`${operationName} failed:`, err.message);
        process.exit(1);
    }
}

/**
 * Display platform-appropriate usage information
 */
function showUsage() {
    console.log('MVD CoApp - MAX Video Downloader Native Messaging Host');
    console.log('');
    console.log('Usage:');
    console.log('  mvdcoapp -h, --help, -help        Show this help message');
    console.log('  mvdcoapp -v, --version, -version  Show version information');
    
    // Platform-specific commands and messaging
    if (IS_WINDOWS) {
        console.log('');
        console.log('On Windows, CoApp is managed by the Installer/Uninstaller.');
        console.log('When called by browser extensions, CoApp operates as a native messaging host.');
    } else if (IS_MACOS || IS_LINUX) {
        console.log('  mvdcoapp -i, --install, -install  Install CoApp for all detected browsers');
        console.log('  mvdcoapp --uninstall, -uninstall  Remove CoApp from all browsers');
        console.log('');
        console.log('When called by browser extensions, CoApp operates as a native messaging host');
    }
}

// Handle CLI commands before Chrome messaging setup
const cliArgsStart = process.execPath === process.argv[0] ? 1 : 2;
const args = process.argv.slice(cliArgsStart);

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

// If no arguments (double-click behavior)
if (args.length === 0) {
    if (IS_MACOS || IS_LINUX) {
        // macOS/Linux: Run installer on double-click
        runInstallerOperation('install', 'Installation');
    } else if (IS_WINDOWS) {
        // Windows: Do nothing, exit silently (users should use NSIS installer)
        process.exit(0);
    }
}

// Handle help command first (intentional help request)
if (hasCommand('help')) {
    showUsage();
    process.exit(0);
}

// Handle version command
if (hasCommand('version')) {
    console.log(`MVD CoApp v${getVersion()}`);
    process.exit(0);
}

// Handle install command (not available on Windows)
if (hasCommand('install')) {
    if (IS_WINDOWS) {
        console.log('Install command not available on Windows. Use the Installer instead.');
        process.exit(1);
    }
    runInstallerOperation('install', 'Installation');
}

// Handle uninstall command (not available on Windows)
if (hasCommand('uninstall')) {
    if (IS_WINDOWS) {
        console.log('Uninstall command not available on Windows. Use the Uninstaller instead.');
        process.exit(1);
    }
    runInstallerOperation('uninstall', 'Uninstallation');
}

// Import commands directly
const DownloadCommandV2 = require('./commands/download-v2');
const FileSystemCommand = require('./commands/file-system');
const RunToolCommand = require('./commands/run-tool');
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
        
        // Send connection info on startup (unsolicited event)
        const version = process.env.APP_VERSION || (() => {
            try {
                const pkg = require('../package.json');
                return pkg.version;
            } catch {
                return '0.0.0';
            }
        })();
        // Get log file size (synchronous, fast operation)
        let logFileSize = 0;
        try {
            const fs = require('fs');
            if (fs.existsSync(LOG_FILE)) {
                logFileSize = fs.statSync(LOG_FILE).size;
            }
        } catch (err) {
            // If we can't get file size, keep it as 0
        }
        
        const connectionInfo = {
            command: 'validateConnection',
            alive: true,
            success: true, // not used anymore
            version: version,
            location: process.execPath || process.argv[0],
            ffmpegVersion: '7.1.1', // Default bundled version
            arch: process.arch,
            platform: process.platform,
            osRelease: os.release(),
            osVersion: os.release(), // Note: os.version() doesn't exist, using release as fallback
            pid: process.pid,
            lastValidation: Date.now(),
            logsFolder: TEMP_DIR,
            logFile: LOG_FILE,
            logFileSize: logFileSize,
            capabilities: ['download-v2', 'cancel-download-v2', 'file-system', 'kill-processing', 'run-tool']
        };
        messagingService.sendMessage(connectionInfo);
        
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
    'download-v2': DownloadCommandV2,
    'cancel-download-v2': DownloadCommandV2,
    'fileSystem': FileSystemCommand,
    'runTool': RunToolCommand,
    'kill-processing': {
        execute: async (params, requestId, messagingService) => {
            logDebug('Received kill-processing command - terminating analysis processes');
            const killCount = processManager.clearProcessing('cache clear');
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
    const isLongRunningOperation = ['download-v2', 'fileSystem', 'runTool'].includes(commandType);
    
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
            messagingService.sendMessage(result, requestId);
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
