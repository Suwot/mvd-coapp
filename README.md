# MAX Video Downloader - CoApp

**Companion application for MAX Video Downloader browser extension**

This repository contains the native companion app (CoApp) that enables reliable video downloading from any website. The CoApp handles video processing, format conversion, and downloads that browser extensions cannot perform due to security restrictions.

**Key features:**
- Downloads HLS (.m3u8), DASH (.mpd), and direct video files. 
– Makes LIVE recordings. 
- Extracts audio and subs from media.
- Static FFmpeg bundled inside 
- Full anonimity, 100% local processing
- Cross-platform support (macOS, Windows, Linux)
- Open source and completely FREE

**Note:** This is not a standalone application. It requires the MAX Video Downloader browser extension to function.  

## Installation

### Step 1: Install Browser Extension

<table>
<tr>
<td align="center" width="200">
<img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/chrome/chrome_48x48.png" width="48" height="48" alt="Chrome"><br>
<strong>Chrome Web Store</strong><br>
<a href="https://chromewebstore.google.com/detail/max-video-downloader-%E2%80%93-do/kjinbaahkmjgkkedfdgpkkelehofieke?utm_source=github&utm_medium=readme">
<img src="https://img.shields.io/badge/Install_Now-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Install from Chrome Web Store">
</a>
</td>
<td align="center" width="200">
<img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/edge/edge_48x48.png" width="48" height="48" alt="Edge"><br>
<strong>Edge Add-ons</strong><br>
<img src="https://img.shields.io/badge/Coming_Soon-cccccc?style=for-the-badge&logo=microsoft-edge&logoColor=999999" alt="Coming Soon">
</td>
<td align="center" width="200">
<img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/firefox/firefox_48x48.png" width="48" height="48" alt="Firefox"><br>
<strong>Firefox Add-ons</strong><br>
<img src="https://img.shields.io/badge/Coming_Soon-cccccc?style=for-the-badge&logo=firefox&logoColor=999999" alt="Coming Soon">
</td>
</tr>
</table>

### Step 2: Install CoApp

## macOS

<table>
<thead style="background-color: #f6f8fa;">
<tr>
<th>Architecture</th>
<th>Download</th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>Apple Silicon</strong> (M1-M4)</td>
<td><a href="https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-mac-arm64.dmg"><img src="https://img.shields.io/badge/Download_DMG-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Download DMG"></a></td>
</tr>
<tr>
<td><strong>Intel</strong> (x64)</td>
<td><a href="https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-mac-x64.dmg"><img src="https://img.shields.io/badge/Download_DMG-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Download DMG"></a></td>
</tr>
</tbody>
</table>

**Installation steps:**

1. **Download** the DMG for your architecture
2. **Mount** the DMG by double-clicking it
3. **Drag** `mvdcoapp.app` to your `Applications` folder
4. **Open Terminal** and run this command to bypass Gatekeeper:
   ```bash
   xattr -dr com.apple.quarantine "/Applications/mvdcoapp.app" && open "/Applications/mvdcoapp.app"
   ```
5. Upon successful installation, you'll see a confirmation window with detected browsers

## Windows

<table>
<thead style="background-color: #f6f8fa;">
<tr>
<th>Architecture</th>
<th>Download</th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>x64</strong></td>
<td><a href="https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-win-x64.exe"><img src="https://img.shields.io/badge/Download_EXE-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Download EXE"></a></td>
</tr>
<tr>
<td><strong>ARM64</strong></td>
<td><img src="https://img.shields.io/badge/Coming_Soon-cccccc?style=for-the-badge&logo=windows&logoColor=999999" alt="Coming Soon"></td>
</tr>
</tbody>
</table>

**Installation steps:**

1. **Download** and **double-click** the installer
2. If SmartScreen appears, click **More info → Run anyway**
3. **Follow** the setup wizard → **Install** → **Finish**

**Verification:** Open the extension popup → Settings, you should see `CoApp: Connected`. If not, click on 'retry' button to revalidate connection.

## Linux

**One-liner installation (recommended):**
```bash
curl -sSLf https://github.com/Suwot/mvd-coapp/releases/latest/download/install.sh | bash
```

**Manual installation:**

<table>
<thead style="background-color: #f6f8fa;">
<tr>
<th>Architecture</th>
<th>Download</th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>x64</strong></td>
<td><a href="https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-linux-x64.tar.gz"><img src="https://img.shields.io/badge/Download_TAR.GZ-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Download TAR.GZ"></a></td>
</tr>
<tr>
<td><strong>ARM64</strong></td>
<td><a href="https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-linux-arm64.tar.gz"><img src="https://img.shields.io/badge/Download_TAR.GZ-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Download TAR.GZ"></a></td>
</tr>
</tbody>
</table>

```bash
tar -xzf mvdcoapp-linux-*.tar.gz
cd mvdcoapp-linux-*
./mvdcoapp -install
```

**Available commands:**
- `./mvdcoapp -install` - Register with browsers
- `./mvdcoapp -uninstall` - Remove from browsers  
- `./mvdcoapp -version` - Show version info

---

**That's it!** Restart your browser and the extension will automatically connect to CoApp. No configuration needed.

## For Developers

All existing logic expects you to build on mac arm64. 

### Prerequisites

- **Node.js 18+** - heart of the coapp
- **FFmpeg static binaries** - precompile and place them in `bin/` before building as ffmpeg / ffprobe (adding .exe for win builds)
- **pkg** - packaging with cross-platform targets (`npm install -g pkg`)

### Building

**Build for current platform:**
```bash
./build-coapp.sh build
```

**Build for specific platform:**
```bash
./build-coapp.sh build mac-arm64
./build-coapp.sh build win-x64
./build-coapp.sh build linux-x64
```

**Create distribution packages:**
```bash
./build-coapp.sh dist mac-arm64  # Creates DMG installer
./build-coapp.sh dist win-x64    # Creates NSIS installer
./build-coapp.sh dist linux-x64  # Creates tar.gz with install script
```

**Local installation for testing:**
```bash
./build/mac-arm64/mvdcoapp -install
```

### Testing

**Docker testing for Linux platforms:**
```bash
# Linux x64
docker run --rm --platform=linux/amd64 \
  -v "$(pwd)/resources/linux/install.sh":/install.sh:ro \
  linux-base bash -lc "useradd -m testuser && su - testuser -c '/install.sh'"

# Linux ARM64
docker run --rm --platform=linux/arm64/v8 \
  -v "$(pwd)/resources/linux/install.sh":/install.sh:ro \
  linux-base-arm64 bash -lc "useradd -m testuser && su - testuser -c '/install.sh'"
```

## License

MIT License - Free to use, modify, and distribute.