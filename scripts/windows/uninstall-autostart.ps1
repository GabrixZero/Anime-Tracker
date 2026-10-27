#Requires -Version 5.1
<#
.SYNOPSIS
  Remove as tarefas do ShowVault do Agendador do Windows e para o servidor.

.DESCRIPTION
  Desfaz o install-autostart.ps1:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\uninstall-autostart.ps1
  - para e remove as tarefas "ShowVault" e "ShowVault-Backup";
  - para o servidor que estiver rodando (só o processo "node ... server.js" que escuta na porta do seu .env);
  - NÃO apaga dados, backups, logs, o .env nem desliga o Funnel do Tailscale (isso é "tailscale funnel reset"; veja o guia).

.PARAMETER KeepServer Não para o servidor que está rodando agora (só remove as tarefas).
.PARAMETER DryRun     Só mostra o que seria feito.
#>
[CmdletBinding()]
param(
    [switch]$KeepServer,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-ShowVaultRoot
Write-Title 'ShowVault: remover o início automático'
if ($DryRun) { Write-Warn 'Simulação (-DryRun): nada será alterado.' }

foreach ($name in @($script:TaskNameApp, $script:TaskNameBackup)) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if (-not $task) {
        Write-Info ('  Tarefa "' + $name + '": não existe (nada a remover).')
        continue
    }
    if ($DryRun) {
        Write-Info ('  Tarefa "' + $name + '": seria parada e removida.')
        continue
    }
    try {
        Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Ok ('Tarefa "' + $name + '" removida.')
    } catch {
        Write-Bad ('Não consegui remover a tarefa "' + $name + '": ' + $_.Exception.Message)
    }
}

if (-not $KeepServer) {
    $port = 3000
    $node = Get-NodeExe
    $envFile = Join-Path $root '.env'
    if ($node -and (Test-Path -LiteralPath $envFile)) {
        $config = Get-ShowVaultConfig -Root $root -NodeExe $node -EnvFile $envFile
        if ($config) { $port = [int]$config.port }
    }
    $listener = Get-PortListener -Port $port
    $supervisors = @(Get-SupervisorProcess)
    if ($listener -and -not (Test-IsShowVaultServer $listener)) {
        Write-Warn ('A porta ' + $port + ' é usada por outro programa (' + $listener.Name + '); não mexi nele.')
    }
    if ($DryRun) {
        Write-Info ('  Servidor: ' + $supervisors.Count + ' supervisor(es) e ' + $(if (Test-IsShowVaultServer $listener) { '1 servidor' } else { 'nenhum servidor' }) + ' seriam encerrados.')
    } else {
        $count = Stop-ShowVault -Port $port
        if ($count -gt 0) { Write-Ok 'ShowVault encerrado.' } else { Write-Info ('  Servidor: nada do ShowVault rodando (porta ' + $port + ').') }
    }
}

Write-Title 'Pronto.'
Write-Info '  Seus dados, backups e o .env continuam onde estavam.'
Write-Info '  Para tirar o ShowVault da internet também: tailscale funnel reset   (veja o guia, seção "Desligar tudo").'
