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

title DeskLink - Build agent portable

echo ========================================
echo  DeskLink - compilar e gerar .exe host
echo  Pasta: %CD%
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado no PATH.
  echo Instale Node 18+ de https://nodejs.org ou reinicie o PC apos instalar.
  goto :FIM_ERRO
)

if not exist "node_modules\" (
  echo [1/4] npm install...
  call npm install
  if errorlevel 1 (
    echo [ERRO] npm install falhou.
    goto :FIM_ERRO
  )
  echo.
)

echo [2/4] npm run build -w client
call npm run build -w client
if errorlevel 1 (
  echo [ERRO] Build do client falhou.
  goto :FIM_ERRO
)
echo.

echo [3/4] npm run build -w server
call npm run build -w server
if errorlevel 1 (
  echo [ERRO] Build do server falhou.
  goto :FIM_ERRO
)
echo.

echo [4/4] npm run pack -w agent ^(pode levar varios minutos^)...
call npm run pack -w agent
if errorlevel 1 (
  echo [ERRO] Pack do agent falhou.
  goto :FIM_ERRO
)
echo.

set "REL=%~dp0agent\release"
echo ========================================
echo  CONCLUIDO COM SUCESSO
echo  Pasta do .exe: !REL!
echo ========================================
echo.

if exist "!REL!" (
  REM Abre a pasta no Explorer
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
