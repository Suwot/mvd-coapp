/**
 * FileSystemCommand – Unified file system operations command
 * - Handles all file system operations through OS native dialogs and commands
 * - Provides cross-platform file opening, folder navigation, and path selection
 * - Manages platform-specific command execution (macOS/Windows)
 * - Unified error handling and response formatting for all operations
 * - Routes operation types: openFile, showInFolder, chooseDirectory, chooseSaveLocation
 */

const BaseCommand = require('./base-command');
const { logDebug, LOG_FILE, getBinaryPaths, normalizeForFsWindows } = require('../utils/utils');
const { getLinuxDialog } = require('../lib/linux-dialog');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const processManager = require('../lib/process-manager');

/**
 * Command for handling all file system operations
 */
class FileSystemCommand extends BaseCommand {
    /**
     * Execute the file system command based on operation type
     * @param {Object} params Command parameters
     * @param {string} params.operation - Operation type: openFile, showInFolder, chooseDirectory, chooseSaveLocation
     * @param {Object} params.params - Operation-specific parameters
     */
    async execute(params) {
        const { operation, params: operationParams } = params;

        logDebug(`FileSystem operation: ${operation}`, operationParams);

        try {
            switch (operation) {
                case 'openFile':
                    return await this.openFile(operationParams);
                case 'showInFolder':
                    return await this.showInFolder(operationParams);
                case 'chooseDirectory':
                    return await this.chooseDirectory(operationParams);
                case 'chooseSaveLocation':
                    return await this.chooseSaveLocation(operationParams);
                case 'deleteFile':
                    return await this.deleteFile(operationParams);

                default:
                    throw new Error(`Unknown file system operation: ${operation}`);
            }
        } catch (error) {
            logDebug(`FileSystem operation failed: ${operation}`, error.message || String(error));
            const errorResponse = { error: error.message, key: error.key || null };
            this.sendMessage(errorResponse);
            return errorResponse;
        }
    }

    /**
     * Open file with default system application
     * @param {Object} params - { filePath: string }
     */
    async openFile(params) {
        const { filePath } = params;

        if (!filePath) {
            throw new Error('File path is required');
        }

        // Check if file exists (handles Windows long paths > 260 chars)
        if (!this.fileExists(filePath)) {
            const error = new Error(`File doesn't exist: ${filePath}`);
            error.key = 'fileNotFound';
            throw error;
        }

        const command = this.getOpenFileCommand(filePath);
        
        try {
            await this.executeCommand(command.cmd, command.args);
            logDebug(`Successfully executed open command for: ${filePath}`);
        } catch (error) {
            logDebug(`Failed to open file ${filePath}: ${error.message}`);
            throw error;
        }

        const result = { success: true, operation: 'openFile', filePath };
        this.sendMessage(result);
        return result;
    }

    /**
     * Show file in folder with file manager focus
     * @param {Object} params - { filePath: string, openFolderOnly?: boolean }
     */
    async showInFolder(params) {
        const { filePath, openFolderOnly = false } = params;

        if (!filePath) {
            throw new Error('File path is required');
        }

        if (openFolderOnly) {
            // Open folder without pointing to file (file is known to be deleted)
            const folderPath = path.dirname(filePath);
            if (!this.fileExists(folderPath)) {
                const error = new Error(`Folder doesn't exist: ${folderPath}`);
                error.key = 'folderNotFound';
                throw error;
            }
            const command = this.getOpenFolderCommand(folderPath);
            await this.executeCommand(command.cmd, command.args);
        } else {
            // Normal operation - check if file exists and show in folder (handles Windows long paths)
            if (!this.fileExists(filePath)) {
                const error = new Error(`File doesn't exist: ${filePath}`);
                error.key = 'fileNotFound';
                throw error;
            }
            const command = this.getShowInFolderCommand(filePath);
            await this.executeCommand(command.cmd, command.args);
        }

        const result = { success: true, operation: 'showInFolder', filePath };
        this.sendMessage(result);
        return result;
    }

    /**
     * Show directory chooser dialog
     * @param {Object} params - { title?: string, defaultPath?: string }
     */
    async chooseDirectory(params) {
        const { title = 'Choose Directory', defaultPath } = params;

        const command = await this.getChooseDirectoryCommand(title, defaultPath);
        const output = await this.executeCommand(command.cmd, command.args, true);

        // Parse output to get selected path
        const selectedPath = this.parseDialogOutput(output, 'directory');

        if (!selectedPath) {
            const error = new Error('No directory selected');
            error.key = 'noDirectorySelected';
            throw error;
        }

        // Check write permissions with actual file creation test
        await this.testWritePermissions(selectedPath);

        const result = { success: true, operation: 'chooseDirectory', selectedPath };
        this.sendMessage(result);
        return result;
    }

    /**
     * Show save file dialog
     * @param {Object} params - { defaultName?: string, title?: string, defaultPath?: string }
     */
    async chooseSaveLocation(params) {
        const { defaultName = 'untitled', title = 'Save As', defaultPath } = params;

        const command = await this.getChooseSaveLocationCommand(defaultName, title, defaultPath);
        const output = await this.executeCommand(command.cmd, command.args, true);

        // Parse output to get selected path
        const selectedPath = this.parseDialogOutput(output, 'file');

        if (!selectedPath) {
            const error = new Error('No save location selected');
            error.key = 'noSaveLocationSelected';
            throw error;
        }

        // Check if user chose to overwrite an existing file (handles Windows long paths > 260 chars)
        const willOverwrite = this.fileExists(selectedPath);

        // Always return path, directory, and filename for clarity
        const directory = path.dirname(selectedPath);
        const filename = path.basename(selectedPath);

        // Check write permissions on the directory with actual file creation test
        await this.testWritePermissions(directory);

        const result = {
            success: true,
            operation: 'chooseSaveLocation',
            path: selectedPath,
            directory,
            filename,
            defaultName,
            willOverwrite // Flag indicating if user chose to overwrite existing file
        };
        this.sendMessage(result);
        return result;
    }

    /**
     * Get platform-specific command for opening file
     * On Windows, uses C++ helper with ShellExecuteEx to avoid cmd.exe /c start (AV tripwire)
     * Falls back to explorer (no /c) if helper is unavailable
     */
    getOpenFileCommand(filePath) {
        if (process.platform === 'darwin') {
            return { cmd: 'open', args: [filePath] };
        } else if (process.platform === 'win32') {
            // Use C++ helper with ShellExecuteEx (avoids cmd.exe /c start AV tripwire, handles long paths)
            const { fileuiPath } = getBinaryPaths();
            if (fileuiPath && fs.existsSync(fileuiPath)) {
                logDebug('Using C++ helper for open file (avoids cmd.exe /c start)');
                return { cmd: fileuiPath, args: ['--mode', 'open-file', '--path', filePath] };
            }
            // Fallback to explorer (no /c start to reduce AV noise)
            logDebug('⚠️ C++ helper not found, falling back to explorer');
            return { cmd: 'explorer', args: [filePath] };
        } else if (process.platform === 'linux') {
            return { cmd: 'xdg-open', args: [filePath] };
        } else {
            throw new Error('Unsupported platform');
        }
    }

    /**
     * Get platform-specific command for showing file in folder
     * On Windows, always uses C++ helper with Shell APIs (SHOpenFolderAndSelectItems)
     * This provides single robust codepath that avoids Explorer's command-line parsing quirks
     * and handles paths > 260 chars natively
     */
    getShowInFolderCommand(filePath) {
        if (process.platform === 'darwin') {
            return { cmd: 'open', args: ['-R', filePath] };
        } else if (process.platform === 'win32') {
            // Use C++ helper with ShellExecuteEx (avoids cmd.exe /c start AV tripwire, handles long paths)
            const { fileuiPath } = getBinaryPaths();
            if (fileuiPath && fs.existsSync(fileuiPath)) {
                logDebug('Using C++ helper to show file in folder');
                return { cmd: fileuiPath, args: ['--mode', 'reveal', '--path', filePath] };
            }
            logDebug('⚠️ C++ helper not found, falling back to explorer /select');
            return { cmd: 'explorer', args: ['/select,', filePath] };
        } else if (process.platform === 'linux') {
            // Open the directory containing the file
            const dirPath = path.dirname(filePath);
            return { cmd: 'xdg-open', args: [dirPath] };
        } else {
            throw new Error('Unsupported platform');
        }
    }

    /**
     * Get platform-specific command for directory chooser dialog
     */
    async getChooseDirectoryCommand(title, defaultPath) {
        if (process.platform === 'darwin') {
            const escAS = s => String(s).replace(/"/g, '\\"');
            let script = `set chosenFolder to choose folder with prompt "${escAS(title)}"`;
            if (defaultPath && this.isDirectory(defaultPath)) {
                script += ` default location POSIX file "${escAS(defaultPath)}"`;
            }
            script += `\nreturn POSIX path of chosenFolder`;
            return { cmd: 'osascript', args: ['-e', script] };
        } else if (process.platform === 'win32') {
            // Use C++ helper for better performance and Unicode support
            const { fileuiPath } = getBinaryPaths();
            if (!fileuiPath || !fs.existsSync(fileuiPath)) {
                const error = new Error('C++ file dialog helper not found. Please reinstall the application.');
                error.key = 'fileDialogHelperNotFound';
                throw error;
            }
            logDebug('Using C++ folder picker helper');
            const args = ['--mode', 'pick-folder', '--title', title || 'Choose Folder'];
            if (defaultPath && this.isDirectory(defaultPath)) {
                args.push('--initial', defaultPath);
            }
            return { cmd: fileuiPath, args };
        } else if (process.platform === 'linux') {
            return await getLinuxDialog('directory', title, defaultPath);
        } else {
            throw new Error('Unsupported platform');
        }
    }

    /**
     * Get platform-specific command for save file dialog
     */
    async getChooseSaveLocationCommand(defaultName, title, defaultPath) {
        if (process.platform === 'darwin') {
            const escAS = s => String(s).replace(/"/g, '\\"');
            let script = `set chosenFile to choose file name with prompt "${escAS(title)}" default name "${escAS(defaultName)}"`;
            if (defaultPath && this.fileExists(defaultPath)) {
                script += ` default location POSIX file "${escAS(defaultPath)}"`;
            }
            script += `
return POSIX path of chosenFile`;
            return { cmd: 'osascript', args: ['-e', script] };
        } else if (process.platform === 'win32') {
            // Use C++ helper for better performance and Unicode support
            const { fileuiPath } = getBinaryPaths();
            if (!fileuiPath || !fs.existsSync(fileuiPath)) {
                const error = new Error('C++ file dialog helper not found. Please reinstall the application.');
                error.key = 'fileDialogHelperNotFound';
                throw error;
            }
            logDebug('Using C++ save file dialog helper');
            const args = ['--mode', 'save-file', '--title', title || 'Save As', '--name', defaultName];
            if (defaultPath && this.isDirectory(defaultPath)) {
                args.push('--initial', defaultPath);
            } else {
                // Use Downloads folder as default if no path specified
                const downloadsPath = path.join(require('os').homedir(), 'Downloads');
                if (this.isDirectory(downloadsPath)) {
                    args.push('--initial', downloadsPath);
                }
            }
            return { cmd: fileuiPath, args };
        } else if (process.platform === 'linux') {
            return await getLinuxDialog('save', title, defaultPath, defaultName);
        } else {
            throw new Error('Unsupported platform');
        }
    }

    /**
     * Execute system command
     * @param {string} cmd - Command to execute
     * @param {Array} args - Command arguments
     * @param {boolean} captureOutput - Whether to capture and return output
     */
    async executeCommand(cmd, args, captureOutput = false) {
        return new Promise((resolve, reject) => {
            logDebug(`Executing command: ${cmd} ${args.join(' ')}`);

            const childProcess = spawn(cmd, args, {
                windowsVerbatimArguments: false  // Let Node handle quote escaping on Windows
            });
            processManager.register(childProcess);

            let output = '';
            let errorOutput = '';

            if (captureOutput) {
                childProcess.stdout.on('data', (data) => {
                    output += data.toString();
                });
            }

            childProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            childProcess.on('close', (code) => {
                if (captureOutput) {
                    // Operations that capture output (dialogs) need valid exit codes
                    if (code === 0) {
                        resolve(output.trim());
                    } else {
                        // Map exit codes to meaningful error messages for dialogs
                        let errorMsg = errorOutput || '';
                        if (code === 1) {
                            if (errorMsg.trim() === '') {
                                errorMsg = 'Dialog cancelled or failed';
                            }
                        } else {
                            errorMsg = `Command failed with code ${code}: ${errorMsg}`;
                        }
                        reject(new Error(errorMsg));
                    }
                } else {
                    // For file operations, check exit code to ensure success
                    if (code === 0) {
                        resolve(code);
                    } else {
                        // Special fallback for xdg-open on Linux - try gio open
                        if (process.platform === 'linux' && cmd === 'xdg-open' && args.length > 0) {
                            logDebug(`xdg-open failed with code ${code}, trying gio open as fallback`);
                            try {
                                // Try gio open as fallback
                                this.executeCommand('gio', ['open', args[0]]).then(() => {
                                    resolve(0); // Success with fallback
                                }).catch((gioError) => {
                                    reject(new Error(`Both xdg-open and gio failed: xdg-open (${code}: ${errorOutput}), gio (${gioError.message})`));
                                });
                                return; // Don't reject yet, wait for fallback
                            } catch (fallbackError) {
                                // Fallback failed immediately
                                reject(new Error(`Command failed with exit code ${code}: ${errorOutput || 'Unknown error'}. Fallback also failed: ${fallbackError.message}`));
                                return;
                            }
                        }
                        reject(new Error(`Command failed with exit code ${code}: ${errorOutput || 'Unknown error'}`));
                    }
                }
            });

            childProcess.on('error', (error) => {
                reject(new Error(`Failed to execute command: ${error.message}`));
            });
        });
    }

    /**
     * Delete file from filesystem
     * @param {Object} params - { filePath: string }
     */
    async deleteFile(params) {
        const { filePath } = params;

        if (!filePath) {
            throw new Error('File path is required');
        }

        // Check if file exists (handles Windows long paths > 260 chars)
        if (!this.fileExists(filePath)) {
            const error = new Error(`File doesn't exist: ${filePath}`);
            error.key = 'fileNotFound';
            throw error;
        }

        try {
            // Delete the file (use normalized path for long paths on Windows)
            const normalized = normalizeForFsWindows(filePath);
            fs.unlinkSync(normalized);
            
            // Check if this was the logs file and return updated size
            const isLogsFile = filePath === LOG_FILE;
            const newSize = isLogsFile ? (this.fileExists(LOG_FILE) ? fs.statSync(normalizeForFsWindows(LOG_FILE)).size : 0) : undefined;
            
            const result = { 
                success: true, 
                operation: 'deleteFile', 
                filePath,
                key: 'fileDeleted',
                ...(isLogsFile && { logFileSize: newSize })
            };
            this.sendMessage(result);
            return result;
        } catch (error) {
            throw new Error(`Failed to delete file: ${error.message}`);
        }
    }

    /**
     * Get platform-specific command for opening folder
     * On Windows, always uses C++ helper with Shell APIs (single robust codepath)
     * Avoids Explorer's Unicode/NTFS quirks and handles any path length
     */
    getOpenFolderCommand(folderPath) {
        if (process.platform === 'darwin') {
            return { cmd: 'open', args: [folderPath] };
        } else if (process.platform === 'win32') {
            // Always use C++ helper on Windows (single robust codepath via Shell APIs) to handle any path length
            const { fileuiPath } = getBinaryPaths();
            if (fileuiPath && fs.existsSync(fileuiPath)) {
                logDebug('Using C++ helper for open folder (single robust codepath)');
                return { cmd: fileuiPath, args: ['--mode', 'open-folder', '--path', folderPath] };
            }
            logDebug('⚠️ C++ helper not found, falling back to explorer');
            return { cmd: 'explorer', args: [folderPath] };
        } else if (process.platform === 'linux') {
            return { cmd: 'xdg-open', args: [folderPath] };
        } else {
            throw new Error('Unsupported platform');
        }
    }

    /**
     * Parse dialog output to extract selected path
     */
    parseDialogOutput(output, type) {
        if (!output) return null;
        
        // Strip UTF-8 BOM if present and trim whitespace
        const clean = output.replace(/^\uFEFF/, '').trim();
        return clean || null;
    }
	
	// Get file stats with Windows long-path normalization
    _normalizedStat(path) {
        const normalized = normalizeForFsWindows(path);
        return fs.statSync(normalized);
    }

	// Check if file exists with Windows long-path normalization
	fileExists(path) { try { this._normalizedStat(path); return true; } catch { return false; } }
	isDirectory(path) { try { return this._normalizedStat(path).isDirectory(); } catch { return false; } }

    /**
     * Test write permissions by actually trying to create and delete a test file
     * Uses atomic creation (O_CREAT|O_EXCL) to avoid clobbering existing files
     * Uses the same fs normalization as fileExists() for long paths
     * @param {string} directoryPath - Directory to test
     */
    async testWritePermissions(directoryPath) {
        // Generate unique test filename to avoid clobbering existing files
        const randomSuffix = Math.random().toString(36).substring(7);
        const testFile = path.join(directoryPath, `maxvd_test_${randomSuffix}.tmp`);
        // Normalize the test file path using the same Windows long-path logic
        const normalizedTestFile = normalizeForFsWindows(testFile);
        
        try {
            // Atomically create test file (fails if exists, won't overwrite)
            const fd = await fs.promises.open(normalizedTestFile, 'wx');
            await fd.write('test');
            await fd.close();
            // Try to delete it
            await fs.promises.unlink(normalizedTestFile);
        } catch (error) {
            // Provide detailed error info for debugging encoding vs permission issues
            const errorDetails = [directoryPath];
            if (error.code) errorDetails.push(error.code);
            if (error.syscall) errorDetails.push(error.syscall);
            if (error.path) errorDetails.push(error.path);
            
            const userError = new Error(`Cannot write to selected directory: ${errorDetails.join(' ')}`);
            userError.key = (error.code === 'EACCES' || error.code === 'EPERM') 
                ? 'directoryNotWritable' 
                : (error.code === 'ENOENT' ? 'folderNotFound' : 'directoryWriteError');
            throw userError;
        }
    }
}

module.exports = FileSystemCommand;
