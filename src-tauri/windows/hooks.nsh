; The station database lives in %ProgramData%\LabelVerification and is shared
; by every Windows account on the machine (see src/data_location.rs). By
; default ProgramData lets other accounts read a file but not write it, so the
; Label Room login could open the database but not check anything out. Grant
; the local Users group (S-1-5-32-545, language-independent) modify rights,
; inherited by the database and its -wal / -shm sidecars.
;
; There is deliberately no uninstall hook: that folder holds the audit trail
; and must survive uninstalling or reinstalling the program.

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  ReadEnvStr $0 PROGRAMDATA
  StrCmp $0 "" 0 +2
    StrCpy $0 "C:\ProgramData"
  CreateDirectory "$0\LabelVerification"
  nsExec::ExecToLog 'icacls "$0\LabelVerification" /grant *S-1-5-32-545:(OI)(CI)M /T /C /Q'
  Pop $1
  Pop $1
  Pop $0
!macroend
