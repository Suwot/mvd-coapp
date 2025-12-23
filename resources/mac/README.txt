MAX Video Downloader – macOS CoApp
Solo-developed desktop app for the MAX Video Downloader browser extension.

INSTALLATION:
1. Drag "mvdcoapp.app" to your Applications folder.
2. Open Terminal (Applications -> Utilities -> Terminal.app) and run:

xattr -dr com.apple.quarantine "/Applications/mvdcoapp.app" && open "/Applications/mvdcoapp.app"

*This command removes the macOS Gatekeeper quarantine flag to allow the app to run.

COMPATIBILITY:
- Apple Silicon (M1-M4): macOS 11+
- Intel: macOS 10.15+ (Legacy build available for 10.10+)
- Browsers: Chrome, Edge, Brave, Vivaldi, Arc. (Firefox: Coming Soon)

RESOURCES:
- Source Code: https://github.com/suwot/mvd-coapp
- Website: https://www.maxvideodownloader.pro/?utm_source=mac-dmg&utm_medium=readme

LICENSE:
GPL v3 (GPL-3.0-only) - Free and Open Source. Attribution required.
