#!/usr/bin/env node
const os = require('os');
const fs = require('fs');
const path = require('path');
const bootLogPath = path.join(os.tmpdir(), 'mvdcoapp.boot.log');
try {
    fs.appendFileSync(bootLogPath, `BOOT ${new Date().toISOString()} argv=${JSON.stringify(process.argv)} stdinTTY=${!!process.stdin.isTTY}\n`);
} catch (err) {
    // Prevent boot logging failures from affecting startup
}
/**
 * MVD CoApp – Native messaging host for MAX Video Downloader
 */

// Import core modules
const MessagingService = require('./lib/messaging');
const { logDebug, TEMP_DIR, LOG_FILE } = require('./utils/utils');

// Platform detection - explicit support for known platforms only
const PLATFORM = process.platform;
const IS_WINDOWS = PLATFORM === 'win32';
const IS_MACOS = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';
const args = process.argv.slice(2);
const isStdinTTY = !!process.stdin.isTTY;

const ALLOWED_IDS = [
    'bkblnddclhmmgjlmbofhakhhbklkcofd',
    'kjinbaahkmjgkkedfdgpkkelehofieke',
    'hkakpofpmdphjlkojabkfjapnhjfebdl',
    'max-video-downloader@rostislav.dev'
];

const KNOWN_COMMANDS = ['-h', '--help', '-v', '--version', '-info', '-i', '--install', '-u', '--uninstall'];

(async () => {
    // 1. Install (0 arguments on Mac/Linux triggers install flow)
    if (args.length === 0) {
        if (IS_MACOS || IS_LINUX) {
            handleDoubleClick(); // Triggers install flow
            return;
        }
        // Windows: silent exit (NSIS handles install)
        process.exit(0);
    }

    // 2. CLI (Exact matches for known flags)
    if (KNOWN_COMMANDS.includes(args[0])) {
        handleCliArgs(args);
        return;
    }

    // 3. Native Messaging (Broad inclusion check for allowed IDs)
    const isMessaging = args.some(arg => ALLOWED_IDS.some(id => arg.includes(id)));
    if (isMessaging && !isStdinTTY) {
        startMessagingMode().catch(err => {
            console.error('Failed to start messaging mode:', err);
            process.exit(1);
        });
        return;
    }

    // 4. Reject everything else (Gibberish or unsupported commands)
    if (isStdinTTY) {
        showUsage();
    }
    process.exit(1);
})().catch(err => {
    console.error('Startup error:', err);
    process.exit(1);
});

// Get app version from env or package.json
function getVersion() {
    return process.env.APP_VERSION || (() => {
        try {
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

function showUsage() {
    console.log('MVD CoApp - MAX Video Downloader Native Messaging Host');
    console.log('');
    console.log('Usage:');
    console.log('  mvdcoapp -h, --help        Show this help message');
    console.log('  mvdcoapp -v, --version     Show version information');
    
    if (IS_WINDOWS) {
        console.log('');
        console.log('On Windows, CoApp is managed by the Installer/Uninstaller.');
        console.log('When called by browser extensions, CoApp operates as a native messaging host.');
    } else if (IS_MACOS || IS_LINUX) {
        console.log('  mvdcoapp -i, --install     Install CoApp for all detected browsers');
        console.log('  mvdcoapp -u, --uninstall   Remove CoApp from all browsers');
        console.log('');
        console.log('When called by browser extensions, CoApp operates as a native messaging host');
    }
}

/**
 * Handle double-click invocation (no args)
 */
function handleDoubleClick() {
    if (IS_MACOS || IS_LINUX) {
        // macOS/Linux: Run installer on double-click
        runInstallerOperation('install', 'Installation');
    } else if (IS_WINDOWS) {
        // Windows: Do nothing, exit silently (users should use NSIS installer)
        process.exit(0);
    }
}

/**
 * Handle CLI arguments
 */
function handleCliArgs(args) {
    const arg = (args || [])[0];
    // Define valid commands mapping
    const commands = {
        '-h': 'help',
        '--help': 'help', 
        '-v': 'version',
        '--version': 'version',
        '-i': 'install',
        '--install': 'install',
        '-u': 'uninstall',
        '--uninstall': 'uninstall',
    };
    
    const command = commands[arg];
    if (!command) {
        console.error(`Unknown command: ${arg}`);
        console.error('Use -h or --help for usage information');
        process.exit(1);
    }
    
    switch (command) {
        case 'help':
            showUsage();
            process.exit(0);
            break;
        case 'version':
            console.log(`MVD CoApp v${getVersion()}`);
            process.exit(0);
            break;
        case 'install':
            if (IS_WINDOWS) {
                console.log('Install command not available on Windows. Use the Installer instead.');
                process.exit(1);
            }
            runInstallerOperation('install', 'Installation');
            break;
        case 'uninstall':
            if (IS_WINDOWS) {
                console.log('Uninstall command not available on Windows. Use the Uninstaller instead.');
                process.exit(1);
            }
            runInstallerOperation('uninstall', 'Uninstallation');
            break;
    }
}

/**
 * Start native messaging mode for extension communication
 */
async function startMessagingMode() {
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
            const version = getVersion();
            // Get log file size (synchronous, fast operation)
            let logFileSize = 0;
            try {
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
                ffmpegVersion: 'n7.1.1-1.7.0', // Default bundled version
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

    // Handle uncaught exceptions and signals (only for messaging mode)
    process.on('uncaughtException', (err) => {
        logDebug('Uncaught exception:', err);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        logDebug('Unhandled rejection at:', promise, 'reason:', reason);
        process.exit(1);
    });

    process.on('SIGINT', () => {
        logDebug('Received SIGINT, exiting gracefully');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        logDebug('Received SIGTERM, exiting gracefully');
        process.exit(0);
    });
}
