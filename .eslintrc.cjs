/**
 * CI-enforced Clean Architecture boundaries (TRD §18.3).
 * Enforces: domain -> usecases -> (interfaces|infrastructure) dependency rule.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { project: './tsconfig.json', tsconfigRootDir: __dirname },
  plugins: ['@typescript-eslint', 'boundaries'],
  ignorePatterns: ['dist/', 'node_modules/', '*.cjs', 'k6/'],
  rules: {
    // Dependency-cruiser-like hard rule: no framework leakage into the core.
    'no-restricted-imports': ['error', {
      patterns: [
        {
          group: ['express', 'kysely', 'pino', 'pg', 'jose', 'opossum'],
          message: 'Dilarang di domain/usecases: lapisan core harus bebas framework.',
        },
      ],
    }],
    'boundaries/element-types': ['error', {
      default: 'disallow',
      rules: [
        { from: 'domain', allow: ['domain'] },
        { from: 'usecases', allow: ['domain', 'usecases'] },
        { from: 'interfaces', allow: ['usecases', 'domain', 'interfaces'] },
        { from: 'infrastructure', allow: ['usecases', 'domain', 'infrastructure'] },
      ],
    }],
  },
  overrides: [
    {
      // Composition root is the only place allowed to wire infrastructure.
      files: ['src/main/**/*.ts'],
      rules: { 'boundaries/element-types': 'off', 'no-restricted-imports': 'off' },
    },
  ],
  settings: {
    'boundaries/include': ['src/**/*.ts'],
    'boundaries/elements': [
      { type: 'domain', pattern: 'src/domain/*' },
      { type: 'usecases', pattern: 'src/usecases/*' },
      { type: 'interfaces', pattern: 'src/interfaces/*' },
      { type: 'infrastructure', pattern: 'src/infrastructure/*' },
    ],
  },
};
