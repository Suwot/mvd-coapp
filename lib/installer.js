/**
 * CoApp Installer
 * Handles installation and removal of native messaging manifests across browsers
 * Replaces install.sh and uninstall.sh with cross-platform Node.js implementation
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { getLinuxModalCommand } = require('./linux-dialog');

const MANIFEST_NAME = 'pro.maxvideodownloader.coapp.json';

// Browser detection matrix
const BROWSERS = {
  darwin: [
    {app: '/Applications/Google Chrome.app', path: '~/Library/Application Support/Google/Chrome/NativeMessagingHosts', type: 'chrome', name: 'Google Chrome'},
    {app: '/Applications/Google Chrome Canary.app', path: '~/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts', type: 'chrome', name: 'Google Chrome Canary'},
    {app: '/Applications/Arc.app', path: '~/Library/Application Support/Arc/User Data/NativeMessagingHosts', type: 'chrome', name: 'Arc'},
    {app: '/Applications/Microsoft Edge.app', path: '~/Library/Application Support/Microsoft Edge/NativeMessagingHosts', type: 'chrome', name: 'Microsoft Edge'},
    {app: '/Applications/Microsoft Edge Beta.app', path: '~/Library/Application Support/Microsoft Edge Beta/NativeMessagingHosts', type: 'chrome', name: 'Microsoft Edge Beta'},
    {app: '/Applications/Microsoft Edge Dev.app', path: '~/Library/Application Support/Microsoft Edge Dev/NativeMessagingHosts', type: 'chrome', name: 'Microsoft Edge Dev'},
    {app: '/Applications/Microsoft Edge Canary.app', path: '~/Library/Application Support/Microsoft Edge Canary/NativeMessagingHosts', type: 'chrome', name: 'Microsoft Edge Canary'},
    {app: '/Applications/Brave Browser.app', path: '~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts', type: 'chrome', name: 'Brave Browser'},
    {app: '/Applications/Opera.app', path: '~/Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts', type: 'chrome', name: 'Opera'},
    {app: '/Applications/Vivaldi.app', path: '~/Library/Application Support/Vivaldi/NativeMessagingHosts', type: 'chrome', name: 'Vivaldi'},
    {app: '/Applications/Epic Privacy Browser.app', path: '~/Library/Application Support/Epic Privacy Browser/NativeMessagingHosts', type: 'chrome', name: 'Epic Privacy Browser'},
    {app: '/Applications/Yandex.app', path: '~/Library/Application Support/Yandex/YandexBrowser/NativeMessagingHosts', type: 'chrome', name: 'Yandex Browser'},
    {app: '/Applications/Firefox.app', path: '~/Library/Application Support/Mozilla/NativeMessagingHosts', type: 'firefox', name: 'Firefox'},
    {app: '/Applications/Tor Browser.app', path: '~/Library/Application Support/TorBrowser-Data/Browser/NativeMessagingHosts', type: 'firefox', name: 'Tor Browser'}
  ],
  linux: [
    {path: '~/.config/google-chrome/NativeMessagingHosts/', configDir: '~/.config/google-chrome/', type: 'chrome', name: 'Google Chrome'},
    {path: '~/.config/google-chrome-beta/NativeMessagingHosts/', configDir: '~/.config/google-chrome-beta/', type: 'chrome', name: 'Google Chrome Beta'},
    {path: '~/.config/google-chrome-unstable/NativeMessagingHosts/', configDir: '~/.config/google-chrome-unstable/', type: 'chrome', name: 'Google Chrome Dev'},
    {path: '~/.config/chromium/NativeMessagingHosts/', configDir: '~/.config/chromium/', type: 'chrome', name: 'Chromium'},
    {path: '~/.config/microsoft-edge/NativeMessagingHosts', configDir: '~/.config/microsoft-edge/', type: 'chrome', name: 'Microsoft Edge'},
    {path: '~/.config/microsoft-edge-beta/NativeMessagingHosts', configDir: '~/.config/microsoft-edge-beta/', type: 'chrome', name: 'Microsoft Edge Beta'},
    {path: '~/.config/microsoft-edge-dev/NativeMessagingHosts', configDir: '~/.config/microsoft-edge-dev/', type: 'chrome', name: 'Microsoft Edge Dev'},
    {path: '~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts', configDir: '~/.config/BraveSoftware/', type: 'chrome', name: 'Brave Browser'},
    {path: '~/.config/opera/NativeMessagingHosts', configDir: '~/.config/opera/', type: 'chrome', name: 'Opera'},
    {path: '~/.config/vivaldi/NativeMessagingHosts', configDir: '~/.config/vivaldi/', type: 'chrome', name: 'Vivaldi'},
    {path: '~/.config/yandex-browser/NativeMessagingHosts', configDir: '~/.config/yandex-browser/', type: 'chrome', name: 'Yandex Browser'},
    {path: '~/.mozilla/native-messaging-hosts/', configDir: '~/.mozilla', type: 'firefox', name: 'Firefox'},
    {path: '~/.librewolf/native-messaging-hosts', configDir: '~/.librewolf', type: 'firefox', name: 'LibreWolf'},
    {path: '~/.var/app/org.mozilla.firefox/.mozilla/native-messaging-hosts', configDir: '~/.var/app/org.mozilla.firefox', type: 'firefox', name: 'Firefox (Flatpak)'},
    {path: '~/.config/vivaldi-snapshot/NativeMessagingHosts', configDir: '~/.config/vivaldi-snapshot/', type: 'chrome', name: 'Vivaldi Snapshot'},
    {path: '~/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser/NativeMessagingHosts', configDir: '~/.var/app/com.brave.Browser', type: 'chrome', name: 'Brave Browser (Flatpak)'},
    {path: '~/.var/app/com.google.Chrome/config/google-chrome/NativeMessagingHosts', configDir: '~/.var/app/com.google.Chrome', type: 'chrome', name: 'Google Chrome (Flatpak)'},
    {path: '~/.var/app/org.chromium.Chromium/config/chromium/NativeMessagingHosts', configDir: '~/.var/app/org.chromium.Chromium', type: 'chrome', name: 'Chromium (Flatpak)'},
    {path: '~/.var/app/com.github.Eloston.UngoogledChromium/config/chromium/NativeMessagingHosts', configDir: '~/.var/app/com.github.Eloston.UngoogledChromium', type: 'chrome', name: 'Ungoogled Chromium (Flatpak)'},
    {path: '~/.var/app/com.microsoft.Edge/config/microsoft-edge/NativeMessagingHosts', configDir: '~/.var/app/com.microsoft.Edge', type: 'chrome', name: 'Microsoft Edge (Flatpak)'}
  ]
};

/**
 * Expand tilde paths to full home directory paths
 */
function expandPath(filePath) {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
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
  const baseManifest = {
    name: 'pro.maxvideodownloader.coapp',
    description: 'MAX Video Downloader CoApp',
    path: process.execPath,
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
 * Detect installed browsers on current platform
 */
async function detectBrowsers() {
  const platform = os.platform();
  const browsers = BROWSERS[platform] || [];
  const detected = [];

  for (const browser of browsers) {
    let isInstalled = false;

    if (platform === 'darwin') {
      // Check for application bundle
      isInstalled = await exists(browser.app);
    } else if (platform === 'linux') {
      // Check for config directory existence
      isInstalled = await exists(expandPath(browser.configDir));
    }

    if (isInstalled) {
      detected.push({
        name: browser.name,
        manifestPath: expandPath(browser.path),
        type: browser.type
      });
    }
  }

  return detected;
}

/**
 * Install manifests for all detected browsers
 */
async function install() {
  console.log('====================================');
  console.log('MAX Video Downloader CoApp Installer');
  console.log('====================================');
  console.log(``);
  console.log(`Installing from: ${process.execPath}`);
  console.log('');

  const browsers = await detectBrowsers();
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
    return { installed: [], failed: browsers };
  }

  for (const browser of browsers) {
    try {
      // Create directory if it doesn't exist
      await fs.mkdir(browser.manifestPath, { recursive: true });
      
      // Create manifest content
      const manifest = createManifest(browser.type);
      const manifestPath = path.join(browser.manifestPath, MANIFEST_NAME);
      
      // Write manifest file
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      
      installed.push(browser);
    } catch (err) {
      failed.push({ ...browser, error: err.message });
    }
  }

  if (installed.length > 0) {
    console.log(`Installed for ${installed.length} browser(s):`);
    for (const browser of installed) {
      console.log(`  ✓ ${browser.name}: ${browser.manifestPath}/${MANIFEST_NAME}`);
    }
    console.log('');
    console.log('The MAX Video Downloader extension should now work.');
    
    // Show GUI dialog on macOS and wait for user response
    if (os.platform() === 'darwin') {
      await showMacOSDialog(installed, false);
    } else if (os.platform() === 'linux') {
      await showLinuxDialog(installed, false);
    }
  } else {
    console.log('Installation failed - no browsers could be configured');
  }

  return { installed, failed };
}

/**
 * Uninstall manifests from all browsers
 */
async function uninstall() {
  console.log('======================================');
  console.log('MAX Video Downloader CoApp Uninstaller');
  console.log('======================================');
  console.log('');

  const browsers = await detectBrowsers();
  const removed = [];

  for (const browser of browsers) {
    try {
      const manifestPath = path.join(browser.manifestPath, MANIFEST_NAME);
      
      if (await exists(manifestPath)) {
        await fs.unlink(manifestPath);
        removed.push(browser);
      }
    } catch (err) {
      // Ignore removal errors - file might not exist
    }
  }

  if (removed.length === 0) {
    console.log('No installations found to remove.');
  } else {
    console.log(`Removed from ${removed.length} browser(s):`);
    for (const browser of removed) {
      console.log(`  ✗ ${browser.name}: ${browser.manifestPath}/${MANIFEST_NAME}`);
    }
	console.log('');
    console.log('Uninstallation complete!');
    
    // Show GUI dialog on macOS
    if (os.platform() === 'darwin') {
      await showMacOSDialog(removed, true);
    } else if (os.platform() === 'linux') {
      await showLinuxDialog(removed, true);
    }
  }

  return { removed };
}

/**
 * Show macOS dialog with uninstall option
 */
function showMacOSDialog(browsers, wasUninstall) {
  return new Promise((resolve) => {
    if (browsers.length === 0) {
      resolve();
      return;
    }

    const browserList = browsers.map(b => `• ${b.name}`).join('\\n');
    
    if (wasUninstall) {
      const dialogText = `MAX Video Downloader CoApp removed from ${browsers.length} browser(s):\\n\\n${browserList}`;
      spawn('osascript', ['-e', `display dialog "${dialogText}" buttons {"OK"} default button "OK"`], { stdio: 'ignore' });
      resolve();
    } else {
      const dialogText = `MAX Video Downloader CoApp installed for ${browsers.length} browser(s):\\n\\n${browserList}`;
      
      // Show dialog with OK and Uninstall buttons (matching original install.sh behavior)
      console.log('Showing installation confirmation dialog...');
      
      const child = spawn('osascript', [
        '-e', 
        `tell application "System Events" to display dialog "${dialogText}" buttons {"Uninstall", "OK"} default button "OK" cancel button "Uninstall"`
      ], { stdio: 'pipe' });
      
      let output = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      child.on('close', (code) => {
        // Check both the output and exit code (matching original install.sh logic)
        if (code === 0 && output.includes('button returned:OK')) {
          // User clicked OK
          resolve();
        } else {
          // User clicked Uninstall (or dialog was cancelled)
          console.log('Uninstalling MAX Video Downloader CoApp...');
          uninstall().then(() => {
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
async function showLinuxDialog(browsers, wasUninstall) {
  return new Promise((resolve) => {
    if (browsers.length === 0) {
      resolve();
      return;
    }

    const browserList = browsers.map(b => `• ${b.name}`).join('\n');
    const dialogText = wasUninstall ?
      `MAX Video Downloader CoApp removed from ${browsers.length} browser(s):\n\n${browserList}` :
      `MAX Video Downloader CoApp installed for ${browsers.length} browser(s):\n\n${browserList}`;

    const command = getLinuxModalCommand(wasUninstall ? 'info' : 'question', dialogText, 'MAX Video Downloader CoApp');

    if (!command) {
      // Fallback to console output if no GUI tool available
      console.log(dialogText);
      resolve();
      return;
    }

    const child = spawn(command.cmd, command.args, { stdio: 'ignore' });

    child.on('close', (code) => {
      if (wasUninstall) {
        resolve();
      } else {
        if (code === 0) {
          // OK clicked
          resolve();
        } else {
          // Cancel/Uninstall clicked (or dialog failed)
          console.log('Uninstalling MAX Video Downloader CoApp...');
          uninstall().then(() => resolve()).catch(err => {
            console.error('Uninstall error:', err);
            resolve();
          });
        }
      }
    });
  });
}

module.exports = {
  install,
  uninstall,
  detectBrowsers
};