// ESLint 10 只认 flat config（eslint.config.mjs）。
//
// 2026-10-06 迁移自旧的 .eslintrc.json：规则集与旧配置一一对应
// （eslint:recommended + @typescript-eslint/recommended + prettier，
//  *.tsx 另加 react / react-hooks），只是换成 flat 写法。
//
// 背景：旧配置是 .eslintrc.json，ESLint 10 直接拒绝加载，
// 于是 `pnpm lint` 在整仓范围内都是「找不到配置文件」直接失败 ——
// 等于 lint 这个保护从来没生效过。这里把它救活。
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

const reactRecommended = react.configs.flat.recommended;

// 只启用地道的老两条 react-hooks 规则（rules-of-hooks / exhaustive-deps），
// 不启用 react-hooks@7 的 flat/recommended —— 那一套把 React Compiler 时代的新规则
// （「不能在 effect 里同步 setState」「渲染期不许调非纯函数」等）全带上来了，
// 一开就是几百个 error。这不是修 lint，是换了个更严的规则集，
// 应该等专门一轮再决定要不要跟，不要在重构刚开始时混进来。
const reactHooksClassicRules = {
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/exhaustive-deps': 'warn',
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      '**/preload-dist/**',
      '**/release/**',
      '**/web-dist/**',
      '**/*.js',
    ],
  },

  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // 与旧配置保持一致的告警级别。历史积压数量见 docs/REFACTOR-PLAN.md。
      // 空 catch / 空块在本仓库里大量是「故意的忽略」（很多地方原本写着 /* 忽略 */）。
      // 允许空 catch，但真正的空 if/for/function 仍然报错。
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
    },
  },

  {
    files: ['**/*.tsx'],
    plugins: { ...reactRecommended.plugins, ...reactHooks.configs.flat.recommended.plugins },
    languageOptions: reactRecommended.languageOptions,
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactRecommended.rules,
      ...reactHooksClassicRules,
      'react/react-in-jsx-scope': 'off',
    },
  },

  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },

  prettier,
];
