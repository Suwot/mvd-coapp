#!/bin/bash
# MAX Video Downloader Native Host Installer
# Standalone installer script that registers the native host with browsers

set -e

# Get the directory containing this script (and the mvdcoapp binary)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY_PATH="$SCRIPT_DIR/mvdcoapp"

# Extension IDs
CHROME_EXT_ID_DEV="bkblnddclhmmgjlmbofhakhhbklkcofd"
CHROME_EXT_ID_PROD="kjinbaahkmjgkkedfdgpkkelehofieke"
FIREFOX_EXT_ID="max-video-downloader@rostislav.dev"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "MAX Video Downloader Native Host Installer"
echo "=========================================="
echo "Installing from: $BINARY_PATH"
echo ""

# Check if binary exists
if [[ ! -f "$BINARY_PATH" ]]; then
    echo -e "${RED}Error: mvdcoapp binary not found at $BINARY_PATH${NC}"
    exit 1
fi

# Make sure binary is executable
chmod +x "$BINARY_PATH"

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

installed_browsers=()

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS installation
    browsers=(
        "/Applications/Google Chrome.app:$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts:chrome:Google Chrome"
        "/Applications/Google Chrome Canary.app:$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts:chrome:Google Chrome Canary"
        "/Applications/Arc.app:$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts:chrome:Arc"
        "/Applications/Microsoft Edge.app:$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts:chrome:Microsoft Edge"
        "/Applications/Microsoft Edge Beta.app:$HOME/Library/Application Support/Microsoft Edge Beta/NativeMessagingHosts:chrome:Microsoft Edge Beta"
        "/Applications/Microsoft Edge Dev.app:$HOME/Library/Application Support/Microsoft Edge Dev/NativeMessagingHosts:chrome:Microsoft Edge Dev"
        "/Applications/Microsoft Edge Canary.app:$HOME/Library/Application Support/Microsoft Edge Canary/NativeMessagingHosts:chrome:Microsoft Edge Canary"
        "/Applications/Brave Browser.app:$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts:chrome:Brave Browser"
        "/Applications/Opera.app:$HOME/Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts:chrome:Opera"
        "/Applications/Vivaldi.app:$HOME/Library/Application Support/Vivaldi/NativeMessagingHosts:chrome:Vivaldi"
        "/Applications/Epic Privacy Browser.app:$HOME/Library/Application Support/Epic Privacy Browser/NativeMessagingHosts:chrome:Epic Privacy Browser"
        "/Applications/Yandex.app:$HOME/Library/Application Support/Yandex/YandexBrowser/NativeMessagingHosts:chrome:Yandex Browser"
        "/Applications/Firefox.app:$HOME/Library/Application Support/Mozilla/NativeMessagingHosts:firefox:Firefox"
        "/Applications/Tor Browser.app:$HOME/Library/Application Support/TorBrowser-Data/Browser/NativeMessagingHosts:firefox:Tor Browser"
    )
    
    for entry in "${browsers[@]}"; do
        IFS=':' read -r app_path manifest_dir browser_type browser_name <<< "$entry"
        
        if [[ -d "$app_path" ]]; then
            mkdir -p "$manifest_dir"
            manifest_file="$manifest_dir/pro.maxvideodownloader.coapp.json"
            
            if [[ "$browser_type" == "firefox" ]]; then
                create_firefox_manifest "$manifest_file"
            else
                create_chrome_manifest "$manifest_file"
            fi
            
            echo -e "${GREEN}✓ Installed for $browser_name${NC}"
            installed_browsers+=("$browser_name")
        fi
    done
    
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    # Windows installation (requires Windows Subsystem or Git Bash)
    echo -e "${YELLOW}Windows installation requires running install.bat instead${NC}"
    exit 1
    
else
    # Linux installation
    browsers=(
        "google-chrome:$HOME/.config/google-chrome/NativeMessagingHosts:chrome:Google Chrome"
        "google-chrome-beta:$HOME/.config/google-chrome-beta/NativeMessagingHosts:chrome:Google Chrome Beta"
        "google-chrome-unstable:$HOME/.config/google-chrome-unstable/NativeMessagingHosts:chrome:Google Chrome Dev"
        "chromium-browser:$HOME/.config/chromium/NativeMessagingHosts:chrome:Chromium"
        "microsoft-edge:$HOME/.config/microsoft-edge/NativeMessagingHosts:chrome:Microsoft Edge"
        "microsoft-edge-beta:$HOME/.config/microsoft-edge-beta/NativeMessagingHosts:chrome:Microsoft Edge Beta"
        "microsoft-edge-dev:$HOME/.config/microsoft-edge-dev/NativeMessagingHosts:chrome:Microsoft Edge Dev"
        "brave-browser:$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts:chrome:Brave Browser"
        "opera:$HOME/.config/opera/NativeMessagingHosts:chrome:Opera"
        "vivaldi:$HOME/.config/vivaldi/NativeMessagingHosts:chrome:Vivaldi"
        "yandex-browser:$HOME/.config/yandex-browser/NativeMessagingHosts:chrome:Yandex Browser"
        "firefox:$HOME/.mozilla/native-messaging-hosts:firefox:Firefox"
    )
    
    for entry in "${browsers[@]}"; do
        IFS=':' read -r cmd manifest_dir browser_type browser_name <<< "$entry"
        
        if command -v "$cmd" >/dev/null 2>&1; then
            mkdir -p "$manifest_dir"
            manifest_file="$manifest_dir/pro.maxvideodownloader.coapp.json"
            
            if [[ "$browser_type" == "firefox" ]]; then
                create_firefox_manifest "$manifest_file"
            else
                create_chrome_manifest "$manifest_file"
            fi
            
            echo -e "${GREEN}✓ Installed for $browser_name${NC}"
            installed_browsers+=("$browser_name")
        fi
    done
fi

echo ""
if [[ ${#installed_browsers[@]} -eq 0 ]]; then
    echo -e "${YELLOW}No supported browsers found.${NC}"
    echo "Please install Chrome, Firefox, or another supported browser."
else
    echo -e "${GREEN}Installation complete!${NC}"
    echo "Installed for ${#installed_browsers[@]} browser(s):"
    for browser in "${installed_browsers[@]}"; do
        echo "  • $browser"
    done
    echo ""
    echo "The MAX Video Downloader extension should now work."
fi

# Show GUI dialog on macOS
if [[ "$OSTYPE" == "darwin"* && ${#installed_browsers[@]} -gt 0 ]]; then
    browser_list=$(printf "• %s\n" "${installed_browsers[@]}")
    osascript -e "display dialog \"MAX Video Downloader installed for ${#installed_browsers[@]} browser(s):\n\n$browser_list\" buttons {\"OK\"} default button \"OK\"" 2>/dev/null || true
fi