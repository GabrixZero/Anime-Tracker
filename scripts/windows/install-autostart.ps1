#Requires -Version 5.1
<#
.SYNOPSIS
  Registra no Agendador de Tarefas do Windows: (1) ligar o ShowVault ao entrar no Windows e (2) o backup diário do banco.

.DESCRIPTION
  Rode UMA vez, depois de "npm run setup:pc" e da migração dos dados (veja Documentacao\deploy-pc-tailscale.md):
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\install-autostart.ps1

  Cria duas tarefas do seu usuário (sem administrador, sem mudar nenhuma configuração do Windows):
    ShowVault         ao fazer logon (com 30 s de espera), janela oculta, sem limite de tempo, reinicia se falhar
    ShowVault-Backup  todo dia às 04:00 (ou na primeira chance depois, se o PC estava desligado): npm run backup
  Rodar de novo atualiza as tarefas (não duplica). Para remover: uninstall-autostart.ps1.

.PARAMETER BackupTime Hora do backup diário, no formato HH:mm (padrão 04:00).
.PARAMETER StartNow    Liga o ShowVault agora (a tarefa) e espera o /health responder.
.PARAMETER DryRun      Só mostra o que seria registrado; não registra nada.
#>
[CmdletBinding()]
param(
    [string]$BackupTime = '04:00',
    [switch]$StartNow,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-ShowVaultRoot
$node = Get-NodeExe
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$user = $env:USERDOMAIN + '\' + $env:USERNAME

Write-Title 'ShowVault: ligar com o Windows e backup diário'
if ($DryRun) { Write-Warn 'Simulação (-DryRun): nada será registrado.' }

# --- conferências antes de registrar ---
if (-not $node) {
    Write-Bad 'Não achei o Node.js. Instale o Node 26 ou mais novo em https://nodejs.org e rode de novo.'
    exit 2
}
Write-Ok ('Node: ' + $node)

$envFile = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
    Write-Bad ('Não achei ' + $envFile + '. Rode antes: npm run setup:pc')
    exit 3
}
$config = Get-ShowVaultConfig -Root $root -NodeExe $node -EnvFile $envFile
if (-not $config) {
    Write-Bad 'Não consegui ler a configuração (rode "node scripts\show-config.js" para ver o motivo).'
    exit 4
}
if (@($config.problems).Count -gt 0) {
    foreach ($problem in @($config.problems)) { Write-Bad $problem }
    Write-Bad 'Corrija o .env (npm run setup:pc ajuda) e rode de novo.'
    exit 5
}
if ($config.storage -ne 'sqlite') {
    Write-Warn ('STORAGE=' + $config.storage + ' no .env: o modo PC usa sqlite (o backup diário só funciona com sqlite).')
}
Write-Ok ('Configuração: porta ' + $config.port + ', dados em ' + $config.dataDir)
Write-Ok ('Backups em: ' + $config.backupDir)

$dbFile = Join-Path $config.dataDir 'showvault.sqlite'
if (-not (Test-Path -LiteralPath $dbFile)) {
    Write-Warn 'Ainda não existe banco de dados na pasta de dados. Se você já usa o ShowVault com arquivos JSON (server\data),'
    Write-Warn 'faça ANTES a migração (npm run storage:migrate -- --from server\data) para não começar com a lista vazia.'
}

$listener = Get-PortListener -Port ([int]$config.port)
if ($listener) {
    Write-Warn ('A porta ' + $config.port + ' já está em uso (' + $listener.Name + ', PID ' + $listener.ProcessId + ').')
    Write-Warn 'Se for o ShowVault aberto pelo iniciar.bat, feche essa janela antes de ligar a tarefa (não pode haver dois).'
}

# --- montar as tarefas ---
$startScript = Join-Path $PSScriptRoot 'start-showvault.ps1'
$backupScript = Join-Path $PSScriptRoot 'backup-showvault.ps1'
$powershellArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"'

$appAction = New-ScheduledTaskAction -Execute $powershell -Argument ($powershellArgs -f $startScript) -WorkingDirectory $root
$appTrigger = New-ScheduledTaskTrigger -AtLogOn -User $user
try { $appTrigger.Delay = 'PT30S' } catch { Write-Warn 'Não consegui definir a espera de 30 s depois do logon (segue sem ela).' }
# Sem limite de tempo (o padrão do Windows mataria o servidor a cada 3 dias), na bateria também, e reinicia se falhar.
$appSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

$backupAction = New-ScheduledTaskAction -Execute $powershell -Argument ($powershellArgs -f $backupScript) -WorkingDirectory $root
$backupTrigger = New-ScheduledTaskTrigger -Daily -At $BackupTime
$backupSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Write-Title 'O que será registrado'
Write-Info ('  Tarefa "' + $script:TaskNameApp + '": ao fazer logon (' + $user + '), janela oculta, sem limite de tempo, reinicia se falhar')
Write-Info ('     ação: powershell.exe ' + ($powershellArgs -f $startScript))
Write-Info ('  Tarefa "' + $script:TaskNameBackup + '": todo dia às ' + $BackupTime + ' (ou na primeira chance, se o PC estava desligado)')
Write-Info ('     ação: powershell.exe ' + ($powershellArgs -f $backupScript))

if ($DryRun) {
    Write-Title 'Simulação concluída: nada foi registrado.'
    exit 0
}

try {
    Register-ScheduledTask -TaskName $script:TaskNameApp -Action $appAction -Trigger $appTrigger -Settings $appSettings -Principal $principal `
        -Description 'ShowVault: liga o servidor ao entrar no Windows (modo PC, S11).' -Force | Out-Null
    Register-ScheduledTask -TaskName $script:TaskNameBackup -Action $backupAction -Trigger $backupTrigger -Settings $backupSettings -Principal $principal `
        -Description 'ShowVault: backup diário do banco (npm run backup).' -Force | Out-Null
} catch {
    Write-Bad ('Não consegui registrar as tarefas: ' + $_.Exception.Message)
    Write-Bad 'Se a mensagem fala em "acesso negado", abra o PowerShell como Administrador e rode este comando de novo.'
    exit 7
}
Write-Ok 'Tarefas registradas.'

if ($StartNow) {
    if ($listener) {
        Write-Warn 'Não liguei agora porque a porta está em uso (veja o aviso acima). Feche o outro e rode: Start-ScheduledTask -TaskName ShowVault'
    } else {
        Start-ScheduledTask -TaskName $script:TaskNameApp
        Write-Info '  Ligando o ShowVault (até 60 s)...'
        $health = Wait-ShowVaultHealth -Url $config.healthUrl -TimeoutSec 60
        if ($health) {
            Write-Ok ('No ar: ' + $config.healthUrl + ' (armazenamento: ' + $health.storage + ')')
        } else {
            Write-Bad ('Não respondeu em 60 s. Veja ' + (Get-DefaultLogDir) + '\supervisor.log e showvault.log')
            exit 8
        }
    }
}

Write-Title 'Pronto.'
Write-Info '  Ligar agora:     Start-ScheduledTask -TaskName ShowVault'
Write-Info '  Parar:           powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\stop-showvault.ps1'
Write-Info '  Ver a situação:  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\status.ps1'
Write-Info '  Remover tudo:    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\uninstall-autostart.ps1'
