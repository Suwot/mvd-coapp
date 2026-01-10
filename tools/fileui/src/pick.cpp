// Minimal, fast file/folder picker and shell operations using IFileDialog + SHOpenFolderAndSelectItems.
// Prints UTF-8 (no BOM) absolute path to stdout; exits 0 on success, 1 on cancel/error.
//
// Usage:
//   mvd-fileui.exe --mode pick-folder [--title "Choose Folder"] [--initial "C:\path"]
//   mvd-fileui.exe --mode save-file  [--title "Save As"] [--initial "C:\path"] [--name "myfile.mp4"]
//   mvd-fileui.exe --mode reveal --path "C:\path\to\file.txt"
//   mvd-fileui.exe --mode open-folder --path "C:\path\to\folder"
//   mvd-fileui.exe --mode open-file --path "C:\path\to\file.txt"
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
// - Long path (> 260 chars) support via SHParseDisplayName + SHOpenFolderAndSelectItems (no MAX_PATH limit).

#define NOMINMAX
#include <windows.h>
#include <shobjidl.h>      // IFileDialog, SHOpenFolderAndSelectItems
#include <shlobj.h>        // SIGDN_*, SHParseDisplayName
#include <shellapi.h>      // CommandLineToArgvW
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

enum DialogMode {
    MODE_PICK_FOLDER,
    MODE_SAVE_FILE,
    MODE_REVEAL,        // Open folder and select file (long-path safe)
    MODE_OPEN_FOLDER,   // Open folder (long-path safe)
    MODE_OPEN_FILE      // Open file with default application (long-path safe)
};

static int write_utf8_stdout(const wchar_t* wstr) {
    if (!wstr) return 1;
    // Get size needed for UTF-8 conversion (includes NUL terminator)
    int needed = WideCharToMultiByte(CP_UTF8, 0, wstr, -1, nullptr, 0, nullptr, nullptr);
    if (needed <= 1) return 1;
    // Allocate buffer and convert once
    char* buf = (char*)malloc((size_t)needed);
    if (!buf) return 1;
    WideCharToMultiByte(CP_UTF8, 0, wstr, -1, buf, needed, nullptr, nullptr);
    // Write to stdout without the trailing '\0'
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
            } else if (wcscmp(argv[i + 1], L"reveal") == 0) {
                mode = MODE_REVEAL;
            } else if (wcscmp(argv[i + 1], L"open-folder") == 0) {
                mode = MODE_OPEN_FOLDER;
            } else if (wcscmp(argv[i + 1], L"open-file") == 0) {
                mode = MODE_OPEN_FILE;
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
        } else if (wcscmp(argv[i], L"--path") == 0 && i + 1 < argc) {
            // --path is used for reveal and open-folder modes
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

// Open folder and select file using SHOpenFolderAndSelectItems (long-path safe, no MAX_PATH limit)
// Correctly builds parent folder PIDL + child PIDL from absolute file PIDL
static int reveal_file(const wchar_t* filepath) {
    if (!filepath || !*filepath) {
        fwprintf(stderr, L"reveal: invalid-path\n");
        return 1;
    }
    
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    if (FAILED(hr)) {
        fwprintf(stderr, L"reveal: com-init-failed\n");
        return 1;
    }
    
    // Parse file path to absolute PIDL (handles long paths > 260 chars)
    PIDLIST_ABSOLUTE pidlFile = nullptr;
    hr = SHParseDisplayName(filepath, nullptr, &pidlFile, 0, nullptr);
    if (FAILED(hr) || !pidlFile) {
        CoUninitialize();
        fwprintf(stderr, L"reveal: file-not-found\n");
        return 1; // File not found or invalid path
    }
    
    // Clone the absolute PIDL so we can mutate it into the parent folder PIDL
    PIDLIST_ABSOLUTE pidlFolder = ILClone(pidlFile);
    if (!pidlFolder) {
        ILFree(pidlFile);
        CoUninitialize();
        fwprintf(stderr, L"reveal: clone-failed\n");
        return 1;
    }
    
    // Remove the last ID from the folder PIDL to get the parent directory
    if (!ILRemoveLastID(pidlFolder)) {
        ILFree(pidlFolder);
        ILFree(pidlFile);
        CoUninitialize();
        fwprintf(stderr, L"reveal: parse-failed\n");
        return 1; // Failed to remove last ID
    }
    
    // Get the last ID from the absolute file PIDL (this is the child item relative to folder)
    PCUITEMID_CHILD pidlChild = ILFindLastID(pidlFile);
    if (!pidlChild) {
        ILFree(pidlFolder);
        ILFree(pidlFile);
        CoUninitialize();
        fwprintf(stderr, L"reveal: child-extract-failed\n");
        return 1;
    }
    
    // Open folder and select the child item (MAX_PATH-safe, fully Unicode)
    HRESULT showResult = SHOpenFolderAndSelectItems(pidlFolder, 1, &pidlChild, 0);
    
    ILFree(pidlFolder);
    ILFree(pidlFile);
    CoUninitialize();
    if (!SUCCEEDED(showResult)) {
        fwprintf(stderr, L"reveal: show-failed\n");
        return 1;
    }
    return 0;
}

// Open folder using ShellExecuteW with "open" verb (handles long paths > 260 chars)
// ShellExecuteW("open", folderpath) actually opens the folder directly and handles long paths
static int open_folder(const wchar_t* folderpath) {
    if (!folderpath || !*folderpath) {
        fwprintf(stderr, L"open-folder: invalid-path\n");
        return 1;
    }
    
    // Use ShellExecuteW to actually open the folder
    // ShellExecuteW("open", folder) handles long paths correctly (no command-line parsing involved)
    // This is equivalent to double-clicking the folder in Explorer
    SHELLEXECUTEINFOW shExecInfo = {};
    shExecInfo.cbSize = sizeof(SHELLEXECUTEINFOW);
    shExecInfo.fMask = 0;
    shExecInfo.lpVerb = L"open";
    shExecInfo.lpFile = folderpath;
    shExecInfo.nShow = SW_SHOW;
    
    if (!ShellExecuteExW(&shExecInfo)) {
        fwprintf(stderr, L"open-folder: execute-failed\n");
        return 1;
    }
    
    return 0;
}

// Open file with default application using ShellExecuteEx (long-path safe)
static int open_file(const wchar_t* filepath) {
    if (!filepath || !*filepath) {
        fwprintf(stderr, L"open-file: invalid-path\n");
        return 1;
    }
    
    SHELLEXECUTEINFOW shExecInfo = {};
    shExecInfo.cbSize = sizeof(SHELLEXECUTEINFOW);
    shExecInfo.fMask = 0;
    shExecInfo.lpVerb = L"open";
    shExecInfo.lpFile = filepath;
    shExecInfo.nShow = SW_SHOW;
    
    if (!ShellExecuteExW(&shExecInfo)) {
        fwprintf(stderr, L"open-file: execute-failed\n");
        return 1; // Failed to open
    }
    
    return 0;
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

    // Handle reveal and open-folder modes (Shell APIs, long-path safe)
    if (mode == MODE_REVEAL) {
        int result = reveal_file(initial);
        LocalFree(argv);
        return result;
    }
    
    if (mode == MODE_OPEN_FOLDER) {
        int result = open_folder(initial);
        LocalFree(argv);
        return result;
    }

    if (mode == MODE_OPEN_FILE) {
        int result = open_file(initial);
        LocalFree(argv);
        return result;
    }

    // Handle dialog modes (pick-folder, save-file)
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
            // Save file; filesystem only; show overwrite prompt; avoid changing CWD; don't add to recent
            // Note: FOS_PATHMUSTEXIST removed to allow users to create new directories during save
            opts |= FOS_OVERWRITEPROMPT | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR | FOS_DONTADDTORECENT;
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
    // Get path and strip \\?\ prefix for UI/history storage
    hr = psi->GetDisplayName(SIGDN_FILESYSPATH, &wz);
    int rc = 1;
    if (SUCCEEDED(hr) && wz && *wz) {
        const wchar_t* outputPath = wz;
        // UNC check first (longer pattern)
        if (wcsncmp(wz, L"\\\\?\\UNC\\", 8) == 0) {
            const wchar_t* uncPath = wz + 8;
            wchar_t* tempBuffer = (wchar_t*)malloc((wcslen(uncPath) + 3) * sizeof(wchar_t));
            if (tempBuffer) {
                wcscpy(tempBuffer, L"\\\\");
                wcscat(tempBuffer, uncPath);
                rc = write_utf8_stdout(tempBuffer);
                free(tempBuffer);
            } else {
                rc = 1; // malloc failed
            }
            CoTaskMemFree(wz);
            goto cleanup;
        } else if (wcsncmp(wz, L"\\\\?\\", 4) == 0) {
            // Regular path with \\?\ prefix - skip 4 chars
            outputPath = wz + 4;
        }
        // Convert 8.3 short names to long names (happens on file overwrite)
        wchar_t longPath[32768];
        DWORD len = GetLongPathNameW(outputPath, longPath, 32768);
        if (len > 0 && len < 32768) {
            rc = write_utf8_stdout(longPath);
        } else {
            rc = write_utf8_stdout(outputPath);
        }
        CoTaskMemFree(wz);
    }
cleanup:
    psi->Release();
    pfd->Release();
    CoUninitialize();
    LocalFree(argv);
    return rc == 0 ? 0 : 1;
}