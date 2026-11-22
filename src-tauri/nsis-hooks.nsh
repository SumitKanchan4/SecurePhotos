; SecurePhotos NSIS installer hooks
; Suggests the external drive, keeps the library on uninstall, and fetches the old-photo models.

;
; T2: SecurePhotos lives on an external drive, with the library beside it.
; - When a removable drive is plugged in, the folder page suggests <drive>:\SecurePhotos.
; - Choosing a folder on this computer's own drive asks once whether that's intended.
; Updates (/UPDATE) and passive or silent installs are never asked anything.

!include "TextFunc.nsh"

!define MUI_CUSTOMFUNCTION_GUIINIT SpSuggestDrive
; Check the folder only when Next is pressed, so the question isn't asked on every keystroke.
!define MUI_DIRECTORYPAGE_VERIFYONLEAVE

Var SpDriveFound
Var SpThisComputerOk
Var SpLastAsked

Function SpIsUpdateOrQuiet
  ; Leaves 1 on the stack for an update, a passive or a silent install, else 0.
  ${If} ${Silent}
    Push 1
    Return
  ${EndIf}
  ClearErrors
  ${GetOptions} $CMDLINE "/UPDATE" $0
  ${IfNot} ${Errors}
    Push 1
    Return
  ${EndIf}
  ClearErrors
  ${GetOptions} $CMDLINE "/P" $0
  ${IfNot} ${Errors}
    Push 1
    Return
  ${EndIf}
  Push 0
FunctionEnd

Function SpRememberDrive
  ; Called by GetDrives for each removable drive: $9 is like "E:\". Keeps "E:"; skips the
  ; floppy letters.
  StrCpy $0 $9 1
  ${If} $0 != "A"
  ${AndIf} $0 != "B"
    StrCpy $SpDriveFound $9 2
    Push "StopGetDrives"
    Return
  ${EndIf}
  Push $0
FunctionEnd

Function SpSuggestDrive
  Call SpIsUpdateOrQuiet
  Pop $0
  ${If} $0 = 1
    Return
  ${EndIf}
  ; Only replace the standard suggestion, never the folder of an earlier install.
  ${If} $INSTDIR != "$LOCALAPPDATA\SecurePhotos"
  ${OrIf} ${FileExists} "$INSTDIR\SecurePhotos.exe"
    Return
  ${EndIf}
  StrCpy $SpDriveFound ""
  ${GetDrives} "FDD" SpRememberDrive
  ${If} $SpDriveFound != ""
    StrCpy $INSTDIR "$SpDriveFound\SecurePhotos"
  ${EndIf}
FunctionEnd

Function .onVerifyInstDir
  Call SpIsUpdateOrQuiet
  Pop $0
  ${If} $0 = 1
    Return
  ${EndIf}
  StrCpy $0 $INSTDIR 2
  StrCpy $1 $WINDIR 2
  ${If} $0 == $1
  ${AndIf} $SpThisComputerOk != $INSTDIR
    ; T20 (owner, 2026-11-21): NSIS checks the folder several times for one press of Next, so the
    ; question came back 4-5 times after No. Ask once; checks within 2 s of the answer just wait.
    System::Call 'kernel32::GetTickCount() i .r2'
    ${If} $SpLastAsked != ""
      IntOp $3 $2 - $SpLastAsked
      ${If} $3 < 2000
        Abort
      ${EndIf}
    ${EndIf}
    MessageBox MB_ICONQUESTION|MB_YESNO "SecurePhotos will be installed on this computer, and your photos and videos will be kept here too.$\r$\n$\r$\nThat means they won't come with you when you use another computer.$\r$\n$\r$\nTo carry your library with you, choose No, plug in your external drive and pick it instead.$\r$\n$\r$\nInstall on this computer?" IDYES sp_this_computer_ok
    System::Call 'kernel32::GetTickCount() i .r2'
    StrCpy $SpLastAsked $2
    Abort
    sp_this_computer_ok:
    StrCpy $SpThisComputerOk $INSTDIR
  ${EndIf}
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  ; Close a running SecurePhotos and its engine, so their files can be replaced in place.
  nsExec::Exec 'taskkill /F /IM securephotos-engine.exe'
  nsExec::Exec 'taskkill /F /IM SecurePhotos.exe'

  ; The engine is a folder of program files only (never photos); clear it so an update leaves
  ; no files from the previous version. Older versions kept it as one file next to the app.
  RMDir /r "$INSTDIR\engine"
  Delete "$INSTDIR\securephotos-engine.exe"

  ; Remove any legacy shortcut left behind in Public Desktop by older MSI installations
  Delete "$COMMONDESKTOP\SecurePhotos.lnk"
  ; Clean up any existing user desktop shortcut before writing the new one to prevent duplication
  Delete "$DESKTOP\SecurePhotos.lnk"
  ; No Visual C++ check: the app and its engine carry that runtime themselves (T2), so they
  ; also start on a computer the drive is plugged into that never had it installed.
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Guarantee that the public desktop does not contain a duplicate
  Delete "$COMMONDESKTOP\SecurePhotos.lnk"

  ; H10 / A2c: download the old-photo models (about 2.7 GB, once). Each model is checked by
  ; SHA-256; one already in place is skipped, so upgrades are quick. A failed download never
  ; fails the install: the app asks later, before the first feature that needs that model.
  ;
  ; T19 (owner, 2026-11-21): the engine runs hidden and the installer doesn't wait on it; it reads
  ; the engine's progress file twice a second and moves its own progress bar, with a line such as
  ; "Add colour (1 of 5): 450 of 980 MB". The status file appearing means the download is over.
  ; T21: the results are lines in this window (details shown), not a separate message box.
  Delete "$INSTDIR\data\models\install_status.txt"
  Delete "$INSTDIR\data\models\install_progress.txt"
  SetDetailsPrint both
  DetailPrint "Getting the old-photo models (about 2.7 GB, once). This can take a while..."
  SetDetailsPrint textonly
  ExecShell "open" "$INSTDIR\engine\securephotos-engine.exe" '--fetch-models "$INSTDIR\data\models"' SW_HIDE
  FindWindow $R0 "#32770" "" $HWNDPARENT
  GetDlgItem $R1 $R0 1004
  SendMessage $R1 0x406 0 100 ; PBM_SETRANGE32: 0-100 for the download
  SendMessage $R1 0x402 0 0   ; PBM_SETPOS
  StrCpy $R2 ""
  StrCpy $R3 0
  sp_poll:
    IfFileExists "$INSTDIR\data\models\install_status.txt" sp_poll_done
    Sleep 500
    ClearErrors
    FileOpen $R4 "$INSTDIR\data\models\install_progress.txt" r
    IfErrors sp_no_news
    FileRead $R4 $R5
    FileRead $R4 $R6
    FileClose $R4
    ${TrimNewLines} $R5 $R5
    ${TrimNewLines} $R6 $R6
    StrCmp "$R5|$R6" $R2 sp_no_news
    StrCpy $R2 "$R5|$R6"
    StrCpy $R3 0
    SendMessage $R1 0x402 $R5 0
    DetailPrint "$R6"
    Goto sp_poll
    sp_no_news:
    IntOp $R3 $R3 + 1
    ; No news for 5 minutes: the download has stopped. The app offers it later.
    IntCmp $R3 600 sp_poll_done sp_poll sp_poll_done
  sp_poll_done:
  SendMessage $R1 0x402 100 0
  SetDetailsPrint both
  Delete "$INSTDIR\data\models\install_progress.txt"
  ${If} ${FileExists} "$INSTDIR\data\models\install_status.txt"
    DetailPrint ""
    DetailPrint "Old-photo models:"
    FileOpen $2 "$INSTDIR\data\models\install_status.txt" r
    sp_status_loop:
      ClearErrors
      FileRead $2 $3
      IfErrors sp_status_done
      ${TrimNewLines} $3 $3
      DetailPrint "  $3"
      Goto sp_status_loop
    sp_status_done:
    FileClose $2
  ${Else}
    DetailPrint "The old-photo models will be offered in the app when you first need them."
  ${EndIf}
  SetDetailsView show
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  MessageBox MB_ICONINFORMATION|MB_OKCANCEL \
    "Removing SecurePhotos takes away the app only.$\r$\n$\r$\n\
Your photos, videos, albums and Private Vault stay where they are, in:$\r$\n\
$INSTDIR\data$\r$\n$\r$\n\
Photos in your Private Vault stay locked. If you'd like them back as ordinary photos, choose Cancel, \
open SecurePhotos and move them out of the vault first.$\r$\n$\r$\n\
Choose OK to remove the app." \
    IDOK proceed_uninstall
  Abort
  proceed_uninstall:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Cleanly remove desktop shortcuts from both user and common desktop locations
  Delete "$DESKTOP\SecurePhotos.lnk"
  Delete "$COMMONDESKTOP\SecurePhotos.lnk"
!macroend
