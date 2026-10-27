@echo off
setlocal EnableExtensions
title Enviar a branch atual para o GitHub - Anime-Tracker
cd /d "%~dp0"

echo ================================================================
echo   ShowVault / Anime-Tracker - Enviar a branch atual ao GitHub
echo   Repositorio: https://github.com/GabrixZero/Anime-Tracker
echo ================================================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [ERRO] O Git nao foi encontrado.
  pause
  exit /b 1
)

for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%B"
if "%BRANCH%"=="" (
  echo [ERRO] Nao consegui descobrir a branch atual. Esta pasta e um repositorio Git?
  pause
  exit /b 1
)
if "%BRANCH%"=="HEAD" (
  echo [ERRO] Voce nao esta em nenhuma branch ^(HEAD solta^). Entre numa branch e tente de novo.
  pause
  exit /b 1
)

echo Branch atual: %BRANCH%
echo.
git status --short
echo.
echo Mudancas ainda NAO commitadas nao sao enviadas ^(so os commits^).
set /p CONFIRMA=Enviar a branch "%BRANCH%" para o GitHub? ^(s/n^):
if /i not "%CONFIRMA%"=="s" (
  echo Cancelado. Nada foi enviado.
  pause
  exit /b 0
)

echo.
git push -u origin "%BRANCH%"
if errorlevel 1 (
  echo.
  echo [ERRO] O envio falhou. Se a mensagem fala em "rejected", rode "git pull" e tente de novo. Nunca force o envio ^(force push^).
  pause
  exit /b 1
)

echo.
echo ================================================================
echo   Branch "%BRANCH%" enviada.
echo.
echo   * Em branches feature/*: a GitHub Action abre sozinha um Pull
echo     Request para a branch "develop".
echo   * Depois que "develop" for atualizada, outra Action abre um PR
echo     de "develop" para "main".
echo ================================================================
pause
