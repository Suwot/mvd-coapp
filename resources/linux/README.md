# MAX Video Downloader - Linux CoApp

Companion application for the MAX Video Downloader browser extension.

This is NOT a standalone app - it only works with the browser extension. It handles video processing and file operations that browser extensions cannot perform due to security restrictions.

## Requirements

Install the browser extension first:  
[Chrome Web Store](https://chromewebstore.google.com/detail/max-video-downloader-%E2%80%93-do/kjinbaahkmjgkkedfdgpkkelehofieke?utm_source=linux-tar&utm_medium=readme)

## Installation

### Option 1: Manual
1. Extract this archive to any directory (e.g., `~/mvdcoapp`)
2. Run `./mvdcoapp -install` to register with your browsers
3. Done! The extension will connect automatically

### Option 2: Auto-Install
Run this command in your terminal for automatic setup:

```bash
curl -sSLf https://github.com/Suwot/mvd-coapp/releases/latest/download/install.sh | bash
```

This will download the latest version, install it to `~/.local/share/mvdcoapp`, and register with your browsers.

## Commands

- `./mvdcoapp -install` - Register with browsers
- `./mvdcoapp -uninstall` - Remove from browsers
- `./mvdcoapp -version` - Show version info

## Browser Support

Works with Chromium-based browsers: Chrome, Edge, Brave, Opera, Vivaldi, Arc, etc.  
Firefox support coming soon.

## Troubleshooting

- **Permission denied**: Run `chmod +x mvdcoapp` to make executable
- **Browser not detected**: Restart browser after installation
- **Flatpak Firefox**: May need additional setup due to sandboxing

## Links

- [Source Code](https://github.com/Suwot/mvd-coapp)
- [Website](https://www.maxvideodownloader.pro/)