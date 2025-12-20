import path from 'path';
import os from 'os';
import fs from 'fs';

// 1. Platform & Environment
export const PLATFORM = process.platform;
export const IS_WINDOWS = PLATFORM === 'win32';
export const IS_MACOS = PLATFORM === 'darwin';
export const IS_LINUX = PLATFORM === 'linux';
export const IS_PKG = typeof process.pkg !== 'undefined';

// Version resolution (Parity with old src)
let version = '0.0.0';
try {
    // We use require() for package.json because pkg handles it natively for bundling
    // and it works reliably in transpiled CommonJS environments.
    const pkg = require('../../package.json');
    version = pkg.version;
} catch {
    // ignore
}
export const APP_VERSION = process.env.APP_VERSION || version;

// 2. Paths & Storage
const isSnap = !!(process.env.SNAP || process.env.SNAP_REVISION) || os.tmpdir().includes('snap');
const cacheBase = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
const rawTempDir = isSnap ? path.join(cacheBase, 'mvdcoapp') : path.join(os.tmpdir(), 'mvdcoapp');

let tempDir;
try {
    if (!fs.existsSync(rawTempDir)) fs.mkdirSync(rawTempDir, { recursive: true });
    tempDir = fs.realpathSync(rawTempDir);
} catch {
    tempDir = rawTempDir;
}

export const TEMP_DIR = tempDir;
export const LOG_FILE = path.join(TEMP_DIR, 'mvdcoapp.log');

// 3. Timeouts & Limits
export const IDLE_TIMEOUT = 30000;
export const DEFAULT_TOOL_TIMEOUT = 30000;
export const PREVIEW_TOOL_TIMEOUT = 40000;
export const LOG_MAX_SIZE = 10 * 1024 * 1024; // 10MB
export const LOG_KEEP_SIZE = 5 * 1024 * 1024; // 5MB

// 4. Binaries
const BIN_DIR = IS_PKG ? path.dirname(process.execPath) : path.dirname(__dirname);
const EXE_EXT = IS_WINDOWS ? '.exe' : '';

export const BINARIES = {
    ffmpeg: path.join(BIN_DIR, `ffmpeg${EXE_EXT}`),
    ffprobe: path.join(BIN_DIR, `ffprobe${EXE_EXT}`),
    fileui: IS_WINDOWS ? path.join(BIN_DIR, `mvd-fileui${EXE_EXT}`) : null,
    diskspace: path.join(BIN_DIR, `mvd-diskspace${EXE_EXT}`)
};

// 5. Constants
export const ALLOWED_IDS = [
    'bkblnddclhmmgjlmbofhakhhbklkcofd',
    'kjinbaahkmjgkkedfdgpkkelehofieke',
    'hkakpofpmdphjlkojabkfjapnhjfebdl',
    'max-video-downloader@rostislav.dev'
];

export const KNOWN_COMMANDS = ['-h', '--help', '-v', '--version', '--info', '-i', '--install', '-u', '--uninstall'];

export const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g; // eslint-disable-line no-control-regex
export const WINDOWS_RESERVED_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

export const VALIDATION_SCHEMA = {
    'download-v2': ['downloadId', 'argsBeforeOutput', 'saveDir'],
    'cancel-download-v2': ['downloadId'],
    'fileSystem': ['operation'],
    'runTool': ['tool', 'args']
};
