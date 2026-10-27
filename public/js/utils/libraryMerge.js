// ================================================================
// SHOWVAULT · MERGE DA BIBLIOTECA (funções puras)
// Roda no navegador (syncService/state) e no servidor (LibraryModel). Mesmo código nos dois lados.
//
// Modelo (D-13, tombstones): remover algo não apaga só o item: grava-se também uma MARCA DE EXCLUSÃO com a data
//   tombstones = { shows: {"<showId>": iso}, watched: {"<chave do episódio>": iso}, notes: {"<chave>": iso} }
// O merge olha, para cada item, o evento mais recente entre "o item existe" (updatedAt/watchedAt) e "o item foi removido"
// (deletedAt): o mais novo vence, e em empate o item fica (nunca perder dado por empate).
//
// `resetAt` = "zerar a conta" (Resetar + apagar a nuvem): tudo cujo evento seja anterior a essa data é descartado.
//
// Nada aqui mexe nos objetos recebidos nem lê relógio/rede: a hora atual entra por `opts.now`.
// ================================================================

(function (root) {
  const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000; // marcas mais velhas que isso são descartadas (aparelho offline por mais tempo pode ressuscitar itens)
  const MAX_SKEW_MS = 5 * 60 * 1000;                  // relógio de aparelho adiantado não "vence para sempre": datas futuras são limitadas a agora + 5 min

  const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const toMs = iso => {
    const n = typeof iso === 'string' ? Date.parse(iso) : NaN;
    return Number.isFinite(n) ? n : 0;
  };
  const laterIso = (a, b) => (toMs(b) > toMs(a) ? b : a);

  function emptyTombstones() {
    return { shows: {}, watched: {}, notes: {} };
  }

  function emptyData() {
    return { trackedShows: [], watchedEpisodes: {}, episodeNotes: {}, tombstones: emptyTombstones(), resetAt: '' };
  }

  // Garante todos os campos (bibliotecas antigas não têm tombstones/resetAt). Não copia os itens.
  function normalizeData(data) {
    const d = isPlainObject(data) ? data : {};
    const t = isPlainObject(d.tombstones) ? d.tombstones : {};
    return {
      trackedShows: Array.isArray(d.trackedShows) ? d.trackedShows : [],
      watchedEpisodes: isPlainObject(d.watchedEpisodes) ? d.watchedEpisodes : {},
      episodeNotes: isPlainObject(d.episodeNotes) ? d.episodeNotes : {},
      tombstones: {
        shows: isPlainObject(t.shows) ? t.shows : {},
        watched: isPlainObject(t.watched) ? t.watched : {},
        notes: isPlainObject(t.notes) ? t.notes : {}
      },
      resetAt: typeof d.resetAt === 'string' ? d.resetAt : ''
    };
  }

  // ----- validação das marcas de exclusão (compartilhada por LibraryModel.validate e validateBackup) -----
  const SHOW_KEY_RE = /^\d+$/;
  const EPISODE_KEY_RE = /^\d+_(movie|s\d+_e\d+)$/;
  const MAX_TOMBSTONES = 50000;

  // Data válida (string que o Date entende) cortada em 40 caracteres, ou ''.
  function cleanStamp(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value.slice(0, 40) : '';
  }

  // Devolve { shows, watched, notes } saneado. `fail()` deve lançar o erro com a mensagem do chamador.
  // Ausente (biblioteca/backup antigo) = vazio.
  function cleanTombstones(raw, fail) {
    const out = emptyTombstones();
    if (raw === undefined || raw === null) return out;
    if (!isPlainObject(raw)) fail();
    const rules = { shows: SHOW_KEY_RE, watched: EPISODE_KEY_RE, notes: EPISODE_KEY_RE };
    for (const kind of Object.keys(rules)) {
      const src = raw[kind];
      if (src === undefined || src === null) continue;
      if (!isPlainObject(src) || Object.keys(src).length > MAX_TOMBSTONES) fail();
      for (const [key, value] of Object.entries(src)) {
        const at = cleanStamp(value);
        if (!rules[kind].test(key) || !at) fail();
        out[kind][key] = at;
      }
    }
    return out;
  }

  // Há alguma obra, episódio ou nota (marcas de exclusão não contam como conteúdo)?
  function hasContent(data) {
    const d = normalizeData(data);
    return d.trackedShows.length > 0 || Object.keys(d.watchedEpisodes).length > 0 || Object.keys(d.episodeNotes).length > 0;
  }

  // ----- horário de cada tipo de item (string ISO; antigo sem updatedAt cai em addedAt/watchedAt) -----
  const showStamp = s => (s && (s.updatedAt || s.addedAt)) || '';
  const watchedStamp = w => (w && (w.updatedAt || w.watchedAt)) || '';
  const noteStamp = n => (n && n.updatedAt) || '';

  function earliestIso(a, b) {
    if (!a) return b || '';
    if (!b) return a;
    return toMs(b) > 0 && toMs(b) < toMs(a) ? b : a;
  }

  // `a` é o item vencedor (mais novo); `b` o outro. Devolvem sempre um objeto novo.
  const combineShow = (a, b) => {
    const out = { ...a };
    const added = earliestIso(a.addedAt, b.addedAt);
    if (added) out.addedAt = added;
    return out;
  };
  const combineWatched = (a, b) => ({ ...a, rewatchCount: Math.max(a.rewatchCount || 1, b.rewatchCount || 1) });
  const combineNote = a => ({ ...a });

  // Reescreve o horário de um item (usado para "aparar" datas no futuro).
  const restampItem = (item, iso) => ({ ...item, updatedAt: iso });

  // Une uma seção (obras, episódios ou notas). `stamp` devolve o horário (ISO) de um item vivo.
  function mergeSection(ctx, lLive, rLive, lTomb, rTomb, stamp, combine) {
    const live = new Map(); // Map preserva a ordem (objetos reordenariam ids numéricos)
    const tombs = {};
    const asMap = m => (m instanceof Map ? m : new Map(Object.entries(m)));
    const lMap = asMap(lLive);
    const rMap = asMap(rLive);
    const keys = new Set([...rMap.keys(), ...lMap.keys(), ...Object.keys(rTomb), ...Object.keys(lTomb)]);

    for (const key of keys) {
      const l = lMap.get(key);
      const r = rMap.get(key);
      // item vivo mais novo (empate: o primeiro argumento, local, fica); o horário é medido ANTES de combinar os campos
      const raw = l && r ? (ctx.t(stamp(r)) > ctx.t(stamp(l)) ? r : l) : (l || r || null);
      let winner = raw ? combine(raw, (raw === l ? r : l) || raw) : null;

      // Relógio adiantado: um horário depois de "agora + 5 min" é regravado como esse limite (fica fixo no dado salvo),
      // assim edições reais feitas depois voltam a vencer em vez de perder para sempre.
      if (winner && toMs(stamp(raw)) > ctx.cap) winner = restampItem(winner, ctx.capIso);
      let tombIso = laterIso(lTomb[key] || '', rTomb[key] || '');
      if (toMs(tombIso) > ctx.cap) tombIso = ctx.capIso;
      const tombMs = toMs(tombIso);
      const liveMs = raw ? ctx.t(stamp(raw)) : 0;

      if (winner && ctx.resetMs > 0 && liveMs <= ctx.resetMs) winner = null; // zerado pela conta

      if (winner && liveMs >= tombMs) {
        live.set(key, winner);
      } else if (tombMs > 0 && tombMs > ctx.resetMs && tombMs >= ctx.pruneBefore) {
        tombs[key] = tombIso;
      }
    }
    return { live, tombs };
  }

  // merge(local, remote, {now}) -> biblioteca unida. Comutativo, exceto nos empates exatos (aí vale o `local`).
  function merge(local, remote, opts = {}) {
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const L = normalizeData(local);
    const R = normalizeData(remote);
    const cap = now + MAX_SKEW_MS;
    const resetAt = laterIso(L.resetAt, R.resetAt);
    const ctx = {
      cap,
      capIso: new Date(cap).toISOString(),
      t: iso => Math.min(toMs(iso), cap),
      resetMs: toMs(resetAt),
      pruneBefore: now - TOMBSTONE_TTL_MS
    };

    const showsMap = arr => {
      const m = new Map();
      for (const s of arr) if (s && Number.isInteger(s.showId)) m.set(String(s.showId), s);
      return m;
    };

    const shows = mergeSection(ctx, showsMap(L.trackedShows), showsMap(R.trackedShows), L.tombstones.shows, R.tombstones.shows, showStamp, combineShow);
    const watched = mergeSection(ctx, L.watchedEpisodes, R.watchedEpisodes, L.tombstones.watched, R.tombstones.watched, watchedStamp, combineWatched);
    const notes = mergeSection(ctx, L.episodeNotes, R.episodeNotes, L.tombstones.notes, R.tombstones.notes, noteStamp, combineNote);

    return {
      trackedShows: [...shows.live.values()],
      watchedEpisodes: Object.fromEntries(watched.live),
      episodeNotes: Object.fromEntries(notes.live),
      tombstones: { shows: shows.tombs, watched: watched.tombs, notes: notes.tombs },
      resetAt: ctx.resetMs > 0 ? resetAt : ''
    };
  }

  // Importar backup = o conteúdo do arquivo vira o estado deste aparelho. Para isso valer também nos outros aparelhos:
  //  - o que existia e não está no arquivo ganha marca de exclusão;
  //  - obras e episódios do arquivo ganham updatedAt = agora (vencem marcas antigas).
  function replaceWith(current, imported, opts = {}) {
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const stamp = new Date(now).toISOString();
    const C = normalizeData(current);
    const I = normalizeData(imported);

    const trackedShows = I.trackedShows.map(s => ({ ...s, updatedAt: stamp }));
    const watchedEpisodes = {};
    for (const [k, w] of Object.entries(I.watchedEpisodes)) watchedEpisodes[k] = { ...w, updatedAt: stamp };
    const episodeNotes = { ...I.episodeNotes };

    const deleteMark = (liveItem, stampFn) => new Date(Math.max(now, toMs(stampFn(liveItem)) + 1)).toISOString();
    const tombstones = emptyTombstones();
    const sections = [
      ['shows', Object.fromEntries(C.trackedShows.map(s => [String(s.showId), s])), Object.fromEntries(trackedShows.map(s => [String(s.showId), s])), showStamp],
      ['watched', C.watchedEpisodes, watchedEpisodes, watchedStamp],
      ['notes', C.episodeNotes, episodeNotes, noteStamp]
    ];
    for (const [name, before, after, stampFn] of sections) {
      for (const src of [C.tombstones[name], I.tombstones[name]]) {
        for (const [k, iso] of Object.entries(src)) tombstones[name][k] = laterIso(tombstones[name][k] || '', iso);
      }
      for (const k of Object.keys(after)) delete tombstones[name][k];
      for (const [k, item] of Object.entries(before)) {
        if (!after[k]) tombstones[name][k] = laterIso(tombstones[name][k] || '', deleteMark(item, stampFn));
      }
    }
    return { trackedShows, watchedEpisodes, episodeNotes, tombstones, resetAt: C.resetAt };
  }

  // O que fazer com a biblioteca do servidor ao entrar (login ou sessão retomada)?
  //  ownerId = dono do estado guardado neste navegador (ausente = visitante); userId = conta que acabou de entrar.
  //  - outro dono: SUBSTITUI pelo remoto (nunca mescla dados de duas contas) e pede para arquivar o local;
  //  - estado inicial nunca editado (seeded; desde a S08 é uma lista vazia): o servidor vence (mesmo vazio);
  //  - demais casos (mesmo dono, ou visitante entrando numa conta): mescla.
  function decideLogin({ ownerId, userId, seeded, local, remote }) {
    if (ownerId && ownerId !== userId) {
      return { action: 'replace', archiveLocal: hasContent(local), data: normalizeData(remote) };
    }
    if (seeded) return { action: 'replace', archiveLocal: false, data: normalizeData(remote) };
    return { action: 'merge', archiveLocal: false, data: merge(local, remote) };
  }

  const api = {
    TOMBSTONE_TTL_MS, MAX_SKEW_MS, emptyData, emptyTombstones, normalizeData, hasContent,
    cleanStamp, cleanTombstones, merge, replaceWith, decideLogin
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LibraryMerge = api;
})(typeof window !== 'undefined' ? window : null);
