#include <iostream>
#include <string>
#include <cstdint>
#include <cstdio>

#ifdef _WIN32
#include <windows.h>
#else
#include <sys/statvfs.h>
#endif

// Error codes
enum ExitCode {
    SUCCESS = 0,
    ERR_ARGS = 2,
    ERR_CONVERSION = 3,
    ERR_OS_CALL = 4
};

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: " << argv[0] << " <path>" << std::endl;
        return ERR_ARGS;
    }

    std::string path = argv[1];
    std::uint64_t freeBytes = 0;

#ifdef _WIN32
    ULARGE_INTEGER freeBytesAvailableToCaller;
    ULARGE_INTEGER totalNumberOfBytes;
    ULARGE_INTEGER totalNumberOfFreeBytes;

    // Convert std::string to std::wstring for GetDiskFreeSpaceExW
    int len = MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, NULL, 0);
    if (len == 0) {
        std::cerr << "Error converting path to wide string" << std::endl;
        return ERR_CONVERSION;
    }
    std::wstring wpath(len, 0);
    MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, &wpath[0], len);

    if (GetDiskFreeSpaceExW(wpath.c_str(), &freeBytesAvailableToCaller, &totalNumberOfBytes, &totalNumberOfFreeBytes)) {
        freeBytes = static_cast<std::uint64_t>(freeBytesAvailableToCaller.QuadPart);
    } else {
        std::cerr << "Error getting disk space: " << GetLastError() << std::endl;
        return ERR_OS_CALL;
    }
#else
    struct statvfs stat;
    if (statvfs(path.c_str(), &stat) == 0) {
        // Safe 64-bit multiplication to avoid potential 32-bit overflow
        freeBytes = static_cast<std::uint64_t>(stat.f_bavail) * static_cast<std::uint64_t>(stat.f_frsize);
    } else {
        perror("Error getting disk space");
        return ERR_OS_CALL;
    }
#endif

    std::cout << "FREE_BYTES=" << freeBytes << std::endl;
    return SUCCESS;
}
