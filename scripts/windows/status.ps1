#Requires -Version 5.1
<#
.SYNOPSIS
  Mostra a situação do ShowVault neste PC: está rodando? /health responde? último backup? Funnel do Tailscale?

.DESCRIPTION
  Só LÊ (não liga, não desliga, não muda nada):
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\status.ps1
  Com -Log mostra também as últimas linhas dos logs.

.PARAMETER EnvFile  .env a usar (padrão: o da pasta do projeto).
.PARAMETER LogDir   Pasta dos logs (padrão: %LOCALAPPDATA%\ShowVault\logs).
.PARAMETER Log      Mostra as últimas linhas do supervisor.log, showvault.log e backup.log.
.PARAMETER NoTailscale Não consulta o Tailscale.
#>
[CmdletBinding()]
param(
    [string]$EnvFile,
    [string]$LogDir,
    [switch]$Log,
    [switch]$NoTailscale
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-ShowVaultRoot
if (-not $EnvFile) { $EnvFile = Join-Path $root '.env' }
if (-not $LogDir) { $LogDir = Get-DefaultLogDir }
$problems = 0

Write-Title 'ShowVault: situação'

# --- configuração ---
$node = Get-NodeExe
$config = $null
if (-not $node) {
    Write-Bad 'Node.js não encontrado (node.exe fora do PATH).'
    $problems++
} elseif (-not (Test-Path -LiteralPath $EnvFile)) {
    Write-Bad ('Sem arquivo de configuração: ' + $EnvFile + ' (rode: npm run setup:pc)')
    $problems++
} else {
    $config = Get-ShowVaultConfig -Root $root -NodeExe $node -EnvFile $EnvFile
    if (-not $config) {
        Write-Bad 'Não consegui ler a configuração (rode: node scripts\show-config.js).'
        $problems++
    } else {
        Write-Ok ('Node ' + $config.nodeVersion + ' · porta ' + $config.port + ' · armazenamento ' + $config.storage + $(if ($config.production) { ' · produção' } else { ' · NÃO é produção' }))
        foreach ($problem in @($config.problems)) { Write-Bad $problem; $problems++ }
        if ($config.storage -ne 'sqlite') { Write-Warn 'STORAGE não é sqlite: o modo PC e o backup diário esperam sqlite.' }
    }
}

# --- tarefas do Agendador ---
foreach ($name in @($script:TaskNameApp, $script:TaskNameBackup)) {
    try {
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if (-not $task) {
            Write-Warn ('Tarefa "' + $name + '": não registrada (rode install-autostart.ps1).')
            continue
        }
        $info = Get-ScheduledTaskInfo -TaskName $name
        $last = 'nunca executou'
        if ($info.LastRunTime -and $info.LastRunTime.Year -gt 2000) {
            $last = 'última execução ' + $info.LastRunTime.ToString('dd/MM/yyyy HH:mm') + ' (resultado ' + $info.LastTaskResult + ')'
        }
        Write-Ok ('Tarefa "' + $name + '": ' + $task.State + ' · ' + $last)
    } catch {
        Write-Warn ('Tarefa "' + $name + '": não consegui consultar (' + $_.Exception.Message + ')')
    }
}

# --- servidor ---
if ($config) {
    $listener = Get-PortListener -Port ([int]$config.port)
    if (-not $listener) {
        Write-Bad ('Nada escutando na porta ' + $config.port + ': o ShowVault NÃO está rodando. Para ligar: Start-ScheduledTask -TaskName ShowVault')
        $problems++
    } else {
        if (Test-IsShowVaultServer $listener) {
            Write-Ok ('Servidor: PID ' + $listener.ProcessId + ' escutando em ' + $listener.LocalAddress + ':' + $config.port)
        } else {
            Write-Bad ('A porta ' + $config.port + ' está com outro programa (' + $listener.Name + ', PID ' + $listener.ProcessId + ').')
            $problems++
        }
        if ($listener.LocalAddress -notin @('127.0.0.1', '::1')) {
            Write-Warn ('O servidor escuta em ' + $listener.LocalAddress + ' (aberto à rede local). O recomendado é HOST=127.0.0.1 no .env.')
        }
        $health = Get-ShowVaultHealth -Url $config.healthUrl -TimeoutSec 5
        if ($health -and $health.status -eq 'ok') {
            Write-Ok ('/health: ok · armazenamento ' + $health.storage + ' · no ar há ' + (Format-Duration ([TimeSpan]::FromSeconds([double]$health.uptimeSec))))
        } else {
            Write-Bad ('/health não respondeu em ' + $config.healthUrl)
            $problems++
        }
    }
    $supervisors = @(Get-SupervisorProcess)
    if ($supervisors.Count -gt 0) {
        Write-Ok ('Supervisor (reinicia o servidor se ele cair): ativo, PID ' + (($supervisors | ForEach-Object { $_.ProcessId }) -join ', '))
    } else {
        Write-Warn 'Supervisor não está rodando (o servidor, se existir, foi aberto de outro jeito e não reinicia sozinho).'
    }

    # --- banco e backup ---
    $dbFile = Join-Path $config.dataDir 'showvault.sqlite'
    if (Test-Path -LiteralPath $dbFile) {
        $db = Get-Item -LiteralPath $dbFile
        Write-Ok ('Banco: ' + $dbFile + ' (' + [Math]::Round($db.Length / 1MB, 2) + ' MB)')
    } else {
        Write-Warn ('Banco ainda não existe em ' + $config.dataDir)
    }
    $backups = @()
    if (Test-Path -LiteralPath $config.backupDir) {
        $backups = @(Get-ChildItem -LiteralPath $config.backupDir -Filter 'showvault-*.sqlite' -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^showvault-\d{4}-\d{2}-\d{2}_\d{6}\.sqlite$' } | Sort-Object LastWriteTime -Descending)
    }
    if ($backups.Count -eq 0) {
        Write-Warn ('Nenhum backup em ' + $config.backupDir + ' (rode: npm run backup)')
    } else {
        $age = (Get-Date) - $backups[0].LastWriteTime
        $text = 'Último backup: ' + $backups[0].Name + ' (há ' + (Format-Duration $age) + '), ' + $backups.Count + ' guardado(s) em ' + $config.backupDir
        if ($age.TotalHours -gt 36) { Write-Warn ($text + ' · está velho: confira a tarefa ShowVault-Backup') } else { Write-Ok $text }
    }
}

# --- Tailscale (somente leitura) ---
if (-not $NoTailscale) {
    $tailscale = Get-TailscaleExe
    if (-not $tailscale) {
        Write-Warn 'Tailscale não encontrado neste PC (instale e siga o guia para publicar o link).'
    } else {
        $previousPreference = $ErrorActionPreference
        try {
            # O tailscale escreve avisos em stderr; com "Stop" isso viraria exceção.
            $ErrorActionPreference = 'Continue'
            $funnel = (& $tailscale funnel status 2>&1 | ForEach-Object { $_.ToString() }) -join "`n"
            $url = [regex]::Match($funnel, 'https://[A-Za-z0-9.-]+\.ts\.net').Value
            if ($url) {
                Write-Info ('  Endereço configurado no Tailscale: ' + $url)
                # A prova de verdade é pedir o /health pelo link público (o texto do "funnel status" pode mudar entre versões).
                $publicHealth = Get-ShowVaultHealth -Url ($url + '/health') -TimeoutSec 10
                if ($publicHealth -and $publicHealth.status -eq 'ok') {
                    Write-Ok 'Pelo link público, /health: ok (o Funnel está publicando o ShowVault).'
                } else {
                    Write-Bad 'Pelo link público, /health não respondeu (Funnel desligado? PC dormindo? Tailscale desconectado? servidor parado?).'
                    $problems++
                }
            } else {
                Write-Warn 'Sem Funnel configurado ("tailscale funnel status" não mostrou um endereço .ts.net). Veja o guia para ligar.'
            }
        } catch {
            Write-Warn ('Não consegui consultar o Tailscale: ' + $_.Exception.Message)
        } finally {
            $ErrorActionPreference = $previousPreference
        }
    }
}

if ($Log) {
    foreach ($name in @('supervisor.log', 'showvault.log', 'backup.log')) {
        $file = Join-Path $LogDir $name
        Write-Title ('Fim de ' + $file)
        if (Test-Path -LiteralPath $file) { Get-Content -LiteralPath $file -Tail 15 } else { Write-Info '  (não existe ainda)' }
    }
} else {
    Write-Info ''
    Write-Info ('Logs em ' + $LogDir + ' (use -Log para ver as últimas linhas).')
}

Write-Info ''
if ($problems -eq 0) { Write-Host 'Tudo certo.' -ForegroundColor Green } else { Write-Host ($problems.ToString() + ' problema(s) acima.') -ForegroundColor Red }
exit $(if ($problems -eq 0) { 0 } else { 1 })
