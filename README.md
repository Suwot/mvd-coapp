# MAX Video Downloader – CoApp

Companion application for the MAX Video Downloader browser extension. Solo-developed and maintained to outperform all current market alternatives.

- Downloads both HLS and DASH streams 
- Records live streams
- Extracts audio / subs from source
- Muxes multiple tracks into one file
- Handles encrypted streams (non-DRM)
- 100% local processing, no payments, accounts or whatever

You'll love it.

---

## Installation

### Step 1: Install Browser Extension

<table>
<tr>
<td align="center" width="200">
<img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/chrome/chrome_48x48.png" width="48" height="48" alt="Chrome"><br>
<strong>Chrome Web Store</strong><br>
<a href="https://chromewebstore.google.com/detail/max-video-downloader-%E2%80%93-do/kjinbaahkmjgkkedfdgpkkelehofieke?utm_source=github&utm_medium=readme">
<img src="https://img.shields.io/badge/INSTALL_NOW-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Install">
</a>
</td>
<td align="center" width="200">
<img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/edge/edge_48x48.png" width="48" height="48" alt="Edge"><br>
<strong>Edge Add-ons</strong><br>
<img src="https://img.shields.io/badge/COMING_SOON-cccccc?style=for-the-badge&logo=microsoft-edge&logoColor=999999" alt="Coming Soon">
</td>
<td align="center" width="200">
<img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/firefox/firefox_48x48.png" width="48" height="48" alt="Firefox"><br>
<strong>Firefox Add-ons</strong><br>
<img src="https://img.shields.io/badge/COMING_SOON-cccccc?style=for-the-badge&logo=firefox&logoColor=999999" alt="Coming Soon">
</td>
</tr>
</table>

### Step 2: Install CoApp

#### macOS
*   **Apple Silicon (M1-M4)**: [Download DMG](https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-mac-arm64.dmg) — macOS 11+
*   **Intel x64**: [Download DMG](https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-mac-x64.dmg) — macOS 10.15+
*   **Legacy Intel**: [Download DMG](https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-mac10-x64.dmg) — macOS 10.10+

**Run this command in Terminal after moving the app to Applications:**
```bash
xattr -dr com.apple.quarantine "/Applications/mvdcoapp.app" && open "/Applications/mvdcoapp.app"
```

#### Windows
*   **Windows x64**: [Download Installer](https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-win-x64.exe) — Windows 10+
*   **Windows ARM64**: [Download Installer](https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-win-arm64.exe) — Windows 10+
*   **Windows 7**: [Download Installer](https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-win7-x64.exe) — Windows 7 SP1+

#### Linux
**Either one-liner installation:**
```bash
curl -sSLf https://github.com/Suwot/mvd-coapp/releases/latest/download/install.sh | bash
```
**Or manual packages:**
*   **Linux x64**: [Download TAR.GZ](https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-linux-x64.tar.gz) — glibc 2.17+
*   **Linux ARM64**: [Download TAR.GZ](https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-linux-arm64.tar.gz) — glibc 2.28+

---

## For Developers

The CoApp is a Node.js-based native messaging host bundled with static FFmpeg and custom C++ helpers for optimized filesystem operations.

### Build Commands
The `build-coapp.sh` script manages the lifecycle across 8 targets.

```bash
./build-coapp.sh build <target|all>
./build-coapp.sh dist <target|all>
./build-coapp.sh publish
```

**Supported Targets:**
`win-x64`, `win-arm64`, `win7-x64`, `mac-x64`, `mac-arm64`, `mac10-x64`, `linux-x64`, `linux-arm64`

### Technical Stack
*   **Bundling**: ESBuild for transpilation and minification.
*   **Packaging**: @yao-pkg/pkg for creating single-file binaries.
*   **Helpers**: C++ binaries for sub-millisecond disk space probing (`mvd-diskspace`) and native Windows file dialogs (`mvd-fileui`).
*   **FFmpeg**: Static builds bundled for each platform to ensure zero-dependency operation.

Funnel designed for building from macOS on ARM with full cross-platform parity.

---

## License
Copyright (c) 2025 Rostislav Alyaev

Licensed under the GNU General Public License v3.0 (GPL-3.0-only).
See LICENSE for details.