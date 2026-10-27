@echo off
setlocal EnableExtensions
title ShowVault - Servidor Local
cd /d "%~dp0"

echo ========================================================
echo   ShowVault - Rastreador de series, animes e filmes
echo ========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] O Node.js nao foi encontrado. Instale a versao 26 ou mais nova em https://nodejs.org e rode este arquivo de novo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando as dependencias ^(so na primeira vez, pode demorar um pouco^)...
  call npm install
  if errorlevel 1 (
    echo [ERRO] O npm install falhou. Veja a mensagem acima.
    pause
    exit /b 1
  )
  echo.
)

rem Porta: usa a variavel PORT se ja existir; senao a do arquivo .env; senao 3000.
set "ENVFLAG="
if exist ".env" set "ENVFLAG=--env-file=.env"
if not defined PORT if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"PORT=" ".env"`) do set "PORT=%%B"
)
if not defined PORT set "PORT=3000"
set "PORT=%PORT: =%"
set "PORT=%PORT:"=%"
if "%PORT%"=="" set "PORT=3000"

echo Iniciando o servidor na porta %PORT% ...
echo O navegador abre sozinho quando o servidor estiver pronto. Para parar, feche esta janela ou use Ctrl+C.
echo.

rem Espera o servidor responder em /health (ate ~30 s) e so entao abre o navegador.
if not defined SHOWVAULT_NO_BROWSER (
  start "" /b powershell -NoProfile -Command "for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:%PORT%/health' -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:%PORT%'; break } catch { Start-Sleep -Milliseconds 500 } }"
)

node %ENVFLAG% server.js

echo.
echo O servidor foi encerrado.
pause
