#Requires -Version 5.1
<#
.SYNOPSIS
  Para o ShowVault (a tarefa e o servidor) SEM remover o início automático.

.DESCRIPTION
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\stop-showvault.ps1
  Use antes de restaurar um backup ou de mexer nos dados. Para ligar de novo: Start-ScheduledTask -TaskName ShowVault
  (no próximo logon a tarefa liga sozinha; para tirar isso de vez use uninstall-autostart.ps1).
  Ordem importante: primeiro a tarefa é parada (assim o Windows não a religa por "reiniciar se falhar"), depois
  encerra-se o supervisor e o servidor que ainda estiverem de pé (só os do ShowVault, achados pela porta do .env).

.PARAMETER Port   Porta do servidor (padrão: a do .env; 3000 se não houver .env).
.PARAMETER DryRun Só mostra o que seria encerrado.
#>
[CmdletBinding()]
param(
    [int]$Port,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-ShowVaultRoot
Write-Title 'ShowVault: parar'

if (-not $Port) {
    $Port = 3000
    $node = Get-NodeExe
    $envFile = Join-Path $root '.env'
    if ($node -and (Test-Path -LiteralPath $envFile)) {
        $config = Get-ShowVaultConfig -Root $root -NodeExe $node -EnvFile $envFile
        if ($config) { $Port = [int]$config.port }
    }
}

$listener = Get-PortListener -Port $Port
if ($listener -and -not (Test-IsShowVaultServer $listener)) {
    Write-Warn ('A porta ' + $Port + ' é usada por outro programa (' + $listener.Name + '); não mexi nele.')
}
if ($DryRun) {
    $supervisors = @(Get-SupervisorProcess)
    Write-Info ('  Seriam encerrados: a tarefa ' + $script:TaskNameApp + ', ' + $supervisors.Count + ' supervisor(es) e ' + $(if (Test-IsShowVaultServer $listener) { '1 servidor' } else { 'nenhum servidor' }) + ' (porta ' + $Port + ').')
    exit 0
}

if (Get-ScheduledTask -TaskName $script:TaskNameApp -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $script:TaskNameApp -ErrorAction SilentlyContinue
}
$count = Stop-ShowVault -Port $Port

$deadline = (Get-Date).AddSeconds(15)
while ((Get-PortListener -Port $Port) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 500 }
$still = Get-PortListener -Port $Port
if ($still -and (Test-IsShowVaultServer $still)) {
    Write-Bad ('O servidor (PID ' + $still.ProcessId + ') continua de pé na porta ' + $Port + '. Feche a janela que o abriu ou encerre o processo.')
    exit 1
}
if ($count -gt 0) { Write-Ok 'ShowVault parado.' } else { Write-Info ('  Nada do ShowVault estava rodando (porta ' + $Port + ').') }
Write-Info '  Para ligar de novo: Start-ScheduledTask -TaskName ShowVault'
