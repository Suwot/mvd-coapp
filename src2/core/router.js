import fs from 'fs';
import os from 'os';
import path from 'path';
import { LOG_FILE, TEMP_DIR, APP_VERSION, IDLE_TIMEOUT, VALIDATION_SCHEMA } from '../utils/config';
import { logDebug, reportLogStatus, getFreeDiskSpace, CoAppError } from '../utils/utils';
import { handleDownload } from '../handlers/downloader';
import { handleFileSystem } from '../handlers/filesystem';
import { handleRunTool } from '../handlers/tools';
import { Protocol } from './protocol';
import { clearProcessing, getActiveProcessCount, setProcessCountCallback } from './processes';

const HANDLERS = {
    'download-v2': handleDownload,
    'cancel-download-v2': handleDownload,
    'fileSystem': handleFileSystem,
    'runTool': handleRunTool,
    'get-disk-space': async (req) => {
        const free = await getFreeDiskSpace(req.path || os.homedir());
        return { success: true, freeDiskSpace: free };
    },
    'kill-processing': async () => { 
        const killedCount = clearProcessing('manual');
        return { success: true, from: 'kill-processing', killedCount }; 
    },
    'quit': async () => { process.exit(0); }
};

let commandCounter = 0;
let activeHandlers = 0;
let idleTimer = null;
let isPipeClosed = false;

function startIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if (activeHandlers === 0 && getActiveProcessCount() === 0) {
            logDebug('[Router] Idle timeout reached - exiting');
            process.exit(0);
        }
    }, IDLE_TIMEOUT);
}

function checkGracefulExit() {
    if (isPipeClosed && activeHandlers === 0 && getActiveProcessCount() === 0) {
        logDebug('[Router] Pipe closed and no active operations - exiting');
        process.exit(0);
    }
}

function validateRequest(request) {
    const fields = VALIDATION_SCHEMA[request.command];
    if (!fields) return;

    for (const field of fields) {
        const value = request[field] ?? request.params?.[field];
        if (value === undefined) {
            throw new CoAppError(`Missing required field: ${field}`, 'EINVAL');
        }
    }
}

export async function routeRequest(request, protocol) {
    const handler = HANDLERS[request.command];
    if (!handler) {
        logDebug(`[Router] Unknown command received: ${request.command}`);
        protocol.send({ error: `Unknown command: ${request.command}`, key: 'ENOSYS' }, request.id);
        return;
    }

    try {
        validateRequest(request);

        activeHandlers++;
        if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
        }

        // Enhanced logging for debugging
        const { id, command, ...params } = request;
        logDebug(`[Router] Routing: ${command} (id: ${id || 'fire-and-forget'})`, params);
        
        // Report log size every 10 commands to keep UI fresh without overhead
        if (++commandCounter % 10 === 0) {
            reportLogStatus({ send: (msg) => protocol.send(msg) });
        }

        const result = await handler(request, { send: (msg) => protocol.send(msg) });
        if (result) protocol.send(result, request.id);
    } catch (err) {
        const key = err.key || err.code || 'internalError';
        logDebug(`[Router] Error executing ${request.command}:`, err.message);
        protocol.send({ success: false, error: err.message, key }, request.id);
    } finally {
        activeHandlers = Math.max(0, activeHandlers - 1);
        if (activeHandlers === 0) {
            startIdleTimer();
            checkGracefulExit();
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

    // Trigger exit check whenever a child process finishes
    setProcessCountCallback(() => {
        if (activeHandlers === 0) checkGracefulExit();
    });

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
        capabilities: ['download-v2', 'cancel-download-v2', 'fileSystem', 'kill-processing', 'runTool']
    });
}
