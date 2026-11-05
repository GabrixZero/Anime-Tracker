// Mapa de ids de anime (AniList/MAL -> série do TMDB) — D-TE-2.
// Fonte: https://github.com/Fribb/anime-lists (anime-list-full.json, ~7,5 MB). O repositório NÃO tem licença: por isso o arquivo nunca
// vai para o Git. O app o BAIXA em tempo de execução (no máximo 1 vez por semana), reduz a só 3 números por obra
// (série do TMDB, temporada, deslocamento de episódio) e guarda o resultado na pasta de dados (`animeIdMap.runtime.json`, ignorada pelo Git).
// O download é tratado como DADO NÃO CONFIÁVEL: só HTTPS e só o host fixo, limite de tamanho, timeout, JSON.parse, validação de formato,
// gravação atômica e nada é executado. Se falhar, vale a última cópia; se nunca baixou, `ready` é false e ninguém é enriquecido.
const path = require('path');
const { readJson, writeJsonAtomic } = require('../storage');
const { requestJson } = require('../utils/httpJson');

const MAP_URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';
const ALLOWED_HOST = 'raw.githubusercontent.com';
const MAX_BYTES = 24 * 1024 * 1024; // o arquivo real tem ~7,5 MB
const DOWNLOAD_TIMEOUT_MS = 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000; // download que falhou só é tentado de novo depois de 1 h
const MIN_VALID_ENTRIES = 1000; // arquivo "válido" mas minúsculo é suspeito (corrompido/trocado): não substitui a cópia boa
const MAX_ID = 100_000_000;

const isId = n => Number.isSafeInteger(n) && n > 0 && n < MAX_ID;
const isSmall = n => Number.isSafeInteger(n) && n >= 0 && n < 100000;

// Uma entrada do arquivo externo -> [tmdbTvId, season|null, offset] ou null. Aceita só o formato conhecido (`themoviedb_id: {tv: N}`).
function reduceEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const tv = e.themoviedb_id && typeof e.themoviedb_id === 'object' ? e.themoviedb_id.tv : null;
  if (!isId(tv)) return null;
  const season = e.season && typeof e.season === 'object' && isSmall(e.season.tmdb) ? e.season.tmdb : null;
  const off = e.episode_offset && typeof e.episode_offset === 'object' ? e.episode_offset.tmdb : null;
  return [tv, season, isSmall(off) ? off : 0];
}

// JSON baixado -> {byAnilist, byMal} (objetos simples id -> [tmdb, season, offset]). Lança se o formato não for o esperado.
function reduceMap(json) {
  if (!Array.isArray(json)) throw new Error('formato inesperado');
  const byAnilist = {};
  const byMal = {};
  let valid = 0;
  for (const e of json) {
    const r = reduceEntry(e);
    if (!r) continue;
    let used = false;
    if (isId(e.anilist_id)) {
      byAnilist[e.anilist_id] = r;
      used = true;
    }
    if (isId(e.mal_id)) {
      byMal[e.mal_id] = r;
      used = true;
    }
    if (used) valid++;
  }
  if (valid < MIN_VALID_ENTRIES) throw new Error('poucas entradas válidas');
  return { byAnilist, byMal, count: valid };
}

class AnimeIdMap {
  constructor({ dataDir, download, now = Date.now, enabled = true, url = MAP_URL } = {}) {
    this.file = dataDir ? path.join(dataDir, 'animeIdMap.runtime.json') : null;
    this.url = url;
    this.now = now;
    this.enabled = enabled;
    this.download = download || (u => requestJson(u, { timeoutMs: DOWNLOAD_TIMEOUT_MS, maxBytes: MAX_BYTES }));
    this.byAnilist = null;
    this.byMal = null;
    this.fetchedAt = 0;
    this.lastFailureAt = 0;
    this.pending = null;
    this.loadFromDisk();
  }

  // Cópia local (se existir e tiver o formato esperado). Nunca lança.
  loadFromDisk() {
    if (!this.file) return;
    try {
      const res = readJson(this.file);
      const d = res && res.data;
      if (d && typeof d === 'object' && d.byAnilist && d.byMal && Number.isFinite(Date.parse(d.fetchedAt))) {
        this.byAnilist = d.byAnilist;
        this.byMal = d.byMal;
        this.fetchedAt = Date.parse(d.fetchedAt);
      }
    } catch {
      /* cópia ilegível: tratada como inexistente */
    }
  }

  get ready() {
    return Boolean(this.enabled && this.byAnilist && this.byMal);
  }

  get stale() {
    return !this.ready || this.now() - this.fetchedAt >= WEEK_MS;
  }

  // Garante o mapa: baixa se não há cópia ou se ela tem mais de 1 semana (e a última falha foi há mais de 1 h). Nunca lança.
  // Devolve `ready`. Pedidos simultâneos viram um só download.
  async ensure() {
    if (!this.enabled) return false;
    if (!this.stale || this.now() - this.lastFailureAt < RETRY_AFTER_FAILURE_MS) return this.ready;
    if (!this.pending) this.pending = this.refresh().finally(() => (this.pending = null));
    await this.pending;
    return this.ready;
  }

  async refresh() {
    try {
      if (new URL(this.url).protocol !== 'https:' || new URL(this.url).hostname !== ALLOWED_HOST) throw new Error('endereço não permitido');
      const reduced = reduceMap(await this.download(this.url));
      const fetchedAt = new Date(this.now()).toISOString();
      if (this.file) writeJsonAtomic(this.file, { fetchedAt, byAnilist: reduced.byAnilist, byMal: reduced.byMal });
      this.byAnilist = reduced.byAnilist;
      this.byMal = reduced.byMal;
      this.fetchedAt = this.now();
      this.lastFailureAt = 0;
    } catch (err) {
      this.lastFailureAt = this.now();
      console.warn(`[AnimeIdMap] Não foi possível atualizar o mapa de ids (${(err && err.code) || (err && err.message) || 'erro'}); usando a última cópia, se houver.`);
    }
  }

  // {tmdbId, season (número do TMDB ou null), offset} ou null. Procura pelo id da AniList e, na falta, pelo da MAL.
  lookup({ anilistId, malId } = {}) {
    if (!this.ready) return null;
    const own = Object.prototype.hasOwnProperty;
    let r = null;
    if (anilistId !== undefined && own.call(this.byAnilist, anilistId)) r = this.byAnilist[anilistId];
    else if (malId !== undefined && own.call(this.byMal, malId)) r = this.byMal[malId];
    if (!Array.isArray(r) || !isId(r[0])) return null;
    return { tmdbId: r[0], season: isSmall(r[1]) ? r[1] : null, offset: isSmall(r[2]) ? r[2] : 0 };
  }
}

module.exports = AnimeIdMap;
module.exports.reduceMap = reduceMap;
module.exports.MAP_URL = MAP_URL;
