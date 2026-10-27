// ================================================================
// SHOWVAULT · TABELA ÚNICA DE EMOÇÕES (S08)
// Fonte única de id, rótulo e ícone das reações. Usada pelo diário, pelas estatísticas e
// (via teste de consistência) pelo modal de anotação e pelos filtros do HTML.
// Script "dual": navegador (window.Emotions) e Node (module.exports), como os outros utils.
// ================================================================

(function (root) {
  const make = (id, label, icon) => Object.freeze({ id, label, icon });

  // A ordem aqui é a ordem em que aparece em todas as telas.
  const LIST = Object.freeze([
    make('awesome', 'Adorei', '😍'),
    make('fun', 'Divertido', '😂'),
    make('mindblown', 'Chocado', '😱'),
    make('sad', 'Triste', '😢'),
    make('disappointed', 'Decepcionado', '😡')
  ]);

  const IDS = Object.freeze(LIST.map(e => e.id));
  const BY_ID = new Map(LIST.map(e => [e.id, e]));

  const isEmotion = (id) => typeof id === 'string' && BY_ID.has(id);
  const get = (id) => (isEmotion(id) ? BY_ID.get(id) : null);

  // "Adorei" (id desconhecido, ex.: dado vindo de um backup antigo, devolve o próprio texto).
  const label = (id) => (isEmotion(id) ? BY_ID.get(id).label : (id == null ? '' : String(id)));

  // "😍 Adorei"
  const withIcon = (id) => (isEmotion(id) ? `${BY_ID.get(id).icon} ${BY_ID.get(id).label}` : label(id));

  // { awesome: 0, fun: 0, ... } para contagens (estatísticas)
  const emptyCounts = () => Object.fromEntries(IDS.map(id => [id, 0]));

  const api = { LIST, IDS, isEmotion, get, label, withIcon, emptyCounts };
  root.Emotions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
