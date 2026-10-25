@echo off
title ShowVault - Servidor Local
echo ========================================================
echo   ShowVault - Seu Rastreador Pessoal de Series
echo   Zero perda de anotacoes - TV Time Replica Local
echo ========================================================
echo.
echo Iniciando servidor local na porta 3000...
start http://localhost:3000
node server.js
pause
