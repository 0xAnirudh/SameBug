import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

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
    // CLI scripts, bench harnesses and tests talk to a human on stdout.
    // The grouping test prints its precision and recall, which is the point of it.
    files: ['**/scripts/**/*.js', 'bench/**/*.js', '**/tests/**/*.js'],
    rules: { 'no-console': 'off' },
  },
  {
    // The client is browser code with JSX, not node scripts.
    files: ['apps/web/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': [
        'error',
        // JSX component names read as unused to the base rule.
        { argsIgnorePattern: '^_', varsIgnorePattern: '^[_A-Z]' },
      ],
    },
  },
];
