ManifestDPIAware true

######################################################################

# System-level installation - admin privileges required
# This installer writes only to HKLM (system-wide) using the 64-bit registry view. 32-bit view is intentionally not used.
RequestExecutionLevel admin

######################################################################

!define APP_NAME "MAX Video Downloader CoApp"
!define COMP_NAME "MAX Video Downloader"
!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!define COPYRIGHT "Rostislav"
!define DESCRIPTION "MAX Video Downloader Companion Application"
!define INSTALLER_NAME "mvdcoapp-installer.exe"
!define MAIN_APP_EXE "mvdcoapp.exe"
!define ICON "icon.ico"
!define LICENSE_TXT "LICENSE.txt"
!define INSTALL_DIR "$PROGRAMFILES64\${APP_NAME}"
!define INSTALL_TYPE "SetShellVarContext all"
!define REG_ROOT "HKLM"
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
Caption "${APP_NAME} ${VERSION}"
OutFile "${INSTALLER_NAME}"
BrandingText "${APP_NAME}"
InstallDirRegKey "${REG_ROOT}" "${REG_APP_PATH}" ""
InstallDir "${INSTALL_DIR}"

######################################################################

Var PROGRAMDATA_DIR

######################################################################

Function .onInit
	SetRegView 64
	ReadEnvStr $PROGRAMDATA_DIR "PROGRAMDATA"
FunctionEnd

######################################################################

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"

######################################################################

!include "MUI2.nsh"
!include "StrFunc.nsh"
${Using:StrFunc} StrRep

!define MUI_ABORTWARNING

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

	# Stop any running instances (active downloads will be terminated)
	SetDetailsPrint textonly
	DetailPrint "Stopping any running instances..."
	SetDetailsPrint listonly
	
	# Kill process - simple approach, ignore if already dead
	nsExec::ExecToStack 'taskkill /f /im mvdcoapp.exe /t'
	Sleep 1000
	
	# Brief pause for handle cleanup
	Sleep 500

	SetDetailsPrint textonly
	DetailPrint "Installing application files..."
	SetDetailsPrint listonly

	SetOverwrite on  # Force overwrite regardless of timestamps
	SetOutPath "$INSTDIR"
	
	# Try copy-first approach to avoid delete-before-copy race condition
	ClearErrors
	File "mvdcoapp.exe"
	${If} ${Errors}
		# Copy failed, likely file in use - schedule for reboot and retry once
		Delete /REBOOTOK "$INSTDIR\mvdcoapp.exe"
		ClearErrors
		File "mvdcoapp.exe"
		${If} ${Errors}
			MessageBox MB_OK|MB_ICONSTOP "Failed to install mvdcoapp.exe. Please close all browsers and try again."
			Abort
		${EndIf}
	${EndIf}
	
	ClearErrors
	File "ffmpeg.exe"
	${If} ${Errors}
		Delete /REBOOTOK "$INSTDIR\ffmpeg.exe"
		ClearErrors
		File "ffmpeg.exe"
		${If} ${Errors}
			MessageBox MB_OK|MB_ICONSTOP "Failed to install ffmpeg.exe. Please close all browsers and try again."
			Abort
		${EndIf}
	${EndIf}
	
	ClearErrors
	File "ffprobe.exe"
	${If} ${Errors}
		Delete /REBOOTOK "$INSTDIR\ffprobe.exe"
		ClearErrors
		File "ffprobe.exe"
		${If} ${Errors}
			MessageBox MB_OK|MB_ICONSTOP "Failed to install ffprobe.exe. Please close all browsers and try again."
			Abort
		${EndIf}
	${EndIf}
	
	ClearErrors
	File "mvd-fileui.exe"
	${If} ${Errors}
		Delete /REBOOTOK "$INSTDIR\mvd-fileui.exe"
		ClearErrors
		File "mvd-fileui.exe"
		${If} ${Errors}
			MessageBox MB_OK|MB_ICONSTOP "Failed to install mvd-fileui.exe. Please close all browsers and try again."
			Abort
		${EndIf}
	${EndIf}

SectionEnd

######################################################################

Section -CreateManifests
	SetDetailsPrint textonly
	DetailPrint "Creating browser manifests..."
	SetDetailsPrint listonly

	# Build absolute path for JSON
	StrCpy $1 "$INSTDIR\mvdcoapp.exe"
	${StrRep} $1 $1 "\" "\\"

	# Create Chromium manifest
	FileOpen $0 "$INSTDIR\chromium-manifest.json" w
	FileWrite $0 '{$\r$\n'
	FileWrite $0 '  "name": "pro.maxvideodownloader.coapp",$\r$\n'
	FileWrite $0 '  "description": "MAX Video Downloader Companion Application",$\r$\n'
	FileWrite $0 '  "path": "$1",$\r$\n'
	FileWrite $0 '  "type": "stdio",$\r$\n'
	FileWrite $0 '  "allowed_origins": [$\r$\n'
	FileWrite $0 '    "chrome-extension://bkblnddclhmmgjlmbofhakhhbklkcofd/",$\r$\n'
	FileWrite $0 '    "chrome-extension://kjinbaahkmjgkkedfdgpkkelehofieke/",$\r$\n'
	FileWrite $0 '    "chrome-extension://hkakpofpmdphjlkojabkfjapnhjfebdl/"$\r$\n'
	FileWrite $0 '  ]$\r$\n'
	FileWrite $0 '}$\r$\n'
	FileClose $0

	# Create Firefox manifest
	FileOpen $0 "$INSTDIR\mozilla-manifest.json" w
	FileWrite $0 '{$\r$\n'
	FileWrite $0 '  "name": "pro.maxvideodownloader.coapp",$\r$\n'
	FileWrite $0 '  "description": "MAX Video Downloader Companion Application",$\r$\n'
	FileWrite $0 '  "path": "$1",$\r$\n'
	FileWrite $0 '  "type": "stdio",$\r$\n'
	FileWrite $0 '  "allowed_extensions": [$\r$\n'
	FileWrite $0 '    "max-video-downloader@rostislav.dev"$\r$\n'
	FileWrite $0 '  ]$\r$\n'
	FileWrite $0 '}$\r$\n'
	FileClose $0

SectionEnd

######################################################################

Section -CreateDataDirectory
	SetDetailsPrint textonly
	DetailPrint "Creating application data directory..."
	SetDetailsPrint listonly

	# Create ProgramData directory for logs (basic creation only)
	CreateDirectory "$PROGRAMDATA_DIR\${APP_NAME}"

SectionEnd

######################################################################

Section -RegisterBrowsers
	SetDetailsPrint textonly
	DetailPrint "Registering with browsers..."
	SetDetailsPrint listonly

	# Chrome/Chromium family (system-wide, HKLM)
	WriteRegStr ${REG_ROOT} "SOFTWARE\Google\Chrome\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\chromium-manifest.json"
	WriteRegStr ${REG_ROOT} "SOFTWARE\Chromium\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\chromium-manifest.json"
	WriteRegStr ${REG_ROOT} "SOFTWARE\Microsoft\Edge\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\chromium-manifest.json"
	WriteRegStr ${REG_ROOT} "SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\chromium-manifest.json"
	WriteRegStr ${REG_ROOT} "SOFTWARE\Vivaldi\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\chromium-manifest.json"
	WriteRegStr ${REG_ROOT} "SOFTWARE\Epic Privacy Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\chromium-manifest.json"
	WriteRegStr ${REG_ROOT} "SOFTWARE\Yandex\YandexBrowser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\chromium-manifest.json"

	# Firefox (system-wide, HKLM)
	WriteRegStr ${REG_ROOT} "SOFTWARE\Mozilla\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$INSTDIR\mozilla-manifest.json"

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
	SetRegView 64

	SetDetailsPrint textonly
	DetailPrint "Removing MAX Video Downloader CoApp..."
	SetDetailsPrint listonly

	# Stop any running instances (mirror install process)
	nsExec::ExecToStack 'taskkill /f /im mvdcoapp.exe /t'
	Sleep 1000

	# Remove browser registrations
	DeleteRegKey ${REG_ROOT} "SOFTWARE\Google\Chrome\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	DeleteRegKey ${REG_ROOT} "SOFTWARE\Chromium\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	DeleteRegKey ${REG_ROOT} "SOFTWARE\Microsoft\Edge\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	DeleteRegKey ${REG_ROOT} "SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	DeleteRegKey ${REG_ROOT} "SOFTWARE\Vivaldi\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	DeleteRegKey ${REG_ROOT} "SOFTWARE\Epic Privacy Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	DeleteRegKey ${REG_ROOT} "SOFTWARE\Yandex\YandexBrowser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	DeleteRegKey ${REG_ROOT} "SOFTWARE\Mozilla\NativeMessagingHosts\pro.maxvideodownloader.coapp"

	# Remove application registration
	DeleteRegKey ${REG_ROOT} "${REG_APP_PATH}"
	DeleteRegKey ${REG_ROOT} "${UNINSTALL_PATH}"

	# Remove files and directory (use /REBOOTOK for consistency)
	Delete /REBOOTOK "$INSTDIR\mvdcoapp.exe"
	Delete /REBOOTOK "$INSTDIR\ffmpeg.exe"
	Delete /REBOOTOK "$INSTDIR\ffprobe.exe"
	Delete /REBOOTOK "$INSTDIR\mvd-fileui.exe"
	Delete "$INSTDIR\chromium-manifest.json"
	Delete "$INSTDIR\mozilla-manifest.json"
	Delete "$INSTDIR\uninstall.exe"
	RmDir "$INSTDIR"
	
	# Remove ProgramData directory (only if empty)
	RmDir "$PROGRAMDATA_DIR\${APP_NAME}"

SectionEnd