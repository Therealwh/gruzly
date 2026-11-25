; NSIS installer hooks for Gruzly.
; A running instance keeps its sidecar binaries locked, which would make
; file extraction fail with "Error opening file for writing".

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running Gruzly processes..."
  nsExec::Exec 'taskkill /IM "Gruzly.exe" /F /T'
  Sleep 500
!macroend
