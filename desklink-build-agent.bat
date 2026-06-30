@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Abrir pelo Explorer: ir para a pasta deste .bat
cd /d "%~dp0" 2>nul
if errorlevel 1 (
  echo ERRO: nao foi possivel entrar na pasta do script.
  goto :FIM_ERRO
)

REM PATH curto ao dar duplo-clique - tentar achar Node instalado no usuario
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
if exist "%LocalAppData%\Programs\nodejs\node.exe" set "PATH=%LocalAppData%\Programs\nodejs;%PATH%"

title DeskLink - Build pacote de expedicao (Host + Servidor)

echo ========================================
echo  DeskLink - compilar e gerar wizard unificado
echo  Pasta: %CD%
echo  Gera: DeskLinkDeployWizard.exe com
echo        - DeskLink Host
echo        - DeskLink Server
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado no PATH.
  echo Instale Node 18+ de https://nodejs.org ou reinicie o PC apos instalar.
  goto :FIM_ERRO
)

echo [1/8] npm install...
call npm install
if errorlevel 1 (
  echo [ERRO] npm install falhou.
  goto :FIM_ERRO
)
echo.

echo [2/8] npm run build -w client
call npm run build -w client
if errorlevel 1 (
  echo [ERRO] Build do client falhou.
  goto :FIM_ERRO
)
echo.

echo [3/8] npm run build -w server
call npm run build -w server
if errorlevel 1 (
  echo [ERRO] Build do server falhou.
  goto :FIM_ERRO
)
echo.

echo [4/8] npm run build-icon -w agent
call npm run build-icon -w agent
if errorlevel 1 (
  echo [ERRO] Build do icone falhou.
  goto :FIM_ERRO
)
echo.

echo [5/8] npm run pack:agent -w agent  ^(DeskLinkHost.exe + payload^)
taskkill /F /IM DeskLinkHost.exe /T >nul 2>&1
timeout /t 1 /nobreak >nul
call npm run pack:agent -w agent
if errorlevel 1 (
  echo [ERRO] Pack do agent ^(Host^) falhou.
  goto :FIM_ERRO
)
echo.

echo [6/8] npm run build-icon -w agent-server
call npm run build-icon -w agent-server
if errorlevel 1 (
  echo [ERRO] Build do icone do agent-server falhou.
  goto :FIM_ERRO
)
echo.

echo [7/8] npm run pack:agent -w agent-server  ^(DeskLinkServer.exe + payload^)
taskkill /F /IM DeskLinkServer.exe /T >nul 2>&1
timeout /t 1 /nobreak >nul
call npm run pack:agent -w agent-server
if errorlevel 1 (
  echo [ERRO] Pack do agent-server ^(Servidor^) falhou.
  goto :FIM_ERRO
)
echo.

echo [8/8] npm run build:deploy-wizard -w agent  ^(Inno Setup - pode levar varios minutos^)
call npm run build:deploy-wizard -w agent
if errorlevel 1 (
  echo [ERRO] Build do wizard Inno Setup falhou.
  goto :FIM_ERRO
)
echo.

set "REL=%~dp0agent\installer\publish"
echo ========================================
echo  CONCLUIDO COM SUCESSO
echo  Wizard em: !REL!
echo ========================================
echo.

if exist "!REL!" (
  start "" explorer.exe "!REL!"
) else (
  echo [AVISO] Pasta release nao encontrada: !REL!
)

goto :FIM_OK

:FIM_ERRO
echo.
echo Resultado: FALHA - leia as mensagens acima.

:FIM_OK
echo.
echo ----------------------------------------
echo  Pressione qualquer tecla para fechar esta janela.
echo ----------------------------------------
pause
endlocal
exit /b 0
