import globals from 'globals';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'warn',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // CLI scripts and bench harnesses talk to a human on stdout. That is their job.
    files: ['**/scripts/**/*.js', 'bench/**/*.js'],
    rules: { 'no-console': 'off' },
  },
];
