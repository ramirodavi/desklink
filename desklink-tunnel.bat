@echo off
chcp 65001 >nul
title DeskLink - Tunel Cloudflare (gratis)
cd /d "%~dp0"

netstat -an | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  echo ============================================================
  echo  Antes: deixe o servidor DeskLink RODANDO na porta 3000
  echo  ^(execute desklink-server.bat ou use desklink-externo.bat^)
  echo ============================================================
  echo.
)

set "CF="
where cloudflared >nul 2>&1
if not errorlevel 1 set "CF=cloudflared"
if exist "%~dp0cloudflared.exe" set "CF=%~dp0cloudflared.exe"
if exist "%~dp0cloudflared\cloudflared.exe" set "CF=%~dp0cloudflared\cloudflared.exe"

if not defined CF (
  echo cloudflared nao encontrado.
  echo.
  echo Baixe o executavel para Windows em:
  echo   https://github.com/cloudflare/cloudflared/releases
  echo Procure: cloudflared-windows-amd64.exe
  echo Renomeie para cloudflared.exe e coloque nesta pasta:
  echo   %~dp0
  echo.
  pause
  exit /b 1
)

echo Usando: %CF%
echo.
echo Sera exibido um endereco https://....trycloudflare.com
echo Use esse URL no controlador (navegador) e no campo do Host Electron.
echo Feche esta janela para encerrar o tunel.
echo.
"%CF%" tunnel --url http://localhost:3000
echo.
pause
