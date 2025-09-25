/**
 * CoApp Installer
 * Handles installation and removal of native messaging manifests across browsers
 * Replaces install.sh and uninstall.sh with cross-platform Node.js implementation
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');

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
    {cmd: 'google-chrome', path: '~/.config/google-chrome/NativeMessagingHosts', type: 'chrome', name: 'Google Chrome'},
    {cmd: 'google-chrome-beta', path: '~/.config/google-chrome-beta/NativeMessagingHosts', type: 'chrome', name: 'Google Chrome Beta'},
    {cmd: 'google-chrome-unstable', path: '~/.config/google-chrome-unstable/NativeMessagingHosts', type: 'chrome', name: 'Google Chrome Dev'},
    {cmd: 'chromium-browser', path: '~/.config/chromium/NativeMessagingHosts', type: 'chrome', name: 'Chromium'},
    {cmd: 'microsoft-edge', path: '~/.config/microsoft-edge/NativeMessagingHosts', type: 'chrome', name: 'Microsoft Edge'},
    {cmd: 'microsoft-edge-beta', path: '~/.config/microsoft-edge-beta/NativeMessagingHosts', type: 'chrome', name: 'Microsoft Edge Beta'},
    {cmd: 'microsoft-edge-dev', path: '~/.config/microsoft-edge-dev/NativeMessagingHosts', type: 'chrome', name: 'Microsoft Edge Dev'},
    {cmd: 'brave-browser', path: '~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts', type: 'chrome', name: 'Brave Browser'},
    {cmd: 'opera', path: '~/.config/opera/NativeMessagingHosts', type: 'chrome', name: 'Opera'},
    {cmd: 'vivaldi', path: '~/.config/vivaldi/NativeMessagingHosts', type: 'chrome', name: 'Vivaldi'},
    {cmd: 'yandex-browser', path: '~/.config/yandex-browser/NativeMessagingHosts', type: 'chrome', name: 'Yandex Browser'},
    {cmd: 'firefox', path: '~/.mozilla/native-messaging-hosts', type: 'firefox', name: 'Firefox'}
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
 * Check if command exists (Linux)
 */
function commandExists(command) {
  return new Promise((resolve) => {
    const child = spawn('which', [command], { stdio: 'ignore' });
    child.on('close', (code) => {
      resolve(code === 0);
    });
  });
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
      // Check for command availability
      isInstalled = await commandExists(browser.cmd);
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
  console.log('MAX Video Downloader CoApp Installer');
  console.log('==========================================');
  console.log(`Installing from: ${process.execPath}`);
  console.log('');

  const browsers = await detectBrowsers();
  const installed = [];
  const failed = [];

  if (browsers.length === 0) {
    console.log('No supported browsers found.');
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
    console.log('');
    console.log('Installation failed - no browsers detected');
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
      
      console.log(`✓ Installed for ${browser.name}`);
      installed.push(browser);
    } catch (err) {
      console.log(`✗ Failed to install for ${browser.name}: ${err.message}`);
      failed.push({ ...browser, error: err.message });
    }
  }

  console.log('');
  if (installed.length > 0) {
    console.log('Installation complete!');
    console.log(`Installed for ${installed.length} browser(s):`);
    for (const browser of installed) {
      console.log(`  • ${browser.name}`);
    }
    console.log('');
    console.log('The MAX Video Downloader extension should now work.');
    
    // Show GUI dialog on macOS and wait for user response
    if (os.platform() === 'darwin') {
      await showMacOSDialog(installed, false);
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
  console.log('MAX Video Downloader CoApp Uninstaller');
  console.log('============================================');
  console.log('');

  const browsers = await detectBrowsers();
  const removed = [];

  for (const browser of browsers) {
    try {
      const manifestPath = path.join(browser.manifestPath, MANIFEST_NAME);
      
      if (await exists(manifestPath)) {
        await fs.unlink(manifestPath);
        console.log(`✓ Removed from ${browser.name}`);
        removed.push(browser);
      }
    } catch (err) {
      // Ignore removal errors - file might not exist
    }
  }

  console.log('');
  if (removed.length === 0) {
    console.log('No installations found to remove.');
  } else {
    console.log('Uninstallation complete!');
    console.log(`Removed from ${removed.length} browser(s):`);
    for (const browser of removed) {
      console.log(`  • ${browser.name}`);
    }
    
    // Show GUI dialog on macOS
    if (os.platform() === 'darwin') {
      await showMacOSDialog(removed, true);
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
      const dialogText = `MAX Video Downloader removed from ${browsers.length} browser(s):\\n\\n${browserList}`;
      spawn('osascript', ['-e', `display dialog "${dialogText}" buttons {"OK"} default button "OK"`], { stdio: 'ignore' });
      resolve();
    } else {
      const dialogText = `MAX Video Downloader installed for ${browsers.length} browser(s):\\n\\n${browserList}`;
      
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
          console.log('Installation confirmed. The extension should now work.');
          resolve();
        } else {
          // User clicked Uninstall (or dialog was cancelled)
          console.log('Uninstalling MAX Video Downloader...');
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

module.exports = {
  install,
  uninstall,
  detectBrowsers
};