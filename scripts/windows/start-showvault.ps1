#Requires -Version 5.1
<#
.SYNOPSIS
  Liga o ShowVault (modo PC, S11): servidor escondido, com log e reinício automático se ele cair.

.DESCRIPTION
  É o que o Agendador do Windows executa ao entrar no Windows (veja install-autostart.ps1). Você também pode rodar à mão:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\start-showvault.ps1

  O que faz:
    - lê o .env da pasta do projeto (npm run setup:pc cria) e confere a configuração;
    - se o ShowVault já está rodando na porta, não faz nada (não abre um segundo);
    - roda "node server.js" sem janela, com a saída gravada em %LOCALAPPDATA%\ShowVault\logs\showvault.log;
    - se o servidor cair, espera um pouco e liga de novo; se cair 5 vezes seguidas em menos de 1 minuto, desiste
      (o Agendador tenta de novo; o motivo fica em supervisor.log e showvault.log).
  Para parar: Stop-ScheduledTask -TaskName ShowVault   (ou feche a janela, se você rodou à mão).

.PARAMETER EnvFile  .env a usar (padrão: o da pasta do projeto).
.PARAMETER LogDir   Pasta dos logs (padrão: %LOCALAPPDATA%\ShowVault\logs).
.PARAMETER NodePath node.exe a usar (padrão: o do PATH).
.PARAMETER NoRestart Roda o servidor uma vez e sai quando ele terminar (para testes).
#>
[CmdletBinding()]
param(
    [string]$EnvFile,
    [string]$LogDir,
    [string]$NodePath,
    [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-ShowVaultRoot
if (-not $EnvFile) { $EnvFile = Join-Path $root '.env' }
if (-not $LogDir) { $LogDir = Get-DefaultLogDir }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$supervisorLog = Join-Path $LogDir 'supervisor.log'
$serverLog = Join-Path $LogDir 'showvault.log'

function Log([string]$Message) {
    Write-ShowVaultLog -Path $supervisorLog -Message $Message
    Write-Host $Message
}

# Uma instância só: se o supervisor já está rodando (outra janela, outro logon), esta sai sem fazer nada.
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\ShowVault-Supervisor', [ref]$createdNew)
if (-not $createdNew) {
    Log 'Já existe um supervisor do ShowVault rodando; esta execução não faz nada.'
    exit 0
}

$node = Get-NodeExe -Preferred $NodePath
if (-not $node) {
    Log 'ERRO: não achei o Node.js (node.exe). Instale o Node 26 ou mais novo em https://nodejs.org e tente de novo.'
    exit 2
}
if (-not (Test-Path -LiteralPath $EnvFile)) {
    Log ('ERRO: não achei o arquivo de configuração ' + $EnvFile + '. Rode "npm run setup:pc" na pasta do projeto.')
    exit 3
}
$config = Get-ShowVaultConfig -Root $root -NodeExe $node -EnvFile $EnvFile
if (-not $config) {
    Log 'ERRO: não consegui ler a configuração (o Node falhou). Rode "node scripts\show-config.js" para ver o motivo.'
    exit 4
}
if (@($config.problems).Count -gt 0) {
    foreach ($problem in @($config.problems)) { Log ('CONFIGURAÇÃO: ' + $problem) }
    Log 'Corrija o .env (ou rode "npm run setup:pc") e tente de novo.'
    exit 5
}

# Já tem alguém na porta? Se é o ShowVault, está tudo certo; se é outro programa, não dá para ligar.
$listener = Get-PortListener -Port ([int]$config.port)
if ($listener) {
    if (Test-IsShowVaultServer $listener) {
        Log ('O ShowVault já está rodando na porta ' + $config.port + ' (PID ' + $listener.ProcessId + '); nada a fazer.')
        exit 0
    }
    Log ('ERRO: a porta ' + $config.port + ' está ocupada por outro programa (' + $listener.Name + ', PID ' + $listener.ProcessId + '). Troque PORT no .env.')
    exit 6
}

Log ('Supervisor iniciado. Node: ' + $node + '. Pasta: ' + $root + '. Porta: ' + $config.port + '. Logs: ' + $LogDir)

$quickFailures = 0
while ($true) {
    Invoke-LogRotation -Path $serverLog
    $started = Get-Date
    # cmd /c é só para juntar a saída normal e a de erro num arquivo só; as aspas externas saem por causa do /s.
    $commandLine = '"{0}" "--env-file={1}" server.js >> "{2}" 2>&1' -f $node, $EnvFile, $serverLog
    $process = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/s', '/c', ('"' + $commandLine + '"')) `
        -WorkingDirectory $root -WindowStyle Hidden -PassThru
    $null = $process.Handle   # mantém o processo "aberto" para o ExitCode ficar disponível no fim
    Log ('Servidor iniciado (PID do cmd ' + $process.Id + ').')

    $announced = $false
    while (-not $process.WaitForExit(2000)) {
        if (-not $announced) {
            $health = Get-ShowVaultHealth -Url $config.healthUrl -TimeoutSec 2
            if ($health -and $health.status -eq 'ok') {
                $announced = $true
                Log ('No ar: ' + $config.healthUrl + ' (armazenamento: ' + $health.storage + ').')
            }
        }
    }

    $exitCode = $process.ExitCode
    if ($null -eq $exitCode) { $exitCode = 1 }
    $seconds = [int]((Get-Date) - $started).TotalSeconds
    Log ('O servidor terminou com código ' + $exitCode + ' depois de ' + $seconds + ' s.')

    # Código 0 = parada pedida de propósito (Ctrl+C/SIGINT no servidor); com -NoRestart também não religa.
    if ($NoRestart -or $exitCode -eq 0) { exit $exitCode }

    if ($seconds -lt 60) { $quickFailures++ } else { $quickFailures = 0 }
    if ($quickFailures -ge 5) {
        Log ('ERRO: o servidor caiu ' + $quickFailures + ' vezes seguidas em menos de 1 minuto. Desisto por agora; veja ' + $serverLog + '.')
        exit 1
    }
    $wait = [int][Math]::Min(60, 5 * [Math]::Pow(2, $quickFailures))
    Log ('Ligando de novo em ' + $wait + ' s...')
    Start-Sleep -Seconds $wait
}
