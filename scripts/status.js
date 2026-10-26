#!/usr/bin/env node
// Quadro de status das seções (S01-S10) lido do GitHub (origin), para sessões paralelas.
//
//   npm run status            -> mostra o quadro
//   npm run status -- S03     -> diz se a S03 pode iniciar (exit 0 = pode, 2 = bloqueada, 3 = já em andamento/concluída)
//   Opções: --no-fetch (não consulta o GitHub; usa o que já está local)
//
// Regras:
//   concluída    = Documentacao/status/SNN.json em origin/main com "status": "concluida"
//   em andamento = existe a branch origin/feature/sNN-* (empurrada ao abrir a sessão)
//   pode iniciar = todas as dependências "hard" (Documentacao/status/grafo.json) estão concluídas
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const noFetch = args.includes('--no-fetch');
const target = (args.find(a => /^S\d{2}$/i.test(a)) || '').toUpperCase();

const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
const tryGit = (...a) => { try { return git(...a); } catch { return null; } };

if (!noFetch) {
  if (tryGit('fetch', '--prune', 'origin') === null) {
    console.warn('(aviso) não consegui consultar o GitHub; usando o que existe localmente.');
  }
}

const grafo = JSON.parse(fs.readFileSync(path.join(root, 'Documentacao/status/grafo.json'), 'utf-8'));
const ids = Object.keys(grafo.hard);

// Status em origin/main (fonte da verdade); se não houver origin/main, cai no arquivo local.
function lerStatus(id) {
  const rel = `Documentacao/status/${id}.json`;
  const remoto = tryGit('show', `origin/main:${rel}`);
  const texto = remoto !== null ? remoto : fs.readFileSync(path.join(root, rel), 'utf-8');
  return JSON.parse(texto);
}

const branches = (tryGit('branch', '-r', '--list', 'origin/feature/s*') || '')
  .split('\n').map(s => s.trim()).filter(Boolean);
const emAndamento = {};
for (const b of branches) {
  const m = /^origin\/feature\/s(\d{2})-/i.exec(b);
  if (m) emAndamento['S' + m[1]] = b.replace('origin/', '');
}

const info = {};
for (const id of ids) {
  const s = lerStatus(id);
  let estado = 'pendente';
  if (s.status === 'concluida') estado = 'concluida';
  else if (emAndamento[id]) estado = 'em andamento';
  info[id] = { ...s, estado, branchAtiva: emAndamento[id] || '' };
}

function bloqueios(id) {
  const faltam = (grafo.hard[id] || []).filter(d => info[d].estado !== 'concluida');
  const avisos = (grafo.soft[id] || []).filter(d => info[d].estado !== 'concluida');
  return { faltam, avisos };
}

function podeIniciar(id) {
  return info[id].estado === 'pendente' && bloqueios(id).faltam.length === 0;
}

const pad = (s, n) => String(s).padEnd(n);

if (!target) {
  console.log(`\n${pad('Seção', 6)}${pad('Título', 34)}${pad('Estado', 14)}Situação`);
  console.log('-'.repeat(86));
  for (const id of ids) {
    const i = info[id];
    const { faltam, avisos } = bloqueios(id);
    let sit = '';
    if (i.estado === 'concluida') sit = i.concluidaEm ? `concluída em ${i.concluidaEm}` : 'concluída';
    else if (i.estado === 'em andamento') sit = `branch ${i.branchAtiva}`;
    else if (faltam.length) sit = `AGUARDANDO ${faltam.join(', ')}`;
    else sit = 'pode iniciar' + (avisos.length ? ` (recomendado antes: ${avisos.join(', ')})` : '');
    console.log(`${pad(id, 6)}${pad(i.titulo, 34)}${pad(i.estado, 14)}${sit}`);
  }
  const livres = ids.filter(podeIniciar);
  console.log(`\nPodem iniciar agora: ${livres.length ? livres.join(', ') : 'nenhuma'}\n`);
  process.exit(0);
}

if (!info[target]) {
  console.error(`Seção desconhecida: ${target}`);
  process.exit(1);
}

const i = info[target];
const { faltam, avisos } = bloqueios(target);
if (i.estado === 'concluida') {
  console.log(`${target} já está CONCLUÍDA no main${i.commit ? ` (commit ${i.commit})` : ''}. Não inicie de novo sem o Gabriel pedir.`);
  process.exit(3);
}
if (i.estado === 'em andamento') {
  console.log(`${target} já está EM ANDAMENTO na branch ${i.branchAtiva}. Outra sessão a pegou; confirme com o Gabriel antes de continuar.`);
  process.exit(3);
}
if (faltam.length) {
  console.log(`${target} está BLOQUEADA: aguardando ${faltam.join(', ')} chegar(em) ao main.`);
  for (const d of faltam) console.log(`  - ${d} (${info[d].titulo}): ${info[d].estado}${info[d].branchAtiva ? ` · ${info[d].branchAtiva}` : ''}`);
  console.log('Avise o Gabriel e PARE. Quando as dependências estiverem concluídas ele te chama de novo.');
  process.exit(2);
}
console.log(`${target} PODE INICIAR (${i.titulo}).`);
if (avisos.length) console.log(`Atenção: é recomendado que ${avisos.join(', ')} esteja(m) concluída(s) antes; verifique conflitos de arquivo.`);
const paralelas = ids.filter(id => id !== target && info[id].estado === 'em andamento');
if (paralelas.length) console.log(`Em paralelo agora: ${paralelas.map(id => `${id} (${info[id].branchAtiva})`).join(', ')} — evite os mesmos arquivos e faça merge de origin/develop antes do push.`);
process.exit(0);
