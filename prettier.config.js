// Prettier: config mínima que acompanha o estilo atual do projeto (aspas simples, ponto e vírgula, 140 colunas).
// `npm run format:check` confere só os arquivos da fase A da S10 (veja package.json); o resto do código será formatado com cuidado,
// depois que as sessões paralelas terminarem, para não gerar conflitos de merge.
module.exports = {
  singleQuote: true,
  semi: true,
  printWidth: 140,
  trailingComma: 'none',
  arrowParens: 'avoid',
  endOfLine: 'auto'
};
