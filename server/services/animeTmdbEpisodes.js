// Títulos e miniaturas dos episódios de anime vindos do TMDB (D-TE-n). Funções puras: sem rede, sem disco.
//
// A AniList numera por ENTRADA da franquia (cada temporada/cour é uma obra); o TMDB junta várias entradas numa série só. Este módulo
// descobre qual episódio do TMDB corresponde a cada episódio da AniList e SÓ aceita o resultado se as datas de estreia confirmarem
// (trava de datas: >= 80% das datas comparáveis batem, com tolerância de 1 dia). Se não confirmar, NADA é aplicado e o episódio
// continua "Episódio N" (nunca arriscamos título trocado). Nada aqui muda `episode_number` nem `season_number`: só `name` e `still_path`.
const { stripHtml, safeHttpUrl } = require('../utils/sanitize');

const GENERIC_NAME = /^(episode|episódio|episodio|épisode|folge|capítulo)\s*#?\d+$/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MATCH_RATIO = 0.8;
const MIN_COMPARABLE = 3;
const TMDB_IMG = /^https:\/\/image\.tmdb\.org\/t\/p\/[\w-]+\/[\w./-]+$/;

// Título "de verdade": não vazio e que não seja só "Episode 5"/"Episódio 5".
function realTitle(name) {
  const t = stripHtml(name, 300);
  return t && !GENERIC_NAME.test(t) ? t : '';
}

const isDate = s => /^\d{4}-\d{2}-\d{2}/.test(String(s || ''));
function closeDates(a, b) {
  if (!isDate(a) || !isDate(b)) return null; // não comparável
  const diff = Math.abs(Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`));
  return diff <= DAY_MS;
}

// Só miniatura servida pelo próprio TMDB (D-TE-6): a URL é guardada, a imagem nunca é copiada.
function safeStill(url) {
  const u = safeHttpUrl(url, null);
  return u && TMDB_IMG.test(u) ? u : null;
}

// Trava de datas. `pairs` = [{ani: {episode_number, air_date}, tmdb: {air_date,...}|null}].
// Aceita se há datas comparáveis suficientes (3, ou todas as que a AniList tem se forem menos) e >= 80% batem. Com menos de 3 datas
// comparáveis (verificação fraca) exige ainda que TODOS os episódios tenham par no TMDB.
function passesDateLock(pairs) {
  const aniWithDate = pairs.filter(p => isDate(p.ani.air_date)).length;
  if (aniWithDate === 0) return false; // nada para conferir: não arrisca
  let comparable = 0;
  let matched = 0;
  for (const p of pairs) {
    if (!p.tmdb) continue;
    const c = closeDates(p.ani.air_date, p.tmdb.air_date);
    if (c === null) continue;
    comparable++;
    if (c) matched++;
  }
  if (comparable < Math.min(MIN_COMPARABLE, aniWithDate) || comparable === 0) return false;
  if (matched / comparable < MIN_MATCH_RATIO) return false;
  if (comparable < MIN_COMPARABLE && pairs.some(p => !p.tmdb)) return false;
  return true;
}

// Candidatos de tradução (do mais confiável ao menos), cada um devolve os episódios do TMDB de que precisa e uma função n -> episódio.
//  A) temporada indicada pelo mapa (+ deslocamento): episódio n da AniList = episódio n+offset dessa temporada;
//  B) lista plana do TMDB (temporadas 1..N em ordem) a partir do total das entradas irmãs anteriores (ex.: Jujutsu T2 = 25-47).
function candidatesFor({ info, tv, start }) {
  const seasons = (tv.seasons || []).filter(s => s && Number.isInteger(s.season_number) && s.season_number > 0 && s.episode_count > 0);
  const out = [];
  if (info.season !== null && seasons.some(s => s.season_number === info.season)) {
    out.push({
      mode: 'season',
      seasonsNeeded: () => [info.season],
      pick: (loaded, n) => (loaded.get(info.season) || []).find(e => e.episode_number === n + info.offset) || null
    });
  }
  // B) posição plana: o episódio n da entrada fica na posição start + n - 1 (base 0) da lista plana
  const flatIndex = [];
  for (const s of seasons.slice().sort((a, b) => a.season_number - b.season_number))
    for (let i = 0; i < s.episode_count; i++) flatIndex.push({ season: s.season_number, pos: i });
  out.push({
    mode: 'flat',
    seasonsNeeded: count => {
      const set = new Set();
      for (let n = 1; n <= count; n++) if (flatIndex[start + n - 1]) set.add(flatIndex[start + n - 1].season);
      return [...set];
    },
    pick: (loaded, n) => {
      const at = flatIndex[start + n - 1];
      if (!at) return null;
      const list = loaded.get(at.season);
      return (list && list[at.pos]) || null; // lista da temporada já ordenada por número de episódio
    }
  });
  return out;
}

// Alinha UMA entrada da AniList com a série do TMDB.
//  entry    = { episodes: [{episode_number, air_date}] }           (episódios da AniList, numeração intocada)
//  info     = { tmdbId, season|null, offset }                        (linha do mapa de ids)
//  tv       = { seasons: [{season_number, episode_count}] }          (detalhes da série no TMDB)
//  start    = soma dos episódios das entradas irmãs anteriores (mesma série do TMDB)
//  loadSeason(n) => Promise<[{episode_number, name, air_date, still_path}]>  (episódios da temporada, ordenados; já com pt-BR -> en-US)
//  recentSeasons = se > 0, só baixa as N últimas temporadas do TMDB necessárias (atualização de obra em exibição)
// Devolve { mode, list: [{episode_number, name, still_path}] } ou null (sem alinhamento confiável).
async function alignEntry({ entry, info, tv, start = 0, loadSeason, recentSeasons = 0 }) {
  const ani = entry.episodes;
  if (!ani.length) return null;
  for (const cand of candidatesFor({ info, tv, start })) {
    let needed = cand.seasonsNeeded(ani.length).sort((a, b) => a - b);
    if (!needed.length) continue;
    if (recentSeasons > 0) needed = needed.slice(-recentSeasons);
    const loaded = new Map();
    for (const n of needed) loaded.set(n, await loadSeason(n));
    const pairs = ani.map(a => ({ ani: a, tmdb: cand.pick(loaded, a.episode_number) }));
    // atualização parcial: confere só os episódios cuja temporada foi baixada
    const checked = recentSeasons > 0 ? pairs.filter(p => p.tmdb) : pairs;
    if (!passesDateLock(checked)) continue;
    const list = [];
    for (const p of pairs) {
      if (!p.tmdb) continue;
      const name = realTitle(p.tmdb.name);
      const still = safeStill(p.tmdb.still_path);
      if (name || still) list.push({ episode_number: p.ani.episode_number, name, still_path: still });
    }
    return { mode: cand.mode, list };
  }
  return null;
}

// Aplica a lista alinhada aos episódios da entrada: só troca o nome que ainda é "Episódio N" (por título não vazio) e só preenche
// miniatura vazia. Nunca cria nem remove episódios e nunca grava título vazio.
function applyTmdbEpisodes(episodes, list) {
  if (!Array.isArray(list) || list.length === 0) return episodes;
  const byNumber = new Map(list.map(e => [e.episode_number, e]));
  return episodes.map(ep => {
    const extra = byNumber.get(ep.episode_number);
    if (!extra) return ep;
    const needName = extra.name && ep.name === `Episódio ${ep.episode_number}`;
    const needStill = extra.still_path && !ep.still_path;
    return needName || needStill
      ? { ...ep, name: needName ? extra.name : ep.name, still_path: needStill ? extra.still_path : ep.still_path }
      : ep;
  });
}

module.exports = { alignEntry, applyTmdbEpisodes, passesDateLock, realTitle, GENERIC_NAME };
