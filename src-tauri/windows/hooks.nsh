; Ganchos do instalador do Tauri (bundle.windows.nsis.installerHooks, no tauri.conf.json).
;
; A passagem de quem tem o app em Electron (até a 0.7.x): o atualizador dele baixa este instalador e roda
; sem telas ("--updated /S --force-run"). Antes de instalar, o app antigo sai sem perguntar nada (a
; biblioteca fica, em %APPDATA%\Playtrove, e o app novo abre com ela) e, no fim, o app novo abre sozinho,
; como o antigo fazia depois de uma atualização. Quem instala o novo pelo instalador com telas também fica
; sem o antigo, em vez de dois Playtrove no computador.

; Onde o instalador do Electron (electron-builder) guarda a pasta do app: o nome vem do appId
; (io.github.lamarckz.playtrove), então é o mesmo para todo mundo. O teste dos ganchos troca pela chave de
; um app antigo de mentira.
!ifndef ELECTRON_APP_KEY
  !define ELECTRON_APP_KEY "Software\27d9fd3d-7c2f-5a85-86f6-2250b9efe66d"
!endif
!define ELECTRON_UNINSTALLER "Uninstall Playtrove.exe"

; O app antigo foi tirado nesta instalação.
Var ElectronAppRemoved

!macro NSIS_HOOK_PREINSTALL
  StrCpy $ElectronAppRemoved 0
  Push $R0
  ReadRegStr $R0 HKCU "${ELECTRON_APP_KEY}" "InstallLocation"
  ${If} $R0 != ""
  ${AndIf} ${FileExists} "$R0\${ELECTRON_UNINSTALLER}"
    ; O "_?=" faz o desinstalador rodar ali mesmo e o ExecWait esperar ele terminar. Sem isso, ele se copia
    ; para outra pasta e a instalação seguiria antes da hora (e os atalhos novos, com o mesmo nome, iriam
    ; embora junto com os antigos). Desinstalar o antigo não apaga a biblioteca.
    ExecWait '"$R0\${ELECTRON_UNINSTALLER}" /currentuser /S _?=$R0'
    Delete "$R0\${ELECTRON_UNINSTALLER}"
    RMDir "$R0"
    StrCpy $ElectronAppRemoved 1
  ${EndIf}
  Pop $R0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Veio do atualizador do Electron (sem telas): abre o app novo, como depois de uma atualização.
  ${If} $ElectronAppRemoved = 1
  ${AndIf} ${Silent}
    nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
  ${EndIf}
!macroend
