import { logDebug } from '../utils/utils';
import { IS_WINDOWS } from '../utils/config';

const allProcesses = new Set();
const processingTasks = new Set();
let isShuttingDown = false;
let onProcessCountChange = null;

export function setProcessCountCallback(cb) {
    onProcessCountChange = cb;
}

export function getActiveProcessCount() {
    return allProcesses.size;
}

export function register(child, options = {}) {
    if (!child || !child.pid) return;
    
    const { type } = options;
    
    allProcesses.add(child);
    if (onProcessCountChange) onProcessCountChange(allProcesses.size);

    if (type === 'processing') {
        processingTasks.add(child);
    }
    
    const cleanup = () => {
        if (!allProcesses.has(child)) return;
        allProcesses.delete(child);
        processingTasks.delete(child);
        if (onProcessCountChange) onProcessCountChange(allProcesses.size);
    };
    child.once('close', cleanup);
    child.once('error', cleanup);
}

export function killAll(reason = 'shutdown') {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logDebug(`[Processes] Killing all (${allProcesses.size}) processes. Reason: ${reason}`);
    allProcesses.forEach(child => {
        if (!child.killed) {
            child.kill(IS_WINDOWS ? 'SIGKILL' : 'SIGTERM');
        }
    });
    allProcesses.clear();
    processingTasks.clear();
}

/**
 * Kill only processing tasks (ffprobe analysis, etc.) 
 * preserved from original clearProcessing
 */
export function clearProcessing(reason = 'cache clear') {
    const count = processingTasks.size;
    if (count === 0) return 0;

    logDebug(`[Processes] Clearing ${count} processing tasks. Reason: ${reason}`);
    processingTasks.forEach(child => {
        if (!child.killed) {
            child.kill(IS_WINDOWS ? 'SIGKILL' : 'SIGTERM');
        }
        allProcesses.delete(child);
    });
    processingTasks.clear();
    return count;
}

// Global Lifecycle
process.on('exit', () => killAll('exit'));
process.on('SIGINT', () => { killAll('SIGINT'); process.exit(0); });
process.on('SIGTERM', () => { killAll('SIGTERM'); process.exit(0); });
process.on('uncaughtException', (err) => {
    logDebug('[Processes] Uncaught Exception:', err?.message || err);
    killAll('uncaughtException');
    process.exit(1);
});
