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
	export VT_API_KEY
fi

# Optional: llvm-mingw toolchain root (used only for Windows cross-compilation)
LLVM_MINGW_ROOT=${LLVM_MINGW_ROOT:-/opt/llvm-mingw}
LEGACY_TRANSPILED_DIR=""

# Target Definitions
ALL_TARGETS=(
	"mac-x64" "mac-arm64" "mac10-x64"
	"win-x64" "win-arm64" "win7-x64"
	"linux-x64" "linux-arm64"
)

# Temporary directories for cleanup on interrupt
TEMP_BUNDLED_DIR=""
TEMP_BUILD_DIR=""
TEMP_NSIS_DIR=""
TEMP_APP_DIR=""
TEMP_STAGE_DIR=""

# ==============================================================================
# HELPERS
# ==============================================================================

log_info() { echo -e "\033[32m[INFO]\033[0m $1"; }
log_warn() { echo -e "\033[33m[WARN]\033[0m $1"; }
log_error() { echo -e "\033[31m[ERROR]\033[0m $1"; }

cleanup() {
    log_info "Cleaning up temporary files..."
    # Unmount any mounted DMG volumes from interrupted builds
    if command -v hdiutil >/dev/null 2>&1; then
        # Unmount the known final volume if mounted
        if [ -d "/Volumes/Max Video Downloader CoApp" ]; then
            hdiutil detach "/Volumes/Max Video Downloader CoApp" -force >/dev/null 2>&1 || true
        fi
        # Unmount temporary DMG images based on their path
        hdiutil info | awk '
        /image-path.*rw\.[0-9]+\.mvdcoapp.*\.dmg/ {flag=1}
        /\/dev\/disk/ {if (flag) {print $1; flag=0}}
        ' | while read -r dev; do
            hdiutil detach "$dev" -force >/dev/null 2>&1 || true
        done
    fi
    [[ -n "$TEMP_BUNDLED_DIR" && -d "$TEMP_BUNDLED_DIR" ]] && rm -rf "$TEMP_BUNDLED_DIR"
    [[ -n "$TEMP_BUILD_DIR" && -d "$TEMP_BUILD_DIR" ]] && rm -rf "$TEMP_BUILD_DIR"
    [[ -n "$TEMP_NSIS_DIR" && -d "$TEMP_NSIS_DIR" ]] && rm -rf "$TEMP_NSIS_DIR"
    [[ -n "$TEMP_APP_DIR" && -d "$TEMP_APP_DIR" ]] && rm -rf "$TEMP_APP_DIR"
    [[ -n "$TEMP_STAGE_DIR" && -d "$TEMP_STAGE_DIR" ]] && rm -rf "$TEMP_STAGE_DIR"
}

trap cleanup SIGTERM SIGINT

# Target Helper Functions
is_legacy() { [[ "$1" == "mac10-x64" || "$1" == "win7-x64" ]]; }
is_mac() { [[ "$1" == mac* ]]; }
is_windows() { [[ "$1" == win* ]]; }
is_linux() { [[ "$1" == linux* ]]; }

check_tool() {
	if ! command -v "$1" &>/dev/null; then
		log_error "Required tool '$1' not found. Please install it to proceed."
		exit 1
	fi
}

check_npx_tool() {
	if ! npx --yes "$1" --version >/dev/null 2>&1; then
		log_error "Required npx tool '$1' not found. Please install it: npm i -D $1"
		exit 1
	fi
}

check_compiler_for_target() {
	local target=$1
	if is_windows "$target"; then
		# We expect llvm-mingw to provide the Windows cross-compilers.
		# PATH is prepended inside build_binary() for win targets.
		if [[ "$target" == "win-arm64" ]]; then
			check_tool "aarch64-w64-mingw32-g++"
			check_tool "aarch64-w64-mingw32-windres"
		else
			check_tool "x86_64-w64-mingw32-g++"
			check_tool "x86_64-w64-mingw32-windres"
		fi
	elif is_mac "$target"; then
		check_tool "xcrun"
		xcrun --find clang++ >/dev/null 2>&1 || {
			log_error "xcrun can't find clang++. Install Xcode Command Line Tools (xcode-select --install)"
			exit 1
		}

	elif is_linux "$target"; then
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
	mac10-x64) echo "node12-macos-x64" ;;
	linux-x64) echo "node18-linux-x64" ;;
	linux-arm64) echo "node18-linux-arm64" ;;
	*) echo "" ;;
	esac
}

bundle_sources_for_target() {
	local target=$1
	local pkg_target=$(get_pkg_target "$target")
	local node_ver=$(echo "$pkg_target" | cut -d'-' -f1)
	local bundled_dir="$BUILD_ROOT/bundled-$target"
	rm -rf "$bundled_dir"
	mkdir -p "$bundled_dir"
	TEMP_BUNDLED_DIR="$bundled_dir"
	log_info "  -> Bundling source for target: $pkg_target (Node: $node_ver)..."

	local esbuild_args=(
		"src/index.js"
		--bundle
		--platform=node
		--target="$node_ver"
		--outfile="$bundled_dir/index.js"
		--minify
	)

	# dbus-next and x11 are only needed for Linux. For other platforms, we mark them as external
	# so they're not bundled into the single-file executable.
	if [[ "$pkg_target" != *linux* ]]; then
		esbuild_args+=(--external:dbus-next --external:x11)
	fi

	if ! npx esbuild "${esbuild_args[@]}"; then
		log_error "esbuild bundling failed for $pkg_target."
		exit 1
	fi

	LEGACY_TRANSPILED_DIR="$bundled_dir"
}

get_ffmpeg_platform_dir() {
	case "$1" in
	win7-x64) echo "win-x64" ;;
	mac10-x64) echo "mac-x64" ;;
	*) echo "$1" ;;
	esac
}

detect_platform() {
	case "$(uname -s)" in
	Darwin)
		case "$(uname -m)" in
		arm64) echo "mac-arm64" ;;
		x86_64) echo "mac-x64" ;;
		*)
			log_error "Unsupported macOS architecture"
			exit 1
			;;
		esac
		;;
	MINGW* | CYGWIN* | MSYS* | Windows_NT)
		case "$(uname -m)" in
		x86_64) echo "win-x64" ;;
		aarch64) echo "win-arm64" ;;
		*)
			log_error "Unsupported Windows architecture"
			exit 1
			;;
		esac
		;;
	Linux)
		case "$(uname -m)" in
		x86_64) echo "linux-x64" ;;
		aarch64) echo "linux-arm64" ;;
		*)
			log_error "Unsupported Linux architecture"
			exit 1
			;;
		esac
		;;
	*)
		log_error "Unsupported OS"
		exit 1
		;;
	esac
}

# Return a grep regex describing the expected file(1) output for the given target.
expected_file_regex_for_target() {
	case "$1" in
	win-x64 | win7-x64) echo 'PE32\+.*(x86-64|x86_64)' ;;
	win-arm64) echo 'PE32\+.*(Aarch64|ARM64|aarch64)' ;;
	mac-x64 | mac10-x64) echo 'Mach-O.*x86_64' ;;
	mac-arm64) echo 'Mach-O.*arm64' ;;
	linux-x64) echo 'ELF.*x86-64' ;;
	linux-arm64) echo 'ELF.*(aarch64|ARM aarch64)' ;;
	*) echo '' ;;
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
	if is_windows "$target"; then
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
	if is_windows "$target"; then ext=".exe"; fi
	local binary_name="$APP_NAME$ext"
	check_npx_tool "esbuild"
	bundle_sources_for_target "$target"
	local bundled_dir="$LEGACY_TRANSPILED_DIR"
	local pkg_entry="$bundled_dir/index.js"

	# Get version components for PE resources
	local major=0 minor=0 patch=0
	if [[ "$VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
		major=${BASH_REMATCH[1]}
		minor=${BASH_REMATCH[2]}
		patch=${BASH_REMATCH[3]}
	fi

	local extra_cxx_flags="-O2 -ffunction-sections -fdata-sections"
	if ! is_mac "$target"; then
		extra_cxx_flags+=" -Wl,--gc-sections -Wl,--as-needed"
	fi
	if is_windows "$target"; then
		extra_cxx_flags+=" -static-libgcc -static-libstdc++ -Wl,--dynamicbase -Wl,--nxcompat -Wl,--high-entropy-va"
	fi

	# 1. Prepare Build Directory
	rm -rf "$build_dir"
	mkdir -p "$build_dir"
	TEMP_BUILD_DIR="$build_dir"

	# 2. Copy Static Assets (FFmpeg)
	local ffmpeg_src="$BIN_DIR/$ffmpeg_plat"

	log_info "  -> Copying FFmpeg binaries from $ffmpeg_plat..."
	if [[ -d "$ffmpeg_src" && -f "$ffmpeg_src/ffmpeg$ext" && -f "$ffmpeg_src/ffprobe$ext" ]]; then
		cp "$ffmpeg_src"/* "$build_dir/"
		validate_binary_file "$target" "$build_dir/ffmpeg$ext" || true
		validate_binary_file "$target" "$build_dir/ffprobe$ext" || true
	else
		log_warn "FFmpeg binaries not found in $ffmpeg_src. Build will lack ffmpeg!"
	fi

	# 3. Build Helpers (Diskspace)
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

		if is_windows "$target"; then
			local compiler="x86_64-w64-mingw32-g++"
			local res_compiler="x86_64-w64-mingw32-windres"
			if [[ "$target" == "win-arm64" ]]; then
				compiler="aarch64-w64-mingw32-g++"
				res_compiler="aarch64-w64-mingw32-windres"
			fi

			# Generate and compile resources
			local res_rc="$bundled_dir/diskspace.rc"
			local res_obj="$bundled_dir/diskspace.res.o"
			
			cat > "$res_rc" <<EOF
#include <windows.h>
VS_VERSION_INFO VERSIONINFO
FILEVERSION     $major,$minor,$patch,0
PRODUCTVERSION  $major,$minor,$patch,0
FILEFLAGSMASK   VS_FFI_FILEFLAGSMASK
FILEFLAGS       0x0L
FILEOS          VOS_NT_WINDOWS32
FILETYPE        VFT_APP
FILESUBTYPE     VFT2_UNKNOWN
BEGIN
    BLOCK "StringFileInfo"
    BEGIN
        BLOCK "040904b0"
        BEGIN
            VALUE "CompanyName",      "MAX Video Downloader"
            VALUE "FileDescription",  "MAX Video Downloader Disk Space Helper"
            VALUE "FileVersion",      "$VERSION"
            VALUE "InternalName",     "mvd-diskspace"
            VALUE "LegalCopyright",   "Copyright (C) 2026 MAX Video Downloader"
            VALUE "OriginalFilename", "mvd-diskspace.exe"
            VALUE "ProductName",      "MAX Video Downloader"
            VALUE "ProductVersion",   "$VERSION"
        END
    END
    BLOCK "VarFileInfo"
    BEGIN
        VALUE "Translation", 0x409, 1200
    END
END
EOF
			"$res_compiler" "$res_rc" -o "$res_obj"

			# Compile with resource and PE mitigations
			"$compiler" "$diskspace_src" "$res_obj" $extra_cxx_flags -static -Wl,--major-subsystem-version,6,--minor-subsystem-version,0 -o "$temp_diskspace"
		elif is_mac "$target"; then
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
			"$mac_cxx" "$diskspace_src" $extra_cxx_flags -arch "$mac_arch" -mmacosx-version-min="$mac_min_version" -isysroot "$mac_sdk" -stdlib=libc++ -o "$temp_diskspace"
			unset MACOSX_DEPLOYMENT_TARGET
		elif is_linux "$target"; then
			g++ -std=c++11 "$diskspace_src" $extra_cxx_flags -o "$temp_diskspace"
		fi

		mv "$temp_diskspace" "$bin_diskspace"
		cp "$bin_diskspace" "$build_diskspace"
		validate_binary_file "$target" "$build_diskspace" || true
	fi

	# 4. Build Helpers (FileUI - Windows Only)
	if is_windows "$target"; then
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
			local res_compiler="x86_64-w64-mingw32-windres"
			if [[ "$target" == "win-arm64" ]]; then
				compiler="aarch64-w64-mingw32-g++"
				res_compiler="aarch64-w64-mingw32-windres"
			fi

			# Generate and compile resources
			local res_rc="$bundled_dir/fileui.rc"
			local res_obj="$bundled_dir/fileui.res.o"

			cat > "$res_rc" <<EOF
#include <windows.h>
VS_VERSION_INFO VERSIONINFO
FILEVERSION     $major,$minor,$patch,0
PRODUCTVERSION  $major,$minor,$patch,0
FILEFLAGSMASK   VS_FFI_FILEFLAGSMASK
FILEFLAGS       0x0L
FILEOS          VOS_NT_WINDOWS32
FILETYPE        VFT_APP
FILESUBTYPE     VFT2_UNKNOWN
BEGIN
    BLOCK "StringFileInfo"
    BEGIN
        BLOCK "040904b0"
        BEGIN
            VALUE "CompanyName",      "MAX Video Downloader"
            VALUE "FileDescription",  "MAX Video Downloader File UI Helper"
            VALUE "FileVersion",      "$VERSION"
            VALUE "InternalName",     "mvd-fileui"
            VALUE "LegalCopyright",   "Copyright (C) 2026 MAX Video Downloader"
            VALUE "OriginalFilename", "mvd-fileui.exe"
            VALUE "ProductName",      "MAX Video Downloader"
            VALUE "ProductVersion",   "$VERSION"
        END
    END
    BLOCK "VarFileInfo"
    BEGIN
        VALUE "Translation", 0x409, 1200
    END
END
EOF
			"$res_compiler" "$res_rc" -o "$res_obj"

			mkdir -p "$BIN_DIR/$ffmpeg_plat"
			local temp_fileui="$bin_fileui.tmp"
			# Compile with resource and PE mitigations
			"$compiler" "$fileui_src" "$res_obj" $extra_cxx_flags -fno-exceptions -fno-rtti -lole32 -luuid -lshell32 -lshlwapi -Wl,--major-subsystem-version,6,--minor-subsystem-version,0 -o "$temp_fileui"
			mv "$temp_fileui" "$bin_fileui"
			cp "$bin_fileui" "$build_fileui"
			validate_binary_file "$target" "$build_fileui" || true
		fi
	fi

	# 5. Compile Main Binary (pkg)
	local pkg_npx_cmd="npx --yes pkg"
	check_npx_tool "pkg"

	# win-arm64 requires --public to prevent crashes.
	local extra_flags=""
	if [[ "$target" == "win-arm64" ]]; then
		extra_flags="--public"
	fi

	log_info "  -> Packaging Node.js binary ($pkg_target) using: $pkg_npx_cmd"
	(
		cd "$bundled_dir"
		$pkg_npx_cmd "index.js" --target "$pkg_target" --output "$build_dir/$binary_name" $extra_flags
	)

	if [[ ! -f "$build_dir/$binary_name" ]]; then
		log_error "pkg failed to create binary at $build_dir/$binary_name"
		exit 1
	fi
	chmod +x "$build_dir/$binary_name"
	validate_binary_file "$target" "$build_dir/$binary_name" || true
	if [[ -n "$bundled_dir" ]]; then
		rm -rf "$bundled_dir"
		bundled_dir=""
		LEGACY_TRANSPILED_DIR=""
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

	if is_windows "$target"; then
		# WINDOWS (NSIS)
		check_tool "makensis"
		local nsis_dir="$BUILD_ROOT/nsis-$target"
		rm -rf "$nsis_dir"
		mkdir -p "$nsis_dir"
		TEMP_NSIS_DIR="$nsis_dir"

		# Stage files for NSIS
		cp "$build_dir"/*.exe "$nsis_dir/"
		cp "$RESOURCES_DIR/windows/installer.nsh" "$nsis_dir/"
		cp "$RESOURCES_DIR/windows/icon.ico" "$nsis_dir/"
		cp "$ROOT_DIR/LICENSE.txt" "$nsis_dir/"

		local installer_name="mvdcoapp-${target}.exe"

		log_info "  -> Running makensis..."
		(
			cd "$nsis_dir"
			makensis -DVERSION="$VERSION" -DOUTFILE="$installer_name" installer.nsh
		)

		local staged_installer="$nsis_dir/$installer_name"
		if [[ -f "$staged_installer" ]]; then
			mv "$staged_installer" "$DIST_DIR/$installer_name"
			log_info "✓ Installer created: dist/$installer_name"
		else
			log_error "NSIS failed to produce $staged_installer"
			exit 1
		fi
		rm -rf "$nsis_dir"

	elif is_mac "$target"; then
		# MACOS (DMG)
		check_tool "create-dmg"
		local app_name_dir="$BUILD_ROOT/${APP_NAME}.app"
		local dmg_name="mvdcoapp-${target}.dmg"

		local min_system_version
		if [[ "$target" == "mac10-x64" ]]; then
			min_system_version="10.10"
		elif [[ "$target" == "mac-x64" ]]; then
			min_system_version="10.15"
		elif [[ "$target" == "mac-arm64" ]]; then
			min_system_version="11.0"
		fi

		# Create .app bundle structure manually
		rm -rf "$app_name_dir"
		TEMP_APP_DIR="$app_name_dir"
		local macos_dir="$app_name_dir/Contents/MacOS"
		local resources_dir="$app_name_dir/Contents/Resources"
		mkdir -p "$macos_dir" "$resources_dir"

		cp "$build_dir"/* "$macos_dir/"

		# Info.plist
		cat >"$app_name_dir/Contents/Info.plist" <<EOF
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
		rm -f "$build_dir/$dmg_name"

		# Unmount stale if any
		if [ -d "/Volumes/Max Video Downloader CoApp" ]; then
			hdiutil detach "/Volumes/Max Video Downloader CoApp" -force >/dev/null 2>&1 || true
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
			"$build_dir/$dmg_name" \
			"$app_name_dir"

		if [[ -f "$build_dir/$dmg_name" ]]; then
			mv "$build_dir/$dmg_name" "$DIST_DIR/$dmg_name"
			log_info "✓ DMG created: dist/$dmg_name"
			rm -rf "$app_name_dir"
		else
			log_error "Failed to create DMG"
			exit 1
		fi

	elif is_linux "$target"; then
		# LINUX (TAR.GZ)
		local tar_name="mvdcoapp-${target}.tar.gz"
		local stage_dir="$BUILD_ROOT/mvdcoapp" # Use generic name in tar
		rm -rf "$stage_dir"
		mkdir -p "$stage_dir"
		TEMP_STAGE_DIR="$stage_dir"

		cp "$build_dir"/* "$stage_dir/"
		[[ -f "LICENSE.txt" ]] && cp "LICENSE.txt" "$stage_dir/"
		[[ -f "$RESOURCES_DIR/linux/README.md" ]] && cp "$RESOURCES_DIR/linux/README.md" "$stage_dir/"

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

	local checksum_file="$DIST_DIR/CHECKSUMS.sha256"
	rm -f "$checksum_file"

	log_info "  -> Recording checksums..."
	(
		cd "$DIST_DIR"
		# Sort results to have consistent order and use relative paths
		find . -type f -not -name ".DS_Store" -not -name "CHECKSUMS.sha256" | sort | while read -r file; do
			# Remove leading ./ for clean output
			local clean_file="${file#./}"
			"${checksum_tool[@]}" "$clean_file"
		done
	) >"$checksum_file"

	log_info "✓ Checksums recorded to dist/CHECKSUMS.sha256"
}

scan_virustotal() {
	if [[ -z "$VT_API_KEY" ]]; then
		log_warn "VirusTotal API key not found (VT_API_KEY env var)."
		log_warn "To enable scanning, create a .env file with VT_API_KEY=your_key"
		log_warn "See coapp/.env.example for reference."
		return 0
	fi

	if ! command -v node >/dev/null 2>&1; then
		log_warn "node not found. Skipping VirusTotal scan."
		return 0
	fi

	log_info "Fetching VirusTotal URL reports via Node script..."
	node "$ROOT_DIR/scripts/vt-scan.js" --dist "$DIST_DIR"
	return $?
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
	done < <(find "$DIST_DIR" -type f -not -name ".DS_Store" -not -name "CHECKSUMS.sha256" -print0)

	if [[ ${#artifacts[@]} -eq 0 ]]; then
		log_error "No artifacts found in dist/ directory"
		exit 1
	fi

	log_info "Found ${#artifacts[@]} CoApp artifacts to upload:"
	printf '  %s\n' "${artifacts[@]}"

	generate_checksums
	local checksum_file="$DIST_DIR/CHECKSUMS.sha256"
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
		cd "$ROOT_DIR" &&
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
if [[ "$COMMAND" != "build" && "$COMMAND" != "dist" && "$COMMAND" != "publish" && "$COMMAND" != "scan" ]]; then
	echo "Usage:"
	echo "  $0 build <target|all>"
	echo "  $0 dist <target|all>"
	echo "  $0 publish"
	echo "  $0 scan"
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

if [[ "$COMMAND" == "scan" ]]; then
	if [[ -n "$TARGET" ]]; then
		log_error "scan command does not accept a target argument"
		exit 1
	fi
	scan_virustotal
	exit 0
fi

check_tool "node"
check_tool "npx"

if ! npx --yes pkg --version >/dev/null 2>&1; then
	log_warn "No packager found via npx (pkg). Install it: npm i -D pkg"
fi

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
