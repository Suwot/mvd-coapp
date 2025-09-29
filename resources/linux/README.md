# MAX Video Downloader - CoApp (Linux)

Companion application for MAX Video Downloader browser extension.

This is the Linux version of the companion app (CoApp) for MAX Video Downloader.
This is NOT a standalone application - it only works as a companion to the browser extension.

## Installation

### Option 1: One-line install (Recommended)

Run this command in your terminal:

curl -sSLf https://github.com/Suwot/mvd-coapp/releases/latest/download/install.sh | bash

This will automatically:
- Download the latest version for your architecture (x64 or ARM64)
- Extract it directly to ~/.local/share/mvdcoapp (backing up any existing installation)
- Register the CoApp with your browsers
- Set up necessary permissions

### Option 2: System-wide installation

For system-wide installation (available to all users):

curl -sSLf https://github.com/Suwot/mvd-coapp/releases/latest/download/install.sh | bash -s -- --system

This installs directly to /opt/mvdcoapp.

### Option 3: Manual installation

1. Download the appropriate tarball for your architecture:
   - mvdcoapp-linux-x64.tar.gz for x86_64 systems
   - mvdcoapp-linux-arm64.tar.gz for ARM64 systems

2. Extract and install:
   mkdir -p ~/.local/share
   tar -xzf mvdcoapp-linux-*.tar.gz -C ~/.local/share/
   # This extracts directly to ~/.local/share/mvdcoapp

3. Register with your browsers:
   ~/.local/share/mvdcoapp/mvdcoapp install

## What it does

The CoApp handles video processing and file operations that browser extensions cannot perform due to security restrictions. It provides:

- Video stream analysis and quality detection
- HLS (.m3u8) and DASH (.mpd) manifest processing
- FFmpeg-powered video/audio downloading and conversion
- Cross-platform file system operations
- Progress tracking and error handling

## Browser Support

Works with Chromium-based browsers that support native messaging:
- Google Chrome
- Microsoft Edge
- Brave
- Opera
- Vivaldi
- Arc
- Comet
- Firefox (with WebExtensions)

## Browser Extension

Install the browser extension to use this CoApp:

Chrome Web Store:
https://chromewebstore.google.com/detail/max-video-downloader-%E2%80%93-do/kjinbaahkmjgkkedfdgpkkelehofieke?utm_source=linux-coapp-readme

Firefox Add-ons: Coming Soon
Edge Add-ons: Coming Soon

## Uninstallation

To uninstall the CoApp:

~/.local/share/mvdcoapp/mvdcoapp uninstall
rm -rf ~/.local/share/mvdcoapp

# For system-wide installation:
# sudo /opt/mvdcoapp/mvdcoapp uninstall
# sudo rm -rf /opt/mvdcoapp

## Requirements

- Linux (x86_64 or ARM64)
- curl (for automatic installation)
- FFmpeg (included in the distribution)

## Troubleshooting

### Permission issues
If you encounter permission errors, make sure the CoApp binary is executable:
chmod +x ~/.local/share/mvdcoapp/mvdcoapp

### Browser not detected
Try restarting your browser after installation. The CoApp registers itself with browsers during installation.

### Flatpak browsers
If you're using Flatpak versions of browsers (like Flatpak Firefox), you may need additional manual configuration due to sandboxing restrictions. The CoApp will be installed but may require special setup to work with Flatpak applications.

For Flatpak Firefox, you can try:
flatpak override --user --filesystem=~/.mozilla/native-messaging-hosts org.mozilla.firefox

## Source Code

Source code: https://github.com/Suwot/mvd-coapp
Website: https://www.maxvideodownloader.pro/