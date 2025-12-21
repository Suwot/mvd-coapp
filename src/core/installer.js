import os from 'os';
import path from 'path';
import { promises as fs, realpathSync } from 'fs';
import { spawn } from 'child_process';
import { logDebug } from '../utils/utils';
import { getLinuxModalCommand } from './linux-dialog';

const MANIFEST_NAME = 'pro.maxvideodownloader.coapp.json';

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
    { name: 'Vivaldi', type: 'chrome', subPath: 'Library/Application Support/Vivaldi/NativeMessagingHosts', configDir: 'Library/Application Support/Vivaldi' },
    { name: 'Vivaldi Snapshot', type: 'chrome', subPath: 'Library/Application Support/Vivaldi-Snapshot/NativeMessagingHosts', configDir: 'Library/Application Support/Vivaldi-Snapshot' },
    { name: 'Epic Privacy Browser', type: 'chrome', subPath: 'Library/Application Support/Epic Privacy Browser/NativeMessagingHosts', configDir: 'Library/Application Support/Epic Privacy Browser' },
    { name: 'Yandex Browser', type: 'chrome', subPath: 'Library/Application Support/Yandex/YandexBrowser/NativeMessagingHosts', configDir: 'Library/Application Support/Yandex/YandexBrowser' },

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
      { name: 'Yandex Browser', type: 'chrome', path: '.config/yandex-browser/NativeMessagingHosts', configDir: '.config/yandex-browser' },

      // Firefox family
      { name: 'Firefox', type: 'firefox', path: '.mozilla/native-messaging-hosts', configDir: '.mozilla' },
      { name: 'LibreWolf', type: 'firefox', path: '.librewolf/native-messaging-hosts', configDir: '.librewolf' },

      // Flatpak (sandboxed apps)
      { name: 'Firefox (Flatpak)', type: 'firefox', path: '.var/app/org.mozilla.firefox/.mozilla/native-messaging-hosts', configDir: '.var/app/org.mozilla.firefox' },
      { name: 'Google Chrome (Flatpak)', type: 'chrome', path: '.var/app/com.google.Chrome/config/google-chrome/NativeMessagingHosts', configDir: '.var/app/com.google.Chrome' },
      { name: 'Chromium (Flatpak)', type: 'chrome', path: '.var/app/org.chromium.Chromium/config/chromium/NativeMessagingHosts', configDir: '.var/app/org.chromium.Chromium' },
      { name: 'Brave Browser (Flatpak)', type: 'chrome', path: '.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser/NativeMessagingHosts', configDir: '.var/app/com.brave.Browser' },
      { name: 'Microsoft Edge (Flatpak)', type: 'chrome', path: '.var/app/com.microsoft.Edge/config/microsoft-edge/NativeMessagingHosts', configDir: '.var/app/com.microsoft.Edge' },

      // Snap packages (sandboxed) - both current/ and common/ for all revisions
      { name: 'Chromium (Snap common)', type: 'chrome', path: 'snap/chromium/common/chromium/NativeMessagingHosts', configDir: 'snap/chromium' },
      { name: 'Chromium (Snap current)', type: 'chrome', path: 'snap/chromium/current/chromium/NativeMessagingHosts', configDir: 'snap/chromium' }
    ],

    // SYSTEM: always write; no checks needed
    system: [
      // Chromium-family
      { name: 'Google Chrome', type: 'chrome', path: '/etc/opt/chrome/native-messaging-hosts' },
      { name: 'Chromium', type: 'chrome', path: '/etc/chromium/native-messaging-hosts' },
      { name: 'Brave Browser', type: 'chrome', path: '/etc/brave/native-messaging-hosts' },
      { name: 'Brave Browser (/opt)', type: 'chrome', path: '/etc/opt/brave/native-messaging-hosts' },
      { name: 'Microsoft Edge', type: 'chrome', path: '/etc/opt/microsoft-edge/native-messaging-hosts' },
      { name: 'Opera', type: 'chrome', path: '/etc/opt/opera/native-messaging-hosts' },
      { name: 'Vivaldi', type: 'chrome', path: '/etc/opt/vivaldi/native-messaging-hosts' },
      { name: 'Yandex Browser', type: 'chrome', path: '/etc/opt/yandex-browser/native-messaging-hosts' },

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

function createManifest(browserType) {
  const execPath = realpathSync(process.execPath);
  const base = { name: 'pro.maxvideodownloader.coapp', description: 'MAX Video Downloader CoApp', path: execPath, type: 'stdio' };
  return browserType === 'firefox' 
    ? { ...base, allowed_extensions: ['max-video-downloader@rostislav.dev'] }
    : { ...base, allowed_origins: ['chrome-extension://bkblnddclhmmgjlmbofhakhhbklkcofd/', 'chrome-extension://kjinbaahkmjgkkedfdgpkkelehofieke/', 'chrome-extension://hkakpofpmdphjlkojabkfjapnhjfebdl/'] };
}

export async function install() {
  const scope = process.getuid?.() === 0 ? 'system' : 'user';
  const platform = os.platform();
  logDebug(`[Installer] Starting install for scope: ${scope}, platform: ${platform}`);

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
  logDebug(`[Installer] Starting uninstall (scope: ${scope}, fromDialog: ${fromDialog})`);

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
    if (wasUninstall || fromDialog) {
      const child = spawn('osascript', ['-e', `display dialog "${text}" buttons {"OK"} default button "OK"`]);
      child.on('close', resolve);
    } else {
      const child = spawn('osascript', ['-e', `tell application "System Events" to display dialog "${text}" buttons {"Uninstall", "OK"} default button "OK" cancel button "Uninstall"`], { stdio: 'pipe' });
      let out = '';
      child.stdout.on('data', d => out += d.toString());
      child.on('close', async (code) => {
          if (code !== 0 || !out.includes('button returned:OK')) {
              await uninstall(true);
          }
          resolve();
      });
    }
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
