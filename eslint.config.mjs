import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'lib/', '.github/'] },

  {
    ...js.configs.recommended,
    files: ['src/**/*.js', 'index.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        SillyTavern: 'readonly',
        $:           'readonly',
        jQuery:      'readonly',
        iro:         'readonly',
        mermaid:     'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef':       'error',
      'no-console':     'off',
      'prefer-const':   'warn',
      'no-var':         'error',
    },
  },
];
