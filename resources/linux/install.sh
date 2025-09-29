#!/bin/bash

set -euo pipefail

# Parse command line arguments
SYSTEM_WIDE=false
if [ "${1:-}" = "--system" ]; then
    SYSTEM_WIDE=true
    echo "Installing system-wide (requires sudo)..."
    if [ "$EUID" -eq 0 ]; then
        echo "E: Don't run with sudo directly. The script will ask for sudo when needed."
        exit 1
    fi
fi

host_os=$(uname -s)
host_arch=$(uname -m)

case $host_os in
  Linux)
    host_os="linux"
    ;;
  *)
    echo "E: Unsupported platform: $host_os"
    echo "Supported platforms: Linux"
    exit 1
    ;;
esac

case $host_arch in
  x86_64)
    host_arch="x64"
    ;;
  aarch64|armv8*)
    host_arch="arm64"
    ;;
  *)
    echo "E: Unsupported architecture: $host_arch"
    echo "Supported architectures: x86_64, aarch64"
    exit 1
    ;;
esac

host="${host_os}-${host_arch}"

if ! [ -x "$(command -v curl)" ]; then
  echo "E: curl not installed. Please install curl first:"
  echo "  Ubuntu/Debian: sudo apt install curl"
  echo "  CentOS/RHEL: sudo yum install curl"
  echo "  Fedora: sudo dnf install curl"
  exit 1
fi

# Print Flatpak note if on Ubuntu and Flatpak not available
if [ -x "$(command -v lsb_release)" ] && [ "$(lsb_release -si)" == "Ubuntu" ] && ! [ -x "$(command -v flatpak)" ]; then
  echo "Note: Flatpak not detected. If using Flatpak Firefox, install Flatpak first:"
  echo "  sudo apt install flatpak"
  echo "  Then run: flatpak override --user --filesystem=~/.mozilla/native-messaging-hosts org.mozilla.firefox"
fi

# Try to get version from GitHub API (optional - for display only)
version=$(curl -s "https://api.github.com/repos/Suwot/mvd-coapp/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/' | sed 's/^v//')

if [ -z "$version" ] || [ "$version" = "null" ]; then
  version="unknown"
fi

# Use dynamic latest release URL
url="https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-${host}.tar.gz"

echo "Downloading MAX Video Downloader CoApp for ${host}..."
echo "URL: $url"

# Create temporary directory for safe extraction
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

archive="$tmpdir/mvdcoapp.tar.gz"

# Download with error checking
if ! curl -fL "$url" -o "$archive"; then
  echo "E: Download failed"
  echo "Please check your internet connection and try again"
  echo "If the problem persists, the release may not be available for your platform yet"
  exit 1
fi

echo "Extracting archive..."
if ! tar -xzf "$archive" -C "$tmpdir"; then
  echo "E: Extraction failed"
  echo "The downloaded archive may be corrupted"
  exit 1
fi

# Determine install paths
if [ "$SYSTEM_WIDE" = true ]; then
  install_dir="/opt/mvdcoapp"
  manifest_base="/etc"
  sudo_cmd="sudo"
else
  install_dir="$HOME/.local/share/mvdcoapp"
  manifest_base="$HOME/.mozilla"
  sudo_cmd=""
fi

echo "Installing to $install_dir..."

# Create install directory
$sudo_cmd mkdir -p "$(dirname "$install_dir")"

# Backup existing installation if it exists
if [ -d "$install_dir" ]; then
  backup_dir="${install_dir}.backup.$(date +%Y%m%d_%H%M%S)"
  echo "Backing up existing installation to $backup_dir"
  $sudo_cmd mv "$install_dir" "$backup_dir"
fi

# Move extracted files to install directory
$sudo_cmd mv "$tmpdir/mvdcoapp" "$install_dir"

# Clean up temp directory
rm -rf "$tmpdir"
trap - EXIT

echo "Registering CoApp with browsers..."
$sudo_cmd "$link_dir/mvdcoapp" install

echo ""
echo "✓ MAX Video Downloader CoApp successfully installed!"
echo "Location: $install_dir"
if [ "$version" != "unknown" ]; then
  echo "Version: $version"
fi
echo ""
echo "To uninstall: $sudo_cmd $install_dir/mvdcoapp uninstall"
echo "To update: re-run this install script"
echo ""
if [ "$SYSTEM_WIDE" = true ]; then
  echo "System-wide installation: Available to all users"
else
  echo "Per-user installation: Only available to current user"
fi
echo ""
echo "Make sure your browser extension is installed and configured."