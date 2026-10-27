#Requires -Version 5.1
<#
.SYNOPSIS
  Backup do banco do ShowVault (é o que a tarefa "ShowVault-Backup" executa todo dia).

.DESCRIPTION
  Roda "node scripts\backup.js" com o .env da pasta do projeto e grava o resultado em %LOCALAPPDATA%\ShowVault\logs\backup.log.
  Pode rodar com o servidor ligado (o backup é uma foto consistente feita pelo SQLite). Você também pode rodar à mão:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\backup-showvault.ps1
  (ou, na pasta do projeto, simplesmente: npm run backup)

.PARAMETER EnvFile .env a usar (padrão: o da pasta do projeto).
.PARAMETER LogDir  Pasta dos logs (padrão: %LOCALAPPDATA%\ShowVault\logs).
#>
[CmdletBinding()]
param(
    [string]$EnvFile,
    [string]$LogDir
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-ShowVaultRoot
if (-not $EnvFile) { $EnvFile = Join-Path $root '.env' }
if (-not $LogDir) { $LogDir = Get-DefaultLogDir }
$log = Join-Path $LogDir 'backup.log'
Invoke-LogRotation -Path $log -MaxBytes 1048576 -Keep 2

$node = Get-NodeExe
if (-not $node) {
    Write-ShowVaultLog -Path $log -Message 'ERRO: não achei o Node.js (node.exe).'
    exit 2
}
if (-not (Test-Path -LiteralPath $EnvFile)) {
    Write-ShowVaultLog -Path $log -Message ('ERRO: não achei ' + $EnvFile + '. Rode "npm run setup:pc".')
    exit 3
}

Write-ShowVaultLog -Path $log -Message 'Backup diário: iniciando.'
Push-Location $root
$previousPreference = $ErrorActionPreference
try {
    # Com "Stop", a primeira linha que o Node escrevesse em stderr viraria uma exceção e esconderia o código de saída.
    $ErrorActionPreference = 'Continue'
    # node --env-file=... para o mesmo .env do servidor; backup.js também lê o .env da pasta do projeto por conta própria.
    $output = (& $node ('--env-file=' + $EnvFile) (Join-Path $root 'scripts\backup.js') 2>&1 | ForEach-Object { $_.ToString() }) -join "`n"
    $code = $LASTEXITCODE
} catch {
    $output = $_.Exception.Message
    $code = 1
} finally {
    $ErrorActionPreference = $previousPreference
    Pop-Location
}
foreach ($line in ($output -split "\r?\n")) {
    if ($line.Trim()) { Write-ShowVaultLog -Path $log -Message $line.Trim() }
}
if ($code -eq 0) {
    Write-ShowVaultLog -Path $log -Message 'Backup diário: concluído.'
} else {
    Write-ShowVaultLog -Path $log -Message ('Backup diário: FALHOU (código ' + $code + ').')
}
exit $code
