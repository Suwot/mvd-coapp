#!/bin/bash
# MAX Video Downloader Native Host Uninstaller
# Removes native messaging manifests from all browsers

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "MAX Video Downloader Native Host Uninstaller"
echo "============================================"
echo ""

removed_browsers=()

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS uninstallation
    manifest_dirs=(
        "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts:Google Chrome"
        "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts:Google Chrome Canary"
        "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts:Arc"
        "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts:Microsoft Edge"
        "$HOME/Library/Application Support/Microsoft Edge Beta/NativeMessagingHosts:Microsoft Edge Beta"
        "$HOME/Library/Application Support/Microsoft Edge Dev/NativeMessagingHosts:Microsoft Edge Dev"
        "$HOME/Library/Application Support/Microsoft Edge Canary/NativeMessagingHosts:Microsoft Edge Canary"
        "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts:Brave Browser"
        "$HOME/Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts:Opera"
        "$HOME/Library/Application Support/Vivaldi/NativeMessagingHosts:Vivaldi"
        "$HOME/Library/Application Support/Epic Privacy Browser/NativeMessagingHosts:Epic Privacy Browser"
        "$HOME/Library/Application Support/Yandex/YandexBrowser/NativeMessagingHosts:Yandex Browser"
        "$HOME/Library/Application Support/Mozilla/NativeMessagingHosts:Firefox"
        "$HOME/Library/Application Support/TorBrowser-Data/Browser/NativeMessagingHosts:Tor Browser"
    )
    
    for entry in "${manifest_dirs[@]}"; do
        IFS=':' read -r manifest_dir browser_name <<< "$entry"
        manifest_file="$manifest_dir/pro.maxvideodownloader.coapp.json"
        
        if [[ -f "$manifest_file" ]]; then
            rm "$manifest_file"
            echo -e "${GREEN}✓ Removed from $browser_name${NC}"
            removed_browsers+=("$browser_name")
        fi
    done
    
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    # Windows uninstallation (requires Windows Subsystem or Git Bash)
    echo -e "${YELLOW}Windows uninstallation requires running uninstall.bat instead${NC}"
    exit 1
    
else
    # Linux uninstallation
    manifest_dirs=(
        "$HOME/.config/google-chrome/NativeMessagingHosts:Google Chrome"
        "$HOME/.config/google-chrome-beta/NativeMessagingHosts:Google Chrome Beta"
        "$HOME/.config/google-chrome-unstable/NativeMessagingHosts:Google Chrome Dev"
        "$HOME/.config/chromium/NativeMessagingHosts:Chromium"
        "$HOME/.config/microsoft-edge/NativeMessagingHosts:Microsoft Edge"
        "$HOME/.config/microsoft-edge-beta/NativeMessagingHosts:Microsoft Edge Beta"
        "$HOME/.config/microsoft-edge-dev/NativeMessagingHosts:Microsoft Edge Dev"
        "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts:Brave Browser"
        "$HOME/.config/opera/NativeMessagingHosts:Opera"
        "$HOME/.config/vivaldi/NativeMessagingHosts:Vivaldi"
        "$HOME/.config/yandex-browser/NativeMessagingHosts:Yandex Browser"
        "$HOME/.mozilla/native-messaging-hosts:Firefox"
    )
    
    for entry in "${manifest_dirs[@]}"; do
        IFS=':' read -r manifest_dir browser_name <<< "$entry"
        manifest_file="$manifest_dir/pro.maxvideodownloader.coapp.json"
        
        if [[ -f "$manifest_file" ]]; then
            rm "$manifest_file"
            echo -e "${GREEN}✓ Removed from $browser_name${NC}"
            removed_browsers+=("$browser_name")
        fi
    done
fi

echo ""
if [[ ${#removed_browsers[@]} -eq 0 ]]; then
    echo -e "${YELLOW}No installations found to remove.${NC}"
else
    echo -e "${GREEN}Uninstallation complete!${NC}"
    echo "Removed from ${#removed_browsers[@]} browser(s):"
    for browser in "${removed_browsers[@]}"; do
        echo "  • $browser"
    done
fi

# Show GUI dialog on macOS
if [[ "$OSTYPE" == "darwin"* && ${#removed_browsers[@]} -gt 0 ]]; then
    browser_list=$(printf "• %s\n" "${removed_browsers[@]}")
    osascript -e "display dialog \"MAX Video Downloader removed from ${#removed_browsers[@]} browser(s):\n\n$browser_list\" buttons {\"OK\"} default button \"OK\"" 2>/dev/null || true
fi