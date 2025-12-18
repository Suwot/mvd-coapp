/**
 * Linux Dialog Module - Portal + Fallback Implementation
 * - XDG Portal (DBus) first priority for modern sandboxed environments
 * - Direct GUI tools fallback (zenity, kdialog, yad)
 * - Safe Downloads path fallback for headless/no GUI
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { logDebug } = require('../utils/utils');
const { pathToFileURL } = require('url');

// Module-level singleton bus to avoid accumulation
let sessionBus = null;

/**
 * Get or create the session bus singleton
 */
function getSessionBus() {
    if (!sessionBus) {
        const dbus = require('dbus-next');
        sessionBus = dbus.sessionBus();
    }
    return sessionBus;
}

// Cached portal availability (checked once per run)
let portalAvailable = null;

/**
 * Check if XDG Portal is available on the system
 * @returns {boolean} True if portal can be used
 */
function isPortalAvailable() {
    if (portalAvailable !== null) return portalAvailable;

    try {
        // Check if DBus session bus is available
        if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
            portalAvailable = false;
            return false;
        }

        // Try to import dbus-next and get bus
        require('dbus-next');
        getSessionBus(); // Ensure bus is created
        portalAvailable = true;
    } catch (error) {
        logDebug('Portal not available:', error.message);
        portalAvailable = false;
    }

    return portalAvailable;
}

/**
 * Try to show dialog via XDG Portal
 * @param {string} type - 'directory' or 'save'
 * @param {Object} options - { title, defaultPath, defaultName }
 * @returns {Object} { path: string } or { cancelled: true } or { failed: true }
 */
async function tryPortalDialog(type, options) {
    if (!isPortalAvailable()) return { failed: true };

    try {
        const dbus = require('dbus-next');
        const Variant = dbus.Variant;
        const bus = getSessionBus();

        const portal = await bus.getProxyObject('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop');
        const fileChooser = portal.getInterface('org.freedesktop.portal.FileChooser');

        const handleToken = `mvd_${Date.now()}`;
        const options_dbus = {
            handle_token: new Variant('s', handleToken),
            modal: new Variant('b', true),
            multiple: new Variant('b', false)
        };

        if (type === 'directory') {
            options_dbus.directory = new Variant('b', true);
        } else {
            if (options.defaultName) {
                options_dbus.current_name = new Variant('s', options.defaultName);
            }
        }

        // Add current folder if defaultPath exists
        if (options.defaultPath && fs.existsSync(options.defaultPath)) {
            options_dbus.current_folder = new Variant('s', pathToFileURL(options.defaultPath).href);
        }

        const method = type === 'directory' ? 'OpenFile' : 'SaveFile';
        const requestPath = await fileChooser[method]('', options.title || (type === 'directory' ? 'Choose Directory' : 'Save As'), options_dbus);

        // Wait for response on the request path
        const request = await bus.getProxyObject('org.freedesktop.portal.Desktop', requestPath);
        const reqInterface = request.getInterface('org.freedesktop.portal.Request');

        const response = await new Promise((resolve, reject) => {
            const handler = (responseCode, results) => {
                clearTimeout(timeout);
                resolve({ responseCode, results });
            };
            reqInterface.once('Response', handler);
            const timeout = setTimeout(() => {
                reqInterface.removeListener('Response', handler);
                resolve({ responseCode: -1, results: {} }); // Treat timeout as cancelled
            }, 600000); // 10min timeout
        });

        if (response.responseCode === 0 && response.results.uris && response.results.uris.value && response.results.uris.value.length > 0) {
            // Convert file:// URI to path
            const uri = response.results.uris.value[0];
            if (typeof uri === 'string' && uri.startsWith('file://')) {
                const { fileURLToPath } = require('url');
                return { path: fileURLToPath(uri) };
            }
        }

        // User cancelled or timeout
        return { cancelled: true };
    } catch (error) {
        logDebug('Portal dialog failed:', error.message);
        return { failed: true };
    }
}

// Cached direct GUI tool (detected once per run)
let cachedTool = null;

/**
 * Get cached direct GUI tool (zenity, kdialog, yad)
 * @returns {string|null} Tool name or null
 */
function pickDirectTool() {
    if (cachedTool !== null) return cachedTool;

    if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
        const candidates = ['zenity', 'kdialog', 'yad'];
        for (const cmd of candidates) {
            try {
                const { status } = spawnSync('which', [cmd], { stdio: 'ignore' });
                if (status === 0) {
                    cachedTool = cmd;
                    return cmd;
                }
            } catch {
                // Ignore errors from which
            }
        }
    }
    cachedTool = null;
    return null;
}

/**
 * Build command for direct GUI tool
 * @param {string} tool - Tool name
 * @param {string} type - 'directory' or 'save'
 * @param {Object} options - { title, defaultPath, defaultName }
 * @returns {Object} { cmd, args }
 */
function runDirectTool(tool, type, options) {
    const args = [];

    switch (tool) {
        case 'zenity':
            args.push('--file-selection');
            if (type === 'directory') {
                args.push('--directory');
            } else {
                args.push('--save', '--confirm-overwrite');
            }
            args.push('--title', options.title || (type === 'directory' ? 'Choose Directory' : 'Save As'));
            break;
        case 'kdialog':
            if (type === 'directory') {
                args.push('--getexistingdirectory');
            } else {
                args.push('--getsavefilename', '--title', options.title || 'Save As');
            }
            break;
        case 'yad':
            args.push('--file');
            if (type === 'directory') {
                args.push('--directory');
            } else {
                args.push('--save', '--confirm-overwrite');
            }
            args.push('--title', options.title || (type === 'directory' ? 'Choose Directory' : 'Save As'));
            break;
    }

    // Add path seed
    const seedPath = options.defaultPath && fs.existsSync(options.defaultPath) ? options.defaultPath :
                     resolveDownloads() || path.join(os.homedir() || '/tmp', 'Downloads');  // Ensure string fallback

    if (type === 'directory') {
        switch (tool) {
            case 'zenity':
            case 'yad':
                args.push('--filename', seedPath.endsWith('/') ? seedPath : seedPath + '/');
                break;
            case 'kdialog':
                args.push(seedPath);
                break;
        }
    } else {
        const filePath = options.defaultName ? path.join(seedPath, options.defaultName) : seedPath;
        switch (tool) {
            case 'zenity':
            case 'yad':
                args.push('--filename', filePath);
                break;
            case 'kdialog':
                args.push(filePath);
                break;
        }
    }

    return { cmd: tool, args };
}

/**
 * Resolve Downloads directory with fallbacks
 * @returns {string} Downloads path
 */
function resolveDownloads() {
    try {
        const { status, stdout } = spawnSync('xdg-user-dir', ['DOWNLOAD'], { encoding: 'utf8' });
        if (status === 0 && stdout.trim()) {
            const dir = stdout.trim();
            if (fs.existsSync(dir)) return dir;
        }
    } catch {
        // Ignore xdg-user-dir errors
    }

    const homeDownloads = path.join(os.homedir(), 'Downloads');
    if (fs.existsSync(homeDownloads)) return homeDownloads;

    // Snap fallback
    if (process.env.SNAP_USER_COMMON) {
        const snapDownloads = path.join(process.env.SNAP_USER_COMMON, 'Downloads');
        try {
            if (!fs.existsSync(snapDownloads)) {
                fs.mkdirSync(snapDownloads, { recursive: true });
            }
            return snapDownloads;
        } catch {
            // Ignore Snap directory creation errors
        }
    }

    return homeDownloads; // Fallback to ~/Downloads even if not exists
}

/**
 * Ensure directory is writable by testing file creation
 * @param {string} dir - Directory path
 * @returns {boolean} True if writable
 */
function ensureWritable(dir) {
    const testFile = path.join(dir, 'mvd_test.tmp');
    try {
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        return true;
    } catch {
        // Directory not writable
        return false;
    }
}

/**
 * Get Linux dialog command with Portal + fallbacks
 * @param {string} type - 'directory' or 'save'
 * @param {string} title - Dialog title
 * @param {string} defaultPath - Default path
 * @param {string} defaultName - Default filename (for save)
 * @returns {Object} { cmd, args }
 */
async function getLinuxDialog(type, title, defaultPath, defaultName) {
    const options = { title, defaultPath, defaultName };

    // Try Portal first
    logDebug('Trying Portal for Linux dialog');
    const portalResult = await tryPortalDialog(type, options);
    if (portalResult.path) {
        logDebug('Portal succeeded');
        return { cmd: 'echo', args: [portalResult.path] };
    }
    if (portalResult.cancelled) {
        // User cancelled Portal - not an error, just a normal cancellation, so no UI feedback
        const error = new Error('Dialog cancelled');
        throw error;
    }
    // Fallback to direct tool, bc Portal failed
    const tool = pickDirectTool();
    if (tool) {
        logDebug(`Using direct tool: ${tool}`);
        return runDirectTool(tool, type, options);
    }

    // Final fallback to Downloads (only when no tools and Portal failed)
    logDebug('No GUI available, using Downloads fallback');
    const fallbackPath = resolveDownloads() || path.join(os.homedir() || '/tmp', 'Downloads');
    if (!ensureWritable(fallbackPath)) {
        // If not writable, try to create or find alternative
        const altPath = path.join(os.tmpdir(), 'mvd_downloads');
        try {
            if (!fs.existsSync(altPath)) fs.mkdirSync(altPath, { recursive: true });
            if (ensureWritable(altPath)) {
                return { cmd: 'echo', args: [altPath] };
            }
        } catch {} // eslint-disable-line no-empty
    }
    return { cmd: 'echo', args: [fallbackPath] };
}

/**
 * Get Linux modal dialog command for info/question dialogs
 * @param {string} type - 'info' or 'question'
 * @param {string} text - Dialog text content
 * @param {string} title - Dialog title
 * @returns {Object} Command object with cmd and args
 */
function getLinuxModalCommand(type, text, title) {
    const tool = pickDirectTool();
    if (!tool) {
        return null; // No GUI tool available, will fall back to console
    }

    const args = (() => {
        switch (tool) {
            case 'zenity':
                if (type === 'info') {
                    return ['--info', '--text=' + text, '--title=' + title, '--width=350'];
                } else { // question
                    return ['--question', '--text=' + text, '--title=' + title, '--ok-label=OK', '--cancel-label=Uninstall', '--width=350'];
                }
            case 'kdialog':
                if (type === 'info') {
                    return ['--msgbox', text, '--title', title];
                } else { // question
                    return ['--yesno', text, '--title', title, '--yes-label', 'OK', '--no-label', 'Uninstall'];
                }
            case 'yad':
                if (type === 'info') {
                    return ['--info', '--text=' + text, '--title=' + title, '--button=OK:0', '--width=350'];
                } else { // question
                    return ['--question', '--text=' + text, '--title=' + title, '--button=Uninstall:1', '--button=OK:0', '--width=350'];
                }
            default:
                return []; // Ensure array even if unknown tool
        }
    })();

    return { cmd: tool, args };
}

module.exports = {
    getLinuxDialog,
    getLinuxModalCommand
};