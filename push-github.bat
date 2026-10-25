@echo off
title Enviar Branches para o GitHub - Anime-Tracker
echo ================================================================
echo   ShowVault / Anime-Tracker - Envio de Branches para o GitHub
echo   Repositorio: https://github.com/GabrixZero/Anime-Tracker
echo ================================================================
echo.
echo 1. Enviando branch main...
git push -u origin main
echo.
echo 2. Enviando branch develop...
git push -u origin develop
echo.
echo 3. Enviando branch feature/core-setup...
git push -u origin feature/core-setup
echo.
echo 4. Enviando branch feature/mvc-architecture-api...
git push -u origin feature/mvc-architecture-api
echo.
echo ================================================================
echo   Todas as branches foram sincronizadas!
echo.
echo   * GitHub Action ativada: Uma Pull Request automatica sera
echo     aberta da feature para a branch 'develop'.
echo   * Apos mergear para 'develop', outra PR automatica sera
echo     criada para mergear na branch 'main'.
echo ================================================================
pause
