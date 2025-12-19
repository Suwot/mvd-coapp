import fs from 'fs';
import os from 'os';
import { ALLOWED_IDS, KNOWN_COMMANDS, IS_MACOS, IS_LINUX, IS_WINDOWS, LOG_FILE, TEMP_DIR, APP_VERSION } from '../utils/config';
import { logDebug, reportLogStatus } from '../utils/utils';
import { handleDownload } from '../handlers/downloader';
import { handleFileSystem } from '../handlers/filesystem';
import { handleRunTool } from '../handlers/tools';
import { Protocol } from './protocol';
import { clearProcessing } from './processes';

const HANDLERS = {
    'download-v2': handleDownload,
    'cancel-download-v2': handleDownload,
    'fileSystem': handleFileSystem,
    'runTool': handleRunTool,
    'kill-processing': async () => { 
        const killedCount = clearProcessing('manual');
        return { success: true, killedCount }; 
    },
    'quit': async () => { process.exit(0); }
};

const IDLE_TIMEOUT = 30000;
let commandCounter = 0;
let activeOperations = 0;
let idleTimer = null;
let isPipeClosed = false;

function startIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if (activeOperations === 0) {
            logDebug('[Router] Idle timeout reached - exiting');
            process.exit(0);
        }
    }, IDLE_TIMEOUT);
}

function checkGracefulExit() {
    if (isPipeClosed && activeOperations === 0) {
        logDebug('[Router] Pipe closed and no active operations - exiting');
        process.exit(0);
    }
}

export async function routeRequest(request, protocol) {
    const handler = HANDLERS[request.command];
    if (!handler) {
        logDebug(`[Router] Unknown command received: ${request.command}`);
        protocol.send({ error: `Unknown command: ${request.command}` }, request.id);
        return;
    }

    const isLongRunning = ['download-v2', 'fileSystem', 'runTool'].includes(request.command);
    if (isLongRunning) {
        activeOperations++;
        if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
        }
    }

    try {
        logDebug(`[Router] Routing command: ${request.command} (id: ${request.id})`);
        
        // Report log size every 10 commands to keep UI fresh without overhead
        if (++commandCounter % 10 === 0) {
            reportLogStatus({ send: (msg) => protocol.send(msg) });
        }

        const result = await handler(request, { send: (msg) => protocol.send(msg) });
        if (result) protocol.send(result, request.id);
    } catch (err) {
        logDebug(`[Router] Error executing ${request.command}:`, err.message);
        protocol.send({ error: err.message }, request.id);
    } finally {
        if (isLongRunning) {
            activeOperations = Math.max(0, activeOperations - 1);
            if (activeOperations === 0) {
                startIdleTimer();
                checkGracefulExit();
            }
        }
    }
}

export function initializeMessaging() {
    const protocol = new Protocol(
        (message) => routeRequest(message, protocol),
        () => {
            isPipeClosed = true;
            checkGracefulExit();
        }
    );

    startIdleTimer();

    // Get log file size
    let logFileSize = 0;
    try {
        if (fs.existsSync(LOG_FILE)) {
            logFileSize = fs.statSync(LOG_FILE).size;
        }
    } catch { /* ignore */ }

    // Send initial connection info (exact parity with original index.js)
    protocol.send({
        command: 'validateConnection',
        alive: true,
        success: true,
        version: APP_VERSION,
        location: process.execPath,
        ffmpegVersion: 'n7.1.1-1.7.0',
        arch: process.arch,
        platform: process.platform,
        osRelease: os.release(),
        osVersion: os.release(),
        pid: process.pid,
        lastValidation: Date.now(),
        logsFolder: TEMP_DIR,
        logFile: LOG_FILE,
        logFileSize,
        capabilities: ['download-v2', 'cancel-download-v2', 'file-system', 'kill-processing', 'run-tool']
    });
}
