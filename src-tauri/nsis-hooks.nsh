; SecurePhotos NSIS Installer Hooks
; Ensures desktop icon idempotency and cleans up legacy MSI/public shortcuts across updates.

!macro NSIS_HOOK_PREINSTALL
  ; Remove any legacy shortcut left behind in Public Desktop by older MSI installations
  Delete "$COMMONDESKTOP\SecurePhotos.lnk"
  ; Clean up any existing user desktop shortcut before writing the new one to prevent duplication
  Delete "$DESKTOP\SecurePhotos.lnk"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Guarantee that the public desktop does not contain a duplicate
  Delete "$COMMONDESKTOP\SecurePhotos.lnk"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  MessageBox MB_ICONINFORMATION|MB_OKCANCEL \
    "SecurePhotos Uninstallation Notice:$\r$\n$\r$\n\
1. Your photo library, database, and encrypted Vault are NOT deleted.$\r$\n\
   They remain safely preserved in:$\r$\n\
   $INSTDIR\data (and $PROFILE\.securephotos_data)$\r$\n$\r$\n\
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

