# Native Host Build Resources

Platform-specific build resources and assets for the MAX Video Downloader native host component.

## Structure

- `linux/` - Linux-specific build resources
- `mac/` - macOS-specific build resources
- `windows/` - Windows-specific build resources

## Usage

These resources are used during the build process for creating platform-specific installers and packages.

### Linux
- `postinst.ejs` - Post-installation script template
- `prerm.ejs` - Pre-removal script template

### macOS
- `AppIcon.icns` - Application icon (created from AppIcon.iconset)
- `Info.plist.ejs` - Application info plist template
- `dmg-background.tiff` - DMG installer background image
- `entitlements.plist` - Code signing entitlements
- `pkg-component.plist.ejs` - Package component plist template
- `pkg-distribution.xml.ejs` - Package distribution XML template

#### ICNS Icon Creation (Apple Standard Workflow)

**Step 1**: Create iconset folder with properly named PNGs
```bash
mkdir -p AppIcon.iconset
cp png_icons/icon_*.png AppIcon.iconset/
```

**Step 2**: Generate ICNS using Apple's iconutil
```bash
iconutil -c icns AppIcon.iconset
```

**Result**: `AppIcon.icns` (97KB) - ready for macOS app bundles

**Usage in Info.plist**:
```xml
<key>CFBundleIconFile</key>
<string>AppIcon</string>
```

**Icon Sizes Created**:
- 16×16, 16×16@2x (32×32)
- 32×32, 32×32@2x (64×64) 
- 128×128, 128×128@2x (256×256)
- 256×256, 256×256@2x (512×512)
- 512×512, 512×512@2x (1024×1024)

### Windows
- `icon.ico` - Multi-resolution icon (created from PNG icons: 16, 32, 48, 64, 128, 256px)
- `installer.nsh.ejs` - NSIS installer script template (adapted for MAX Video Downloader)

**Note**: LICENSE file is located at `../LICENSE.txt` (native_host repository root) and referenced by the NSIS script for the license agreement page.

#### NSIS Installer Configuration

**Installation Mode**: Current user only (simplified, no admin required)
- Installs to: `%LOCALAPPDATA%\CoApp`
- Registry: `HKCU` (current user registry)
- No elevation prompts or user choice dialogs

**Simplified Design**: Streamlined for current user installation without unnecessary components or checks.

#### NSIS Installer Usage

The `installer.nsh.ejs` template creates a streamlined Windows installer for CoApp:

1. **Current User Installation**: Automatically installs for current user only
2. **No Admin Required**: No UAC prompts or elevation dialogs
3. **Simple Registry**: Uses HKCU for all registrations
4. **Clean & Direct**: No unnecessary options or complications

**Installation Directory**: `%LOCALAPPDATA%\CoApp` (user's local app data)

**Registry Keys**: All stored in current user registry (HKCU)

To build the installer:
```bash
# Install NSIS (Nullsoft Scriptable Install System)
# Compile the EJS template and build with makensis
makensis installer.nsh
```

**Output naming pattern**: `mvdcoapp-{version}-win-{arch}.exe`

To build the installer:
```bash
# Install NSIS (Nullsoft Scriptable Install System)
# Compile the EJS template and build with makensis
makensis installer.nsh
```