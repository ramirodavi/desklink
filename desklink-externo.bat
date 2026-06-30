@echo off
chcp 65001 >nul
title DeskLink - acesso externo
cd /d "%~dp0"

echo.
echo ============================================================
echo  DeskLink - servidor + tunel Cloudflare
echo  Duas janelas serao abertas: servidor e tunel.
echo  Feche ambas para encerrar tudo.
echo ============================================================
echo.

netstat -an | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo  Servidor ja esta rodando na porta 3000.
  echo.
  goto start_tunnel
)

echo  Iniciando servidor em nova janela...
start "DeskLink - servidor" /D "%~dp0" "%~dp0desklink-server.bat"

echo  Aguardando servidor na porta 3000...
set /a WAIT_COUNT=0
:wait_server
timeout /t 2 /nobreak >nul
netstat -an | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto start_tunnel
set /a WAIT_COUNT+=1
set /a WAIT_REM=WAIT_COUNT %% 15
if %WAIT_REM%==0 (
  echo  Ainda aguardando... ^(na primeira vez, instalacao e build podem demorar^)
)
goto wait_server

:start_tunnel
echo  Servidor pronto. Iniciando tunel...
echo.
call "%~dp0desklink-tunnel.bat"
