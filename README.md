# MAX Video Downloader - CoApp

**Companion application for MAX Video Downloader browser extension**

Cross-platform video processing engine with FFmpeg integration for downloading HLS, DASH, and direct media files. Currently available for macOS (Intel and Apple Silicon) and Windows (x64, also works on ARM), with Linux and Windows ARM64 support coming soon.

## Files

- `LICENSE.txt` - Project license (used by Windows installer)
- `package.json` - Node.js package configuration
- `build-coapp.sh` - Cross-platform build script
- `resources/` - Platform-specific build resources and assets

## Overview

This is the companion app (CoApp) component of MAX Video Downloader. This is not a standalone application - it only works as a companion to the browser extension and has no user interface of its own.

The CoApp handles video processing, format conversion, and file system operations that cannot be performed directly by browser extensions due to security restrictions.

It communicates with the browser extension through Chrome's native messaging API and provides:

- Video stream analysis and quality detection
- HLS (.m3u8) and DASH (.mpd) manifest processing  
- FFmpeg-powered video/audio downloading and conversion
- Cross-platform file system operations
- Progress tracking and error handling

## Browser Extension

Install the browser extension to use this CoApp:

<table>
<tr>
<td align="center" width="200">
<img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/chrome/chrome_48x48.png" width="48" height="48" alt="Chrome"><br>
<strong>Chrome Web Store</strong><br>
<a href="https://chromewebstore.google.com/detail/max-video-downloader-%E2%80%93-do/kjinbaahkmjgkkedfdgpkkelehofieke?utm_campaign=readme-btn&utm_medium=button&utm_source=github">
<img src="https://img.shields.io/badge/Install-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Install from Chrome Web Store">
</a>
</td>
<td align="center" width="200">
<img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/firefox/firefox_48x48.png" width="48" height="48" alt="Firefox"><br>
<strong>Firefox Add-ons</strong><br>
<img src="https://img.shields.io/badge/Coming_Soon-cccccc?style=for-the-badge&logo=firefox&logoColor=999999" alt="Coming Soon">
</td>
<td align="center" width="200">
<img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/edge/edge_48x48.png" width="48" height="48" alt="Edge"><br>
<strong>Edge Add-ons</strong><br>
<img src="https://img.shields.io/badge/Coming_Soon-cccccc?style=for-the-badge&logo=microsoft-edge&logoColor=999999" alt="Coming Soon">
</td>
</tr>
</table>

## Downloads

Download the CoApp for your platform:

| Platform | Architecture | Download |
|----------|-------------|----------|
| **macOS** | Apple Silicon (M1-M4) | [![Download DMG](https://img.shields.io/badge/Download_DMG-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-mac-arm64.dmg) |
| **macOS** | Intel (x64) | [![Download DMG](https://img.shields.io/badge/Download_DMG-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-mac-x64.dmg) |
| **Windows** | x64 | [![Download EXE](https://img.shields.io/badge/Download_EXE-0078D4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-win-x64.exe) |
| **Windows** | ARM64 | ![Coming Soon](https://img.shields.io/badge/Coming_Soon-cccccc?style=for-the-badge&logo=windows&logoColor=999999) |
| **Linux** | x64 | ![Coming Soon](https://img.shields.io/badge/Coming_Soon-cccccc?style=for-the-badge&logo=linux&logoColor=999999) |
| **Linux** | ARM64 | ![Coming Soon](https://img.shields.io/badge/Coming_Soon-cccccc?style=for-the-badge&logo=linux&logoColor=999999) |

## Installation

1. **Download** the appropriate CoApp for your platform
2. **Install** the CoApp (automatic browser registration included)
3. **Install** the browser extension from your browser's web store
4. **Restart** your browser to complete the setup

The CoApp automatically registers itself with all supported browsers during installation.

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

The CoApp supports these commands from the browser extension:

- `download` - Video/audio download with progress tracking
- `get-qualities` - Stream quality analysis and metadata extraction  
- `generate-preview` - Thumbnail generation from video URLs
- `validate-connection` - Connection validation and host information
- `file-system` - Cross-platform file operations and dialogs

## Development

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

# Install system-wide (after building)
./build/mac-arm64/mvdcoapp -install

# Uninstall
./build/mac-arm64/mvdcoapp -uninstall

# Double-click installation
./build/mac-arm64/mvdcoapp
```

## Testing

# linux-x64 via Docker:
```
docker run --rm --platform=linux/amd64 \
  -v "$(pwd)/resources/linux/install.sh":/install.sh:ro \
  linux-base bash -lc "useradd -m testuser && su - testuser -c '/install.sh'"
```

# linux-arm64 via Docker:
```
docker run --rm --platform=linux/arm64/v8 \
  -v "$(pwd)/resources/linux/install.sh":/install.sh:ro \
  linux-base-arm64 bash -lc "useradd -m testuser && su - testuser -c '/install.sh'"
```

## License

MIT License