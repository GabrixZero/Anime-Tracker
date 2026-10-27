#Requires -Version 5.1
<#
.SYNOPSIS
  Atualiza o ShowVault deste PC para a versão mais nova da branch main e religa o servidor.

.DESCRIPTION
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\update.ps1
  Passos (para tudo se um deles falhar, e diz como voltar):
    1. confere que a pasta está na branch main, sem alterações suas não salvas, e busca as novidades (git fetch);
    2. faz um backup do banco (npm run backup);
    3. para o ShowVault (tarefa + servidor);
    4. git pull --ff-only (só avança; nunca mistura nem apaga trabalho seu);
    5. instala as dependências (npm ci; se o OneDrive travar a pasta node_modules, tenta npm install);
    6. religa a tarefa e espera o /health responder.
  As migrações de dados (formato das bibliotecas, catálogo) rodam sozinhas quando o servidor liga.

.PARAMETER Branch    Branch a acompanhar (padrão main).
.PARAMETER DryRun    Só mostra o que seria feito (faz git fetch, que não muda nada no seu trabalho).
.PARAMETER NoRestart Atualiza mas não religa o servidor.
#>
[CmdletBinding()]
param(
    [string]$Branch = 'main',
    [switch]$DryRun,
    [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$root = Get-ShowVaultRoot
Set-Location -LiteralPath $root
Write-Title ('ShowVault: atualizar para a versão mais nova da ' + $Branch)
if ($DryRun) { Write-Warn 'Simulação (-DryRun): nada será alterado (só o git fetch roda).' }

# Roda um comando externo e devolve a saída em texto; falha o script se o código de saída não for 0.
function Invoke-Native {
    param([string]$File, [string[]]$Arguments, [switch]$AllowFailure)
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $text = (& $File @Arguments 2>&1 | ForEach-Object { $_.ToString() }) -join "`n"
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($code -ne 0 -and -not $AllowFailure) {
        throw ($File + ' ' + ($Arguments -join ' ') + ' falhou (código ' + $code + '):' + "`n" + $text)
    }
    return $text
}

$git = Get-Command git.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $git) { Write-Bad 'Não achei o Git (git.exe). Instale o Git para Windows e rode de novo.'; exit 2 }
$node = Get-NodeExe
if (-not $node) { Write-Bad 'Não achei o Node.js (node.exe).'; exit 2 }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $npm) { Write-Bad 'Não achei o npm (npm.cmd).'; exit 2 }

try {
    # --- 1. conferir o estado do git ---
    $current = (Invoke-Native $git.Source @('rev-parse', '--abbrev-ref', 'HEAD')).Trim()
    if ($current -ne $Branch) {
        Write-Bad ('A pasta está na branch "' + $current + '", não na "' + $Branch + '". O ShowVault em produção deve acompanhar a ' + $Branch + '.')
        Write-Info ('  Se não há trabalho seu pendente nesta pasta, rode: git checkout ' + $Branch + '   e depois este script de novo.')
        exit 3
    }
    $dirty = (Invoke-Native $git.Source @('status', '--porcelain', '--untracked-files=no')).Trim()
    if ($dirty) {
        Write-Bad 'Há alterações suas ainda não salvas (commit) nesta pasta; não vou atualizar por cima delas:'
        Write-Info $dirty
        exit 4
    }
    Invoke-Native $git.Source @('fetch', 'origin') | Out-Null
    $oldHash = (Invoke-Native $git.Source @('rev-parse', 'HEAD')).Trim()
    $newHash = (Invoke-Native $git.Source @('rev-parse', ('origin/' + $Branch))).Trim()
    if ($oldHash -eq $newHash) {
        Write-Ok ('Já está na versão mais nova (' + $oldHash.Substring(0, 7) + '). Nada a atualizar.')
        exit 0
    }
    Write-Info ('  Versão atual: ' + $oldHash.Substring(0, 7) + '  ->  nova: ' + $newHash.Substring(0, 7))
    Write-Info (Invoke-Native $git.Source @('log', '--oneline', '--no-decorate', '-n', '15', ($oldHash + '..' + $newHash)))
    $behind = (Invoke-Native $git.Source @('rev-list', '--count', ('HEAD..origin/' + $Branch))).Trim()
    $ahead = (Invoke-Native $git.Source @('rev-list', '--count', ('origin/' + $Branch + '..HEAD'))).Trim()
    if ($ahead -ne '0') {
        Write-Bad ('Esta pasta tem ' + $ahead + ' commit(s) que não estão na origin/' + $Branch + '; não dá para só avançar. Resolva com o git antes.')
        exit 5
    }
    Write-Ok ($behind + ' commit(s) novo(s) para trazer.')

    # --- configuração (para saber a porta) ---
    $envFile = Join-Path $root '.env'
    $config = $null
    if (Test-Path -LiteralPath $envFile) { $config = Get-ShowVaultConfig -Root $root -NodeExe $node -EnvFile $envFile }
    $port = 3000
    if ($config) { $port = [int]$config.port }

    if ($DryRun) {
        Write-Title 'Simulação: o que seria feito'
        Write-Info '  1. npm run backup (backup do banco antes de mexer)'
        Write-Info '  2. parar a tarefa ShowVault e o servidor'
        Write-Info ('  3. git pull --ff-only origin ' + $Branch)
        Write-Info '  4. npm ci (ou npm install, se o OneDrive travar)'
        Write-Info '  5. Start-ScheduledTask -TaskName ShowVault e esperar o /health'
        exit 0
    }

    # --- 2. backup ---
    $dbFile = $null
    if ($config) { $dbFile = Join-Path $config.dataDir 'showvault.sqlite' }
    if ($dbFile -and (Test-Path -LiteralPath $dbFile)) {
        Write-Info '  Fazendo o backup do banco antes de atualizar...'
        # Atenção ao montar a lista de argumentos: sem os parênteses, o "+" juntaria o texto com a lista inteira e viraria UM argumento só.
        Write-Info (Invoke-Native $node @(('--env-file=' + $envFile), (Join-Path $root 'scripts\backup.js')))
    } else {
        Write-Warn 'Não achei o banco; seguindo sem backup.'
    }

    # --- 3. parar ---
    Write-Info '  Parando o ShowVault...'
    Stop-ScheduledTask -TaskName $script:TaskNameApp -ErrorAction SilentlyContinue
    $null = Stop-ShowVault -Port $port
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-PortListener -Port $port) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 500 }
    if (Get-PortListener -Port $port) {
        Write-Bad ('A porta ' + $port + ' continua ocupada; não vou atualizar com o servidor ligado. Feche o que estiver nela e tente de novo.')
        exit 6
    }

    # --- 4. trazer o código ---
    Write-Info '  Trazendo a versão nova (git pull --ff-only)...'
    Invoke-Native $git.Source @('pull', '--ff-only', 'origin', $Branch) | Out-Null
    Write-Ok ('Código atualizado para ' + (Invoke-Native $git.Source @('rev-parse', '--short', 'HEAD')).Trim())

    # --- 5. dependências ---
    Write-Info '  Instalando as dependências (pode demorar um pouco na pasta do OneDrive)...'
    $install = Invoke-Native $npm.Source @('ci', '--no-audit', '--no-fund') -AllowFailure
    if ($LASTEXITCODE -ne 0) {
        Write-Warn 'npm ci falhou (o OneDrive costuma travar node_modules); tentando npm install...'
        Invoke-Native $npm.Source @('install', '--no-audit', '--no-fund') | Out-Null
    }
    Write-Ok 'Dependências instaladas.'
} catch {
    Write-Bad ('A atualização parou: ' + $_.Exception.Message)
    if ($oldHash) {
        Write-Info ('  Para voltar ao que funcionava: git reset --hard ' + $oldHash.Substring(0, 7) + '   (e depois: Start-ScheduledTask -TaskName ShowVault)')
    }
    exit 1
}

# --- 6. religar ---
if ($NoRestart) {
    Write-Warn 'Servidor NÃO religado (-NoRestart). Para ligar: Start-ScheduledTask -TaskName ShowVault'
    exit 0
}
if (-not (Get-ScheduledTask -TaskName $script:TaskNameApp -ErrorAction SilentlyContinue)) {
    Write-Warn 'A tarefa ShowVault não está registrada (rode install-autostart.ps1); ligue à mão com: powershell -File .\scripts\windows\start-showvault.ps1'
    exit 0
}
if (-not $config) {
    Write-Warn 'Sem configuração legível (.env); não liguei o servidor. Rode "npm run setup:pc" e depois: Start-ScheduledTask -TaskName ShowVault'
    exit 0
}
Start-ScheduledTask -TaskName $script:TaskNameApp
Write-Info '  Ligando o ShowVault (até 90 s; na primeira vez depois de atualizar pode haver migrações)...'
$health = Wait-ShowVaultHealth -Url $config.healthUrl -TimeoutSec 90
if ($health) {
    Write-Ok ('No ar: ' + $config.healthUrl + ' (armazenamento: ' + $health.storage + ')')
    Write-Title 'Atualização concluída.'
    exit 0
}
Write-Bad ('O servidor não respondeu em 90 s. Veja ' + (Get-DefaultLogDir) + '\supervisor.log e showvault.log')
Write-Info ('  Para voltar à versão anterior: git reset --hard ' + $oldHash.Substring(0, 7) + '   (e Start-ScheduledTask -TaskName ShowVault)')
exit 7
