ManifestDPIAware true

######################################################################

# Support both per-user and per-machine installation.
# Base execution starts as standard user; elevates only if per-machine is selected.
RequestExecutionLevel user

######################################################################

!define APP_NAME "MAX Video Downloader CoApp"
!define COMP_NAME "MAX Video Downloader"
!ifndef VERSION
	!define VERSION "1.0.0"
!endif
!define COPYRIGHT "Rostislav"
!define DESCRIPTION "MAX Video Downloader Companion Application"
!ifndef OUTFILE
	!define OUTFILE "mvdcoapp-installer.exe"
!endif
!define MAIN_APP_EXE "mvdcoapp.exe"
!define ICON "icon.ico"
!define LICENSE_TXT "LICENSE.txt"
; Default install dir is per-user for safety, will be adjusted in .onInit
!define INSTALL_DIR_USER "$LOCALAPPDATA\${APP_NAME}"
!define INSTALL_DIR_MACHINE "$PROGRAMFILES64\${APP_NAME}"
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
OutFile "${OUTFILE}"
BrandingText "${APP_NAME}"
InstallDir "${INSTALL_DIR_USER}"

######################################################################

Var PROGRAMDATA_DIR
Var InstallMode # "user" or "machine"
Var Dialog
Var Radio_User
Var Radio_Machine

######################################################################

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"

######################################################################

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!include "WinMessages.nsh"
!include "StrFunc.nsh"
!include "UAC.nsh"
${Using:StrFunc} StrRep
!insertmacro GetParent

!define MUI_ABORTWARNING

Var SkipStartupPages

Function SkipIfElevated
	${If} $SkipStartupPages == 1
		Abort
	${EndIf}
FunctionEnd

!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfElevated
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfElevated
!insertmacro MUI_PAGE_LICENSE "${LICENSE_TXT}"

Page custom PageInstallModeSelection PageInstallModeSelectionLeave

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Installation complete"
ShowInstDetails show

######################################################################

# Custom UAC macros for registry operations as user
# Pattern based on UAC_AsUser_ExecShell from UAC.nsh

!macro UAC_AsUser_RegWrite hive key valuename valuedata
	!insertmacro _UAC_IncL
	goto _UAC_L_E_${__UAC_L}
	_UAC_L_F_${__UAC_L}:
	WriteRegStr ${hive} "${key}" "${valuename}" "${valuedata}"
	return
	_UAC_L_E_${__UAC_L}:
	!insertmacro UAC_AsUser_Call Label _UAC_L_F_${__UAC_L} ${UAC_SYNCREGISTERS}
!macroend

!macro UAC_AsUser_RegDeleteKey hive key
	!insertmacro _UAC_IncL
	goto _UAC_L_E_${__UAC_L}
	_UAC_L_F_${__UAC_L}:
	DeleteRegKey ${hive} "${key}"
	return
	_UAC_L_E_${__UAC_L}:
	!insertmacro UAC_AsUser_Call Label _UAC_L_F_${__UAC_L} ${UAC_SYNCREGISTERS}
!macroend

!macro Init thing
uac_tryagain:
# Hide the entire window BEFORE prompt.
# This eliminates the "ghost window" while user is at the UAC prompt.
HideWindow

!insertmacro UAC_RunElevated
${Switch} $0
${Case} 0
	${If} $1 = 1
		# Elevation worked, child process is running. 
		# Close the original process immediately and quietly.
		SetErrorLevel 0
		Quit
	${EndIf}
	
	# Return from elevation: either we are already elevated ($1=2) or need retry ($1=3)
	# Bring the window back before showing any boxes or continuing.
	ShowWindow $HWNDPARENT ${SW_SHOW}
	
	${IfThen} $1 = 2 ${|} ${Break} ${|} ; already running elevated, proceed.
    
    # User logged in with non-admin account in RunAs
	MessageBox mb_YesNo|mb_IconExclamation|mb_TopMost|mb_SetForeground "This ${thing} requires admin privileges, try again?" /SD IDNO IDYES uac_tryagain
	Abort
${Case} 1223
	# User cancelled elevation - show window again and return to page.
	ShowWindow $HWNDPARENT ${SW_SHOW}
	Abort # This will stop the "Leave" function and stay on the current page.
${Case} 1062
	ShowWindow $HWNDPARENT ${SW_SHOW}
	MessageBox mb_IconStop|mb_TopMost|mb_SetForeground "Logon service not running, aborting!"
	Abort
${Default}
	ShowWindow $HWNDPARENT ${SW_SHOW}
	MessageBox mb_IconStop|mb_TopMost|mb_SetForeground "Unable to elevate, error $0"
	Abort
${EndSwitch}
!macroend

######################################################################

######################################################################

Function PageInstallModeSelection
	# If we are an elevated child process, skip this page too, 
	# but reset the flag so that Back button works correctly from later pages.
	${If} $SkipStartupPages == 1
		StrCpy $SkipStartupPages 0
		Abort
	${EndIf}

	nsDialogs::Create 1018
	Pop $Dialog

	${If} $Dialog == error
		Abort
	${EndIf}

	${NSD_CreateLabel} 0 0 100% 12u "Select the installation mode:"
	
	${NSD_CreateRadioButton} 0 20u 100% 10u "Install for current user (recommended)"
	Pop $Radio_User
	
	${NSD_CreateRadioButton} 0 35u 100% 10u "Install for all users (requires admin)"
	Pop $Radio_Machine

	# Pre-select based on existing state
	${If} $InstallMode == "machine"
		${NSD_SetState} $Radio_Machine 1
	${Else}
		${NSD_SetState} $Radio_User 1
	${EndIf}

	nsDialogs::Show
FunctionEnd

Function PageInstallModeSelectionLeave
	${NSD_GetState} $Radio_Machine $0
	${If} $0 == 1
		# User selected machine mode
		StrCpy $InstallMode "machine"

		# All-users install requires elevation on UAC systems.
		!insertmacro Init "installer"
		
		# If Init returned (didn't Quit or Abort), we are elevated.
		StrCpy $INSTDIR "${INSTALL_DIR_MACHINE}"
		SetShellVarContext all
	${Else}
		# User selected user mode
		StrCpy $InstallMode "user"
		StrCpy $INSTDIR "${INSTALL_DIR_USER}"
		SetShellVarContext current
	${EndIf}
FunctionEnd

######################################################################

Function .onInit
	ReadEnvStr $PROGRAMDATA_DIR "PROGRAMDATA"
	
	# Initial default state
	StrCpy $InstallMode "user"
	SetShellVarContext current
	StrCpy $INSTDIR "${INSTALL_DIR_USER}"
	StrCpy $SkipStartupPages 0

	# Check if we are an 'inner' elevated process.
	# If so, we pre-select machine mode and jump straight to Directory page.
	UAC::_ 3
	Pop $0
	${If} $0 != 0
		StrCpy $InstallMode "machine"
		StrCpy $INSTDIR "${INSTALL_DIR_MACHINE}"
		SetShellVarContext all
		StrCpy $SkipStartupPages 1
	${EndIf}
FunctionEnd

Function un.onInit
	# Detect install mode and path from registry
	ReadEnvStr $PROGRAMDATA_DIR "PROGRAMDATA"

	# Scan for installation mode and $INSTDIR
	# We check both views for maximum reliability
	SetRegView 64
	ReadRegStr $0 HKCU "${REG_APP_PATH}" "InstallMode"
	ReadRegStr $1 HKCU "${REG_APP_PATH}" ""
	${If} $0 == ""
		ReadRegStr $0 HKLM "${REG_APP_PATH}" "InstallMode"
		ReadRegStr $1 HKLM "${REG_APP_PATH}" ""
	${EndIf}
	
	${If} $0 == ""
		SetRegView 32
		ReadRegStr $0 HKCU "${REG_APP_PATH}" "InstallMode"
		ReadRegStr $1 HKCU "${REG_APP_PATH}" ""
		${If} $0 == ""
			ReadRegStr $0 HKLM "${REG_APP_PATH}" "InstallMode"
			ReadRegStr $1 HKLM "${REG_APP_PATH}" ""
		${EndIf}
	${EndIf}

	# $1 contains the path to mvdcoapp.exe, we need the folder
	${If} $1 != ""
		${GetParent} "$1" $INSTDIR
	${EndIf}

	${If} $0 == "machine"
		StrCpy $InstallMode "machine"
		SetShellVarContext all
		!insertmacro Init "uninstaller"
	${Else}
		StrCpy $InstallMode "user"
		SetShellVarContext current
	${EndIf}
FunctionEnd

######################################################################

Section -MainProgram
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

	SetDetailsPrint textonly
	DetailPrint "Installing application files..."
	SetDetailsPrint listonly

	SetOverwrite on  # Force overwrite regardless of timestamps
	SetOutPath "$INSTDIR"
	
	# Main application executable
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
	
	# Lightweight custom fs-ui
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
	
	# Disk space helper
	ClearErrors
	File "mvd-diskspace.exe"
	${If} ${Errors}
		Delete /REBOOTOK "$INSTDIR\mvd-diskspace.exe"
		ClearErrors
		File "mvd-diskspace.exe"
		${If} ${Errors}
			MessageBox MB_OK|MB_ICONSTOP "Failed to install mvd-diskspace.exe. Please close all browsers and try again."
			Abort
		${EndIf}
	${EndIf}
	
	# Media processing binaries (ffmpeg, ffprobe)
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

SectionEnd

######################################################################

Section -CreateManifests
	SetDetailsPrint textonly
	DetailPrint "Creating browser manifests..."
	SetDetailsPrint listonly

	# Use relative path (mvdcoapp.exe) instead of full path
	# This is more resilient - Windows resolves it relative to the manifest location
	StrCpy $1 "mvdcoapp.exe"

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

	${If} $InstallMode == "machine"
		# Create ProgramData directory for logs
		CreateDirectory "$PROGRAMDATA_DIR\${APP_NAME}"
	${EndIf}
	# No-op for user mode; $INSTDIR is already $LOCALAPPDATA\${APP_NAME}

SectionEnd

######################################################################

Section -RegisterBrowsers
	SetDetailsPrint textonly
	DetailPrint "Registering with browsers..."
	SetDetailsPrint listonly

	# NativeMessagingHosts registry values must point to the manifest file on disk (full path).
	StrCpy $1 "$INSTDIR\chromium-manifest.json"
	StrCpy $2 "$INSTDIR\mozilla-manifest.json"

	${If} $InstallMode == "machine"
		# Register in HKLM (system-wide)
		SetRegView 64
		# Whale and 360 browsers on Windows use Chrome's NativeMessagingHosts path
		WriteRegStr HKLM "SOFTWARE\Google\Chrome\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Chromium\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Microsoft\Edge\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Vivaldi\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Epic Privacy Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Yandex\YandexBrowser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Opera Software\Opera Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Opera Software\Opera GX Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Mozilla\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$2"

		SetRegView 32
		WriteRegStr HKLM "SOFTWARE\Google\Chrome\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Chromium\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Microsoft\Edge\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Vivaldi\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Epic Privacy Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Yandex\YandexBrowser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Opera Software\Opera Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Opera Software\Opera GX Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
		WriteRegStr HKLM "SOFTWARE\Mozilla\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$2"
	${EndIf}

	# Register in HKCU (per-user)
	# If we are admin, we MUST use !insertmacro UAC_AsUser_RegWrite to hit the real user's HKCU.
	# We write to both 64-bit and 32-bit views for maximum compatibility.
	
	SetRegView 64
	# Whale and 360 browsers on Windows use Chrome's NativeMessagingHosts path
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Google\Chrome\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Chromium\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Microsoft\Edge\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Vivaldi\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Epic Privacy Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Yandex\YandexBrowser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Opera Software\Opera Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Opera Software\Opera GX Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Mozilla\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$2"

	SetRegView 32
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Google\Chrome\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Chromium\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Microsoft\Edge\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Vivaldi\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Epic Privacy Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Yandex\YandexBrowser\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Opera Software\Opera Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Opera Software\Opera GX Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$1"
	!insertmacro UAC_AsUser_RegWrite "HKCU" "SOFTWARE\Mozilla\NativeMessagingHosts\pro.maxvideodownloader.coapp" "" "$2"

	SetRegView 64 # Restore default view
SectionEnd

######################################################################

Section -SystemIntegration
	# Registry root (HKLM or HKCU) is set based on SetShellVarContext
	SetRegView 64
	SetOutPath "$INSTDIR"
	WriteUninstaller "$INSTDIR\uninstall.exe"

	# Application registration
	WriteRegStr SHCTX "${REG_APP_PATH}" "" "$INSTDIR\${MAIN_APP_EXE}"
	WriteRegStr SHCTX "${REG_APP_PATH}" "InstallMode" "$InstallMode"
	
	WriteRegStr SHCTX "${UNINSTALL_PATH}"  "DisplayName" "${APP_NAME}"
	# UninstallString must be quoted because $INSTDIR contains spaces ("Program Files", etc.).
	WriteRegStr SHCTX "${UNINSTALL_PATH}"  "UninstallString" '"$INSTDIR\uninstall.exe"'
	WriteRegStr SHCTX "${UNINSTALL_PATH}"  "DisplayIcon" "$INSTDIR\${MAIN_APP_EXE}"
	WriteRegStr SHCTX "${UNINSTALL_PATH}"  "DisplayVersion" "${VERSION}"
	WriteRegStr SHCTX "${UNINSTALL_PATH}"  "Publisher" "${COMP_NAME}"
	WriteRegDWORD SHCTX "${UNINSTALL_PATH}" "NoModify" 1
	WriteRegDWORD SHCTX "${UNINSTALL_PATH}" "NoRepair" 1
	
	SetRegView 32
	WriteRegStr SHCTX "${REG_APP_PATH}" "" "$INSTDIR\${MAIN_APP_EXE}"
	WriteRegStr SHCTX "${REG_APP_PATH}" "InstallMode" "$InstallMode"
	
	WriteRegStr SHCTX "${UNINSTALL_PATH}"  "DisplayName" "${APP_NAME}"
	# UninstallString must be quoted because $INSTDIR contains spaces ("Program Files", etc.).
	WriteRegStr SHCTX "${UNINSTALL_PATH}"  "UninstallString" '"$INSTDIR\uninstall.exe"'
	WriteRegStr SHCTX "${UNINSTALL_PATH}"  "DisplayIcon" "$INSTDIR\${MAIN_APP_EXE}"
	WriteRegStr SHCTX "${UNINSTALL_PATH}"  "DisplayVersion" "${VERSION}"
	WriteRegStr SHCTX "${UNINSTALL_PATH}"  "Publisher" "${COMP_NAME}"
	WriteRegDWORD SHCTX "${UNINSTALL_PATH}" "NoModify" 1
	WriteRegDWORD SHCTX "${UNINSTALL_PATH}" "NoRepair" 1

SectionEnd

######################################################################

Section Uninstall
	SetDetailsPrint textonly
	DetailPrint "Removing MAX Video Downloader CoApp..."
	SetDetailsPrint listonly

	# Stop any running instances
	nsExec::ExecToStack 'taskkill /f /im mvdcoapp.exe /t'
	Sleep 1000

	${If} $InstallMode == "machine"
		# Remove from HKLM (system-wide)
		SetRegView 64
		DeleteRegKey HKLM "SOFTWARE\Google\Chrome\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Chromium\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Microsoft\Edge\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Vivaldi\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Epic Privacy Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Yandex\YandexBrowser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Opera Software\Opera Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Opera Software\Opera GX Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Mozilla\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		
		SetRegView 32
		DeleteRegKey HKLM "SOFTWARE\Google\Chrome\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Chromium\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Microsoft\Edge\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Vivaldi\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Epic Privacy Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Yandex\YandexBrowser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Opera Software\Opera Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Opera Software\Opera GX Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp"
		DeleteRegKey HKLM "SOFTWARE\Mozilla\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	${EndIf}
	
	# Remove from HKCU (per-user) - both views
	SetRegView 64
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Google\Chrome\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Chromium\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Microsoft\Edge\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Vivaldi\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Epic Privacy Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Yandex\YandexBrowser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Opera Software\Opera Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Opera Software\Opera GX Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Mozilla\NativeMessagingHosts\pro.maxvideodownloader.coapp"

	SetRegView 32
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Google\Chrome\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Chromium\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Microsoft\Edge\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Vivaldi\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Epic Privacy Browser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Yandex\YandexBrowser\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Opera Software\Opera Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Opera Software\Opera GX Stable\NativeMessagingHosts\pro.maxvideodownloader.coapp"
	!insertmacro UAC_AsUser_RegDeleteKey "HKCU" "SOFTWARE\Mozilla\NativeMessagingHosts\pro.maxvideodownloader.coapp"

	# Remove application registration
	SetRegView 64
	DeleteRegKey SHCTX "${REG_APP_PATH}"
	DeleteRegKey SHCTX "${UNINSTALL_PATH}"
	SetRegView 32
	DeleteRegKey SHCTX "${REG_APP_PATH}"
	DeleteRegKey SHCTX "${UNINSTALL_PATH}"

	# Remove files and directory
	Delete /REBOOTOK "$INSTDIR\mvdcoapp.exe"
	Delete /REBOOTOK "$INSTDIR\ffmpeg.exe"
	Delete /REBOOTOK "$INSTDIR\ffprobe.exe"
	Delete /REBOOTOK "$INSTDIR\mvd-fileui.exe"
	Delete /REBOOTOK "$INSTDIR\mvd-diskspace.exe"
	Delete "$INSTDIR\chromium-manifest.json"
	Delete "$INSTDIR\mozilla-manifest.json"
	Delete "$INSTDIR\uninstall.exe"
	RmDir "$INSTDIR"
	
	# Remove ProgramData directory if it was created (only in machine mode typically)
	${If} $InstallMode == "machine"
		RmDir "$PROGRAMDATA_DIR\${APP_NAME}"
	${EndIf}

SectionEnd
