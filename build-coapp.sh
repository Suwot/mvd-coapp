#!/bin/bash

# MAX Video Downloader Native Host Build System
# Creates self-contained installers for all platforms

set -e

VERSION=$(node -p "require('../package.json').version")
APP_NAME="pro.maxvideodownloader.coapp"
CHROME_EXT_ID_DEV="bkblnddclhmmgjlmbofhakhhbklkcofd"
CHROME_EXT_ID_PROD="kjinbaahkmjgkkedfdgpkkelehofieke"
FIREFOX_EXT_ID="max-video-downloader@rostislav.dev"

# ============================================================================
# UTILITIES
# ============================================================================

log_info() { echo -e "\033[32m[INFO]\033[0m $1"; }
log_warn() { echo -e "\033[33m[WARN]\033[0m $1"; }
log_error() { echo -e "\033[31m[ERROR]\033[0m $1"; }

detect_platform() {
    case "$(uname -s)" in
        Darwin)
            case "$(uname -m)" in
                arm64) echo "mac-arm64" ;;
                x86_64) echo "mac-x64" ;;
                *) log_error "Unsupported macOS architecture"; exit 1 ;;
            esac ;;
        MINGW*|CYGWIN*|MSYS*|Windows_NT)
            case "$(uname -m)" in
                x86_64) echo "win-x64" ;;
                aarch64) echo "win-arm64" ;;
                *) log_error "Unsupported Windows architecture"; exit 1 ;;
            esac ;;
        Linux)
            case "$(uname -m)" in
                x86_64) echo "linux-x64" ;;
                aarch64) echo "linux-arm64" ;;
                *) log_error "Unsupported Linux architecture"; exit 1 ;;
            esac ;;
        *) log_error "Unsupported OS"; exit 1 ;;
    esac
}

get_pkg_target() {
    case "$1" in
        mac-arm64) echo "node18-macos-arm64" ;;
        mac-x64) echo "node18-macos-x64" ;;
        win-x64) echo "node18-win-x64" ;;
        win-arm64) echo "node18-win-arm64" ;;
        linux-x64) echo "node18-linux-x64" ;;
        linux-arm64) echo "node18-linux-arm64" ;;
        *) echo "" ;;
    esac
}

get_binary_name() {
    case "$1" in
        win-*) echo "mvdcoapp.exe" ;;
        *) echo "mvdcoapp" ;;
    esac
}

# ============================================================================
# BUILD FUNCTIONS
# ============================================================================

build_binary() {
    local platform=$1
    local pkg_target=$(get_pkg_target "$platform")
    local binary_name=$(get_binary_name "$platform")
    local build_dir="build/$platform"
    
    [[ -z "$pkg_target" ]] && { log_error "Unsupported platform: $platform"; exit 1; }
    
    log_info "Building binary for $platform..."
    mkdir -p "$build_dir"
    
    # Build native host binary with version
    APP_VERSION="$VERSION" npx pkg index.js --target "$pkg_target" --output "$build_dir/$binary_name"
    
    # Make binary executable (important for double-click functionality)
    chmod +x "$build_dir/$binary_name"
    
    # Copy FFmpeg binaries
    local ffmpeg_source="bin/$platform"
    if [[ -d "$ffmpeg_source" ]]; then
        cp "$ffmpeg_source"/* "$build_dir/"
        log_info "Copied FFmpeg binaries from $ffmpeg_source"
    else
        log_warn "FFmpeg binaries not found at $ffmpeg_source"
    fi
    
    # Copy install and uninstall scripts
    cp install.sh "$build_dir/"
    cp uninstall.sh "$build_dir/"
    chmod +x "$build_dir/install.sh"
    chmod +x "$build_dir/uninstall.sh"
    log_info "Copied install and uninstall scripts"
    
    log_info "✓ Binary built: $build_dir/$binary_name"
}

# ============================================================================
# INSTALLER TEMPLATES
# ============================================================================

generate_macos_installer() {
    cat << 'EOF'
#!/bin/bash
# MAX Video Downloader Native Host Installer

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY_PATH="$SCRIPT_DIR/mvdcoapp"
CHROME_EXT_ID_DEV="bkblnddclhmmgjlmbofhakhhbklkcofd"
CHROME_EXT_ID_PROD="kjinbaahkmjgkkedfdgpkkelehofieke"
FIREFOX_EXT_ID="max-video-downloader@rostislav.dev"

create_chrome_manifest() {
    local path="$1"
    cat > "$path" << MANIFEST_EOF
{
  "name": "pro.maxvideodownloader.coapp",
  "description": "MAX Video Downloader Native Host",
  "path": "$BINARY_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$CHROME_EXT_ID_DEV/",
    "chrome-extension://$CHROME_EXT_ID_PROD/"
  ]
}
MANIFEST_EOF
}

create_firefox_manifest() {
    local path="$1"
    cat > "$path" << MANIFEST_EOF
{
  "name": "pro.maxvideodownloader.coapp",
  "description": "MAX Video Downloader Native Host",
  "path": "$BINARY_PATH",
  "type": "stdio",
  "allowed_extensions": ["$FIREFOX_EXT_ID"]
}
MANIFEST_EOF
}

installed=0
browsers=(
    "/Applications/Google Chrome.app:$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts:chrome"
    "/Applications/Google Chrome Canary.app:$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts:chrome"
    "/Applications/Arc.app:$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts:chrome"
    "/Applications/Microsoft Edge.app:$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts:chrome"
    "/Applications/Microsoft Edge Beta.app:$HOME/Library/Application Support/Microsoft Edge Beta/NativeMessagingHosts:chrome"
    "/Applications/Microsoft Edge Dev.app:$HOME/Library/Application Support/Microsoft Edge Dev/NativeMessagingHosts:chrome"
    "/Applications/Microsoft Edge Canary.app:$HOME/Library/Application Support/Microsoft Edge Canary/NativeMessagingHosts:chrome"
    "/Applications/Brave Browser.app:$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts:chrome"
    "/Applications/Opera.app:$HOME/Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts:chrome"
    "/Applications/Vivaldi.app:$HOME/Library/Application Support/Vivaldi/NativeMessagingHosts:chrome"
    "/Applications/Epic Privacy Browser.app:$HOME/Library/Application Support/Epic Privacy Browser/NativeMessagingHosts:chrome"
    "/Applications/Yandex.app:$HOME/Library/Application Support/Yandex/YandexBrowser/NativeMessagingHosts:chrome"
    "/Applications/Firefox.app:$HOME/Library/Application Support/Mozilla/NativeMessagingHosts:firefox"
    "/Applications/Tor Browser.app:$HOME/Library/Application Support/TorBrowser-Data/Browser/NativeMessagingHosts:firefox"
)

for entry in "${browsers[@]}"; do
    IFS=':' read -r app_path manifest_dir browser_type <<< "$entry"
    
    if [[ -d "$app_path" ]]; then
        mkdir -p "$manifest_dir"
        if [[ "$browser_type" == "firefox" ]]; then
            create_firefox_manifest "$manifest_dir/pro.maxvideodownloader.coapp.json"
        else
            create_chrome_manifest "$manifest_dir/pro.maxvideodownloader.coapp.json"
        fi
        ((installed++))
    fi
done

osascript -e "display dialog \"MAX Video Downloader installed for $installed browser(s)\" buttons {\"OK\"} default button \"OK\""
EOF
}

generate_windows_installer() {
    cat << 'EOF'
@echo off
setlocal enabledelayedexpansion

echo MAX Video Downloader Native Host Installer
echo ==========================================
echo.

set "INSTALL_DIR=%~dp0"
set "TARGET_DIR=%LOCALAPPDATA%\MaxVideoDownloader"
set "BINARY_PATH=%TARGET_DIR%\mvdcoapp.exe"
set "TEMP_DIR=%LOCALAPPDATA%\.mvdcoapp"
set "CHROME_EXT_ID_DEV=bkblnddclhmmgjlmbofhakhhbklkcofd"
set "CHROME_EXT_ID_PROD=kjinbaahkmjgkkedfdgpkkelehofieke"
set "FIREFOX_EXT_ID=max-video-downloader@rostislav.dev"

echo Installing to: %TARGET_DIR%
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
copy "%INSTALL_DIR%\*.exe" "%TARGET_DIR%\" >nul
if %errorlevel% neq 0 (
    echo Error: Failed to copy files
    pause & exit /b 1
)

if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"

set "CHROME_TEMPLATE=%TEMP_DIR%\chrome_template.json"
(
echo {
echo   "name": "pro.maxvideodownloader.coapp",
echo   "description": "MAX Video Downloader Native Host",
echo   "path": "%BINARY_PATH:\=\\%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%CHROME_EXT_ID_DEV%/",
echo     "chrome-extension://%CHROME_EXT_ID_PROD%/"
echo   ]
echo }
) > "%CHROME_TEMPLATE%"

set "FIREFOX_TEMPLATE=%TEMP_DIR%\firefox_template.json"
(
echo {
echo   "name": "pro.maxvideodownloader.coapp",
echo   "description": "MAX Video Downloader Native Host",
echo   "path": "%BINARY_PATH:\=\\%",
echo   "type": "stdio",
echo   "allowed_extensions": ["%FIREFOX_EXT_ID%"]
echo }
) > "%FIREFOX_TEMPLATE%"

set installed=0
for %%b in (Chrome:HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\pro.maxvideodownloader.coapp:chrome Chrome-Canary:HKEY_CURRENT_USER\Software\Google\Chrome SxS\NativeMessagingHosts\pro.maxvideodownloader.coapp:chrome Edge:HKEY_CURRENT_USER\Software\Microsoft\Edge\NativeMessagingHosts\pro.maxvideodownloader.coapp:chrome Edge-Beta:HKEY_CURRENT_USER\Software\Microsoft\Edge Beta\NativeMessagingHosts\pro.maxvideodownloader.coapp:chrome Edge-Dev:HKEY_CURRENT_USER\Software\Microsoft\Edge Dev\NativeMessagingHosts\pro.maxvideodownloader.coapp:chrome Edge-Canary:HKEY_CURRENT_USER\Software\Microsoft\Edge SxS\NativeMessagingHosts\pro.maxvideodownloader.coapp:chrome Brave:HKEY_CURRENT_USER\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp:chrome Opera:HKEY_CURRENT_USER\Software\Opera Software\Opera Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp:chrome Vivaldi:HKEY_CURRENT_USER\Software\Vivaldi\NativeMessagingHosts\pro.maxvideodownloader.coapp:chrome Yandex:HKEY_CURRENT_USER\Software\Yandex\YandexBrowser\NativeMessagingHosts\pro.maxvideodownloader.coapp:chrome Firefox:HKEY_CURRENT_USER\Software\Mozilla\NativeMessagingHosts\pro.maxvideodownloader.coapp:firefox) do (
    for /f "tokens=1,2,3 delims=:" %%x in ("%%b") do (
        set "manifest=%TEMP_DIR%\%%x.json"
        if "%%z"=="firefox" (
            copy "%FIREFOX_TEMPLATE%" "!manifest!" >nul
        ) else (
            copy "%CHROME_TEMPLATE%" "!manifest!" >nul
        )
        reg add "%%y" /ve /t REG_SZ /d "!manifest!" /f >nul 2>&1
        if !errorlevel! equ 0 (
            echo   ✓ %%x installed
            set /a installed+=1
        )
    )
)

echo.
echo Installation complete! Installed for %installed% browser(s).
echo The MAX Video Downloader extension should now work.
echo.
pause
EOF
}

generate_linux_installer() {
    cat << 'EOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY_PATH="$SCRIPT_DIR/mvdcoapp"
CHROME_EXT_ID_DEV="bkblnddclhmmgjlmbofhakhhbklkcofd"
CHROME_EXT_ID_PROD="kjinbaahkmjgkkedfdgpkkelehofieke"
FIREFOX_EXT_ID="max-video-downloader@rostislav.dev"

create_chrome_manifest() {
    local path="$1"
    mkdir -p "$(dirname "$path")"
    cat > "$path" << MANIFEST_EOF
{
  "name": "pro.maxvideodownloader.coapp",
  "description": "MAX Video Downloader Native Host",
  "path": "$BINARY_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$CHROME_EXT_ID_DEV/",
    "chrome-extension://$CHROME_EXT_ID_PROD/"
  ]
}
MANIFEST_EOF
}

create_firefox_manifest() {
    local path="$1"
    mkdir -p "$(dirname "$path")"
    cat > "$path" << MANIFEST_EOF
{
  "name": "pro.maxvideodownloader.coapp",
  "description": "MAX Video Downloader Native Host",
  "path": "$BINARY_PATH",
  "type": "stdio",
  "allowed_extensions": ["$FIREFOX_EXT_ID"]
}
MANIFEST_EOF
}

installed=0
browsers=(
    "google-chrome:$HOME/.config/google-chrome/NativeMessagingHosts:chrome"
    "google-chrome-beta:$HOME/.config/google-chrome-beta/NativeMessagingHosts:chrome"
    "google-chrome-unstable:$HOME/.config/google-chrome-unstable/NativeMessagingHosts:chrome"
    "chromium-browser:$HOME/.config/chromium/NativeMessagingHosts:chrome"
    "microsoft-edge:$HOME/.config/microsoft-edge/NativeMessagingHosts:chrome"
    "microsoft-edge-beta:$HOME/.config/microsoft-edge-beta/NativeMessagingHosts:chrome"
    "microsoft-edge-dev:$HOME/.config/microsoft-edge-dev/NativeMessagingHosts:chrome"
    "brave-browser:$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts:chrome"
    "opera:$HOME/.config/opera/NativeMessagingHosts:chrome"
    "vivaldi:$HOME/.config/vivaldi/NativeMessagingHosts:chrome"
    "yandex-browser:$HOME/.config/yandex-browser/NativeMessagingHosts:chrome"
    "firefox:$HOME/.mozilla/native-messaging-hosts:firefox"
)

for entry in "${browsers[@]}"; do
    IFS=':' read -r cmd manifest_dir browser_type <<< "$entry"
    
    if command -v "$cmd" >/dev/null 2>&1; then
        if [[ "$browser_type" == "firefox" ]]; then
            create_firefox_manifest "$manifest_dir/pro.maxvideodownloader.coapp.json"
        else
            create_chrome_manifest "$manifest_dir/pro.maxvideodownloader.coapp.json"
        fi
        ((installed++))
    fi
done

if command -v zenity >/dev/null 2>&1; then
    zenity --info --text="MAX Video Downloader installed for $installed browser(s)!"
else
    echo "Installation complete! Installed for $installed browser(s)."
fi
EOF
}

# ============================================================================
# PACKAGING FUNCTIONS
# ============================================================================

create_macos_package() {
    local platform=$1
    local build_dir="build/$platform"
    local app_dir="build/${APP_NAME}.app"
    
    [[ ! -d "$build_dir" ]] && { log_error "Build $platform first"; exit 1; }
    [[ ! "$platform" =~ ^mac- ]] && { log_error "macOS packaging only"; exit 1; }
    
    log_info "Creating macOS package for $platform..."
    
    # Create app bundle structure
    local contents_dir="$app_dir/Contents"
    local macos_dir="$contents_dir/MacOS"
    local resources_dir="$contents_dir/Resources"
    
    rm -rf "$app_dir"
    mkdir -p "$macos_dir" "$resources_dir"
    
    # Copy binaries
    cp "$build_dir"/* "$macos_dir/"
    chmod +x "$macos_dir"/*
    
    # Copy icon
    local icon_source="../extension/icons/128.png"
    [[ -f "$icon_source" ]] && cp "$icon_source" "$resources_dir/AppIcon.png"
    
    # Create Info.plist (point directly to the binary)
    cat > "$contents_dir/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>mvdcoapp</string>
    <key>CFBundleIdentifier</key>
    <string>${APP_NAME}</string>
    <key>CFBundleName</key>
    <string>MAX Video Downloader</string>
    <key>CFBundleDisplayName</key>
    <string>MAX Video Downloader</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon.png</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
EOF
    
    # Note: No separate installer script needed - wrapper handles installation
    
    # Create DMG
    local dmg_name="MaxVideoDownloader-${VERSION}-${platform}.dmg"
    local temp_dmg="build/temp.dmg"
    local final_dmg="build/$dmg_name"
    
    rm -f "$temp_dmg" "$final_dmg"
    hdiutil create -size 200m -fs HFS+ -volname "MAX Video Downloader" "$temp_dmg"
    
    local mount_point=$(hdiutil attach "$temp_dmg" | grep "/Volumes" | sed 's/.*\(\/Volumes\/.*\)/\1/')
    [[ -z "$mount_point" ]] && { log_error "Failed to mount DMG"; exit 1; }
    
    sleep 2
    cp -R "$app_dir" "$mount_point/"
    ln -s /Applications "$mount_point/Applications" 2>/dev/null || true
    
    sync
    hdiutil detach "$mount_point"
    hdiutil convert "$temp_dmg" -format UDZO -o "$final_dmg"
    rm "$temp_dmg"
    
    log_info "✓ Created: $final_dmg"
}

create_windows_package() {
    local platform=$1
    local build_dir="build/$platform"
    local installer_dir="build/installer-$platform"
    
    [[ ! -d "$build_dir" ]] && { log_error "Build $platform first"; exit 1; }
    [[ ! "$platform" =~ ^win- ]] && { log_error "Windows packaging only"; exit 1; }
    
    log_info "Creating Windows package for $platform..."
    
    rm -rf "$installer_dir"
    mkdir -p "$installer_dir"
    
    # Copy binaries
    cp "$build_dir"/* "$installer_dir/"
    
    # Create installer
    generate_windows_installer > "$installer_dir/install.bat"
    
    log_info "✓ Created: $installer_dir/"
    log_info "Distribute the entire folder to users"
}

create_linux_package() {
    local platform=$1
    local build_dir="build/$platform"
    local appdir="build/MaxVideoDownloader-$platform.AppDir"
    
    [[ ! -d "$build_dir" ]] && { log_error "Build $platform first"; exit 1; }
    [[ ! "$platform" =~ ^linux- ]] && { log_error "Linux packaging only"; exit 1; }
    
    log_info "Creating Linux package for $platform..."
    
    rm -rf "$appdir"
    mkdir -p "$appdir/usr/bin"
    
    # Copy binaries
    cp "$build_dir"/* "$appdir/usr/bin/"
    
    # Create desktop file
    cat > "$appdir/MaxVideoDownloader.desktop" << EOF
[Desktop Entry]
Type=Application
Name=MAX Video Downloader
Exec=install_native_host.sh
Icon=maxvideodownloader
Categories=Network;
EOF
    
    # Create installer
    generate_linux_installer > "$appdir/usr/bin/install_native_host.sh"
    chmod +x "$appdir/usr/bin/install_native_host.sh"
    
    # Create AppRun
    cat > "$appdir/AppRun" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")/usr/bin"
./install_native_host.sh
EOF
    chmod +x "$appdir/AppRun"
    
    log_info "✓ Created: $appdir/"
    log_info "Use appimagetool to create final .AppImage"
}

# ============================================================================
# MAIN COMMANDS
# ============================================================================

show_help() {
    cat << EOF
MAX Video Downloader Build System

Usage: ./build-coapp.sh <command> [platform]

Commands:
  build <platform>     Build binary for platform
  package <platform>   Create distributable package
  dist <platform>      Build + package in one step
  version              Show version
  help                 Show this help

Platforms:
  mac-arm64, mac-x64, win-x64, win-arm64, linux-x64, linux-arm64

Examples:
  ./build-coapp.sh dist mac-arm64     # Create complete macOS installer
  ./build-coapp.sh build mac-arm64    # Just build binary

Note: For installation, use install.sh after building
EOF
}

case "${1:-help}" in
    version)
        echo "Native Host v${VERSION}"
        ;;
    build)
        platform=${2:-$(detect_platform)}
        build_binary "$platform"
        ;;
    package)
        platform=${2:-$(detect_platform)}
        case "$platform" in
            mac-*) create_macos_package "$platform" ;;
            win-*) create_windows_package "$platform" ;;
            linux-*) create_linux_package "$platform" ;;
            *) log_error "Unknown platform: $platform"; exit 1 ;;
        esac
        ;;
    dist)
        platform=${2:-$(detect_platform)}
        build_binary "$platform"
        case "$platform" in
            mac-*) create_macos_package "$platform" ;;
            win-*) create_windows_package "$platform" ;;
            linux-*) create_linux_package "$platform" ;;
            *) log_error "Unknown platform: $platform"; exit 1 ;;
        esac
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac