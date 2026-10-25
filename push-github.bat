@echo off
title Enviar Branches para o GitHub - Anime-Tracker
echo ================================================================
echo   ShowVault / Anime-Tracker - Envio de Branches para o GitHub
echo   Repositorio: https://github.com/GabrixZero/Anime-Tracker
echo ================================================================
echo.
echo Enviando branch main...
git push -u origin main
echo.
echo Enviando branch develop...
git push -u origin develop
echo.
echo Enviando branch feature/core-setup...
git push -u origin feature/core-setup
echo.
echo ================================================================
echo   Pronto! Todas as branches foram sincronizadas no GitHub.
echo ================================================================
pause
