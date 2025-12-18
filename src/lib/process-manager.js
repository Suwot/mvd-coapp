/**
 * ProcessManager – lightweight central registry for child processes
 * - Keeps a Set of active ChildProcess objects for shutdown cleanup
 * - Keeps a simple array of analysis processes for cache clear
 * - Installs process exit/signal handlers to forcibly kill remaining children
 *
 * This module is intentionally minimal: no PID maps, no detached groups.
 */

const { logDebug } = require('../utils/utils');

// Core process tracking for shutdown cleanup
const allProcesses = new Set();
// Simple processing task tracking for cache clear
const processingTasks = [];
let shuttingDown = false;
let handlersInstalled = false;

function safeKill(child, signal = 'SIGKILL') {
    if (!child || !child.pid || child.killed) return false;
    try {
        const pid = child.pid;
        // Windows has limited POSIX signal support - use consistent SIGKILL for reliability
        // ChildProcess.kill() always exists, so no fallback needed
        const effectiveSignal = process.platform === 'win32' ? 'SIGKILL' : signal;
        child.kill(effectiveSignal);
        logDebug(`ProcessManager: sent ${effectiveSignal} to PID ${pid}`);
        return true;
    } catch (err) {
        logDebug(`ProcessManager: failed to kill PID ${child.pid} - ${err.message}`);
        return false;
    }
}

function killAll(reason = 'shutdown') {
    if (shuttingDown) return;
    shuttingDown = true;

    if (allProcesses.size === 0) {
        logDebug('ProcessManager: killAll called but no active processes');
        return;
    }

    logDebug(`ProcessManager: killing all ${allProcesses.size} active process(es) due to ${reason}`);

    // Kill all processes immediately
    allProcesses.forEach(child => safeKill(child));
    
    // Clear both tracking collections
    allProcesses.clear();
    processingTasks.length = 0;
}

function clearProcessing(reason = 'cache clear') {
    const killCount = processingTasks.length;
    
    if (killCount === 0) return 0;
    
    logDebug(`ProcessManager: attempting to kill ${killCount} processing task(s) due to ${reason}`);
    
    // Kill all processing tasks and track success
    let successCount = 0;
    processingTasks.forEach(child => {
        if (safeKill(child)) {
            successCount++;
        }
        allProcesses.delete(child); // Also remove from main set
    });
    
    // Clear processing array
    processingTasks.length = 0;
    
    logDebug(`ProcessManager: kill signals sent to ${successCount}/${killCount} processing tasks`);
    return killCount;
}

function register(child, type) {
    if (!child || !child.pid) return;
    
    // Always track in main set for shutdown cleanup
    allProcesses.add(child);
    
    // Also track processing tasks for cache clear
    if (type === 'processing') {
        processingTasks.push(child);
        logDebug(`ProcessManager: registered processing task PID ${child.pid}`);
    } else {
        logDebug(`ProcessManager: registered process PID ${child.pid}`);
    }
    
    // Auto-unregister when the child fully closes
    let cleanedUp = false;
    const cleanup = (code, signal) => {
        if (cleanedUp) return; // Prevent double cleanup from close+error
        cleanedUp = true;
        
        allProcesses.delete(child);
        const processingIndex = processingTasks.indexOf(child);
        if (processingIndex !== -1) {
            processingTasks.splice(processingIndex, 1);
        }
        // Log actual process close with exit info
        const exitInfo = signal ? `signal ${signal}` : `code ${code}`;
        logDebug(`ProcessManager: process PID ${child.pid} closed (${exitInfo})`);
    };
    child.once('close', cleanup);
    child.once('error', cleanup);
    
    // Install exit handlers on first registration
    installHandlersOnce();
}

function unregister(child) {
    if (!child || !child.pid) return;
    
    // Remove from main set
    allProcesses.delete(child);
    
    // Remove from processing array if present
    const processingIndex = processingTasks.indexOf(child);
    if (processingIndex !== -1) {
        processingTasks.splice(processingIndex, 1);
    }
    
    logDebug(`ProcessManager: unregistered process PID ${child.pid}`);
}

function installHandlersOnce() {
    if (handlersInstalled) return;
    handlersInstalled = true;

    const safeHandler = (reason) => {
        logDebug('ProcessManager: shutdown handler triggered', reason || 'signal');
        try {
            killAll(reason);
        } catch (e) {
            logDebug('ProcessManager: error during killAll:', e.message || e);
        }
    };

    process.on('exit', () => safeHandler('exit'));
    process.on('beforeExit', () => safeHandler('beforeExit'));
    process.on('SIGINT', () => safeHandler('SIGINT'));
    process.on('SIGTERM', () => safeHandler('SIGTERM'));
    process.on('uncaughtException', (err) => {
        logDebug('ProcessManager: uncaughtException:', err && err.message);
        safeHandler('uncaughtException');
    });
    process.on('unhandledRejection', (reason, promise) => {
        logDebug('ProcessManager: unhandledRejection:', reason);
        safeHandler('unhandledRejection');
    });
}

// Install handlers immediately on require
installHandlersOnce();

module.exports = { register, unregister, killAll, clearProcessing };
