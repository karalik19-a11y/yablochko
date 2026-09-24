; NSIS-хуки установщика (Tauri 2): ярлыки Start Menu создаёт Tauri по умолчанию,
; ярлык на рабочем столе добавляем явно (DoD Этапа 15).
!macro NSIS_HOOK_POSTINSTALL
  CreateShortcut "$DESKTOP\YABLOKO INTELLIGENCE.lnk" "$INSTDIR\YABLOKO INTELLIGENCE.exe"
  CreateShortcut "$SMPROGRAMS\YABLOKO INTELLIGENCE.lnk" "$INSTDIR\YABLOKO INTELLIGENCE.exe"
!macroend
