#!/bin/bash
set -e

# ==============================================================================
# CONFIGURATION & CONSTANTS
# ==============================================================================

APP_NAME="mvdcoapp"
VERSION=$(node -p "require('./package.json').version")
SCAN_ON_PUBLISH=1 # Toggle to enable VirusTotal scanning on publish

# Paths
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$ROOT_DIR/bin"
TOOLS_DIR="$ROOT_DIR/tools"
RESOURCES_DIR="$ROOT_DIR/resources"
BUILD_ROOT="$ROOT_DIR/build"
DIST_DIR="$ROOT_DIR/dist"

# Optional env overrides loaded once per run
if [[ -f "$ROOT_DIR/.env" ]]; then
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env"
fi

# Optional: llvm-mingw toolchain root (used only for Windows cross-compilation)
LLVM_MINGW_ROOT=${LLVM_MINGW_ROOT:-/opt/llvm-mingw}

# Target Definitions
ALL_TARGETS=(
  "win-x64" "win-arm64" "win7-x64"
  "mac-x64" "mac-arm64" "mac-x64-legacy"
  "linux-x64" "linux-arm64"
)

# ==============================================================================
# HELPERS
# ==============================================================================

log_info() { echo -e "\033[32m[INFO]\033[0m $1"; }
log_warn() { echo -e "\033[33m[WARN]\033[0m $1"; }
log_error() { echo -e "\033[31m[ERROR]\033[0m $1"; }

check_tool() {
  if ! command -v "$1" &> /dev/null; then
    log_error "Required tool '$1' not found. Please install it to proceed."
    exit 1
  fi
}

check_compiler_for_target() {
  local target=$1
  if [[ "$target" == win-* ]] || [[ "$target" == "win7-x64" ]]; then
    # We expect llvm-mingw to provide the Windows cross-compilers.
    # PATH is prepended inside build_binary() for win targets.
    if [[ "$target" == "win-arm64" ]]; then
      check_tool "aarch64-w64-mingw32-g++"
    else
      check_tool "x86_64-w64-mingw32-g++"
    fi
  elif [[ "$target" == mac-* ]]; then
    check_tool "xcrun"
    xcrun --find clang++ > /dev/null 2>&1 || {
      log_error "xcrun can't find clang++. Install Xcode Command Line Tools (xcode-select --install)"
      exit 1
    }

  elif [[ "$target" == linux-* ]]; then
    check_tool "g++"
  fi
}

get_pkg_target() {
  case "$1" in
    win-x64) echo "node18-win-x64" ;;
    win-arm64) echo "node18-win-arm64" ;;
    win7-x64) echo "node12-win-x64" ;;
    mac-x64) echo "node18-macos-x64" ;;
    mac-arm64) echo "node18-macos-arm64" ;;
    mac-x64-legacy) echo "node12-macos-x64" ;;
    linux-x64) echo "node18-linux-x64" ;;
    linux-arm64) echo "node18-linux-arm64" ;;
    *) echo "" ;;
  esac
}

get_ffmpeg_platform_dir() {
  case "$1" in
    win7-x64) echo "win-x64" ;;
    mac-x64-legacy) echo "mac-x64" ;;
    *) echo "$1" ;;
  esac
}

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

# Return a grep regex describing the expected file(1) output for the given target.
expected_file_regex_for_target() {
  case "$1" in
    win-x64|win7-x64) echo 'PE32\+.*(x86-64|x86_64)';;
    win-arm64) echo 'PE32\+.*(Aarch64|ARM64|aarch64)';;
    mac-x64|mac-x64-legacy) echo 'Mach-O.*x86_64';;
    mac-arm64) echo 'Mach-O.*arm64';;
    linux-x64) echo 'ELF.*x86-64';;
    linux-arm64) echo 'ELF.*(aarch64|ARM aarch64)';;
    *) echo '';;
  esac
}

# Validate a single binary path using `file`. Non-blocking.
# Logs OK/WARN; never exits non-zero.
validate_binary_file() {
  local target="$1"
  local path="$2"

  if [[ ! -e "$path" ]]; then
    log_warn "binary-check: MISSING $(basename "$path")"
    return 0
  fi

  if ! command -v file >/dev/null 2>&1; then
    log_warn "binary-check: 'file' command not found; skipping validation for $(basename "$path")"
    return 0
  fi

  local expected
  expected=$(expected_file_regex_for_target "$target")
  if [[ -z "$expected" ]]; then
    log_warn "binary-check: unknown target '$target'; skipping validation for $(basename "$path")"
    return 0
  fi

  local desc
  desc=$(file -b "$path" 2>/dev/null || true)

  local desc_full="$desc"
  local desc_log
  if [[ "$desc" == *,* ]]; then
    desc_log=$(echo "$desc" | awk -F', ' '{print $1", "$2", "$3}')
  else
    desc_log="$desc"
  fi

  if echo "$desc_full" | grep -Eiq "$expected"; then
    log_info "binary-check: OK $(basename "$path") -> $desc_log"
  else
    log_warn "binary-check: WARN $(basename "$path") -> $desc_log (expected: $expected)"
  fi

  return 0
}

# Normalize PE subsystem version for a Windows executable using llvm-objcopy.
# Non-blocking: logs WARN on failure.
normalize_windows_subsystem() {
  local target="$1"
  local exe_path="$2"

  [[ -f "$exe_path" ]] || return 0

  # Prefer llvm-objcopy from llvm-mingw (keeps Windows tooling self-contained)
  local objcopy_bin=""
  if [[ -x "$LLVM_MINGW_ROOT/bin/llvm-objcopy" ]]; then
    objcopy_bin="$LLVM_MINGW_ROOT/bin/llvm-objcopy"
  elif command -v llvm-objcopy >/dev/null 2>&1; then
    objcopy_bin="$(command -v llvm-objcopy)"
  fi

  if [[ -z "$objcopy_bin" ]]; then
    log_warn "binary-check: llvm-objcopy not found; cannot normalize subsystem for $(basename "$exe_path")"
    return 0
  fi

  # Your target policy:
  # - win7-x64 build should be safe on Windows 7 SP1+ (6.1). Using 6.0 is also acceptable, but 6.1 is explicit.
  # - win-x64 and win-arm64 are for Windows 10+; keep them consistent.
  local subsystem_ver="6.1" # Windows 7 SP1+
  if [[ "$target" == "win-x64" || "$target" == "win-arm64" ]]; then
    subsystem_ver="10.0" # Windows 10+
  fi

  # Apply in-place. Non-fatal if it fails.
  if "$objcopy_bin" --subsystem "console:${subsystem_ver}" "$exe_path" 2>/dev/null; then
    log_info "binary-check: normalized $(basename "$exe_path") subsystem -> console:${subsystem_ver}"
  else
    log_warn "binary-check: failed to normalize subsystem for $(basename "$exe_path")"
  fi

  return 0
}

# ==============================================================================
# BUILD LOGIC
# ==============================================================================

build_binary() {
  local target=$1
  log_info "Starting build for target: $target"

  local ffmpeg_plat=$(get_ffmpeg_platform_dir "$target")
  local pkg_target=$(get_pkg_target "$target")
  if [[ -z "$pkg_target" ]]; then
    log_error "Unknown target mapping for '$target'"
    exit 1
  fi

  # Windows builds: use llvm-mingw toolchain (do not affect mac/linux)
  if [[ "$target" == win-* ]] || [[ "$target" == "win7-x64" ]]; then
    if [[ -d "$LLVM_MINGW_ROOT/bin" ]]; then
      export PATH="$LLVM_MINGW_ROOT/bin:$PATH"
    else
      log_error "llvm-mingw not found at $LLVM_MINGW_ROOT (expected $LLVM_MINGW_ROOT/bin). Set LLVM_MINGW_ROOT or install llvm-mingw there."
      exit 1
    fi
  fi

  # Validate compiler first
  check_compiler_for_target "$target"

  local build_dir="$BUILD_ROOT/$target"
  local ext=""
  [[ "$target" == win* ]] && ext=".exe"
  local binary_name="$APP_NAME$ext"

  # 1. Prepare Build Directory
  rm -rf "$build_dir"
  mkdir -p "$build_dir"

  # 2. Build Helpers (Diskspace)
  local diskspace_src="$TOOLS_DIR/diskspace/src/diskspace.cpp"
  local bin_diskspace="$BIN_DIR/$ffmpeg_plat/mvd-diskspace$ext"
  local build_diskspace="$build_dir/mvd-diskspace$ext"

  if [[ -f "$bin_diskspace" ]]; then
    cp "$bin_diskspace" "$build_diskspace"
    validate_binary_file "$target" "$build_diskspace" || true
  else
    log_info "  -> Compiling diskspace helper..."
    if [[ ! -f "$diskspace_src" ]]; then
       log_error "Diskspace source not found at $diskspace_src"
       exit 1
    fi

    mkdir -p "$BIN_DIR/$ffmpeg_plat"
    local temp_diskspace="$bin_diskspace.tmp"

    if [[ "$target" == win-* ]] || [[ "$target" == "win7-x64" ]]; then
      local compiler="x86_64-w64-mingw32-g++"
      [[ "$target" == "win-arm64" ]] && compiler="aarch64-w64-mingw32-g++"
      # Note: For win7-x64 (legacy), we rely on default linking (usually msvcrt or ucrt provided by toolchain).
      # User requested llvm-mingw.
      "$compiler" "$diskspace_src" -O2 -s -static -Wl,--major-subsystem-version,6,--minor-subsystem-version,0 -o "$temp_diskspace"
    elif [[ "$target" == mac-* ]]; then
      local mac_cxx
      mac_cxx=$(xcrun --find clang++)
      local mac_sdk
      mac_sdk=$(xcrun --sdk macosx --show-sdk-path)
      local mac_arch
      if [[ "$target" == "mac-arm64" ]]; then
        mac_arch="arm64"
        mac_min_version="11.0"
      else
        mac_arch="x86_64"
        mac_min_version="10.10"
      fi
      export MACOSX_DEPLOYMENT_TARGET="$mac_min_version"
      "$mac_cxx" "$diskspace_src" -O2 -arch "$mac_arch" -mmacosx-version-min="$mac_min_version" -isysroot "$mac_sdk" -stdlib=libc++ -o "$temp_diskspace"
      unset MACOSX_DEPLOYMENT_TARGET
    elif [[ "$target" == linux-* ]]; then
      g++ -std=c++11 "$diskspace_src" -O2 -s -o "$temp_diskspace"
    fi

    mv "$temp_diskspace" "$bin_diskspace"
    cp "$bin_diskspace" "$build_diskspace"
    validate_binary_file "$target" "$build_diskspace" || true
  fi

  # 3. Build Helpers (FileUI - Windows Only)
  if [[ "$target" == win* ]]; then
    local fileui_src="$TOOLS_DIR/fileui/src/pick.cpp"
    local bin_fileui="$BIN_DIR/$ffmpeg_plat/mvd-fileui$ext"
    local build_fileui="$build_dir/mvd-fileui$ext"

    if [[ -f "$bin_fileui" ]]; then
      cp "$bin_fileui" "$build_fileui"
      validate_binary_file "$target" "$build_fileui" || true
    else
      log_info "  -> Compiling fileui helper..."
      if [[ ! -f "$fileui_src" ]]; then
         log_error "FileUI source not found at $fileui_src"
         exit 1
      fi
      local compiler="x86_64-w64-mingw32-g++"
      [[ "$target" == "win-arm64" ]] && compiler="aarch64-w64-mingw32-g++"
      
      mkdir -p "$BIN_DIR/$ffmpeg_plat"
      local temp_fileui="$bin_fileui.tmp"
      "$compiler" "$fileui_src" -O2 -s -fno-exceptions -fno-rtti -lole32 -luuid -lshell32 -lshlwapi -Wl,--major-subsystem-version,6,--minor-subsystem-version,0 -o "$temp_fileui"
      mv "$temp_fileui" "$bin_fileui"
      cp "$bin_fileui" "$build_fileui"
      validate_binary_file "$target" "$build_fileui" || true
    fi
  fi

  # 4. Compile Main Binary (pkg)
  log_info "  -> Packaging Node.js binary ($pkg_target)..."
  # We use npx pkg. Ensure cwd is correct.
  # Using subshell to not pollute env
  (
    # Set APP_VERSION for injection if needed by code, though usually read from package.json
    export APP_VERSION="$VERSION"
    npx pkg index.js --target "$pkg_target" --output "$build_dir/$binary_name"
  )

  if [[ ! -f "$build_dir/$binary_name" ]]; then
    log_error "pkg failed to create binary at $build_dir/$binary_name"
    exit 1
  fi
  chmod +x "$build_dir/$binary_name"
  validate_binary_file "$target" "$build_dir/$binary_name" || true
  # Windows: pkg output may drift in SubsystemVersion across arches; normalize it.
  if [[ "$target" == win-* ]] || [[ "$target" == "win7-x64" ]]; then
    normalize_windows_subsystem "$target" "$build_dir/$binary_name" || true
  fi

  # 5. Copy Static Assets (FFmpeg)
  local ffmpeg_src="$BIN_DIR/$ffmpeg_plat"
  
  log_info "  -> Copying FFmpeg binaries from $ffmpeg_plat..."
  if [[ -d "$ffmpeg_src" && -f "$ffmpeg_src/ffmpeg$ext" && -f "$ffmpeg_src/ffprobe$ext" ]]; then
    cp "$ffmpeg_src"/* "$build_dir/"
    validate_binary_file "$target" "$build_dir/ffmpeg$ext" || true
    validate_binary_file "$target" "$build_dir/ffprobe$ext" || true
  else
    log_warn "FFmpeg binaries not found in $ffmpeg_src. Build will lack ffmpeg!"
  fi

  log_info "✓ Build complete for $target"
}

create_installer() {
  local target=$1
  log_info "Creating installer for target: $target"
  
  local build_dir="$BUILD_ROOT/$target"
  if [[ ! -d "$build_dir" ]]; then
     log_error "Build directory missing for $target. Run build first."
     exit 1
  fi

  mkdir -p "$DIST_DIR"

  if [[ "$target" == win* ]]; then
    # WINDOWS (NSIS)
    check_tool "makensis"
    local nsis_dir="$BUILD_ROOT/nsis-$target"
    rm -rf "$nsis_dir"
    mkdir -p "$nsis_dir"

    # Stage files for NSIS
    cp "$build_dir"/*.exe "$nsis_dir/"
    cp "$RESOURCES_DIR/windows/installer.nsh" "$nsis_dir/"
    cp "$RESOURCES_DIR/windows/icon.ico" "$nsis_dir/"
    cp "$ROOT_DIR/LICENSE.txt" "$nsis_dir/"

    local installer_name="mvdcoapp-${target}.exe"
    
    log_info "  -> Running makensis..."
    (
      cd "$nsis_dir"
      # We rely on installer.nsh producing a fixed name (e.g. mvdcoapp-installer.exe) or we force it?
      # Assuming standard script from repo. We define VERSION.
      makensis -DVERSION="$VERSION" installer.nsh
    )
    
    # Check what installer.nsh produced. Usually 'mvdcoapp-installer.exe' defined in .nsh
    local expected_out="$nsis_dir/mvdcoapp-installer.exe"
    if [[ -f "$expected_out" ]]; then
      mv "$expected_out" "$DIST_DIR/$installer_name"
      log_info "✓ Installer created: dist/$installer_name"
    else
      log_error "NSIS failed to produce $expected_out"
      exit 1
    fi
    rm -rf "$nsis_dir"

  elif [[ "$target" == mac* ]]; then
    # MACOS (DMG)
    check_tool "create-dmg"
    local app_name_dir="$BUILD_ROOT/${APP_NAME}.app"
    local dmg_name="mvdcoapp-${target}.dmg"

    local min_system_version
    if [[ "$target" == "mac-x64-legacy" ]]; then
      min_system_version="10.10"
    elif [[ "$target" == "mac-x64" ]]; then
      min_system_version="10.15"
    elif [[ "$target" == "mac-arm64" ]]; then
      min_system_version="11.0"
    fi

    # Create .app bundle structure manually
    rm -rf "$app_name_dir"
    local macos_dir="$app_name_dir/Contents/MacOS"
    local resources_dir="$app_name_dir/Contents/Resources"
    mkdir -p "$macos_dir" "$resources_dir"

    cp "$build_dir"/* "$macos_dir/"
    
    # Info.plist
    cat > "$app_name_dir/Contents/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>mvdcoapp</string>
    <key>CFBundleIdentifier</key>
    <string>com.mvd.coapp</string>
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
    <string>${min_system_version}</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
EOF
    
    # Icon
    [[ -f "$RESOURCES_DIR/mac/AppIcon.icns" ]] && cp "$RESOURCES_DIR/mac/AppIcon.icns" "$resources_dir/"

    # Ad-hoc sign
    log_info "  -> Signing app bundle..."
    codesign --force --deep --sign - "$app_name_dir"

    # Create DMG
    log_info "  -> Creating DMG..."
    rm -f "$DIST_DIR/$dmg_name"
    
    # Unmount stale if any
    if [ -d "/Volumes/Max Video Downloader CoApp" ]; then
        hdiutil detach "/Volumes/Max Video Downloader CoApp" -force > /dev/null 2>&1 || true
    fi

    # Simplified create-dmg call (assuming standard options)
    # Note: window-pos/size configs are cosmetic, can be tuned.
    create-dmg \
        --volname "Max Video Downloader CoApp" \
        --volicon "$RESOURCES_DIR/mac/AppIcon.icns" \
		--background "$RESOURCES_DIR/mac/dmg-background.png" \
        --window-pos 200 120 \
        --window-size 934 457 \
        --icon-size 120 \
        --icon "${APP_NAME}.app" 160 288 \
		--app-drop-link 478 288 \
        --add-file "README.txt" "resources/mac/README.txt" 734 288 \
        --hide-extension "${APP_NAME}.app" \
        "$DIST_DIR/$dmg_name" \
        "$app_name_dir" > /dev/null

    if [[ -f "$DIST_DIR/$dmg_name" ]]; then
        log_info "✓ DMG created: dist/$dmg_name"
        rm -rf "$app_name_dir"
    else
        log_error "Failed to create DMG"
        exit 1
    fi

  elif [[ "$target" == linux* ]]; then
    # LINUX (TAR.GZ)
    local tar_name="mvdcoapp-${target}.tar.gz"
    local stage_dir="$BUILD_ROOT/mvdcoapp" # Use generic name in tar
    rm -rf "$stage_dir"
    mkdir -p "$stage_dir"
    
    cp "$build_dir"/* "$stage_dir/"
    [[ -f "LICENSE.txt" ]] && cp "LICENSE.txt" "$stage_dir/"
    [[ -f "$RESOURCES_DIR/linux/README.md" ]] && cp "$RESOURCES_DIR/linux/README.md" "$stage_dir/"
    [[ -f "$RESOURCES_DIR/linux/install.sh" && -x "$RESOURCES_DIR/linux/install.sh" ]] && cp "$RESOURCES_DIR/linux/install.sh" "$stage_dir/"

    log_info "  -> Creating tarball..."
    tar -czf "$DIST_DIR/$tar_name" -C "$BUILD_ROOT" mvdcoapp
    
    rm -rf "$stage_dir"
    log_info "✓ Tarball created: dist/$tar_name"
  fi
}

# ==============================================================================
# PUBLISH UTILITIES
# ==============================================================================

generate_checksums() {
  if [[ ! -d "$DIST_DIR" ]]; then
    log_warn "dist/ directory not found; skipping checksum generation."
    return 0
  fi

  local -a checksum_tool
  if command -v shasum >/dev/null 2>&1; then
    checksum_tool=(shasum -a 256)
  elif command -v sha256sum >/dev/null 2>&1; then
    checksum_tool=(sha256sum)
  else
    log_warn "Neither shasum nor sha256sum available; skipping checksum generation."
    return 0
  fi

  local checksum_file="$DIST_DIR/checksums.txt"
  rm -f "$checksum_file"

  local files=()
  while IFS=$'\0' read -r -d '' file; do
    files+=("$file")
  done < <(find "$DIST_DIR" -type f -not -name ".DS_Store" -not -name "checksums.txt" -print0)

  if [[ ${#files[@]} -eq 0 ]]; then
    log_warn "No artifacts found to checksum."
    return 0
  fi

  {
    for file in "${files[@]}"; do
      "${checksum_tool[@]}" "$file"
    done
  } > "$checksum_file"

  log_info "Checksums recorded to $checksum_file"
}

scan_virustotal() {
  local api_key="$VT_API_KEY"
  if [[ -z "$api_key" ]]; then
    log_warn "VirusTotal API key not found (VT_API_KEY env var)."
    log_warn "To enable scanning, create a .env file with VT_API_KEY=your_key"
    log_warn "See coapp/.env.example for reference."
    return 0
  fi

  if [[ -z "$RELEASE_REPO" ]]; then
    log_warn "RELEASE_REPO not configured; skipping VirusTotal scan."
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    log_warn "curl not found. Skipping VirusTotal scan."
    return 0
  fi

  log_info "Requesting VirusTotal scans for binaries..."

  local artifacts=()
  while IFS=$'\0' read -r -d '' file; do
    artifacts+=("$file")
  done < <(find "$DIST_DIR" -type f \( -name "*.dmg" -o -name "*.exe" -o -name "*.tar.gz" \) -print0)

  if [[ ${#artifacts[@]} -eq 0 ]]; then
    log_warn "No distributable artifacts found in dist/ for VirusTotal scan."
    return 0
  fi

  for artifact_path in "${artifacts[@]}"; do
    local filename
    filename=$(basename "$artifact_path")
    local url="https://github.com/$RELEASE_REPO/releases/latest/download/$filename"
    log_info "Submitting to VirusTotal: $url"

    local response
    if ! response=$(curl --silent --show-error --fail \
         --write-out "HTTPSTATUS:%{http_code}" \
         --request POST \
         --url https://www.virustotal.com/api/v3/urls \
         --header "x-apikey: $api_key" \
         --form "url=$url"); then
      log_warn "VirusTotal request failed for $filename"
      continue
    fi

    local http_status=${response##*HTTPSTATUS:}
    local body=${response%HTTPSTATUS:*}
    if [[ "$body" == *"\"id\":"* ]]; then
      log_info "✓ Scan request submitted for $filename"
    else
      log_warn "VirusTotal scan response missing id (status $http_status) for $filename"
    fi
  done
}

publish_release() {
  log_info "Publishing CoApp artifacts for version $VERSION..."

  check_tool "gh"
  check_tool "git"

  if [[ -z "$RELEASE_REPO" ]]; then
    RELEASE_REPO="$(cd "$ROOT_DIR" && gh repo view --json owner,name -q '.owner.login + "/" + .name')"
    if [[ -z "$RELEASE_REPO" ]]; then
      log_error "Unable to determine release repository. Set RELEASE_REPO in .env or ensure gh is configured."
      exit 1
    fi
  fi

  if [[ ! -d "$DIST_DIR" ]]; then
    log_error "dist/ directory not found. Run builds first."
    exit 1
  fi

  local linux_install_src="$RESOURCES_DIR/linux/install.sh"
  if [[ -f "$linux_install_src" ]]; then
    cp -f "$linux_install_src" "$DIST_DIR/install.sh"
    chmod +x "$DIST_DIR/install.sh"
    log_info "Staged linux install script into dist/install.sh"
  fi

  local artifacts=()
  while IFS=$'\0' read -r -d '' file; do
    artifacts+=("$file")
  done < <(find "$DIST_DIR" -type f -not -name ".DS_Store" -not -name "checksums.txt" -print0)

  if [[ ${#artifacts[@]} -eq 0 ]]; then
    log_error "No artifacts found in dist/ directory"
    exit 1
  fi

  log_info "Found ${#artifacts[@]} CoApp artifacts to upload:"
  printf '  %s\n' "${artifacts[@]}"

  generate_checksums
  local checksum_file="$DIST_DIR/checksums.txt"
  if [[ -f "$checksum_file" ]]; then
    artifacts+=("$checksum_file")
  fi

  log_info "Updated artifact count: ${#artifacts[@]} (including checksums)"

  (
    cd "$ROOT_DIR" || exit 1
    if ! git tag -l | grep -q "^v$VERSION$"; then
      log_info "Creating git tag v$VERSION..."
      git tag "v$VERSION"
      git push origin "v$VERSION"
      log_info "✓ Created and pushed tag v$VERSION"
    else
      log_info "Git tag v$VERSION already exists"
    fi

    if ! gh release view "v$VERSION" &>/dev/null; then
      log_info "Creating GitHub release v$VERSION..."
      gh release create "v$VERSION" \
        --title "CoApp v$VERSION" \
        --generate-notes
      log_info "✓ Created GitHub release v$VERSION"
    else
      log_info "GitHub release v$VERSION already exists"
    fi
  )

  log_info "Uploading to release v$VERSION..."
  if (
    cd "$ROOT_DIR" && \
    gh release upload "v$VERSION" "${artifacts[@]}" --clobber
  ); then
    log_info "✅ Successfully published ${#artifacts[@]} CoApp artifacts for v$VERSION"
    log_info "📦 Release available at: https://github.com/$RELEASE_REPO/releases/tag/v$VERSION"
    if [[ "${SCAN_ON_PUBLISH}" == "1" ]]; then
      scan_virustotal
    else
      log_info "VirusTotal scan is disabled (SCAN_ON_PUBLISH=${SCAN_ON_PUBLISH})"
    fi
  else
    log_error "Failed to upload artifacts"
    exit 1
  fi
}

# ==============================================================================
# MAIN EXECUTION
# ==============================================================================

COMMAND=$1
TARGET=$2

# Validate Command
if [[ "$COMMAND" != "build" && "$COMMAND" != "dist" && "$COMMAND" != "publish" ]]; then
  echo "Usage:"
  echo "  $0 build <target|all>"
  echo "  $0 dist <target|all>"
  echo "  $0 publish"
  echo
  echo "Available targets:"
  echo "  ${ALL_TARGETS[*]}"
  exit 1
fi

# Execute
execute_workflow() {
  local t=$1
  local ok=0
  local x
  for x in "${ALL_TARGETS[@]}"; do [[ "$x" == "$t" ]] && ok=1 && break; done
  if [[ $ok -ne 1 ]]; then
    log_error "Invalid target: $t. Available targets: ${ALL_TARGETS[*]}"
    exit 1
  fi
  
  build_binary "$t"
  
  if [[ "$COMMAND" == "dist" ]]; then
    create_installer "$t"
  fi
}

# Main Loop
if [[ "$COMMAND" == "publish" ]]; then
  if [[ -n "$TARGET" ]]; then
    log_error "publish command does not accept a target argument"
    exit 1
  fi
  publish_release
  exit 0
fi

check_tool "node"
check_tool "npx"

if [[ "$TARGET" == "all" ]]; then
  for t in "${ALL_TARGETS[@]}"; do
    execute_workflow "$t"
  done
elif [[ -n "$TARGET" ]]; then
  execute_workflow "$TARGET"
else
  # Detect current platform and build for it
  detected_target=$(detect_platform)
  log_info "No target specified, detected current platform: $detected_target"
  execute_workflow "$detected_target"
fi

log_info "Done."