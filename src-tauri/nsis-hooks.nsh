; SecurePhotos NSIS Installer Hooks
; Ensures desktop icon idempotency and cleans up legacy MSI/public shortcuts across updates.

!macro NSIS_HOOK_PREINSTALL
  ; Terminate any running SecurePhotos or backend engine processes to prevent file locking during in-place upgrade
  nsExec::Exec 'taskkill /F /IM securephotos-engine.exe'
  nsExec::Exec 'taskkill /F /IM SecurePhotos.exe'

  ; Remove any legacy shortcut left behind in Public Desktop by older MSI installations
  Delete "$COMMONDESKTOP\SecurePhotos.lnk"
  ; Clean up any existing user desktop shortcut before writing the new one to prevent duplication
  Delete "$DESKTOP\SecurePhotos.lnk"

  ; Pre-flight validation: Check for Microsoft Visual C++ 2015-2022 Redistributable (x64)
  ClearErrors
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Installed"
  ${If} ${Errors}
    ClearErrors
    ReadRegDWORD $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Installed"
  ${EndIf}
  ${If} $0 != 1
    ${If} ${FileExists} "$SYSDIR\vcruntime140.dll"
      StrCpy $0 1
    ${EndIf}
  ${EndIf}
  ${If} $0 != 1
    MessageBox MB_ICONEXCLAMATION|MB_YESNO \
      "Microsoft Visual C++ 2015-2022 Redistributable (x64) is required for SecurePhotos local AI processing and face recognition.$\r$\n$\r$\nIt is not currently detected on this machine.$\r$\n$\r$\nWould you like to open the official Microsoft installer download page now?" \
      IDNO +2
    ExecShell "open" "https://aka.ms/vs/17/release/vc_redist.x64.exe"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Guarantee that the public desktop does not contain a duplicate
  Delete "$COMMONDESKTOP\SecurePhotos.lnk"

  ; H10 / A2c: download the old-photo models (about 2.7 GB, once). Each model is checked by
  ; SHA-256; one already in place is skipped, so upgrades are quick. A failed download never
  ; fails the install: the app asks later, before the first feature that needs that model.
  ; Progress and per-model status go into the details list.
  SetDetailsPrint both
  DetailPrint "Getting the old-photo models (about 2.7 GB, once). This can take a while..."
  nsExec::ExecToLog '"$INSTDIR\securephotos-engine.exe" --fetch-models "$INSTDIR\data\models"'
  Pop $0
  ; Show the per-model status, except in silent / passive installs (updates).
  ${IfNot} ${Silent}
  ${AndIf} $PassiveMode <> 1
    ${If} ${FileExists} "$INSTDIR\data\models\install_status.txt"
      StrCpy $1 ""
      FileOpen $2 "$INSTDIR\data\models\install_status.txt" r
      sp_status_loop:
        FileRead $2 $3
        StrCmp $3 "" sp_status_done
        StrCpy $1 "$1$3"
        Goto sp_status_loop
      sp_status_done:
      FileClose $2
      MessageBox MB_ICONINFORMATION|MB_OK "Old-photo models:$\r$\n$\r$\n$1"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  MessageBox MB_ICONINFORMATION|MB_OKCANCEL \
    "SecurePhotos Uninstallation Notice:$\r$\n$\r$\n\
1. Your photo library, SQLite database, and encrypted Vault are NOT deleted.$\r$\n\
   They remain safely preserved in your data folder:$\r$\n\
   $INSTDIR\data$\r$\n$\r$\n\
2. If you have locked photos in your Vault that you want restored to regular unencrypted files, \
please click CANCEL, open SecurePhotos, and unlock your vault first.$\r$\n$\r$\n\
Click OK to proceed with removing the SecurePhotos application files." \
    IDOK proceed_uninstall
  Abort
  proceed_uninstall:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Cleanly remove desktop shortcuts from both user and common desktop locations
  Delete "$DESKTOP\SecurePhotos.lnk"
  Delete "$COMMONDESKTOP\SecurePhotos.lnk"
!macroend

