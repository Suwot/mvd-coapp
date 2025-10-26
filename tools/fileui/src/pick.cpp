// Minimal, fast file/folder picker using IFileDialog.
// Prints UTF-8 (no BOM) absolute path to stdout; exits 0 on success, 1 on cancel/error.
//
// Usage:
//   mvd-fileui.exe --mode pick-folder [--title "Choose Folder"] [--initial "C:\path"]
//   mvd-fileui.exe --mode save-file  [--title "Save As"] [--initial "C:\path"] [--name "myfile.mp4"]
//
// Backward compatibility:
//   mvd-fileui.exe                -> defaults to --mode pick-folder
//   mvd-fileui.exe "Pick folder"  -> --mode pick-folder --title "Pick folder"
//   mvd-fileui.exe "Pick" "C:\Users\Public" -> --mode pick-folder --title "Pick" --initial "C:\Users\Public"
//
// Notes:
// - Requires STA COM apartment.
// - Windows Vista+ API; tested Win 8/8.1/10/11.
// - Build for x64 now; arm64 later (same source).

#define NOMINMAX
#include <windows.h>
#include <shobjidl.h>      // IFileDialog
#include <shlobj.h>        // SIGDN_*
#include <shellapi.h>      // CommandLineToArgvW
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

enum DialogMode {
    MODE_PICK_FOLDER,
    MODE_SAVE_FILE
};

static int write_utf8_stdout(const wchar_t* wstr) {
    if (!wstr) return 1;
    int needed = WideCharToMultiByte(CP_UTF8, 0, wstr, -1, nullptr, 0, nullptr, nullptr);
    if (needed <= 1) return 1;
    // Exclude terminating NUL from output
    int written = WideCharToMultiByte(CP_UTF8, 0, wstr, -1, nullptr, 0, nullptr, nullptr);
    char* buf = (char*)malloc((size_t)needed);
    if (!buf) return 1;
    WideCharToMultiByte(CP_UTF8, 0, wstr, -1, buf, needed, nullptr, nullptr);
    // print without the trailing '\0'
    size_t len = (size_t)needed - 1;
    size_t out = fwrite(buf, 1, len, stdout);
    free(buf);
    return (out == len) ? 0 : 1;
}

static IShellItem* shell_item_from_path(const wchar_t* path) {
    if (!path || !*path) return nullptr;
    IShellItem* psi = nullptr;
    // SHCreateItemFromParsingName is available on Vista+
    if (SUCCEEDED(SHCreateItemFromParsingName(path, nullptr, IID_PPV_ARGS(&psi)))) {
        return psi;
    }
    return nullptr;
}

static bool parse_args(int argc, LPWSTR* argv, DialogMode& mode, const wchar_t*& title, const wchar_t*& initial, const wchar_t*& filename) {
    mode = MODE_PICK_FOLDER; // default
    title = L"Choose Folder";
    initial = nullptr;
    filename = nullptr;

    // Check for --mode flag (new style)
    for (int i = 1; i < argc; ++i) {
        if (wcscmp(argv[i], L"--mode") == 0 && i + 1 < argc) {
            if (wcscmp(argv[i + 1], L"pick-folder") == 0) {
                mode = MODE_PICK_FOLDER;
            } else if (wcscmp(argv[i + 1], L"save-file") == 0) {
                mode = MODE_SAVE_FILE;
            } else {
                return false; // invalid mode
            }
            i++; // skip the mode value
        } else if (wcscmp(argv[i], L"--title") == 0 && i + 1 < argc) {
            title = argv[i + 1];
            i++;
        } else if (wcscmp(argv[i], L"--initial") == 0 && i + 1 < argc) {
            initial = argv[i + 1];
            i++;
        } else if (wcscmp(argv[i], L"--name") == 0 && i + 1 < argc) {
            filename = argv[i + 1];
            i++;
        } else {
            // Backward compatibility: treat positional args as title and initial
            if (i == 1) title = argv[i];
            else if (i == 2) initial = argv[i];
        }
    }
    return true;
}

int main() {
    // Parse Unicode argv via CommandLineToArgvW to be robust across CRTs
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    
    DialogMode mode;
    const wchar_t* title;
    const wchar_t* initial;
    const wchar_t* filename;
    
    if (!parse_args(argc, argv, mode, title, initial, filename)) {
        LocalFree(argv);
        return 1; // invalid arguments
    }

    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    if (FAILED(hr)) {
        LocalFree(argv);
        return 1;
    }

    IFileDialog* pfd = nullptr;
    if (mode == MODE_PICK_FOLDER) {
        hr = CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&pfd));
    } else { // MODE_SAVE_FILE
        hr = CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&pfd));
    }
    
    if (FAILED(hr) || !pfd) {
        LocalFree(argv);
        CoUninitialize();
        return 1;
    }

    DWORD opts = 0;
    if (SUCCEEDED(pfd->GetOptions(&opts))) {
        if (mode == MODE_PICK_FOLDER) {
            // Pick folders; filesystem only; avoid changing CWD; don't add to recent; require initial path exists
            opts |= FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR | FOS_DONTADDTORECENT | FOS_PATHMUSTEXIST;
        } else { // MODE_SAVE_FILE
            // Save file; filesystem only; show overwrite prompt; avoid changing CWD; don't add to recent; require initial path exists
            opts |= FOS_OVERWRITEPROMPT | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR | FOS_DONTADDTORECENT | FOS_PATHMUSTEXIST;
        }
        pfd->SetOptions(opts);
    }

    if (title && *title) {
        pfd->SetTitle(title);
    }

    // Set filename for save dialog
    if (mode == MODE_SAVE_FILE && filename && *filename) {
        IFileSaveDialog* pfsd = nullptr;
        if (SUCCEEDED(pfd->QueryInterface(IID_PPV_ARGS(&pfsd)))) {
            pfsd->SetFileName(filename);
            pfsd->Release();
        }
    }

    // If an initial folder is provided and exists, set it as the starting location
    IShellItem* initialItem = shell_item_from_path(initial);
    if (initialItem) {
        pfd->SetFolder(initialItem);       // Prefer SetFolder (current view)
        pfd->SetDefaultFolder(initialItem); // and SetDefaultFolder (fallback)
        initialItem->Release();
    }

    hr = pfd->Show(nullptr);
    if (hr != S_OK) {
        LocalFree(argv);
        pfd->Release();
        CoUninitialize();
        return 1; // cancel or error
    }

    IShellItem* psi = nullptr;
    hr = pfd->GetResult(&psi);
    if (FAILED(hr) || !psi) {
        LocalFree(argv);
        pfd->Release();
        CoUninitialize();
        return 1;
    }

    PWSTR wz = nullptr;
    hr = psi->GetDisplayName(SIGDN_FILESYSPATH, &wz);
    int rc = 1;
    if (SUCCEEDED(hr) && wz && *wz) {
        rc = write_utf8_stdout(wz);
        CoTaskMemFree(wz);
    }
    psi->Release();
    pfd->Release();
    CoUninitialize();
    LocalFree(argv);
    return rc == 0 ? 0 : 1;
}