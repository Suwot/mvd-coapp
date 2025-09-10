# MAX Video Downloader - Native Host

<div align="center">

**Native companion application for MAX Video Downloader browser extension**

Cross-platform video processing engine with FFmpeg integration for downloading HLS, DASH, and direct media files.

</div>

## Overview

This is the native messaging host component of MAX Video Downloader. It handles video processing, format conversion, and file system operations that cannot be performed directly by browser extensions due to security restrictions.

The native host communicates with the browser extension through Chrome's native messaging API and provides:

- Video stream analysis and quality detection
- HLS (.m3u8) and DASH (.mpd) manifest processing  
- FFmpeg-powered video/audio downloading and conversion
- Cross-platform file system operations
- Progress tracking and error handling

## Browser Extension

Install the browser extension to use this native host:

<div align="center">

<table>
<tr>
<td align="center" width="200">
<img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/chrome/chrome_48x48.png" width="48" height="48" alt="Chrome"><br>
<strong>Chrome Web Store</strong><br>
<a href="https://chrome.google.com/webstore/detail/dummy-extension-id">
<img src="https://img.shields.io/badge/Install-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Install from Chrome Web Store">
</a>
</td>
<td align="center" width="200">
<img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/firefox/firefox_48x48.png" width="48" height="48" alt="Firefox"><br>
<strong>Firefox Add-ons</strong><br>
<img src="https://img.shields.io/badge/Coming_Soon-FF7139?style=for-the-badge&logo=firefox&logoColor=white" alt="Coming Soon">
<br><small><em>Coming Soon</em></small>
</td>
<td align="center" width="200">
<img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/edge/edge_48x48.png" width="48" height="48" alt="Edge"><br>
<strong>Edge Add-ons</strong><br>
<img src="https://img.shields.io/badge/Coming_Soon-0078D4?style=for-the-badge&logo=microsoft-edge&logoColor=white" alt="Coming Soon">
<br><small><em>Coming Soon</em></small>
</td>
</tr>
</table>

</div>

## Downloads

Download the native host for your platform:

### macOS

<div align="center">

| Architecture | Download | Status |
|--------------|----------|--------|
| **Apple Silicon (M1/M2/M3)** | <a href="https://github.com/Suwot/mvd-coapp/releases/latest/download/MaxVideoDownloader-mac-arm64.dmg"><img src="https://img.shields.io/badge/Download_DMG-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Download for macOS ARM64"></a> | ✅ Available |
| **Intel (x64)** | <img src="https://img.shields.io/badge/Coming_Soon-6C6C6C?style=for-the-badge&logo=apple&logoColor=white" alt="Coming Soon"> | 🔄 Coming Soon |

</div>

### Windows

<div align="center">

| Architecture | Download | Status |
|--------------|----------|--------|
| **x64** | <img src="https://img.shields.io/badge/Coming_Soon-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Coming Soon"> | 🔄 Coming Soon |
| **ARM64** | <img src="https://img.shields.io/badge/Coming_Soon-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Coming Soon"> | 🔄 Coming Soon |

</div>

### Linux

<div align="center">

| Architecture | Download | Status |
|--------------|----------|--------|
| **x64** | <img src="https://img.shields.io/badge/Coming_Soon-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Coming Soon"> | 🔄 Coming Soon |
| **ARM64** | <img src="https://img.shields.io/badge/Coming_Soon-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Coming Soon"> | 🔄 Coming Soon |

</div>

## Installation

1. **Download** the appropriate native host for your platform
2. **Install** the native host (automatic browser registration included)
3. **Install** the browser extension from your browser's web store
4. **Restart** your browser to complete the setup

The native host automatically registers itself with all supported browsers during installation.

## Supported Browsers

- **Chrome** (Stable, Beta, Dev, Canary)
- **Chromium-based browsers** (Arc, Edge, Brave, Opera, Vivaldi, Epic, Yandex)
- **Firefox** (coming soon)

## Technical Architecture

- **Language:** Node.js with native binary packaging
- **Video Processing:** Bundled FFmpeg and FFprobe binaries
- **Communication:** Chrome Native Messaging API
- **Packaging:** Self-contained executables with automatic installation
- **Cross-Platform:** Single codebase with platform-specific builds

## Commands

The native host supports these commands from the browser extension:

- `download` - Video/audio download with progress tracking
- `get-qualities` - Stream quality analysis and metadata extraction  
- `generate-preview` - Thumbnail generation from video URLs
- `validate-connection` - Connection validation and host information
- `file-system` - Cross-platform file operations and dialogs

## Development

This repository is part of the [MAX Video Downloader](https://github.com/Suwot/max-video-downloader) project.

### Build Requirements

- Node.js 18+
- Platform-specific FFmpeg binaries (included)
- pkg for binary packaging

### Build Commands

```bash
# Build for current platform
./build-coapp.sh build

# Build for specific platform  
./build-coapp.sh build mac-arm64

# Create distribution package
./build-coapp.sh dist mac-arm64

# Install system-wide
./install.sh

# Uninstall
./uninstall.sh
```

## License

MIT License - see [LICENSE](../LICENSE) file for details.

## Support

For issues and support, please visit the [main project repository](https://github.com/Suwot/max-video-downloader).