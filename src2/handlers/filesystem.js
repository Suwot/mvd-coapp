import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { logDebug, getBinaryPaths, normalizeForFsWindows, LOG_FILE } from '../utils/utils';
import { getLinuxDialog } from '../core/linux-dialog';
import { register } from '../core/processes';

export async function handleFileSystem(request, responder) {
    const { operation, params = {} } = request;

    try {
        switch (operation) {
            case 'exists':
                return { success: true, exists: fs.existsSync(params.path || params.filePath) };
            
            case 'mkdir':
                fs.mkdirSync(params.path || params.filePath, { recursive: true });
                return { success: true };

            case 'readFile':
                const data = fs.readFileSync(params.path || params.filePath, params.options?.encoding || 'utf8');
                return { success: true, data };

            case 'writeFile':
                fs.writeFileSync(params.path || params.filePath, params.content, params.options?.encoding || 'utf8');
                return { success: true };

            case 'unlink':
                const toUnlink = params.path || params.filePath;
                if (fs.existsSync(toUnlink)) fs.unlinkSync(toUnlink);
                return { success: true };

            // --- Enhanced Operations (Parity with FileSystemCommand) ---
            
            case 'openFile':
                return await openFile(params, responder);
            
            case 'showInFolder':
                return await showInFolder(params, responder);
            
            case 'chooseDirectory':
                return await chooseDirectory(params, responder);
            
            case 'chooseSaveLocation':
                return await chooseSaveLocation(params, responder);
            
            case 'deleteFile':
                return await deleteFile(params, responder);

            default:
                return { success: false, error: `Unknown filesystem operation: ${operation}` };
        }
    } catch (err) {
        logDebug(`[FS] Operation ${operation} failed:`, err.message);
        return { success: false, error: err.message, key: err.key };
    }
}

async function openFile(params, responder) {
    const { filePath } = params;
    if (!filePath) throw new Error('File path required');
    logDebug(`[FS] Request to open file: ${filePath}`);

    if (!fs.existsSync(normalizeForFsWindows(filePath))) {
        const err = new Error('File not found');
        err.key = 'fileNotFound';
        logDebug(`[FS] openFile failed: File not found at ${filePath}`);
        throw err;
    }

    const command = getOpenFileCommand(filePath);
    await executeSimple(command.cmd, command.args);
    
    const result = { success: true, operation: 'openFile', filePath };
    responder.send(result);
    return result;
}

async function showInFolder(params, responder) {
    const { filePath, openFolderOnly = false } = params;
    if (!filePath) throw new Error('File path required');
    logDebug(`[FS] Request to reveal: ${filePath} (openFolderOnly=${openFolderOnly})`);

    let command;
    if (openFolderOnly) {
        const folderPath = path.dirname(filePath);
        if (!fs.existsSync(normalizeForFsWindows(folderPath))) {
            const err = new Error('Folder not found');
            err.key = 'folderNotFound';
            logDebug(`[FS] showInFolder fallback failed: Folder not found at ${folderPath}`);
            throw err;
        }
        command = getOpenFolderCommand(folderPath);
    } else {
        if (!fs.existsSync(normalizeForFsWindows(filePath))) {
            const err = new Error('File not found');
            err.key = 'fileNotFound';
            logDebug(`[FS] showInFolder failed: File not found at ${filePath}`);
            throw err;
        }
        command = getShowInFolderCommand(filePath);
    }

    await executeSimple(command.cmd, command.args);
    const result = { success: true, operation: 'showInFolder', filePath };
    responder.send(result);
    return result;
}

async function chooseDirectory(params, responder) {
    const { title = 'Choose Directory', defaultPath } = params;
    logDebug(`[FS] Request to choose directory: ${title}`);

    try {
        const command = await getChooseDirectoryCommand(title, defaultPath);
        const output = await executeSimple(command.cmd, command.args, true);
        const selectedPath = output.trim().replace(/^\uFEFF/, '');
        
        if (!selectedPath) {
            logDebug('[FS] No path selected by user');
            const err = new Error('No path selected');
            err.key = 'pickerCommandFailed';
            throw err;
        }

        logDebug(`[FS] User selected directory: ${selectedPath}`);
        await testWritePermissions(selectedPath);
        const result = { success: true, operation: 'chooseDirectory', selectedPath };
        responder.send(result);
        return result;
    } catch (err) {
        if (err.key === 'fileDialogHelperNotFound' || err.key === 'pickerCommandFailed') {
            logDebug(`[FS] Picker failed (${err.key}), attempting writable fallback`);
            const fallback = await findWritableFallbackFolder();
            if (!fallback) throw new Error('No writable folder found');
            
            logDebug(`[FS] Using fallback directory: ${fallback}`);
            const result = { success: true, operation: 'chooseDirectory', selectedPath: fallback, isAutoFallback: true, key: err.key };
            responder.send(result);
            return result;
        }
        throw err;
    }
}

async function chooseSaveLocation(params, responder) {
    const { defaultName = 'untitled', title = 'Save As', defaultPath } = params;
    logDebug(`[FS] Request to choose save location: ${title} (default: ${defaultName})`);

    const command = await getChooseSaveLocationCommand(defaultName, title, defaultPath);
    const output = await executeSimple(command.cmd, command.args, true);
    const selectedPath = output.trim().replace(/^\uFEFF/, '');

    if (!selectedPath) {
        logDebug('[FS] No save path selected by user');
        const err = new Error('No path selected');
        err.key = 'pickerCommandFailed';
        throw err;
    }

    logDebug(`[FS] User selected save path: ${selectedPath}`);
    const directory = path.dirname(selectedPath);
    await testWritePermissions(directory);

    const result = {
        success: true,
        operation: 'chooseSaveLocation',
        path: selectedPath,
        directory,
        filename: path.basename(selectedPath),
        willOverwrite: fs.existsSync(normalizeForFsWindows(selectedPath))
    };
    responder.send(result);
    return result;
}

async function deleteFile(params, responder) {
    const { filePath } = params;
    const normalized = normalizeForFsWindows(filePath);
    if (!fs.existsSync(normalized)) {
        const err = new Error('File not found');
        err.key = 'fileNotFound';
        throw err;
    }

    fs.unlinkSync(normalized);
    const isLogs = filePath === LOG_FILE;
    const result = {
        success: true,
        operation: 'deleteFile',
        filePath,
        key: 'fileDeleted',
        ...(isLogs && { logFileSize: fs.existsSync(normalized) ? fs.statSync(normalized).size : 0 })
    };
    responder.send(result);
    return result;
}

// --- Platform Command Generators ---

function getOpenFileCommand(filePath) {
    if (os.platform() === 'darwin') return { cmd: 'open', args: [filePath] };
    if (os.platform() === 'win32') {
        const { fileuiPath } = getBinaryPaths();
        if (fileuiPath && fs.existsSync(fileuiPath)) return { cmd: fileuiPath, args: ['--mode', 'open-file', '--path', filePath] };
        return { cmd: 'explorer', args: [filePath] };
    }
    return { cmd: 'xdg-open', args: [filePath] };
}

function getOpenFolderCommand(folderPath) {
    if (os.platform() === 'darwin') return { cmd: 'open', args: [folderPath] };
    if (os.platform() === 'win32') {
        const { fileuiPath } = getBinaryPaths();
        if (fileuiPath && fs.existsSync(fileuiPath)) return { cmd: fileuiPath, args: ['--mode', 'open-folder', '--path', folderPath] };
        return { cmd: 'explorer', args: [folderPath] };
    }
    return { cmd: 'xdg-open', args: [folderPath] };
}

function getShowInFolderCommand(filePath) {
    if (os.platform() === 'darwin') return { cmd: 'open', args: ['-R', filePath] };
    if (os.platform() === 'win32') {
        const { fileuiPath } = getBinaryPaths();
        if (fileuiPath && fs.existsSync(fileuiPath)) return { cmd: fileuiPath, args: ['--mode', 'reveal', '--path', filePath] };
        return { cmd: 'explorer', args: ['/select,', filePath] };
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
        const { fileuiPath } = getBinaryPaths();
        if (!fileuiPath || !fs.existsSync(fileuiPath)) {
            const err = new Error('Helper not found');
            err.key = 'fileDialogHelperNotFound';
            throw err;
        }
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
        const { fileuiPath } = getBinaryPaths();
        if (!fileuiPath || !fs.existsSync(fileuiPath)) {
            const err = new Error('Helper not found');
            err.key = 'fileDialogHelperNotFound';
            throw err;
        }
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
        if (capture) child.stdout.on('data', d => out += d);
        child.stderr.on('data', d => err += d);

        child.on('close', (code) => {
            if (code === 0) resolve(out);
            else if (code === 1 && capture) {
                const cancel = new Error('Cancelled');
                cancel.key = 'cancelled';
                reject(cancel);
            } else {
                const fail = new Error(err || `Exit ${code}`);
                fail.key = 'pickerCommandFailed';
                reject(fail);
            }
        });
        child.on('error', (e) => {
            const fail = new Error(e.message);
            fail.key = 'pickerCommandFailed';
            reject(fail);
        });
    });
}

async function testWritePermissions(dir) {
    const testFile = path.join(dir, `maxvd_test_${Math.random().toString(36).slice(7)}.tmp`);
    const norm = normalizeForFsWindows(testFile);
    try {
        fs.writeFileSync(norm, 'test');
        fs.unlinkSync(norm);
    } catch (e) {
        const err = new Error(`Write failed: ${e.code}`);
        err.key = (e.code === 'EACCES' || e.code === 'EPERM') ? 'directoryNotWritable' : 'directoryWriteError';
        throw err;
    }
}

async function findWritableFallbackFolder() {
    const candidates = [
        path.join(os.homedir(), 'Downloads', 'MAX Video Downloader'),
        path.join(os.tmpdir(), 'MAX Video Downloader')
    ];
    for (const c of candidates) {
        try {
            fs.mkdirSync(c, { recursive: true });
            await testWritePermissions(c);
            return c;
        } catch { /* ignore */ }
    }
    return null;
}
