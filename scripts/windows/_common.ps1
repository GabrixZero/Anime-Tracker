#Requires -Version 5.1
# Funções compartilhadas pelos scripts do ShowVault no Windows (modo PC, S11 / D-29).
# Uso: no começo de cada script   . (Join-Path $PSScriptRoot '_common.ps1')
# Nada aqui muda configurações do sistema (energia, firewall, inicialização...): só lê, escreve logs e usa o que o script pedir.

$script:TaskNameApp = 'ShowVault'
$script:TaskNameBackup = 'ShowVault-Backup'

# Pasta do projeto (dois níveis acima de scripts\windows).
function Get-ShowVaultRoot {
    return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
}

# Pasta dos logs: %LOCALAPPDATA%\ShowVault\logs (fora do OneDrive).
function Get-DefaultLogDir {
    $base = $env:LOCALAPPDATA
    if (-not $base) { $base = [Environment]::GetFolderPath('LocalApplicationData') }
    return (Join-Path $base 'ShowVault\logs')
}

function Write-Info([string]$Text) { Write-Host $Text }
function Write-Ok([string]$Text) { Write-Host ('  [ok] ' + $Text) -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host ('  [!]  ' + $Text) -ForegroundColor Yellow }
function Write-Bad([string]$Text) { Write-Host ('  [X]  ' + $Text) -ForegroundColor Red }
function Write-Title([string]$Text) { Write-Host ''; Write-Host $Text -ForegroundColor Cyan }

# Acrescenta uma linha com data e hora ao arquivo de log (cria a pasta se preciso). Nunca derruba o script por causa do log.
function Write-ShowVaultLog {
    param([string]$Path, [string]$Message)
    try {
        $dir = Split-Path -Parent $Path
        if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Message
        Add-Content -LiteralPath $Path -Value $line -Encoding UTF8
    } catch {
        # log indisponível (disco cheio, arquivo preso): segue sem ele
    }
}

# Gira o log quando passa do tamanho: log -> log.1 -> log.2 -> log.3 (o mais velho some).
function Invoke-LogRotation {
    param([string]$Path, [long]$MaxBytes = 5242880, [int]$Keep = 3)
    try {
        if (-not (Test-Path -LiteralPath $Path)) { return }
        if ((Get-Item -LiteralPath $Path).Length -lt $MaxBytes) { return }
        for ($i = $Keep; $i -ge 1; $i--) {
            if ($i -eq 1) { $from = $Path } else { $from = $Path + '.' + ($i - 1) }
            $to = $Path + '.' + $i
            if (Test-Path -LiteralPath $from) { Move-Item -LiteralPath $from -Destination $to -Force }
        }
    } catch {
        # arquivo preso por outro programa: a rotação fica para a próxima vez
    }
}

# Caminho do node.exe: o informado, o do PATH ou os lugares comuns de instalação. $null se não achar.
function Get-NodeExe {
    param([string]$Preferred)
    if ($Preferred -and (Test-Path -LiteralPath $Preferred)) { return (Resolve-Path -LiteralPath $Preferred).Path }
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    $candidates = @()
    if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe') }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}

# Lê a configuração que o servidor usaria (porta, pasta de dados, problemas...) com o MESMO interpretador de .env do servidor.
# Devolve um objeto (ou $null se o Node falhar). Nunca traz segredos.
function Get-ShowVaultConfig {
    param([string]$Root, [string]$NodeExe, [string]$EnvFile)
    try {
        $script = Join-Path $Root 'scripts\show-config.js'
        $output = & $NodeExe $script '--env' $EnvFile 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return (($output | Out-String).Trim() | ConvertFrom-Json)
    } catch {
        return $null
    }
}

# GET /health; devolve o objeto da resposta ou $null.
function Get-ShowVaultHealth {
    param([string]$Url, [int]$TimeoutSec = 5)
    try {
        return (Invoke-RestMethod -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing)
    } catch {
        return $null
    }
}

# Quem está escutando numa porta (processo, PID, linha de comando). $null se ninguém.
function Get-PortListener {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $conn) { return $null }
    $proc = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $conn.OwningProcess) -ErrorAction SilentlyContinue
    $name = $null
    $commandLine = $null
    if ($proc) { $name = $proc.Name; $commandLine = $proc.CommandLine }
    return [pscustomobject]@{
        ProcessId    = $conn.OwningProcess
        LocalAddress = $conn.LocalAddress
        Name         = $name
        CommandLine  = $commandLine
    }
}

# Esse listener é o servidor do ShowVault (node ... server.js)?
function Test-IsShowVaultServer($Listener) {
    return ($Listener -and $Listener.CommandLine -and ($Listener.CommandLine -match 'server\.js'))
}

# Supervisores do ShowVault em execução (powershell rodando start-showvault.ps1), sem contar este próprio processo.
function Get-SupervisorProcess {
    $found = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction SilentlyContinue
    return @($found | Where-Object { $_.CommandLine -match 'start-showvault\.ps1' -and $_.ProcessId -ne $PID })
}

# Encerra o supervisor e o servidor do ShowVault (cada um com os processos filhos). Só mexe no que for do ShowVault:
# o supervisor pela linha de comando e o servidor pelo dono da porta, desde que seja "node ... server.js".
# Um corte brusco é seguro: o SQLite se recupera sozinho. Devolve quantos processos-raiz foram encerrados.
function Stop-ShowVault {
    param([int]$Port)
    $ErrorActionPreference = 'Continue'   # taskkill escreve em stderr quando falha; isso não deve virar exceção
    $stopped = 0
    foreach ($supervisor in (Get-SupervisorProcess)) {
        & taskkill.exe /PID $supervisor.ProcessId /T /F 2>&1 | Out-Null
        $stopped++
    }
    $listener = Get-PortListener -Port $Port
    if ($listener -and (Test-IsShowVaultServer $listener)) {
        & taskkill.exe /PID $listener.ProcessId /T /F 2>&1 | Out-Null
        $stopped++
    }
    return $stopped
}

# Duração em português: "3 h 12 min", "5 min", "40 s".
function Format-Duration([TimeSpan]$Span) {
    if ($Span.TotalDays -ge 1) { return ('{0} d {1} h' -f [int][Math]::Floor($Span.TotalDays), $Span.Hours) }
    if ($Span.TotalHours -ge 1) { return ('{0} h {1} min' -f [int][Math]::Floor($Span.TotalHours), $Span.Minutes) }
    if ($Span.TotalMinutes -ge 1) { return ('{0} min' -f [int][Math]::Floor($Span.TotalMinutes)) }
    return ('{0} s' -f [int][Math]::Floor($Span.TotalSeconds))
}

# Espera o /health responder (até $TimeoutSec). Devolve o objeto da resposta ou $null.
function Wait-ShowVaultHealth {
    param([string]$Url, [int]$TimeoutSec = 60)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $health = Get-ShowVaultHealth -Url $Url -TimeoutSec 2
        if ($health -and $health.status -eq 'ok') { return $health }
        Start-Sleep -Milliseconds 1000
    }
    return $null
}

# Caminho do tailscale.exe (somente leitura de estado; o script nunca muda nada no Tailscale). $null se não achar.
function Get-TailscaleExe {
    $cmd = Get-Command tailscale.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    if ($env:ProgramFiles) {
        $default = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
        if (Test-Path -LiteralPath $default) { return $default }
    }
    return $null
}
