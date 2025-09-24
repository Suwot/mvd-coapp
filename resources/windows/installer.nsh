ManifestDPIAware true

######################################################################

# User-level installation - no admin privileges required
RequestExecutionLevel user

######################################################################

!define APP_NAME "MAX Video Downloader CoApp"
!define COMP_NAME "MAX Video Downloader"
!define VERSION "0.6.0"
!define COPYRIGHT "Rostislav"
!define DESCRIPTION "MAX Video Downloader CoApp"
!define INSTALLER_NAME "mvdcoapp-installer.exe"
!define MAIN_APP_EXE "mvdcoapp.exe"
!define ICON "icon.ico"
!define LICENSE_TXT "LICENSE.txt"
!define INSTALL_DIR "$LOCALAPPDATA\${APP_NAME}"
!define INSTALL_TYPE "SetShellVarContext current"
!define REG_ROOT "HKCU"
!define REG_APP_PATH "Software\Microsoft\Windows\CurrentVersion\App Paths\${MAIN_APP_EXE}"
!define UNINSTALL_PATH "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"

######################################################################

VIProductVersion  "${VERSION}.0"
VIAddVersionKey "ProductName"  "${APP_NAME}"
VIAddVersionKey "CompanyName"  "${COMP_NAME}"
VIAddVersionKey "LegalCopyright"  "${COPYRIGHT}"
VIAddVersionKey "FileDescription"  "${DESCRIPTION}"
VIAddVersionKey "FileVersion" "${VERSION}"

######################################################################

SetCompressor /SOLID Lzma
Name "${APP_NAME}"
Caption "${APP_NAME}"
OutFile "${INSTALLER_NAME}"
BrandingText "${APP_NAME}"
InstallDirRegKey "${REG_ROOT}" "${REG_APP_PATH}" ""
InstallDir "${INSTALL_DIR}"

######################################################################

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"

######################################################################

!include "MUI2.nsh"
!include "StrFunc.nsh"
${Using:StrFunc} StrRep

!define MUI_ABORTWARNING
!define MUI_UNABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${LICENSE_TXT}"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

######################################################################

Section -MainProgram
	${INSTALL_TYPE}

	SetDetailsPrint textonly
	DetailPrint "Installing MAX Video Downloader CoApp..."
	SetDetailsPrint listonly

	SetOverwrite ifnewer
	SetOutPath "$INSTDIR"
	
	# Install binaries
	File "mvdcoapp.exe"
	File "ffmpeg.exe"
	File "ffprobe.exe"

SectionEnd

######################################################################

Section -CreateManifests
	SetDetailsPrint textonly
	DetailPrint "Creating browser manifests..."
	SetDetailsPrint listonly

	# Escape backslashes in path for JSON
	StrCpy $1 "$INSTDIR\mvdcoapp.exe"
	${StrRep} $1 $1 "\" "\\"

	# Create Chrome manifest
	FileOpen $0 "$INSTDIR\pro.maxvideodownloader.coapp.json" w
	FileWrite $0 '{$\r$\n'
	FileWrite $0 '  "name": "pro.maxvideodownloader.coapp",$\r$\n'
	FileWrite $0 '  "description": "MAX Video Downloader Native Host",$\r$\n'
	FileWrite $0 '  "path": "$1",$\r$\n'
	FileWrite $0 '  "type": "stdio",$\r$\n'
	FileWrite $0 '  "allowed_origins": [$\r$\n'
	FileWrite $0 '    "chrome-extension://bkblnddclhmmgjlmbofhakhhbklkcofd/",$\r$\n'
	FileWrite $0 '    "chrome-extension://kjinbaahkmjgkkedfdgpkkelehofieke/"$\r$\n'
	FileWrite $0 '  ]$\r$\n'
	FileWrite $0 '}$\r$\n'
	FileClose $0

	# Create Firefox manifest
	FileOpen $0 "$INSTDIR\max-video-downloader@rostislav.dev.json" w
	FileWrite $0 '{$\r$\n'
	FileWrite $0 '  "name": "pro.maxvideodownloader.coapp",$\r$\n'
	FileWrite $0 '  "description": "MAX Video Downloader Native Host",$\r$\n'
	FileWrite $0 '  "path": "$1",$\r$\n'
	FileWrite $0 '  "type": "stdio",$\r$\n'
	FileWrite $0 '  "allowed_extensions": [$\r$\n'
	FileWrite $0 '    "max-video-downloader@rostislav.dev"$\r$\n'
	FileWrite $0 '  ]$\r$\n'
	FileWrite $0 '}$\r$\n'
	FileClose $0

SectionEnd

######################################################################

Section -RegisterBrowsers
	SetDetailsPrint textonly
	DetailPrint "Registering with browsers..."
	SetDetailsPrint listonly

	# Chrome/Chromium browsers - register manifest path
	WriteRegStr ${REG_ROOT} "SOFTWARE\Google\Chrome\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\pro.maxvideodownloader.coapp.json"
	WriteRegStr ${REG_ROOT} "SOFTWARE\Microsoft\Edge\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\pro.maxvideodownloader.coapp.json"
	WriteRegStr ${REG_ROOT} "SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\pro.maxvideodownloader.coapp.json"
	WriteRegStr ${REG_ROOT} "SOFTWARE\Vivaldi\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\pro.maxvideodownloader.coapp.json"
	WriteRegStr ${REG_ROOT} "SOFTWARE\Opera Software\Opera\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\pro.maxvideodownloader.coapp.json"
	WriteRegStr ${REG_ROOT} "SOFTWARE\Epic Privacy Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\pro.maxvideodownloader.coapp.json"
	WriteRegStr ${REG_ROOT} "SOFTWARE\YandexBrowser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\pro.maxvideodownloader.coapp.json"

	# Firefox browsers - register manifest path
	WriteRegStr ${REG_ROOT} "SOFTWARE\Mozilla\NativeMessagingHosts\max-video-downloader@rostislav.dev" "" "$INSTDIR\max-video-downloader@rostislav.dev.json"

SectionEnd

######################################################################

Section -SystemIntegration
	${INSTALL_TYPE}

	SetOutPath "$INSTDIR"
	WriteUninstaller "$INSTDIR\uninstall.exe"

	# Application registration
	WriteRegStr ${REG_ROOT} "${REG_APP_PATH}" "" "$INSTDIR\${MAIN_APP_EXE}"
	WriteRegStr ${REG_ROOT} "${UNINSTALL_PATH}"  "DisplayName" "${APP_NAME}"
	WriteRegStr ${REG_ROOT} "${UNINSTALL_PATH}"  "UninstallString" "$INSTDIR\uninstall.exe"
	WriteRegStr ${REG_ROOT} "${UNINSTALL_PATH}"  "DisplayIcon" "$INSTDIR\${MAIN_APP_EXE}"
	WriteRegStr ${REG_ROOT} "${UNINSTALL_PATH}"  "DisplayVersion" "${VERSION}"
	WriteRegStr ${REG_ROOT} "${UNINSTALL_PATH}"  "Publisher" "${COMP_NAME}"
	WriteRegDWORD ${REG_ROOT} "${UNINSTALL_PATH}" "NoModify" 1
	WriteRegDWORD ${REG_ROOT} "${UNINSTALL_PATH}" "NoRepair" 1

SectionEnd

######################################################################

Section Uninstall
	${INSTALL_TYPE}

	SetDetailsPrint textonly
	DetailPrint "Removing MAX Video Downloader CoApp..."
	SetDetailsPrint listonly

	# Remove browser registrations
	DeleteRegKey ${REG_ROOT} "SOFTWARE\Google\Chrome\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	DeleteRegKey ${REG_ROOT} "SOFTWARE\Microsoft\Edge\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	DeleteRegKey ${REG_ROOT} "SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	DeleteRegKey ${REG_ROOT} "SOFTWARE\Vivaldi\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	DeleteRegKey ${REG_ROOT} "SOFTWARE\Opera Software\Opera\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	DeleteRegKey ${REG_ROOT} "SOFTWARE\Epic Privacy Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	DeleteRegKey ${REG_ROOT} "SOFTWARE\YandexBrowser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	DeleteRegKey ${REG_ROOT} "SOFTWARE\Mozilla\NativeMessagingHosts\max-video-downloader@rostislav.dev"

	# Remove application registration
	DeleteRegKey ${REG_ROOT} "${REG_APP_PATH}"
	DeleteRegKey ${REG_ROOT} "${UNINSTALL_PATH}"

	# Remove files and directory
	Delete "$INSTDIR\mvdcoapp.exe"
	Delete "$INSTDIR\ffmpeg.exe"
	Delete "$INSTDIR\ffprobe.exe"
	Delete "$INSTDIR\pro.maxvideodownloader.coapp.json"
	Delete "$INSTDIR\max-video-downloader@rostislav.dev.json"
	Delete "$INSTDIR\uninstall.exe"
	RmDir "$INSTDIR"

SectionEnd