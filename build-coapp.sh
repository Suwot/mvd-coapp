#!/bin/bash

# MAX Video Downloader CoApp Build System
# Creates self-contained installers for all platforms

set -e

VERSION=$(node -p "require('./package.json').version")
APP_NAME="mvdcoapp"

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
    
    # Clean build directory to ensure fresh build
    rm -rf "$build_dir"
    mkdir -p "$build_dir"
    
    # Build CoApp binary with version
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
    local dmg_name="mvdcoapp-${platform}.dmg"
    
    [[ ! -d "$build_dir" ]] && { log_error "Build $platform first"; exit 1; }
    [[ ! "$platform" =~ ^mac- ]] && { log_error "macOS packaging only"; exit 1; }
    
    log_info "Creating macOS package for $platform..."
    
    # Clean any existing dist files for this platform
    rm -f "dist/$dmg_name"
    
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
    
    # Check for create-dmg dependency
    if ! command -v create-dmg &> /dev/null; then
        log_error "create-dmg not found. Install with: brew install create-dmg"
        exit 1
    fi
    
    # Create DMG using create-dmg
    local dmg_name="mvdcoapp-${platform}.dmg"
    local final_dmg="dist/$dmg_name"
    
    mkdir -p dist
    rm -f "$final_dmg"
    
    log_info "Creating styled DMG with background..."
    create-dmg \
        --volname "Max Video Downloader CoApp" \
        --background "resources/mac/dmg-background.png" \
        --window-pos 200 120 \
        --window-size 720 326 \
        --icon-size 100 \
        --icon "${APP_NAME}.app" 140 130 \
        --app-drop-link 550 130 \
        --hide-extension "${APP_NAME}.app" \
        "$final_dmg" \
        "$app_dir"
    
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
        # Move the created installer to the dist directory
        local installer_name="mvdcoapp-${platform}.exe"
        mkdir -p ../../dist
        # Clean any existing installer
        rm -f "../../dist/$installer_name"
        mv "mvdcoapp-installer.exe" "../$installer_name"
        mv "../$installer_name" "../../dist/$installer_name"
        log_info "✓ Created: ../../dist/$installer_name"
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
    local appdir="dist/MaxVideoDownloader-$platform.AppDir"
    
    [[ ! -d "$build_dir" ]] && { log_error "Build $platform first"; exit 1; }
    [[ ! "$platform" =~ ^linux- ]] && { log_error "Linux packaging only"; exit 1; }
    
    log_info "Creating Linux package for $platform..."
    
    # Clean any existing AppDir
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
# PUBLISH FUNCTIONS
# ============================================================================

publish_release() {
    local version=$(node -p "require('./package.json').version")
    
    log_info "Publishing CoApp artifacts for version $version..."
    
    # Check if gh CLI is available
    if ! command -v gh &> /dev/null; then
        log_error "GitHub CLI (gh) not found. Install from https://cli.github.com/"
        exit 1
    fi
    
    # Check if git tag exists, create if not
    if ! git tag -l | grep -q "^v$version$"; then
        log_info "Creating git tag v$version..."
        git tag "v$version"
        git push origin "v$version"
        log_info "✓ Created and pushed tag v$version"
    else
        log_info "Git tag v$version already exists"
    fi
    
    # Check if GitHub release exists, create if not
    if ! gh release view "v$version" &>/dev/null; then
        log_info "Creating GitHub release v$version..."
        
        gh release create "v$version" \
            --title "CoApp v$version" \
            --notes "Automated release of CoApp binaries v$version" \
            --generate-notes
        
        log_info "✓ Created GitHub release v$version"
    else
        log_info "GitHub release v$version already exists"
    fi
    
    # Check if dist directory exists and has files
    if [[ ! -d "dist" ]]; then
        log_error "dist/ directory not found. Run builds first."
        exit 1
    fi
    
    # Get all files in dist directory
    local artifacts=()
    while IFS= read -r -d '' file; do
        artifacts+=("$file")
    done < <(find dist -type f -print0)
    
    if [[ ${#artifacts[@]} -eq 0 ]]; then
        log_error "No artifacts found in dist/ directory"
        exit 1
    fi
    
    log_info "Found ${#artifacts[@]} CoApp artifacts to upload:"
    printf '  %s\n' "${artifacts[@]}"
    
    # Upload all artifacts to the release
    log_info "Uploading to release v$version..."
    
    if gh release upload "v$version" "${artifacts[@]}" --clobber; then
        log_info "✅ Successfully published ${#artifacts[@]} CoApp artifacts for v$version"
        log_info "📦 Release available at: https://github.com/$(gh repo view --json owner,name -q '.owner.login + "/" + .name')/releases/tag/v$version"
    else
        log_error "Failed to upload artifacts"
        exit 1
    fi
}

# ============================================================================
# MAIN COMMANDS
# ============================================================================

show_help() {
    cat << EOF
MAX Video Downloader CoApp Build System

Usage: ./build-coapp.sh <command> [platform]

Commands:
  build <platform>     Build CoApp binary for platform
  package <platform>   Create CoApp distributable package
  dist <platform>      Build + package CoApp in one step
  publish              Upload all dist/ CoApp artifacts to GitHub release
  version              Show CoApp version
  help                 Show this help

Platforms:
  mac-arm64, mac-x64, win-x64, win-arm64, linux-x64, linux-arm64

Examples:
  ./build-coapp.sh dist mac-arm64     # Create complete macOS installer
  ./build-coapp.sh build mac-arm64    # Just build binary
  ./build-coapp.sh publish            # Upload all dist files with auto-generated notes

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
    publish)
        publish_release
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