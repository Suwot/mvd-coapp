#!/bin/bash

# MAX Video Downloader Native Host Build System
# Creates self-contained installers for all platforms

set -e

VERSION=$(node -p "require('./package.json').version")
APP_NAME="pro.maxvideodownloader.coapp"

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
    
    log_info "✓ Binary built: $build_dir/$binary_name (self-contained installer)"
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
    
    # Ad-hoc sign the app bundle to reduce Gatekeeper restrictions
    log_info "Ad-hoc signing app bundle..."
    codesign --force --deep --sign - "$app_dir" 2>/dev/null || log_warn "Code signing failed - app will show unidentified developer warning"
    
    # Copy icon
    local icon_source="resources/mac/AppIcon.icns"
    [[ -f "$icon_source" ]] && cp "$icon_source" "$resources_dir/AppIcon.icns"
    
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
    <string>AppIcon.icns</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
EOF
    
    # Installer script included for manual installation if needed
    
    log_info "macOS .app bundle contains self-installing binary - just double-click mvdcoapp"
    
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
    
    # Clean up the intermediary app bundle
    rm -rf "$app_dir"
    
    log_info "✓ Created: $final_dmg"
}

create_windows_package() {
    local platform=$1
    local build_dir="build/$platform"
    local nsis_dir="build/nsis-$platform"
    
    [[ ! -d "$build_dir" ]] && { log_error "Build $platform first"; exit 1; }
    [[ ! "$platform" =~ ^win- ]] && { log_error "Windows packaging only"; exit 1; }
    
    # Check if NSIS is available
    if ! command -v makensis &> /dev/null; then
        log_error "NSIS not found. Please install NSIS (makensis) to create Windows installers."
        log_error "On macOS: brew install nsis"
        log_error "On Ubuntu/Debian: apt-get install nsis"
        exit 1
    fi
    
    log_info "Creating Windows NSIS installer for $platform..."
    
    # Clean up and create NSIS directory
    rm -rf "$nsis_dir"
    mkdir -p "$nsis_dir"
    
    # Copy binaries to NSIS directory
    cp "$build_dir"/mvdcoapp.exe "$nsis_dir/"
    cp "$build_dir"/ffmpeg.exe "$nsis_dir/"
    cp "$build_dir"/ffprobe.exe "$nsis_dir/"
    
    # Copy required files for NSIS
    cp "resources/windows/installer.nsh" "$nsis_dir/"
    cp "resources/windows/icon.ico" "$nsis_dir/"
    cp "LICENSE.txt" "$nsis_dir/"
    
    # Compile NSIS installer
    log_info "Compiling NSIS installer..."
    cd "$nsis_dir"
    if makensis installer.nsh; then
        # Move the created installer to the main build directory with versioned name
        local installer_name="mvdcoapp-${VERSION}-${platform}-installer.exe"
        mv "mvdcoapp-installer.exe" "../$installer_name"
        log_info "✓ Created: build/$installer_name"
    else
        log_error "NSIS compilation failed"
        exit 1
    fi
    
    # Clean up temporary NSIS directory
    cd ../..
    rm -rf "$nsis_dir"
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
Exec=mvdcoapp
Icon=maxvideodownloader
Categories=Network;
EOF
    
    # Create AppRun
    cat > "$appdir/AppRun" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")/usr/bin"
./mvdcoapp
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

Note: Installation is built into the binary - just run mvdcoapp or double-click
EOF
}

case "${1:-help}" in
    version)
        echo "MVD CoApp v${VERSION}"
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