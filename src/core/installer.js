import os from 'os';
import path from 'path';
import { promises as fs, realpathSync } from 'fs';
import { spawn } from 'child_process';
import { logDebug } from '../utils/utils';
import { getLinuxModalCommand } from './linux-dialog';

const MANIFEST_NAME = 'pro.maxvideodownloader.coapp.json';

const SNAP_BROWSERS = {
  'chromium': { name: 'Chromium', type: 'chrome', manifestPaths: ['common/chromium/NativeMessagingHosts', 'current/.config/chromium/NativeMessagingHosts'] },
  'brave': { name: 'Brave Browser', type: 'chrome', manifestPaths: ['common/BraveSoftware/Brave-Browser/NativeMessagingHosts', 'current/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts'] },
  'vivaldi': { name: 'Vivaldi', type: 'chrome', manifestPaths: ['common/vivaldi/NativeMessagingHosts', 'current/.config/vivaldi/NativeMessagingHosts'] },
  'opera': { name: 'Opera', type: 'chrome', manifestPaths: ['common/opera/NativeMessagingHosts', 'current/.config/opera/NativeMessagingHosts'] },
  'microsoft-edge': { name: 'Microsoft Edge', type: 'chrome', manifestPaths: ['common/microsoft-edge/NativeMessagingHosts', 'current/.config/microsoft-edge/NativeMessagingHosts'] },
  'firefox': { name: 'Firefox', type: 'firefox', manifestPaths: ['common/.mozilla/native-messaging-hosts', 'current/.mozilla/native-messaging-hosts'] }
};

const BROWSERS = {
  // macOS — same structure for both user and system modes, paths without tilde
  darwin: [
    // Chromium-family
    { name: 'Google Chrome', type: 'chrome', subPath: 'Library/Application Support/Google/Chrome/NativeMessagingHosts', configDir: 'Library/Application Support/Google/Chrome' }, // this is harmless for system-mode, but it's a falsy path, maybe will fix later
    { name: 'Google Chrome (system)', type: 'chrome', subPath: 'Library/Google/Chrome/NativeMessagingHosts', configDir: 'Library/Google/Chrome' }, // this key will be ignored by user-mode
    { name: 'Google Chrome Beta', type: 'chrome', subPath: 'Library/Application Support/Google/Chrome Beta/NativeMessagingHosts', configDir: 'Library/Application Support/Google/Chrome Beta' },
    { name: 'Google Chrome Dev', type: 'chrome', subPath: 'Library/Application Support/Google/Chrome Dev/NativeMessagingHosts', configDir: 'Library/Application Support/Google/Chrome Dev' },
    { name: 'Google Chrome Canary', type: 'chrome', subPath: 'Library/Application Support/Google/Chrome Canary/NativeMessagingHosts', configDir: 'Library/Application Support/Google/Chrome Canary' },
    { name: 'Chromium', type: 'chrome', subPath: 'Library/Application Support/Chromium/NativeMessagingHosts', configDir: 'Library/Application Support/Chromium' },
    { name: 'Arc', type: 'chrome', subPath: 'Library/Application Support/Arc/User Data/NativeMessagingHosts', configDir: 'Library/Application Support/Arc/User Data' },
    { name: 'Arc (new layout)', type: 'chrome', subPath: 'Library/Application Support/Arc/Browser/User Data/NativeMessagingHosts', configDir: 'Library/Application Support/Arc/Browser/User Data' },
    { name: 'Microsoft Edge', type: 'chrome', subPath: 'Library/Application Support/Microsoft Edge/NativeMessagingHosts', configDir: 'Library/Application Support/Microsoft Edge' },
    { name: 'Microsoft Edge Beta', type: 'chrome', subPath: 'Library/Application Support/Microsoft Edge Beta/NativeMessagingHosts', configDir: 'Library/Application Support/Microsoft Edge Beta' },
    { name: 'Microsoft Edge Dev', type: 'chrome', subPath: 'Library/Application Support/Microsoft Edge Dev/NativeMessagingHosts', configDir: 'Library/Application Support/Microsoft Edge Dev' },
    { name: 'Microsoft Edge Canary', type: 'chrome', subPath: 'Library/Application Support/Microsoft Edge Canary/NativeMessagingHosts', configDir: 'Library/Application Support/Microsoft Edge Canary' },
    { name: 'Brave Browser', type: 'chrome', subPath: 'Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts', configDir: 'Library/Application Support/BraveSoftware/Brave-Browser' },
    { name: 'Brave Browser Nightly', type: 'chrome', subPath: 'Library/Application Support/BraveSoftware/Brave-Browser-Nightly/NativeMessagingHosts', configDir: 'Library/Application Support/BraveSoftware/Brave-Browser-Nightly' },
    { name: 'Opera', type: 'chrome', subPath: 'Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts', configDir: 'Library/Application Support/com.operasoftware.Opera' },
    { name: 'Opera Developer', type: 'chrome', subPath: 'Library/Application Support/com.operasoftware.OperaDeveloper/NativeMessagingHosts', configDir: 'Library/Application Support/com.operasoftware.OperaDeveloper' },
    { name: 'Vivaldi', type: 'chrome', subPath: 'Library/Application Support/Vivaldi/NativeMessagingHosts', configDir: 'Library/Application Support/Vivaldi' },
    { name: 'Vivaldi Snapshot', type: 'chrome', subPath: 'Library/Application Support/Vivaldi-Snapshot/NativeMessagingHosts', configDir: 'Library/Application Support/Vivaldi-Snapshot' },
    { name: 'Epic Privacy Browser', type: 'chrome', subPath: 'Library/Application Support/Epic Privacy Browser/NativeMessagingHosts', configDir: 'Library/Application Support/Epic Privacy Browser' },
    { name: 'Yandex Browser', type: 'chrome', subPath: 'Library/Application Support/Yandex/YandexBrowser/NativeMessagingHosts', configDir: 'Library/Application Support/Yandex/YandexBrowser' },
    { name: 'CocCoc', type: 'chrome', subPath: 'Library/Application Support/CocCoc/Browser/NativeMessagingHosts', configDir: 'Library/Application Support/CocCoc/Browser' },
    { name: 'Whale', type: 'chrome', subPath: 'Library/Application Support/Naver/Whale/NativeMessagingHosts', configDir: 'Library/Application Support/Naver/Whale' },

    // Firefox-family
    { name: 'Firefox', type: 'firefox', subPath: 'Library/Application Support/Mozilla/NativeMessagingHosts', configDir: 'Library/Application Support/Mozilla' },
    { name: 'LibreWolf', type: 'firefox', subPath: 'Library/Application Support/LibreWolf/NativeMessagingHosts', configDir: 'Library/Application Support/LibreWolf' },
    { name: 'Tor Browser', type: 'firefox', subPath: 'Library/Application Support/TorBrowser-Data/Browser/NativeMessagingHosts', configDir: 'Library/Application Support/TorBrowser-Data/Browser' },
    { name: 'Tor Browser (revision)', type: 'firefox', subPath: 'Library/Application Support/Tor Browser/Browser/NativeMessagingHosts', configDir: 'Library/Application Support/Tor Browser/Browser' }
  ],

  // Linux — separated into user and system sets
  linux: {
    // USER: check configDir; write manifests only if found
    user: [
      // Classic installs
      { name: 'Google Chrome', type: 'chrome', path: '.config/google-chrome/NativeMessagingHosts', configDir: '.config/google-chrome' },
      { name: 'Google Chrome Beta', type: 'chrome', path: '.config/google-chrome-beta/NativeMessagingHosts', configDir: '.config/google-chrome-beta' },
      { name: 'Google Chrome Dev', type: 'chrome', path: '.config/google-chrome-unstable/NativeMessagingHosts', configDir: '.config/google-chrome-unstable' },
      { name: 'Chromium', type: 'chrome', path: '.config/chromium/NativeMessagingHosts', configDir: '.config/chromium' },
      { name: 'Brave Browser', type: 'chrome', path: '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts', configDir: '.config/BraveSoftware/Brave-Browser' },
      { name: 'Microsoft Edge', type: 'chrome', path: '.config/microsoft-edge/NativeMessagingHosts', configDir: '.config/microsoft-edge' },
      { name: 'Microsoft Edge Beta', type: 'chrome', path: '.config/microsoft-edge-beta/NativeMessagingHosts', configDir: '.config/microsoft-edge-beta' },
      { name: 'Microsoft Edge Dev', type: 'chrome', path: '.config/microsoft-edge-dev/NativeMessagingHosts', configDir: '.config/microsoft-edge-dev' },
      { name: 'Vivaldi', type: 'chrome', path: '.config/vivaldi/NativeMessagingHosts', configDir: '.config/vivaldi' },
      { name: 'Vivaldi Snapshot', type: 'chrome', path: '.config/vivaldi-snapshot/NativeMessagingHosts', configDir: '.config/vivaldi-snapshot' },
      { name: 'Opera', type: 'chrome', path: '.config/opera/NativeMessagingHosts', configDir: '.config/opera' },
      { name: 'Opera (Developer)', type: 'chrome', path: '.config/opera-developer/NativeMessagingHosts', configDir: '.config/opera-developer' },
      { name: 'Yandex Browser', type: 'chrome', path: '.config/yandex-browser/NativeMessagingHosts', configDir: '.config/yandex-browser' },
      { name: 'Whale', type: 'chrome', path: '.config/naver-whale/NativeMessagingHosts', configDir: '.config/naver-whale' },

      // Firefox family
      { name: 'Firefox', type: 'firefox', path: '.mozilla/native-messaging-hosts', configDir: '.mozilla' },
      { name: 'LibreWolf', type: 'firefox', path: '.librewolf/native-messaging-hosts', configDir: '.librewolf' },

      // Flatpak (sandboxed apps)
      { name: 'Firefox (Flatpak)', type: 'firefox', path: '.var/app/org.mozilla.firefox/.mozilla/native-messaging-hosts', configDir: '.var/app/org.mozilla.firefox' },
      { name: 'Google Chrome (Flatpak)', type: 'chrome', path: '.var/app/com.google.Chrome/config/google-chrome/NativeMessagingHosts', configDir: '.var/app/com.google.Chrome' },
      { name: 'Chromium (Flatpak)', type: 'chrome', path: '.var/app/org.chromium.Chromium/config/chromium/NativeMessagingHosts', configDir: '.var/app/org.chromium.Chromium' },
      { name: 'Brave Browser (Flatpak)', type: 'chrome', path: '.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser/NativeMessagingHosts', configDir: '.var/app/com.brave.Browser' },
      { name: 'Microsoft Edge (Flatpak)', type: 'chrome', path: '.var/app/com.microsoft.Edge/config/microsoft-edge/NativeMessagingHosts', configDir: '.var/app/com.microsoft.Edge' }
    ],

    // SYSTEM: always write; no checks needed
    system: [
      // Chromium-family
      { name: 'Google Chrome', type: 'chrome', path: '/etc/opt/chrome/native-messaging-hosts' },
      { name: 'Chromium', type: 'chrome', path: '/etc/chromium/native-messaging-hosts' },
      { name: 'Brave Browser', type: 'chrome', path: '/etc/brave/native-messaging-hosts' },
      { name: 'Brave Browser (/opt)', type: 'chrome', path: '/etc/opt/brave/native-messaging-hosts' },
      { name: 'Microsoft Edge', type: 'chrome', path: '/etc/opt/edge/native-messaging-hosts' },
      { name: 'Opera', type: 'chrome', path: '/etc/opt/opera/native-messaging-hosts' },
      { name: 'Vivaldi', type: 'chrome', path: '/etc/opt/vivaldi/native-messaging-hosts' },
      { name: 'Yandex Browser', type: 'chrome', path: '/etc/opt/yandex-browser/native-messaging-hosts' },
      { name: 'Whale', type: 'chrome', path: '/etc/opt/naver-whale/native-messaging-hosts' },

      // Firefox-family (both lib and lib64 for distro compatibility)
      { name: 'Firefox', type: 'firefox', path: '/usr/lib/mozilla/native-messaging-hosts' },
      { name: 'Firefox (lib64)', type: 'firefox', path: '/usr/lib64/mozilla/native-messaging-hosts' },
      { name: 'LibreWolf', type: 'firefox', path: '/usr/lib/librewolf/native-messaging-hosts' },
      { name: 'LibreWolf (mozilla)', type: 'firefox', path: '/usr/lib/mozilla/native-messaging-hosts' },
      { name: 'LibreWolf (lib64)', type: 'firefox', path: '/usr/lib64/mozilla/native-messaging-hosts' }
    ]
  }
};

function getBrowsers(scope, platform) {
  const home = os.homedir();
  if (platform === 'darwin') {
    const prefix = scope === 'system' ? '/' : home;
    return BROWSERS.darwin.map(b => ({ ...b, path: path.join(prefix, b.subPath), configDir: path.join(prefix, b.configDir) }));
  } else if (platform === 'linux') {
    const list = BROWSERS.linux[scope] || [];
    return scope === 'user' 
        ? list.map(b => ({ ...b, path: b.path.startsWith('/') ? b.path : path.join(home, b.path), configDir: b.configDir.startsWith('/') ? b.configDir : path.join(home, b.configDir) }))
        : list;
  }
  return [];
}

async function writeFileAtomic(filePath, content) {
  const tmp = `${filePath}.tmp.${Date.now()}`;
  try {
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, filePath);
    await fs.chmod(filePath, 0o644);
  } catch (err) {
    if (err.code === 'EXDEV') {
      await fs.copyFile(tmp, filePath);
      await fs.unlink(tmp);
      await fs.chmod(filePath, 0o644);
    } else {
      try { await fs.unlink(tmp); } catch { /* ignore */ }
      throw err;
    }
  }
}

function sanitizeForAppleScript(text) {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\$/g, '\\$').replace(/[`]/g, '');
}

async function filterInstalledBrowsers(browsers, isSystemMode) {
  if (isSystemMode) return browsers;
  const results = await Promise.all(browsers.map(async (b) => {
    try { await fs.access(b.configDir); return b; } catch { return null; }
  }));
  return results.filter(b => b !== null);
}

async function copyFolderRecursive(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyFolderRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
      // Ensure executables remain executable
      if (entry.name === 'mvdcoapp' || entry.name.startsWith('ffmpeg') || entry.name.startsWith('ffprobe') || entry.name.startsWith('mvd-')) {
        await fs.chmod(destPath, 0o755);
      }
    }
  }
}

function createManifest(browserType, customExecPath) {
  const execPath = customExecPath || realpathSync(process.execPath);
  const base = { name: 'pro.maxvideodownloader.coapp', description: 'MAX Video Downloader CoApp', path: execPath, type: 'stdio' };
  return browserType === 'firefox' 
    ? { ...base, allowed_extensions: ['max-video-downloader@rostislav.dev'] }
    : { ...base, allowed_origins: ['chrome-extension://bkblnddclhmmgjlmbofhakhhbklkcofd/', 'chrome-extension://kjinbaahkmjgkkedfdgpkkelehofieke/', 'chrome-extension://hkakpofpmdphjlkojabkfjapnhjfebdl/'] };
}

async function handleSnapOnly(snapId, execPath, home) {
  const installed = [];
  const config = SNAP_BROWSERS[snapId];
  if (!config) {
    logDebug(`[Installer] Run from unknown snap: ${snapId}`);
    return installed;
  }

  // Use the refined coverage rule: check each potential manifest parent directory and use the first one that exists.
  let bestManifestDir = null;
  for (const subPath of config.manifestPaths) {
    const fullPath = path.join(home, 'snap', snapId, subPath);
    const parentDir = path.dirname(fullPath);
    try {
      await fs.access(parentDir);
      bestManifestDir = fullPath;
      break;
    } catch { /* ignore */ }
  }

  // Fallback to first one if none exist yet (mkdir recursive will handle it)
  const manifestDir = bestManifestDir || path.join(home, 'snap', snapId, config.manifestPaths[0]);

  try {
    await fs.mkdir(manifestDir, { recursive: true, mode: 0o755 });
    await writeFileAtomic(path.join(manifestDir, MANIFEST_NAME), JSON.stringify(createManifest(config.type, execPath), null, 2));
    installed.push({ name: config.name });
    logDebug(`[Installer] Snap-only success for ${config.name} at ${manifestDir}`);
  } catch (err) {
    logDebug(`[Installer] Snap-only failed for ${config.name}: ${err.message}`);
  }
  return installed;
}

async function handleNonSnapAndSnap(execPath, home) {
  const installed = [];
  const binDir = path.dirname(execPath);

  // 1. Regular/Flatpak browsers (classic .config or .mozilla)
  const regularBrowsers = await filterInstalledBrowsers(getBrowsers('user', 'linux'), false);
  for (const b of regularBrowsers) {
    try {
      await fs.mkdir(b.path, { recursive: true, mode: 0o755 });
      await writeFileAtomic(path.join(b.path, MANIFEST_NAME), JSON.stringify(createManifest(b.type, execPath), null, 2));
      installed.push(b);
      logDebug(`[Installer] Regular success for ${b.name} at ${b.path}`);
    } catch (err) {
      logDebug(`[Installer] Regular failed for ${b.name}: ${err.message}`);
    }
  }

  // 2. Snap browsers (multi-layout coverage)
  for (const [id, config] of Object.entries(SNAP_BROWSERS)) {
    const snapHome = path.join(home, 'snap', id);
    try {
      await fs.access(snapHome);
      const targetDir = path.join(snapHome, 'common/mvdcoapp');
      const targetExec = path.join(targetDir, 'mvdcoapp');

      // Copy bundle (clear first to ensure clean state)
      try { await fs.rm(targetDir, { recursive: true, force: true }); } catch { /* ignore */ }
      await copyFolderRecursive(binDir, targetDir);

      // Find best manifest location based on existing profile roots
      let bestManifestDir = null;
      for (const subPath of config.manifestPaths) {
        const fullPath = path.join(snapHome, subPath);
        const parentDir = path.dirname(fullPath);
        try {
          await fs.access(parentDir);
          bestManifestDir = fullPath;
          break;
        } catch { /* ignore */ }
      }
      
      const manifestDir = bestManifestDir || path.join(snapHome, config.manifestPaths[0]);
      
      await fs.mkdir(manifestDir, { recursive: true, mode: 0o755 });
      await writeFileAtomic(path.join(manifestDir, MANIFEST_NAME), JSON.stringify(createManifest(config.type, targetExec), null, 2));
      
      installed.push({ name: `${config.name} (Snap)` });
      logDebug(`[Installer] Snap success for ${config.name} at ${manifestDir}`);
    } catch {
      // Snap not installed or inaccessible
    }
  }
  return installed;
}

export async function install() {
  const scope = process.getuid?.() === 0 ? 'system' : 'user';
  const platform = os.platform();
  const home = os.homedir();
  logDebug(`[Installer] Starting install for scope: ${scope}, platform: ${platform}`);

  if (platform === 'linux' && scope === 'user') {
    const execPath = realpathSync(process.execPath);
    const snapRoot = path.join(home, 'snap') + path.sep;
    
    let installed;
    if (execPath.startsWith(snapRoot)) {
        const snapId = execPath.slice(snapRoot.length).split(path.sep)[0];
        installed = await handleSnapOnly(snapId, execPath, home);
    } else {
        installed = await handleNonSnapAndSnap(execPath, home);
    }

    if (installed.length > 0) {
        logDebug(`[Installer] Total installed: ${installed.length}`);
        await showLinuxDialog(installed, false, scope);
    } else {
        logDebug('[Installer] No target browsers found for installation.');
        console.log('No browsers found.'); 
    }
    return;
  }

  const browsers = await filterInstalledBrowsers(getBrowsers(scope, platform), scope === 'system');
  if (browsers.length === 0) {
    logDebug('[Installer] No target browsers found for installation.');
    console.log('No browsers found.'); 
    return;
  }

  const installed = [];
  for (const b of browsers) {
    try {
      await fs.mkdir(b.path, { recursive: true, mode: 0o755 });
      await writeFileAtomic(path.join(b.path, MANIFEST_NAME), JSON.stringify(createManifest(b.type), null, 2));
      installed.push(b);
      logDebug(`[Installer] Success for ${b.name} at ${b.path}`);
    } catch (err) {
      logDebug(`[Installer] Failed for ${b.name}:`, err.message);
      console.error(`Failed for ${b.name}: ${err.message}`);
    }
  }

  if (installed.length > 0) {
    logDebug(`[Installer] Total installed: ${installed.length}`);
    if (platform === 'darwin') await showMacOSDialog(installed, false, scope);
    else if (platform === 'linux') await showLinuxDialog(installed, false, scope);
  }
}

export async function uninstall(fromDialog = false) {
  const scope = process.getuid?.() === 0 ? 'system' : 'user';
  const platform = os.platform();
  const home = os.homedir();
  logDebug(`[Installer] Starting uninstall (scope: ${scope}, fromDialog: ${fromDialog})`);

  if (platform === 'linux' && scope === 'user') {
    const removed = [];

    // 1. Regular/Flatpak
    const regularBrowsers = await filterInstalledBrowsers(getBrowsers('user', 'linux'), false);
    for (const b of regularBrowsers) {
      try {
        const p = path.join(b.path, MANIFEST_NAME);
        await fs.access(p);
        await fs.unlink(p);
        removed.push(b);
        logDebug(`[Installer] Removed from regular: ${b.name}`);
      } catch { /* ignore */ }
    }

    // 2. Snaps (check all potential manifest locations)
    for (const [id, config] of Object.entries(SNAP_BROWSERS)) {
      const snapHome = path.join(home, 'snap', id);
      try {
        let hasRemovedManifest = false;
        for (const subPath of config.manifestPaths) {
          try {
            const manifestPath = path.join(snapHome, subPath, MANIFEST_NAME);
            await fs.access(manifestPath);
            await fs.unlink(manifestPath);
            hasRemovedManifest = true;
          } catch { /* ignore if not in this path */ }
        }
        
        if (hasRemovedManifest) {
          removed.push({ name: `${config.name} (Snap)` });
          logDebug(`[Installer] Removed from snap: ${config.name}`);
        }
      } catch { /* snap folder inaccessible */ }
    }

    if (removed.length > 0) {
      logDebug(`[Installer] Total removed: ${removed.length}`);
      await showLinuxDialog(removed, true, scope, fromDialog);
    }
    return;
  }

  const browsers = await filterInstalledBrowsers(getBrowsers(scope, platform), scope === 'system');
  const removed = [];

  for (const b of browsers) {
    try {
      const p = path.join(b.path, MANIFEST_NAME);
      await fs.access(p);
      await fs.unlink(p);
      removed.push(b);
      logDebug(`[Installer] Removed from ${b.name}`);
    } catch { /* ignore if doesn't exist */ }
  }

  if (removed.length > 0) {
    logDebug(`[Installer] Total removed: ${removed.length}`);
    if (platform === 'darwin') await showMacOSDialog(removed, true, scope, fromDialog);
    else if (platform === 'linux') await showLinuxDialog(removed, true, scope, fromDialog);
  }
}

async function showMacOSDialog(browsers, wasUninstall, scope, fromDialog = false) {
  const list = browsers.map(b => `• ${sanitizeForAppleScript(b.name)}`).join('\\n');
  const text = `${wasUninstall ? 'Removed from' : 'Installed for'} ${browsers.length} browser(s):\\n\\n${list}\\n\\nScope: ${scope}`;
  
  return new Promise((resolve) => {
    // We avoid "tell application System Events" to bypass Automation permission requirements.
    // Plain "display dialog" works fine for the installer context.
    const script = (wasUninstall || fromDialog)
      ? `display dialog "${text}" buttons {"OK"} default button "OK" with title "MAX Video Downloader"`
      : `display dialog "${text}" buttons {"Uninstall", "OK"} default button "OK" with title "MAX Video Downloader"`;

    const child = spawn('osascript', ['-e', script], { stdio: 'pipe' });
    let out = '';
    child.stdout.on('data', d => out += d.toString());

    child.on('close', async () => {
        // Only trigger uninstallation if the user explicitly clicked the "Uninstall" button.
        // We check the stdout for the button name.
        if (!wasUninstall && !fromDialog && out.includes('button returned:Uninstall')) {
            logDebug('[Installer] User clicked Uninstall in success dialog.');
            await uninstall(true);
        }
        resolve();
    });
  });
}

async function showLinuxDialog(browsers, wasUninstall, scope, fromDialog = false) {
  const list = browsers.map(b => `• ${b.name}`).join('\n');
  const text = `${wasUninstall ? 'Removed from' : 'Installed for'} ${browsers.length} browser(s):\n\n${list}\n\nScope: ${scope}`;
  const cmd = getLinuxModalCommand(wasUninstall ? 'info' : 'question', text, 'MAX Video Downloader CoApp');
  if (!cmd) { console.log(text); return; }

  return new Promise((resolve) => {
    const child = spawn(cmd.cmd, cmd.args);
    child.on('close', async (code) => {
      if (!wasUninstall && code !== 0 && !fromDialog) {
        await uninstall(true);
      }
      resolve();
    });
  });
}
