# MAX Video Downloader – Linux CoApp
Solo-developed companion app for the MAX Video Downloader browser extension.

## Requirements
Install the browser extension first:  
- Chrome Web Store: https://chromewebstore.google.com/detail/max-video-downloader-%E2%80%93-do/kjinbaahkmjgkkedfdgpkkelehofieke?utm_source=linux-tar&utm_medium=readme

- Works with all Chromium-based browsers (Chrome, Edge, Brave, etc.)
- glibc 2.17+ (x64) or glibc 2.28+ (ARM64)

## Installation

### Option 1: Full setup with one-liner (Recommended)
Run this command in your terminal for automatic setup:
```
curl -sSLf https://github.com/Suwot/mvd-coapp/releases/latest/download/install.sh | bash
```

### Option 2: Manual Installation
1. Extract this archive into a permanent directory (e.g., `~/.local/share/mvdcoapp`).
2. Double click mvdcoapp or run `./mvdcoapp --install` from the terminal.
3. It's ready. Make sure browser extension is installed.

## Commands
- `./mvdcoapp --help` - Show list of available commands
- `./mvdcoapp --info` - Show system info
- `./mvdcoapp --install` - Register with browsers
- `./mvdcoapp --uninstall` - Remove from browsers
- `./mvdcoapp --version` - Show version info

## Troubleshooting
- **Permission denied:** Run `chmod +x mvdcoapp` to make it executable.
- **Sandboxing:** Snap/Flatpak browsers are partially supported due to native messaging restrictions. Report on GitHub if your setup is not working.

## Links
- Source Code: https://github.com/Suwot/mvd-coapp
- Website: https://www.maxvideodownloader.pro/?utm_source=linux-tar&utm_medium=readme

## License
GPL v3 (GPL-3.0-only) - Free and Open Source. Attribution required.