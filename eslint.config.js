import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Principle I: Reddit-owned names live only in src/contracts/. SC-006: network only via src/core/net.ts.
const redditLiteral = {
  selector: 'Literal[value=/shreddit-|faceplate-|data-testid/]',
  message: 'Reddit selectors belong in src/contracts/reddit.ts (constitution Principle I).',
};
const redditTemplate = {
  selector: 'TemplateElement[value.raw=/shreddit-|faceplate-|data-testid/]',
  message: 'Reddit selectors belong in src/contracts/reddit.ts (constitution Principle I).',
};
const rawNetwork = [
  { name: 'fetch', message: 'Use src/core/net.ts (SC-006).' },
  { name: 'XMLHttpRequest', message: 'Use src/core/net.ts (SC-006).' },
];

export default tseslint.config(
  { ignores: ['.output/', '.wxt/', 'node_modules/', 'coverage/', 'tests/fixtures/captured/', '.claude/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/contracts/**'],
    rules: { 'no-restricted-syntax': ['error', redditLiteral, redditTemplate] },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/core/net.ts'],
    rules: { 'no-restricted-globals': ['error', ...rawNetwork] },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
