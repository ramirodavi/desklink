@echo off
chcp 65001 >nul
title DeskLink — servidor
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao foi encontrado. Instale Node 18+ de https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [DeskLink] Instalando dependencias ^(primeira vez^)...
  call npm install
  if errorlevel 1 (
    echo Falha no npm install.
    pause
    exit /b 1
  )
)

if not exist "server\dist\index.js" (
  echo [DeskLink] Compilando servidor...
  call npm run build -w server
  if errorlevel 1 (
    echo Falha no build do servidor.
    pause
    exit /b 1
  )
)

if not exist "client\dist\index.html" (
  echo [DeskLink] Compilando pagina do controlador...
  call npm run build -w client
  if errorlevel 1 (
    echo Falha no build do client.
    pause
    exit /b 1
  )
)

echo.
echo  Servidor: http://localhost:3000
echo  Controlador: abra essa URL no navegador ^(ou outro PC na rede^).
echo  Para parar: feche esta janela ou Ctrl+C
echo.
call npm run start -w server
echo.
if errorlevel 1 (
  echo Servidor encerrou com erro.
  pause
)
