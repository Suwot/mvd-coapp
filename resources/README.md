# CoApp Build Resources

Assets and templates for cross-platform packaging of the MAX Video Downloader CoApp.

## Platform Resources

### Linux (`/linux`)
- `install.sh`: The primary one-liner delivery script.
- `README.md`: Distributed inside the `.tar.gz`.

### macOS (`/mac`)
- `AppIcon.icns`: High-resolution application iconсет.
- `AppIcon.icns`: Standard icon for the app bundle.
- `dmg-background.png`: Custom installer background.
- `README.txt`: Distributed inside the `.dmg`.

### Windows (`/windows`)
- `icon.ico`: Multi-resolution icon.
- `installer.nsh`: NSIS template for creating the Windows `.exe` installer.

## Architecture Notes
- All installer templates are designed for "Current User" installation (no admin/sudo required by default).
- Distribution binaries are standalone and include a static copy of the **GPL v3 License**.

## Maintenance
When updating icons:
- **macOS**: Use `iconutil -c icns AppIcon.iconset` to regenerate `AppIcon.icns`.
- **Windows**: Use `ffmpeg` or `magick` to combine PNG layers into the `.ico`.

## License
GPL v3 (GPL-3.0-only) - Free and Open Source. Attribution required.