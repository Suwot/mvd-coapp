import { IS_MACOS, IS_LINUX, IS_WINDOWS, APP_VERSION } from '../utils/config';
import { install, uninstall } from './installer';
import { getConnectionInfo } from '../utils/utils';

export function showUsage() {
    console.log('MVD CoApp - MAX Video Downloader Native Messaging Host');
    console.log('');
    console.log('Usage:');
    console.log('  mvdcoapp -h, --help        Show this help message');
    console.log('  mvdcoapp -v, --version     Show version information');
    console.log('  mvdcoapp --info            Show system info');
    
    if (IS_WINDOWS) {
        console.log('\nOn Windows, CoApp is managed by the Installer/Uninstaller.');
    } else {
        console.log('  mvdcoapp -i, --install     Install CoApp for all detected browsers');
        console.log('  mvdcoapp -u, --uninstall   Remove CoApp from all browsers');
    }
}

async function runInstallerOperation(operation) {
    try {
        if (operation === 'install') await install();
        else await uninstall();
        process.exit(0);
    } catch (err) {
        console.error(`${operation} failed:`, err.message);
        process.exit(1);
    }
}

export function handleDoubleClick() {
    if (IS_MACOS || IS_LINUX) return runInstallerOperation('install');
    process.exit(0);
}

export function handleCliArgs(args) {
    const arg = args[0];
    if (arg === '-h' || arg === '--help') {
        showUsage();
        process.exit(0);
    }
    if (arg === '-v' || arg === '--version') {
        console.log(`MVD CoApp v${APP_VERSION}`);
        process.exit(0);
    }
    if (arg === '--info') {
        console.log(JSON.stringify(getConnectionInfo(), null, 2));
        process.exit(0);
    }
    if (arg === '-i' || arg === '--install') {
        return runInstallerOperation('install');
    }
    if (arg === '-u' || arg === '--uninstall') {
        return runInstallerOperation('uninstall');
    }
}
