/**
 * FileSystemCommand – Unified file system operations command
 * - Handles all file system operations through OS native dialogs and commands
 * - Provides cross-platform file opening, folder navigation, and path selection
 * - Manages platform-specific command execution (macOS/Windows)
 * - Unified error handling and response formatting for all operations
 * - Routes operation types: openFile, showInFolder, chooseDirectory, chooseSaveLocation
 */

const BaseCommand = require('./base-command');
const { logDebug } = require('../utils/logger');
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
            logDebug(`FileSystem operation failed: ${operation}`, error);
            this.sendMessage({ error: error.message });
            return { error: error.message };
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

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found');
        }

        const command = this.getOpenFileCommand(filePath);
        await this.executeCommand(command.cmd, command.args);

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
            if (!fs.existsSync(folderPath)) {
                throw new Error('Folder not found');
            }
            const command = this.getOpenFolderCommand(folderPath);
            await this.executeCommand(command.cmd, command.args);
        } else {
            // Normal operation - check if file exists and show in folder
            if (!fs.existsSync(filePath)) {
                throw new Error('File not found');
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
     * @param {Object} params - { title?: string }
     */
    async chooseDirectory(params) {
        const { title = 'Choose Directory' } = params;

        const command = this.getChooseDirectoryCommand(title);
        const output = await this.executeCommand(command.cmd, command.args, true);

        // Parse output to get selected path
        const selectedPath = this.parseDialogOutput(output, 'directory');

        if (!selectedPath) {
            throw new Error('No directory selected');
        }

        const result = { success: true, operation: 'chooseDirectory', selectedPath };
        this.sendMessage(result);
        return result;
    }

    /**
     * Show save file dialog
     * @param {Object} params - { defaultName?: string, title?: string }
     */
    async chooseSaveLocation(params) {
        const { defaultName = 'untitled', title = 'Save As' } = params;

        const command = this.getChooseSaveLocationCommand(defaultName, title);
        const output = await this.executeCommand(command.cmd, command.args, true);

        // Parse output to get selected path
        const selectedPath = this.parseDialogOutput(output, 'file');

        if (!selectedPath) {
            throw new Error('No save location selected');
        }

        // Check if user chose to overwrite an existing file
        const willOverwrite = fs.existsSync(selectedPath);

        // Always return path, directory, and filename for clarity
        const directory = path.dirname(selectedPath);
        const filename = path.basename(selectedPath);
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
     */
    getOpenFileCommand(filePath) {
        if (process.platform === 'darwin') {
            return { cmd: 'open', args: [filePath] };
        } else if (process.platform === 'win32') {
            return { cmd: 'start', args: ['""', `"${filePath}"`] };
        } else {
            throw new Error('Unsupported platform');
        }
    }

    /**
     * Get platform-specific command for showing file in folder
     */
    getShowInFolderCommand(filePath) {
        if (process.platform === 'darwin') {
            return { cmd: 'open', args: ['-R', filePath] };
        } else if (process.platform === 'win32') {
            return { cmd: 'explorer', args: ['/select,', `"${filePath}"`] };
        } else {
            throw new Error('Unsupported platform');
        }
    }

    /**
     * Get platform-specific command for directory chooser dialog
     */
    getChooseDirectoryCommand(title) {
        if (process.platform === 'darwin') {
            const script = `set chosenFolder to choose folder with prompt "${title}"
return POSIX path of chosenFolder`;
            return { cmd: 'osascript', args: ['-e', script] };
        } else if (process.platform === 'win32') {
            const script = `Add-Type -AssemblyName System.Windows.Forms; 
                $browser = New-Object System.Windows.Forms.FolderBrowserDialog; 
                $browser.Description = '${title}'; 
                $browser.RootFolder = 'MyComputer'; 
                if($browser.ShowDialog() -eq 'OK') { $browser.SelectedPath }`;
            return { cmd: 'powershell', args: ['-Command', script] };
        } else {
            throw new Error('Unsupported platform');
        }
    }

    /**
     * Get platform-specific command for save file dialog
     */
    getChooseSaveLocationCommand(defaultName, title) {
        if (process.platform === 'darwin') {
            const script = `set chosenFile to choose file name with prompt "${title}" default name "${defaultName}"
return POSIX path of chosenFile`;
            return { cmd: 'osascript', args: ['-e', script] };
        } else if (process.platform === 'win32') {
            const script = `Add-Type -AssemblyName System.Windows.Forms; 
                $saveDialog = New-Object System.Windows.Forms.SaveFileDialog; 
                $saveDialog.Title = '${title}'; 
                $saveDialog.FileName = '${defaultName}'; 
                if($saveDialog.ShowDialog() -eq 'OK') { $saveDialog.FileName }`;
            return { cmd: 'powershell', args: ['-Command', script] };
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
                windowsVerbatimArguments: process.platform === 'win32'
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
                if (code === 0) {
                    resolve(captureOutput ? output.trim() : null);
                } else {
                    reject(new Error(`Command failed with code ${code}: ${errorOutput}`));
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

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found');
        }

        try {
            // Delete the file
            fs.unlinkSync(filePath);
            
            const result = { success: true, operation: 'deleteFile', filePath };
            this.sendMessage(result);
            return result;
        } catch (error) {
            throw new Error(`Failed to delete file: ${error.message}`);
        }
    }

    /**
     * Get platform-specific command for opening folder
     */
    getOpenFolderCommand(folderPath) {
        if (process.platform === 'darwin') {
            return { cmd: 'open', args: [folderPath] };
        } else if (process.platform === 'win32') {
            return { cmd: 'explorer', args: [`"${folderPath}"`] };
        } else {
            throw new Error('Unsupported platform');
        }
    }

    /**
     * Parse dialog output to extract selected path
     */
    parseDialogOutput(output, type) {
        if (!output || output.trim() === '') {
            return null;
        }

        const trimmedOutput = output.trim();

        // Handle cases where dialog was cancelled (empty output)
        if (trimmedOutput === '') {
            return null;
        }

        return trimmedOutput;
    }
}

module.exports = FileSystemCommand;
