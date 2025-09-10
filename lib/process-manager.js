/**
 * ProcessManager – lightweight central registry for child processes
 * - Keeps a Set of active ChildProcess objects
 * - Exposes register(child) and unregister(child)
 * - Installs process exit/signal handlers to forcibly kill remaining children
 *
 * This module is intentionally minimal: no PID maps, no detached groups.
 */

const { logDebug } = require('../utils/logger');

const activeChildren = new Set();
let shuttingDown = false;
let handlersInstalled = false;

function safeKill(child, signal = 'SIGKILL') {
    if (!child || !child.pid) return;
    try {
        if (child.killed) return;
        logDebug(`ProcessManager: sending ${signal} to PID ${child.pid}`);
        // Use process.kill if child.kill isn't available (child could be a plain object)
        if (typeof child.kill === 'function') {
            child.kill(signal);
        } else {
            try {
                process.kill(child.pid, signal);
            } catch (err) {
                logDebug(`ProcessManager: process.kill failed for PID ${child.pid}: ${err.message}`);
            }
        }
    } catch (err) {
        logDebug(`ProcessManager: failed to kill PID ${child && child.pid}: ${err && err.message}`);
    }
}

function killAll(reason = 'shutdown') {
    if (shuttingDown) return;
    shuttingDown = true;

    if (activeChildren.size === 0) {
        logDebug('ProcessManager: killAll called but no active children');
        return;
    }

    logDebug(`ProcessManager: killing all ${activeChildren.size} active child(ren) due to ${reason}`);

    // For previews we prefer immediate termination — send SIGKILL immediately
    for (const child of Array.from(activeChildren)) {
        try {
            safeKill(child, 'SIGKILL');
        } catch (e) {
            // ignore
        }
    }

    // Clear the set eagerly
    activeChildren.clear();
}

function register(child) {
    if (!child || !child.pid) return;
    activeChildren.add(child);
    // Auto-unregister when the child fully closes; also handle spawn errors
    const cleanup = () => {
        if (activeChildren.has(child)) activeChildren.delete(child);
    };
    child.once('close', cleanup);
    child.once('error', cleanup);
}

function unregister(child) {
    if (!child) return;
    if (activeChildren.has(child)) activeChildren.delete(child);
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

module.exports = { register, unregister, killAll };
