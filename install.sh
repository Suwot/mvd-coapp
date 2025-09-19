#!/bin/bash
# MAX Video Downloader Native Host Installer
# Standalone installer script that registers the native host with browsers

set -e

# Get the directory containing this script (and the mvdcoapp binary)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY_PATH="$SCRIPT_DIR/mvdcoapp"

# Manifest content templates
CHROME_ORIGINS='  "allowed_origins": [
    "chrome-extension://bkblnddclhmmgjlmbofhakhhbklkcofd/",
    "chrome-extension://kjinbaahkmjgkkedfdgpkkelehofieke/"
  ]'

FIREFOX_EXTENSIONS='  "allowed_extensions": [
    "max-video-downloader@rostislav.dev"
  ]'

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

create_manifest() {
    local path="$1"
    local manifest_type="$2"
    
    if [[ "$manifest_type" == "firefox" ]]; then
        local origins_block="$FIREFOX_EXTENSIONS"
    else
        local origins_block="$CHROME_ORIGINS"
    fi
    
    cat > "$path" << MANIFEST_EOF
{
  "name": "pro.maxvideodownloader.coapp",
  "description": "MAX Video Downloader Native Host",
  "path": "$BINARY_PATH",
  "type": "stdio",
$origins_block
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
                create_manifest "$manifest_file" "firefox"
            else
                create_manifest "$manifest_file" "chrome"
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
                create_manifest "$manifest_file" "firefox"
            else
                create_manifest "$manifest_file" "chrome"
            fi
            
            echo -e "${GREEN}✓ Installed for $browser_name${NC}"
            installed_browsers+=("$browser_name")
        fi
    done
fi

echo ""
if [[ ${#installed_browsers[@]} -eq 0 ]]; then
    echo -e "${YELLOW}No supported browsers found.${NC}"
    echo ""
    echo "Please install one of these supported browsers:"
    echo "  • Google Chrome: https://www.google.com/chrome/"
    echo "  • Mozilla Firefox: https://www.mozilla.org/firefox/"
    echo "  • Microsoft Edge: https://www.microsoft.com/edge"
    echo "  • Brave Browser: https://brave.com/"
    echo "  • Opera: https://www.opera.com/"
    echo "  • Vivaldi: https://vivaldi.com/"
    echo ""
    echo "After installing, run this installer again."
    echo ""
    echo -e "${RED}Installation failed - no browsers detected${NC}"
    exit 1
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
    dialog_text="MAX Video Downloader installed for ${#installed_browsers[@]} browser(s):\\n\\n$browser_list"

    # Show dialog with OK and Uninstall buttons
    echo "Showing installation confirmation dialog..."
    
    # Temporarily disable set -e for osascript (needed because Uninstall is cancel button)
    set +e
    button_clicked=$(osascript -e "tell application \"System Events\" to display dialog \"$dialog_text\" buttons {\"Uninstall\", \"OK\"} default button \"OK\" cancel button \"Uninstall\"" 2>/dev/null)
    osascript_exit_code=$?
    set -e
    
    # Check both the output and exit code
    if [[ $osascript_exit_code -eq 0 && "$button_clicked" == "button returned:OK" ]]; then
        # User clicked OK
        echo "Installation confirmed. The extension should now work."
    else
        # User clicked Uninstall (or dialog was cancelled)
        echo "Uninstalling MAX Video Downloader..."
        uninstall_script="$SCRIPT_DIR/uninstall.sh"
        if [[ -f "$uninstall_script" ]]; then
            chmod +x "$uninstall_script"
            "$uninstall_script"
        else
            echo -e "${RED}Error: uninstall.sh not found at $uninstall_script${NC}"
            # Show error dialog on macOS
            if [[ "$OSTYPE" == "darwin"* ]]; then
                osascript -e "display dialog \"Error: Uninstall script not found at $uninstall_script\\n\\nPlease make sure uninstall.sh is in the same directory as install.sh.\" buttons {\"OK\"} default button \"OK\" with icon stop" 2>/dev/null || true
            fi
        fi
    fi
fi