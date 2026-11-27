; NSIS installer hooks for Gruzly.
; A running instance keeps its sidecar binaries locked, which would make
; file extraction fail with "Error opening file for writing".

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running Gruzly processes..."
  nsExec::Exec 'taskkill /IM "Gruzly.exe" /F /T'
  ; An orphaned engine from a crashed or force-closed session keeps
  ; aria2c.exe locked even when the app itself is gone.
  nsExec::Exec 'taskkill /IM "aria2c.exe" /F'
  nsExec::Exec 'taskkill /IM "yt-dlp.exe" /F'
  nsExec::Exec 'taskkill /IM "ffmpeg.exe" /F'

  ; Wait for the sidecar file handles to be released (up to ~5 seconds).
  IfFileExists "$INSTDIR\aria2c.exe" 0 done
  StrCpy $0 0
  retry:
    ClearErrors
    FileOpen $1 "$INSTDIR\aria2c.exe" r
    IfErrors locked
      FileClose $1
      Goto done
    locked:
      Sleep 500
      IntOp $0 $0 + 1
      IntCmp $0 10 done retry
  done:
!macroend
