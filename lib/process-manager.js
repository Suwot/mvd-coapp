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
// Simple analysis process tracking for cache clear
const analysisProcesses = [];
let shuttingDown = false;
let handlersInstalled = false;

function safeKill(child, signal = 'SIGKILL') {
    if (!child || !child.pid || child.killed) return false;
    try {
        const pid = child.pid;
        if (typeof child.kill === 'function') {
            child.kill(signal);
        } else {
            process.kill(child.pid, signal);
        }
        logDebug(`ProcessManager: sent ${signal} to PID ${pid}`);
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
    analysisProcesses.length = 0;
}

function clearAnalysis(reason = 'cache clear') {
    const killCount = analysisProcesses.length;
    
    if (killCount === 0) return 0;
    
    logDebug(`ProcessManager: attempting to kill ${killCount} analysis process(es) due to ${reason}`);
    
    // Kill all analysis processes and track success
    let successCount = 0;
    analysisProcesses.forEach(child => {
        if (safeKill(child)) {
            successCount++;
        }
        allProcesses.delete(child); // Also remove from main set
    });
    
    // Clear analysis array
    analysisProcesses.length = 0;
    
    logDebug(`ProcessManager: kill signals sent to ${successCount}/${killCount} analysis processes`);
    return killCount;
}

function register(child, type) {
    if (!child || !child.pid) return;
    
    // Always track in main set for shutdown cleanup
    allProcesses.add(child);
    
    // Also track analysis processes for cache clear
    if (type === 'processing') {
        analysisProcesses.push(child);
        logDebug(`ProcessManager: registered analysis process PID ${child.pid}`);
    } else {
        logDebug(`ProcessManager: registered process PID ${child.pid}`);
    }
    
    // Auto-unregister when the child fully closes
    const cleanup = (code) => {
        allProcesses.delete(child);
        const analysisIndex = analysisProcesses.indexOf(child);
        if (analysisIndex !== -1) {
            analysisProcesses.splice(analysisIndex, 1);
        }
        // Log process death confirmation (only for killed processes to avoid spam)
        if (code === null) {
            logDebug(`ProcessManager: confirmed death of PID ${child.pid} (killed)`);
        }
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
    
    // Remove from analysis array if present
    const analysisIndex = analysisProcesses.indexOf(child);
    if (analysisIndex !== -1) {
        analysisProcesses.splice(analysisIndex, 1);
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

module.exports = { register, unregister, killAll, clearAnalysis };
