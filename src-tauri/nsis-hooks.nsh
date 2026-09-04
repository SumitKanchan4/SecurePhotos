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
  ; Pre-uninstall cleanup
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Cleanly remove desktop shortcuts from both user and common desktop locations
  Delete "$DESKTOP\SecurePhotos.lnk"
  Delete "$COMMONDESKTOP\SecurePhotos.lnk"
!macroend

