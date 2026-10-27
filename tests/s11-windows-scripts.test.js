// S11: os scripts do PowerShell (scripts/windows) e o guia. Os .ps1 são escritos para o Windows PowerShell 5.1; aqui conferimos o que dá para
// conferir em qualquer máquina: sintaxe (quando há PowerShell), codificação, promessas de segurança (não mexem em configurações do
// sistema nem no Tailscale, só leem) e que o guia só cita comandos e arquivos que existem.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const DIR = path.join(REPO, 'scripts', 'windows');
const scripts = fs.readdirSync(DIR).filter(name => name.endsWith('.ps1'));
const read = name => fs.readFileSync(path.join(DIR, name), 'utf8');

// Tira comentários (linhas com # e blocos <# ... #>) para procurar só o que o script EXECUTA.
const code = name =>
  read(name)
    .replace(/<#[\s\S]*?#>/g, '')
    .split(/\r?\n/)
    .filter(line => !/^\s*#/.test(line))
    .join('\n');

test('existem os scripts prometidos pelo guia e pela seção S11', () => {
  for (const name of [
    'install-autostart.ps1',
    'uninstall-autostart.ps1',
    'start-showvault.ps1',
    'status.ps1',
    'update.ps1',
    'stop-showvault.ps1',
    'backup-showvault.ps1',
    '_common.ps1'
  ]) {
    assert.ok(scripts.includes(name), `${name} deveria existir em scripts/windows`);
  }
});

test('os .ps1 são UTF-8 com BOM (o Windows PowerShell 5.1 lê sem BOM como ANSI e estraga os acentos)', () => {
  for (const name of scripts) {
    const bytes = fs.readFileSync(path.join(DIR, name));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name} sem BOM`);
    assert.equal(bytes.toString('utf8').includes('�'), false, `${name} não é UTF-8 válido`);
  }
});

function findPowerShell() {
  for (const exe of process.platform === 'win32' ? ['powershell.exe', 'pwsh'] : ['pwsh']) {
    const probe = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { encoding: 'utf8', timeout: 20000 });
    if (!probe.error && probe.status === 0) return exe;
  }
  return null;
}

test(
  'análise de sintaxe do PowerShell: nenhum .ps1 tem erro',
  { skip: findPowerShell() ? false : 'PowerShell não encontrado nesta máquina' },
  () => {
    const exe = findPowerShell();
    const dir = DIR.replace(/'/g, "''");
    const command =
      `$bad = 0; Get-ChildItem -LiteralPath '${dir}' -Filter '*.ps1' | ForEach-Object { ` +
      '$t = $null; $e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$t, [ref]$e); ' +
      "if ($e.Count -gt 0) { $bad++; $e | ForEach-Object { Write-Output ($_.Extent.File + ':' + $_.Extent.StartLineNumber + ' ' + $_.Message) } } }; exit $bad";
    const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, `erros de sintaxe:\n${r.stdout}${r.stderr}`);
  }
);

test('os scripts NÃO mudam configurações do sistema (energia, firewall, políticas, serviços, registro)', () => {
  const forbidden = [
    /\bpowercfg\b/i,
    /\bnetsh\b/i,
    /\bNew-NetFirewallRule\b|\bSet-NetFirewall\w*\b|\bEnable-NetFirewallRule\b/i,
    /\bSet-ExecutionPolicy\b/i,
    /\bEnable-PSRemoting\b|\bEnable-WSManCredSSP\b/i,
    /\bbcdedit\b/i,
    /\breg(\.exe)?\s+(add|delete|import)\b/i,
    /\bSet-Service\b|\bNew-Service\b|\bsc(\.exe)?\s+(config|create)\b/i,
    /\bSet-ItemProperty\b[^\n]*\bHK(LM|CU)\b|\bNew-ItemProperty\b[^\n]*\bHK(LM|CU)\b/i,
    /\bschtasks(\.exe)?\b/i,
    /\bwinget\b|\bchoco(latey)?\b|\bmsiexec\b|\bInstall-Package\b|\bInstall-Module\b/i,
    /\bStart-Process\b[^\n]*-Verb\s+RunAs\b/i
  ];
  for (const name of scripts) {
    const text = code(name);
    for (const pattern of forbidden) assert.doesNotMatch(text, pattern, `${name} usa ${pattern}`);
  }
});

test('só o install registra tarefas e só o uninstall as remove; o Tailscale é só consultado', () => {
  for (const name of scripts) {
    const text = code(name);
    if (name !== 'install-autostart.ps1') assert.doesNotMatch(text, /\bRegister-ScheduledTask\b/, `${name} não deve registrar tarefas`);
    if (name !== 'uninstall-autostart.ps1') assert.doesNotMatch(text, /\bUnregister-ScheduledTask\b/, `${name} não deve remover tarefas`);
    // toda chamada ao tailscale.exe precisa ser "funnel status" (somente leitura): nada de funnel/serve/up/down/logout/set
    for (const line of text.split('\n').filter(l => /&\s*\$tailscale\b/.test(l))) {
      assert.match(line, /&\s*\$tailscale\s+funnel\s+status\b/, `${name}: o script só pode consultar o Tailscale: ${line.trim()}`);
    }
  }
});

test('install, uninstall e update têm simulação (-DryRun); nenhum script tem segredo escrito', () => {
  for (const name of ['install-autostart.ps1', 'uninstall-autostart.ps1', 'update.ps1']) {
    assert.match(code(name), /\[switch\]\$DryRun/, `${name} sem -DryRun`);
  }
  for (const name of scripts) {
    assert.doesNotMatch(read(name), /JWT_SECRET\s*=\s*\S|password\s*=\s*['"]\S/i, `${name} parece conter um segredo`);
  }
});

test('o guia só cita arquivos e comandos npm que existem', () => {
  const guide = fs.readFileSync(path.join(REPO, 'Documentacao', 'deploy-pc-tailscale.md'), 'utf8');
  for (const [, rel] of guide.matchAll(/scripts[\\/]windows[\\/]([\w.-]+\.ps1)/g)) {
    assert.ok(scripts.includes(rel), `o guia cita scripts\\windows\\${rel}, que não existe`);
  }
  const npmScripts = Object.keys(JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).scripts);
  for (const [, name] of guide.matchAll(/npm run ([\w:-]+)/g)) {
    assert.ok(npmScripts.includes(name), `o guia cita "npm run ${name}", que não existe no package.json`);
  }
  assert.doesNotMatch(guide, /JWT_SECRET=[0-9a-f]{16,}/i, 'o guia não pode trazer segredo');
});
