; Steps of the setup that Tauri's own installer script runs at set points (bundle.windows.nsis.installerHooks in tauri.installer.conf.json).

; Before the files are written. An update lays the new files over the old ones and removes none, so an earlier version's Python would stay
; mixed in with the new one: another version's library and standard library, its packages, and wrappers that name the Python of the computer
; that built it. The two Pythons that travel with the program are replaced whole instead. Nothing of the author's is kept in them (their
; compiled files go to the program's data folder, and the narration voice is installed there too).
!macro NSIS_HOOK_PREINSTALL
  RMDir /r "$INSTDIR\python"
  RMDir /r "$INSTDIR\python-narration"
!macroend
