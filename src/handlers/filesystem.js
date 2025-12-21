import fs, { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { logDebug, normalizeForFsWindows, CoAppError, checkBinaries } from '../utils/utils';
import { getLinuxDialog } from '../core/linux-dialog';
import { register } from '../core/processes';

const getPath = (p) => normalizeForFsWindows(p.path || p.filePath);

const FS_HANDLERS = {
    'exists': async (params) => ({ success: true, exists: fs.existsSync(getPath(params)) }),
    
    'mkdir': async (params) => {
        await fsp.mkdir(getPath(params), { recursive: true });
        return { success: true };
    },

    'readFile': async (params) => {
        const target = getPath(params);
        if (!fs.existsSync(target)) throw new CoAppError('File not found', 'fileNotFound');
        const data = await fsp.readFile(target, params.options?.encoding || 'utf8');
        return { success: true, data };
    },

    'writeFile': async (params) => {
        await fsp.writeFile(getPath(params), params.content, params.options?.encoding || 'utf8');
        return { success: true };
    },

    'unlink': async (params) => {
        const target = getPath(params);
        if (fs.existsSync(target)) await fsp.unlink(target);
        return { success: true };
    },

    'openFile': openFile,
    'showInFolder': showInFolder,
    'chooseDirectory': chooseDirectory,
    'chooseSaveLocation': chooseSaveLocation,
    'deleteFile': deleteFile
};

export async function handleFileSystem(request, responder) {
    const { operation, params = {} } = request;
    const handler = FS_HANDLERS[operation];
    if (!handler) throw new CoAppError(`Unknown filesystem operation: ${operation}`, 'ENOSYS');
		
    return handler(params, responder);
}

async function openFile(params) {
    const { filePath } = params;
    if (!filePath) throw new CoAppError('File path required', 'EINVAL');
    logDebug(`[FS] Request to open file: ${filePath}`);

    if (!fs.existsSync(normalizeForFsWindows(filePath))) {
        logDebug(`[FS] openFile failed: File not found at ${filePath}`);
        throw new CoAppError('File not found', 'fileNotFound');
    }

    const command = getOpenFileCommand(filePath);
    await executeSimple(command.cmd, command.args);
    
    return { success: true, operation: 'openFile', filePath };
}

async function showInFolder(params) {
    const { filePath, openFolderOnly = false } = params;
    if (!filePath) throw new CoAppError('File path required', 'EINVAL');
    logDebug(`[FS] Request to reveal: ${filePath} (openFolderOnly=${openFolderOnly})`);

    let command;
    if (openFolderOnly) {
        const folderPath = path.dirname(filePath);
        if (!fs.existsSync(normalizeForFsWindows(folderPath))) {
            logDebug(`[FS] showInFolder fallback failed: Folder not found at ${folderPath}`);
            throw new CoAppError('Folder not found', 'folderNotFound');
        }
        command = getOpenFolderCommand(folderPath);
    } else {
        if (!fs.existsSync(normalizeForFsWindows(filePath))) {
            logDebug(`[FS] showInFolder failed: File not found at ${filePath}`);
            throw new CoAppError('File not found', 'fileNotFound');
        }
        command = getShowInFolderCommand(filePath);
    }

    await executeSimple(command.cmd, command.args);
    return { success: true, operation: 'showInFolder', filePath };
}

async function chooseDirectory(params) {
    const { title = 'Choose Directory', defaultPath } = params;
    logDebug(`[FS] Request to choose directory: ${title}`);

    try {
        const command = await getChooseDirectoryCommand(title, defaultPath);
        const output = await executeSimple(command.cmd, command.args, true);
        const selectedPath = output.trim().replace(/^\uFEFF/, '');
        
        if (!selectedPath) {
            logDebug('[FS] No path selected by user');
            throw new CoAppError('No path selected', 'EIO');
        }

        logDebug(`[FS] User selected directory: ${selectedPath}`);
        await testWritePermissions(selectedPath);
        return { success: true, operation: 'chooseDirectory', selectedPath };
    } catch (err) {
        const key = err.key || err.code;
        if (key === 'USER_CANCELLED') {
            logDebug('[FS] User cancelled directory picker');
            return { success: true, operation: 'chooseDirectory', cancelled: true, key: 'USER_CANCELLED' };
        }
        if (key === 'ENOENT' || key === 'EIO') {
            logDebug(`[FS] Picker failed (${key}), attempting writable fallback`);
            const fallback = await findWritableFallbackFolder();
            if (!fallback) throw new CoAppError('No writable folder found', 'EACCES');
            
            logDebug(`[FS] Using fallback directory: ${fallback}`);
            return { 
                success: true, 
                operation: 'chooseDirectory', 
                selectedPath: fallback, 
                isAutoFallback: true, 
                key 
            };
        }
        throw err;
    }
}

async function chooseSaveLocation(params) {
    const { defaultName = 'untitled', title = 'Save As', defaultPath } = params;
    logDebug(`[FS] Request to choose save location: ${title} (default: ${defaultName})`);

    try {
        const command = await getChooseSaveLocationCommand(defaultName, title, defaultPath);
        const output = await executeSimple(command.cmd, command.args, true);
        const selectedPath = output.trim().replace(/^\uFEFF/, '');

        if (!selectedPath) {
            logDebug('[FS] No save path selected by user');
            throw new CoAppError('No path selected', 'ENOENT');
        }

        logDebug(`[FS] User selected save path: ${selectedPath}`);
        const directory = path.dirname(selectedPath);
        await testWritePermissions(directory);

        return {
            success: true,
            operation: 'chooseSaveLocation',
            path: selectedPath,
            directory,
            filename: path.basename(selectedPath),
            willOverwrite: fs.existsSync(normalizeForFsWindows(selectedPath))
        };
    } catch (err) {
        if (err.key === 'USER_CANCELLED') {
            logDebug('[FS] User cancelled save location picker');
            return { success: true, operation: 'chooseSaveLocation', cancelled: true, key: 'USER_CANCELLED' };
        }
        throw err;
    }
}

async function deleteFile(params) {
    const { filePath } = params;
    const normalized = normalizeForFsWindows(filePath);

    await fsp.unlink(normalized);
    return {
        success: true,
        operation: 'deleteFile',
        filePath,
        key: 'fileDeleted'
    };
}

// --- Platform Command Generators ---

function getOpenFileCommand(filePath) {
    if (os.platform() === 'darwin') return { cmd: 'open', args: [filePath] };
    if (os.platform() === 'win32') {
        try {
            const fileuiPath = checkBinaries('fileui');
            return { cmd: fileuiPath, args: ['--mode', 'open-file', '--path', filePath] };
        } catch {
            return { cmd: 'explorer', args: [filePath] };
        }
    }
    return { cmd: 'xdg-open', args: [filePath] };
}

function getOpenFolderCommand(folderPath) {
    if (os.platform() === 'darwin') return { cmd: 'open', args: [folderPath] };
    if (os.platform() === 'win32') {
        try {
            const fileuiPath = checkBinaries('fileui');
            return { cmd: fileuiPath, args: ['--mode', 'open-folder', '--path', folderPath] };
        } catch {
            return { cmd: 'explorer', args: [folderPath] };
        }
    }
    return { cmd: 'xdg-open', args: [folderPath] };
}

function getShowInFolderCommand(filePath) {
    if (os.platform() === 'darwin') return { cmd: 'open', args: ['-R', filePath] };
    if (os.platform() === 'win32') {
        try {
            const fileuiPath = checkBinaries('fileui');
            return { cmd: fileuiPath, args: ['--mode', 'reveal', '--path', filePath] };
        } catch {
            return { cmd: 'explorer', args: ['/select,', filePath] };
        }
    }
    return { cmd: 'xdg-open', args: [path.dirname(filePath)] };
}

async function getChooseDirectoryCommand(title, defaultPath) {
    if (os.platform() === 'darwin') {
        const esc = s => s.replace(/"/g, '\\"');
        let script = `set chosenFolder to choose folder with prompt "${esc(title)}"`;
        if (defaultPath && fs.existsSync(defaultPath)) script += ` default location POSIX file "${esc(defaultPath)}"`;
        script += '\nreturn POSIX path of chosenFolder';
        return { cmd: 'osascript', args: ['-e', script] };
    }
    if (os.platform() === 'win32') {
        const fileuiPath = checkBinaries('fileui');
        const args = ['--mode', 'pick-folder', '--title', title];
        if (defaultPath) args.push('--initial', defaultPath);
        return { cmd: fileuiPath, args };
    }
    return await getLinuxDialog('directory', title, defaultPath);
}

async function getChooseSaveLocationCommand(defaultName, title, defaultPath) {
    if (os.platform() === 'darwin') {
        const esc = s => s.replace(/"/g, '\\"');
        let script = `set chosenFile to choose file name with prompt "${esc(title)}" default name "${esc(defaultName)}"`;
        if (defaultPath && fs.existsSync(defaultPath)) script += ` default location POSIX file "${esc(defaultPath)}"`;
        script += '\nreturn POSIX path of chosenFile';
        return { cmd: 'osascript', args: ['-e', script] };
    }
    if (os.platform() === 'win32') {
        const fileuiPath = checkBinaries('fileui');
        const args = ['--mode', 'save-file', '--title', title, '--name', defaultName];
        if (defaultPath) args.push('--initial', defaultPath);
        else {
            const dl = path.join(os.homedir(), 'Downloads');
            if (fs.existsSync(dl)) args.push('--initial', dl);
        }
        return { cmd: fileuiPath, args };
    }
    return await getLinuxDialog('save', title, defaultPath, defaultName);
}

// --- Internal Helpers ---

async function executeSimple(cmd, args, capture = false) {
    return new Promise((resolve, reject) => {
        logDebug(`[FS] Executing: ${cmd} ${args.join(' ')}`);
        const child = spawn(cmd, args);
        register(child);

        let out = '';
        let err = '';
        if (capture) {
            child.stdout?.on('data', d => out += d.toString());
            child.stderr?.on('data', d => err += d.toString());
        }

        child.on('close', (code) => {
            if (code === 0) resolve(out);
            else if (code === 1 && capture) {
                reject(new CoAppError('Cancelled', 'USER_CANCELLED'));
            } else {
                reject(new CoAppError(err || `Exit ${code}`, 'EIO'));
            }
        });
        child.on('error', (e) => {
            reject(new CoAppError(e.message, e.code === 'ENOENT' ? 'ENOENT' : 'EIO'));
        });
    });
}

async function testWritePermissions(dir) {
    const testFile = path.join(dir, `maxvd_test_${Math.random().toString(36).slice(7)}.tmp`);
    const norm = normalizeForFsWindows(testFile);
    try {
        await fsp.writeFile(norm, 'test');
        await fsp.unlink(norm);
    } catch (e) {
        logDebug(`[FS] testWritePermissions failed for ${dir}: ${e.message}`);
        throw new CoAppError(`Write failed: ${e.code}`, e.code || 'EACCES');
    }
}

async function findWritableFallbackFolder() {
    const candidates = [
        path.join(os.homedir(), 'Downloads', 'MAX Video Downloader'),
        path.join(os.tmpdir(), 'MAX Video Downloader')
    ];
    for (const c of candidates) {
        try {
            await fsp.mkdir(c, { recursive: true });
            await testWritePermissions(c);
            return c;
        } catch { /* ignore */ }
    }
    return null;
}
