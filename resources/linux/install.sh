#!/bin/bash
# MAX Video Downloader CoApp Installer
# Usage: curl -sSLf https://github.com/Suwot/mvd-coapp/releases/latest/download/install.sh | bash

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Show MAX Video Downloader logo
show_logo() {
    echo ""
    echo -e "${BLUE}███╗░░░███╗░█████╗░██╗░░██╗  ██╗░░░██╗██╗██████╗░███████╗░█████╗░${NC}"
    echo -e "${BLUE}████╗░████║██╔══██╗╚██╗██╔╝  ██║░░░██║██║██╔══██╗██╔════╝██╔══██╗${NC}"
    echo -e "${BLUE}██╔████╔██║███████║░╚███╔╝░  ╚██╗░██╔╝██║██║░░██║█████╗░░██║░░██║${NC}"
    echo -e "${BLUE}██║╚██╔╝██║██╔══██║░██╔██╗░  ░╚████╔╝░██║██║░░██║██╔══╝░░██║░░██║${NC}"
    echo -e "${BLUE}██║░╚═╝░██║██║░░██║██╔╝╚██╗  ░░╚██╔╝░░██║██████╔╝███████╗╚█████╔╝${NC}"
    echo -e "${BLUE}╚═╝░░░░░╚═╝╚═╝░░╚═╝╚═╝░░╚═╝  ░░░╚═╝░░░╚═╝╚═════╝░╚══════╝░╚════╝░${NC}"
    echo ""
    echo -e "${YELLOW}                    Companion App Installer${NC}"
    echo ""
}

# Print colored output
print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Single user installation only

show_logo

echo "This script will:"
echo "• Download the MAX Video Downloader companion app (CoApp)"
echo "• Install it to ~/.local/share/mvdcoapp (user-level, no sudo needed)"
echo "• Register with all detected browsers for native messaging"
echo ""

# Prevent running as root
if [ "$EUID" -eq 0 ]; then
  print_error "Don't run this installer as root"
  echo "This installs to your user directory (~/.local/share/mvdcoapp)"
  echo "Running as root would install to /root and cause browser connection issues"
  echo ""
  echo "Run without sudo:"
  echo "  curl -sSLf https://github.com/Suwot/mvd-coapp/releases/latest/download/install.sh | bash"
  exit 1
fi

host_os=$(uname -s)
host_arch=$(uname -m)

case $host_os in
  Linux)
    host_os="linux"
    ;;
  *)
    print_error "Unsupported platform: $host_os"
    echo "Supported platforms: Linux"
    exit 1
    ;;
esac

case $host_arch in
  x86_64)
    host_arch="x64"
    ;;
  aarch64|arm64|armv8*)
    host_arch="arm64"
    ;;
  armv7l|armv6l)
    print_error "32-bit ARM is not supported"
    echo "Your architecture: $host_arch"
    echo "Supported architectures: x86_64, aarch64/arm64"
    echo ""
    echo "Please use a 64-bit ARM system (aarch64) or x86_64 system."
    exit 1
    ;;
  *)
    print_error "Unsupported architecture: $host_arch"
    echo "Supported architectures: x86_64, aarch64/arm64"
    exit 1
    ;;
esac

host="${host_os}-${host_arch}"

# Check for curl and provide distro-specific install instructions
if ! [ -x "$(command -v curl)" ]; then
  print_error "curl not installed. Please install curl first:"
  
  # Detect package manager and provide appropriate command
  if [ -x "$(command -v apt)" ]; then
    echo "  sudo apt install curl"
  elif [ -x "$(command -v dnf)" ]; then
    echo "  sudo dnf install curl"
  elif [ -x "$(command -v yum)" ]; then
    echo "  sudo yum install curl"
  elif [ -x "$(command -v pacman)" ]; then
    echo "  sudo pacman -S curl"
  elif [ -x "$(command -v zypper)" ]; then
    echo "  sudo zypper install curl"
  elif [ -x "$(command -v apk)" ]; then
    echo "  sudo apk add curl"
  else
    echo "  Use your system's package manager to install curl"
    echo "  Common commands:"
    echo "    Ubuntu/Debian: sudo apt install curl"
    echo "    Fedora: sudo dnf install curl"
    echo "    CentOS/RHEL: sudo yum install curl"
    echo "    Arch: sudo pacman -S curl"
    echo "    openSUSE: sudo zypper install curl"
    echo "    Alpine: sudo apk add curl"
  fi
  exit 1
fi

# Flatpak detection and setup is handled by mvdcoapp -install

# Try to get version from GitHub API (optional - for display only)
print_status "Fetching latest version..."
version=$(curl -s --max-time 10 "https://api.github.com/repos/Suwot/mvd-coapp/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/' | sed 's/^v//' || echo "")

if [ -z "$version" ] || [ "$version" = "null" ]; then
  print_warning "Could not fetch version info (network issue), continuing with installation..."
  version="latest"
fi

# Use dynamic latest release URL
url="https://github.com/Suwot/mvd-coapp/releases/latest/download/mvdcoapp-${host}.tar.gz"
checksum_url="https://github.com/Suwot/mvd-coapp/releases/latest/download/CHECKSUMS.sha256"

echo "Downloading MAX Video Downloader CoApp for ${host}..."
echo "URL: $url"

# Create temporary directory for safe extraction
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

archive="$tmpdir/mvdcoapp.tar.gz"
checksums="$tmpdir/CHECKSUMS.sha256"

# Function to download with retries
download_with_retry() {
  local url="$1"
  local output="$2"
  local max_attempts=3
  local attempt=1
  
  while [ $attempt -le $max_attempts ]; do
    if [ $attempt -gt 1 ]; then
      local wait_time=$((attempt * 2))
      echo "Retrying in ${wait_time}s... (attempt $attempt/$max_attempts)"
      sleep $wait_time
    fi
    
    if curl -fL --connect-timeout 30 --max-time 1800 "$url" -o "$output"; then
      return 0
    fi
    
    attempt=$((attempt + 1))
  done
  
  return 1
}

# Download checksums first for verification
print_status "Downloading checksums..."
if ! download_with_retry "$checksum_url" "$checksums"; then
  print_error "Failed to download checksums after 3 attempts"
  echo "Cannot verify download integrity without checksums"
  exit 1
fi

# Download with error checking
print_status "Downloading from GitHub releases..."
if ! download_with_retry "$url" "$archive"; then
  print_error "Download failed for ${host}"
  echo "URL: $url"
  echo ""
  echo "Possible causes:"
  echo "  • Internet connection issue"
  echo "  • GitHub releases temporarily unavailable"
  echo "  • Release not yet available for your platform (${host})"
  echo ""
  echo "Please check your connection and try again in a few minutes"
  exit 1
fi

# Verify checksum
print_status "Verifying download integrity..."
# Use more specific grep to avoid matching other files (like .sig or .tar.gz.something)
# Format is: <checksum><spaces><filename>
expected_checksum=$(grep "[[:space:]]mvdcoapp-${host}.tar.gz$" "$checksums" | head -n 1 | awk '{print $1}' || echo "")
if [ -z "$expected_checksum" ]; then
  # Fallback: try without anchor if no match
  expected_checksum=$(grep "mvdcoapp-${host}.tar.gz" "$checksums" | head -n 1 | awk '{print $1}' || echo "")
fi

if [ -z "$expected_checksum" ]; then
  print_error "Checksum not found for ${host} in CHECKSUMS.sha256"
  echo "Your platform may not be supported yet"
  exit 1
fi

actual_checksum=$(sha256sum "$archive" | awk '{print $1}')
if [ "$actual_checksum" != "$expected_checksum" ]; then
  print_warning "Checksum verification failed"
  echo "Expected sha256: $expected_checksum"
  echo "Actual sha256:  $actual_checksum"
  echo "Continuing with installation anyway..."
else
  print_success "Checksum verified"
fi

print_status "Extracting archive..."
# Extract with hardening: suppress irrelevant warnings
if ! tar --warning=no-unknown-keyword -xzf "$archive" -C "$tmpdir"; then
  print_error "Archive extraction failed"
  echo "The downloaded file may be corrupted or incomplete"
  echo "Archive location: $archive"
  echo ""
  echo "Try running the installer again to re-download"
  exit 1
fi

# Install to user directory
install_dir="$HOME/.local/share/mvdcoapp"
staging_dir="${install_dir}.new"

print_status "Installing to $install_dir..."

# Check if we can create the install directory
if ! mkdir -p "$(dirname "$install_dir")" 2>/dev/null; then
  print_error "Cannot create installation directory: $(dirname "$install_dir")"
  echo "Check permissions or try running as different user"
  exit 1
fi

# Validate extracted archive structure
if [ ! -d "$tmpdir/mvdcoapp" ]; then
  print_error "Invalid archive structure"
  echo "Expected directory 'mvdcoapp' not found in archive"
  echo "The archive may be corrupted or have unexpected layout"
  exit 1
fi

# Stage to temporary location first (atomic replacement)
print_status "Staging installation..."
rm -rf "$staging_dir" 2>/dev/null || true
mv "$tmpdir/mvdcoapp" "$staging_dir"

# Test binary before finalizing installation
print_status "Verifying binary works..."
if ! "$staging_dir/mvdcoapp" -version >/dev/null 2>&1; then
  print_error "Binary verification failed"
  echo "The downloaded binary may be corrupted or incompatible"
  echo "Platform: ${host}"
  rm -rf "$staging_dir"
  exit 1
fi

# Atomic swap - backup existing and replace
if [ -d "$install_dir" ]; then
  print_status "Backing up existing installation..."
  mv "$install_dir" "${install_dir}.backup" || {
    print_error "Cannot backup existing installation"
    rm -rf "$staging_dir"
    exit 1
  }
fi

print_status "Finalizing installation..."
if ! mv "$staging_dir" "$install_dir"; then
  print_error "Failed to finalize installation"
  # Restore backup if available
  if [ -d "${install_dir}.backup" ]; then
    echo "Restoring previous installation..."
    mv "${install_dir}.backup" "$install_dir"
  fi
  exit 1
fi

# Clean up backup on successful install
rm -rf "${install_dir}.backup" 2>/dev/null || true

# Temp directory will be cleaned up by trap on exit

print_status "Registering CoApp with browsers..."
"$install_dir/mvdcoapp" -install

print_success "CoApp is working correctly"

echo ""
echo "✓ MAX Video Downloader CoApp successfully installed!"
echo "Location: $install_dir"
if [ "$version" != "unknown" ]; then
  echo "Version: $version"
fi
echo ""
echo "To uninstall: $install_dir/mvdcoapp -uninstall"
echo "To update: re-run this install script"
echo ""
echo "Per-user installation: Only available to current user"
echo ""
echo "Next steps:"
echo "1. Install the browser extension from the Chrome Web Store or Edge/Firefox Add-ons"
echo "2. The CoApp will automatically connect when you use the extension"
echo "3. See $install_dir/README.md for more information"
echo ""
