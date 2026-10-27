// ESLint (config mínima, "flat config"). `npm run lint` precisa passar sem ERROS; avisos (warn) são tolerados e listados.
// Regras escolhidas por acharem bugs reais (variável não definida, comparação errada, código inalcançável), não por estilo.
const js = require('@eslint/js');
const globals = require('globals');

const commonRules = {
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-constant-condition': ['error', { checkLoops: false }],
  eqeqeq: ['warn', 'smart'],
  'no-var': 'warn',
  'prefer-const': 'warn',
  'no-useless-assignment': 'warn'
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'server/data/**',
      'Documentacao/**',
      '.claude/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'blob-report/**',
      '.playwright-browsers/**'
    ]
  },
  js.configs.recommended,

  // Servidor, scripts e testes: Node (CommonJS)
  {
    files: [
      'server.js',
      'server/**/*.js',
      'scripts/**/*.js',
      'tests/**/*.js',
      'eslint.config.js',
      'prettier.config.js',
      'playwright.config.js'
    ],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node, fetch: 'readonly' } },
    rules: commonRules
  },

  // Testes E2E (S12): o código roda no Node, mas as funções passadas a page.evaluate()/waitForFunction() rodam DENTRO do navegador
  // (window, document, localStorage...), então os dois conjuntos de globais valem aqui.
  {
    files: ['tests/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },

  // Frontend: scripts clássicos no navegador. Os arquivos conversam por `window.*` e por variáveis globais declaradas
  // em outros <script>, então `no-undef` não consegue julgar aqui (o teste de a11y/xss cobre o contrato entre eles).
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      // Os utilitários "duais" (dom.js, migrations.js...) também exportam via module.exports para os testes em Node.
      globals: { ...globals.browser, module: 'writable', require: 'readonly' }
    },
    rules: {
      ...commonRules,
      'no-undef': 'off',
      // Funções/constantes de topo de um script viram globais usadas pelos outros arquivos: só vale checar o que é local.
      'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-redeclare': 'off'
    }
  }
];
