/**
 * CoApp Installer - Simplified 2-mode architecture
 * Handles installation and removal of native messaging manifests across browsers
 * 2 modes: USER (uid !== 0) - installs to user directory, checks browser paths
 *          SYSTEM (uid === 0) - installs to system directory, no path checks
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { getLinuxModalCommand } = require('./linux-dialog');

const MANIFEST_NAME = 'pro.maxvideodownloader.coapp.json';

// Browser detection matrix - platform and mode specific
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

/**
 * Build browser list with resolved paths for current platform and mode
 * Resolves once at initialization to avoid repeated path expansion
 */
function getBrowsers(scope, platform) {
  const home = os.homedir();

  if (platform === 'darwin') {
    // macOS: prefix subPath with home or root based on scope
    const prefix = scope === 'system' ? '/' : home;
    return BROWSERS.darwin.map(b => ({
      ...b,
      path: path.join(prefix, b.subPath),
      configDir: path.join(prefix, b.configDir)
    }));
  } else if (platform === 'linux') {
    // Linux: user and system are separate arrays; user paths need home prefix
    const browserList = BROWSERS.linux[scope];
    if (scope === 'user') {
      return browserList.map(b => {
        // Guard against absolute paths: only prepend home if path is relative
        const fullPath = b.path.startsWith('/') ? b.path : path.join(home, b.path);
        const fullConfigDir = b.configDir.startsWith('/') ? b.configDir : path.join(home, b.configDir);
        return {
          ...b,
          path: fullPath,
          configDir: fullConfigDir
        };
      });
    }
    // SYSTEM mode: paths are already absolute
    return browserList;
  }

  return [];
}

/**
 * Get current scope: 'user' if uid !== 0, 'system' if uid === 0
 */
function getScope() {
  return process.getuid?.() === 0 ? 'system' : 'user';
}

/**
 * Write file atomically via temp→rename pattern to prevent corruption
 * Falls back to copy+unlink on EXDEV (cross-device) errors
 */
async function writeFileAtomic(filePath, content) {
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  try {
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, filePath);
    // Ensure readable permissions (0644) for system-wide installs
    await fs.chmod(filePath, 0o644);
  } catch (err) {
    // Handle cross-device rename (EXDEV) by copying instead
    if (err.code === 'EXDEV') {
      try {
        await fs.copyFile(tempPath, filePath);
        await fs.unlink(tempPath);
        // Ensure readable permissions (0644) for system-wide installs
        await fs.chmod(filePath, 0o644);
      } catch (copyErr) {
        try {
          await fs.unlink(tempPath);
        } catch (_) {
          // Ignore cleanup error
        }
        throw copyErr;
      }
    } else {
      try {
        await fs.unlink(tempPath);
      } catch (_) {
        // Ignore cleanup error
      }
      throw err;
    }
  }
}

/**
 * Sanitize text for use in AppleScript dialog
 * Escapes problematic characters that break AppleScript syntax
 */
function sanitizeForAppleScript(text) {
  return text
    .replace(/\\/g, '\\\\')      // Backslash first
    .replace(/"/g, '\\"')         // Double quotes
    .replace(/'/g, "\\'")         // Single quotes
    .replace(/\$/g, '\\$')        // Dollar signs (prevent command injection)
    .replace(/[`]/g, '');         // Backticks (close injection edge cases)
}

/**
 * Check if a file or directory exists
 */
async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create manifest content based on browser type
 */
function createManifest(browserType) {
  // Resolve real executable path to avoid broken links when app is moved/symlinked
  const execPath = require('fs').realpathSync(process.execPath);

  const baseManifest = {
    name: 'pro.maxvideodownloader.coapp',
    description: 'MAX Video Downloader CoApp',
    path: execPath,
    type: 'stdio'
  };

  if (browserType === 'firefox') {
    return {
      ...baseManifest,
      allowed_extensions: [
        'max-video-downloader@rostislav.dev'
      ]
    };
  } else {
    return {
      ...baseManifest,
      allowed_origins: [
        'chrome-extension://bkblnddclhmmgjlmbofhakhhbklkcofd/',
        'chrome-extension://kjinbaahkmjgkkedfdgpkkelehofieke/',
        'chrome-extension://hkakpofpmdphjlkojabkfjapnhjfebdl/'
      ]
    };
  }
}

/**
 * Filter browsers based on installed status (check configDir for user mode)
 * SYSTEM mode: all browsers passed through (we write to all system paths)
 * USER mode: only browsers with existing config directory (parallelized)
 */
async function filterInstalledBrowsers(browsers, isSystemMode) {
  if (isSystemMode) {
    // SYSTEM mode: always install to all system paths
    return browsers;
  }

  // USER mode: check which browsers are actually installed (in parallel)
  const results = await Promise.all(
    browsers.map(async (browser) => {
      try {
        await fs.access(browser.configDir);
        return browser;
      } catch {
        return null;
      }
    })
  );

  // Filter out nulls (browsers that don't exist)
  return results.filter(b => b !== null);
}

/**
 * Install manifests for all detected browsers
 */
async function install() {
  const scope = getScope();
  const platform = os.platform();
  const isSystemMode = scope === 'system';

  console.log('====================================');
  console.log('MAX Video Downloader CoApp Installer');
  console.log('====================================');
  console.log('');
  console.log(`Scope: ${scope.toUpperCase()}`);
  console.log(`Installing from: ${process.execPath}`);
  console.log('');

  // Resolve all browser paths once
  let allBrowsers = getBrowsers(scope, platform);
  if (!allBrowsers.length) {
    console.log('Platform not supported.');
    if (require.main === module) process.exit(0);
    return;
  }

  // Filter to only installed browsers
  const browsers = await filterInstalledBrowsers(allBrowsers, isSystemMode);
  const installed = [];
  const failed = [];

  if (browsers.length === 0) {
    console.log('No supported browsers found. Manifests are not installed.');
    console.log('');
    console.log('Please install one of these supported browsers:');
    console.log('  • Google Chrome: https://www.google.com/chrome/');
    console.log('  • Mozilla Firefox: https://www.mozilla.org/firefox/');
    console.log('  • Microsoft Edge: https://www.microsoft.com/edge');
    console.log('  • Brave Browser: https://brave.com/');
    console.log('  • Opera: https://www.opera.com/');
    console.log('  • Vivaldi: https://vivaldi.com/');
    console.log('');
    console.log('After installing, run this installer again.');
    if (require.main === module) process.exit(0);
    return;
  }

  const permissionErrors = [];

  for (const browser of browsers) {
    try {
      // Create directory if it doesn't exist (0755 for system-wide readability)
      await fs.mkdir(browser.path, { recursive: true, mode: 0o755 });
      
      // Create manifest content
      const manifest = createManifest(browser.type);
      const manifestPath = path.join(browser.path, MANIFEST_NAME);
      
      // Write manifest atomically
      await writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2));
      
      installed.push(browser);
    } catch (err) {
      // Track permission errors for consolidated messaging
      if (isSystemMode && err.code === 'EACCES') {
        permissionErrors.push(browser.name);
      }
      failed.push({ ...browser, error: err.message });
    }
  }

  if (installed.length > 0) {
    console.log(`Installed for ${installed.length} browser(s):`);
    for (const browser of installed) {
      console.log(`  ✓ ${browser.name}: ${browser.path}/${MANIFEST_NAME}`);
    }
    console.log('');
    console.log('The MAX Video Downloader extension should now work.');
    console.log('');
    
    // Show GUI dialog on macOS/Linux and exit
    if (platform === 'darwin') {
      await showMacOSDialog(installed, false, scope);
    } else if (platform === 'linux') {
      await showLinuxDialog(installed, false, scope);
    }
  } else if (failed.length > 0) {
    console.log('Installation failed - no browsers could be configured');
    console.log('');
  }

  // Consolidated permission error message at end (only for system mode)
  if (permissionErrors.length > 0) {
    console.log('');
    console.warn(`Warning: Some system paths were not writable (${permissionErrors.join(', ')}).`);
    console.warn('Rerun with sudo to install system-wide.');
  }

  if (require.main === module) process.exit(0);
}

/**
 * Uninstall manifests from all browsers
 */
async function uninstall(fromDialog = false) {
  const scope = getScope();
  const platform = os.platform();
  const isSystemMode = scope === 'system';

  console.log('======================================');
  console.log('MAX Video Downloader CoApp Uninstaller');
  console.log('======================================');
  console.log('');
  console.log(`Scope: ${scope.toUpperCase()}`);
  console.log('');

  // Resolve all browser paths once
  let allBrowsers = getBrowsers(scope, platform);
  if (!allBrowsers.length) {
    console.log('Platform not supported.');
    process.exit(0);
  }

  // Filter to only installed browsers
  const browsers = await filterInstalledBrowsers(allBrowsers, isSystemMode);
  const removed = [];

  for (const browser of browsers) {
    try {
      const manifestPath = path.join(browser.path, MANIFEST_NAME);
      
      if (await exists(manifestPath)) {
        await fs.unlink(manifestPath);
        removed.push(browser);
      }
    } catch (err) {
      console.warn(`Warning: Could not remove manifest for ${browser.name}: ${err.message}`);
    }
  }

  if (removed.length === 0) {
    console.log('No installations found to remove.');
    console.log('');
    if (require.main === module) process.exit(0);
    return;
  }

  console.log(`Removed from ${removed.length} browser(s):`);
  for (const browser of removed) {
    console.log(`  ✗ ${browser.name}: ${browser.path}/${MANIFEST_NAME}`);
  }
  console.log('');
  console.log('Uninstallation complete!');
  console.log('');
  
  // Show GUI dialog on macOS/Linux and exit
  if (platform === 'darwin') {
    await showMacOSDialog(removed, true, scope, fromDialog);
  } else if (platform === 'linux') {
    await showLinuxDialog(removed, true, scope, fromDialog);
  }

  if (require.main === module) process.exit(0);
}

/**
 * Show macOS dialog with uninstall option
 */
function showMacOSDialog(browsers, wasUninstall, scope, fromDialog = false) {
  return new Promise((resolve) => {
    if (browsers.length === 0) {
      resolve();
      return;
    }

    const browserList = browsers.map(b => `• ${sanitizeForAppleScript(b.name)}`).join('\\n');
    let dialogText = wasUninstall ?
      `MAX Video Downloader CoApp removed from ${browsers.length} browser(s):\\n\\n${browserList}` :
      `MAX Video Downloader CoApp installed for ${browsers.length} browser(s):\\n\\n${browserList}`;
    
    // Add scope information
    dialogText += `\\n\\nScope: ${scope}`;
    
    if (wasUninstall) {
      const child = spawn('osascript', ['-e', `display dialog "${dialogText}" buttons {"OK"} default button "OK"`], { stdio: 'ignore' });
      child.on('error', (err) => {
        console.warn(`Warning: Could not show dialog: ${err.message}`);
        resolve();
      });
      child.on('close', () => resolve());
    } else {
      // Show dialog with OK and Uninstall buttons (skip if already called from uninstall dialog)
      if (fromDialog) {
        resolve();
        return;
      }

      console.log('Showing installation confirmation dialog...');
      
      const child = spawn('osascript', [
        '-e', 
        `tell application "System Events" to display dialog "${dialogText}" buttons {"Uninstall", "OK"} default button "OK" cancel button "Uninstall"`
      ], { stdio: 'pipe' });
      
      let output = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('error', (err) => {
        console.warn(`Warning: Could not show dialog: ${err.message}`);
        resolve();
      });
      
      child.on('close', (code) => {
        if (code === 0 && output.includes('button returned:OK')) {
          // User clicked OK
          resolve();
        } else {
          // User clicked Uninstall
          console.log('Uninstalling MAX Video Downloader CoApp...');
          uninstall(true).then(() => {
            resolve();
          }).catch(err => {
            console.error('Uninstall error:', err);
            resolve();
          });
        }
      });
    }
  });
}

/**
 * Show Linux dialog with uninstall option
 */
function showLinuxDialog(browsers, wasUninstall, scope, fromDialog = false) {
  return new Promise((resolve) => {
    if (browsers.length === 0) {
      resolve();
      return;
    }

    const browserList = browsers.map(b => `• ${b.name}`).join('\n');
    let dialogText = wasUninstall ?
      `MAX Video Downloader CoApp removed from ${browsers.length} browser(s):\n\n${browserList}` :
      `MAX Video Downloader CoApp installed for ${browsers.length} browser(s):\n\n${browserList}`;
    
    // Add scope information
    dialogText += `\n\nScope: ${scope}`;

    const command = getLinuxModalCommand(wasUninstall ? 'info' : 'question', dialogText, 'MAX Video Downloader CoApp');

    if (!command) {
      // Fallback to console output if no GUI tool available
      console.log(dialogText);
      resolve();
      return;
    }

    const child = spawn(command.cmd, command.args, { stdio: 'ignore' });

    child.on('error', (err) => {
      console.warn(`Warning: Could not show dialog: ${err.message}`);
      resolve();
    });

    child.on('close', (code) => {
      if (wasUninstall) {
        resolve();
      } else {
        if (code === 0 && !fromDialog) {
          // OK clicked
          resolve();
        } else if (code !== 0 && !fromDialog) {
          // Cancel/Uninstall clicked
          console.log('Uninstalling MAX Video Downloader CoApp...');
          uninstall(true).then(() => resolve()).catch(err => {
            console.error('Uninstall error:', err);
            resolve();
          });
        } else {
          resolve();
        }
      }
    });
  });
}

module.exports = {
  install,
  uninstall,
  getBrowsers
};