import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logDebug } from '../utils/utils';
import { pathToFileURL, fileURLToPath } from 'url';

let sessionBus = null;

function getSessionBus() {
    if (!sessionBus) {
        const dbus = require('dbus-next');
        sessionBus = dbus.sessionBus();
    }
    return sessionBus;
}

let portalAvailable = null;

function isPortalAvailable() {
    if (portalAvailable !== null) return portalAvailable;
    try {
        if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
            portalAvailable = false;
            return false;
        }
        require('dbus-next');
        getSessionBus();
        portalAvailable = true;
    } catch (error) {
        logDebug('Portal not available:', error.message);
        portalAvailable = false;
    }
    return portalAvailable;
}

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
        } else if (options.defaultName) {
            options_dbus.current_name = new Variant('s', options.defaultName);
        }

        if (options.defaultPath && fs.existsSync(options.defaultPath)) {
            options_dbus.current_folder = new Variant('s', pathToFileURL(options.defaultPath).href);
        }

        const method = type === 'directory' ? 'OpenFile' : 'SaveFile';
        const requestPath = await fileChooser[method]('', options.title || (type === 'directory' ? 'Choose Directory' : 'Save As'), options_dbus);

        const request = await bus.getProxyObject('org.freedesktop.portal.Desktop', requestPath);
        const reqInterface = request.getInterface('org.freedesktop.portal.Request');

        const response = await new Promise((resolve) => {
            const handler = (responseCode, results) => {
                clearTimeout(timeout);
                resolve({ responseCode, results });
            };
            reqInterface.once('Response', handler);
            const timeout = setTimeout(() => {
                reqInterface.removeListener('Response', handler);
                resolve({ responseCode: -1, results: {} });
            }, 600000);
        });

        if (response.responseCode === 0 && response.results.uris?.value?.length > 0) {
            const uri = response.results.uris.value[0];
            if (typeof uri === 'string' && uri.startsWith('file://')) {
                return { path: fileURLToPath(uri) };
            }
        }
        return { cancelled: true };
    } catch (error) {
        logDebug('Portal dialog failed:', error.message);
        return { failed: true };
    }
}

let cachedTool = null;

function pickDirectTool() {
    if (cachedTool !== null) return cachedTool;
    if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
        for (const cmd of ['zenity', 'kdialog', 'yad']) {
            try {
                if (spawnSync('which', [cmd], { stdio: 'ignore' }).status === 0) {
                    cachedTool = cmd;
                    return cmd;
                }
            } catch { /* ignore */ }
        }
    }
    cachedTool = null;
    return null;
}

function resolveDownloads() {
    try {
        const { status, stdout } = spawnSync('xdg-user-dir', ['DOWNLOAD'], { encoding: 'utf8' });
        if (status === 0 && stdout.trim() && fs.existsSync(stdout.trim())) return stdout.trim();
    } catch { /* ignore */ }
    const homeDownloads = path.join(os.homedir(), 'Downloads');
    if (fs.existsSync(homeDownloads)) return homeDownloads;
    if (process.env.SNAP_USER_COMMON) {
        const snapDownloads = path.join(process.env.SNAP_USER_COMMON, 'Downloads');
        try {
            if (!fs.existsSync(snapDownloads)) fs.mkdirSync(snapDownloads, { recursive: true });
            return snapDownloads;
        } catch { /* ignore */ }
    }
    return homeDownloads;
}

function runDirectTool(tool, type, options) {
    const args = [];
    switch (tool) {
        case 'zenity':
            args.push('--file-selection');
            if (type === 'directory') args.push('--directory');
            else args.push('--save', '--confirm-overwrite');
            args.push('--title', options.title || (type === 'directory' ? 'Choose Directory' : 'Save As'));
            break;
        case 'kdialog':
            if (type === 'directory') args.push('--getexistingdirectory');
            else args.push('--getsavefilename', '--title', options.title || 'Save As');
            break;
        case 'yad':
            args.push('--file');
            if (type === 'directory') args.push('--directory');
            else args.push('--save', '--confirm-overwrite');
            args.push('--title', options.title || (type === 'directory' ? 'Choose Directory' : 'Save As'));
            break;
    }

    const seedPath = (options.defaultPath && fs.existsSync(options.defaultPath)) ? options.defaultPath : resolveDownloads();
    if (type === 'directory') {
        if (tool === 'kdialog') args.push(seedPath);
        else args.push('--filename', seedPath.endsWith('/') ? seedPath : seedPath + '/');
    } else {
        const filePath = options.defaultName ? path.join(seedPath, options.defaultName) : seedPath;
        if (tool === 'kdialog') args.push(filePath);
        else args.push('--filename', filePath);
    }
    return { cmd: tool, args };
}

export async function getLinuxDialog(type, title, defaultPath, defaultName) {
    const options = { title, defaultPath, defaultName };
    const portalResult = await tryPortalDialog(type, options);
    if (portalResult.path) return { cmd: 'echo', args: [portalResult.path] };
    if (portalResult.cancelled) throw new Error('Dialog cancelled');

    const tool = pickDirectTool();
    if (tool) return runDirectTool(tool, type, options);

    const fallbackPath = resolveDownloads();
    return { cmd: 'echo', args: [fallbackPath] };
}

export function getLinuxModalCommand(type, text, title) {
    const tool = pickDirectTool();
    if (!tool) return null;

    const args = (() => {
        switch (tool) {
            case 'zenity':
                return type === 'info' 
                    ? ['--info', '--text=' + text, '--title=' + title, '--width=350']
                    : ['--question', '--text=' + text, '--title=' + title, '--ok-label=OK', '--cancel-label=Uninstall', '--width=350'];
            case 'kdialog':
                return type === 'info'
                    ? ['--msgbox', text, '--title', title]
                    : ['--yesno', text, '--title', title, '--yes-label', 'OK', '--no-label', 'Uninstall'];
            case 'yad':
                return type === 'info'
                    ? ['--info', '--text=' + text, '--title=' + title, '--button=OK:0', '--width=350']
                    : ['--question', '--text=' + text, '--title=' + title, '--button=Uninstall:1', '--button=OK:0', '--width=350'];
            default:
                return [];
        }
    })();
    return { cmd: tool, args };
}
