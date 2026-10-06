// 客服端（Electron 主进程，纯 JS）的 lint 配置（2026-10-07）。
//
// 为什么单独给这一端配：它以前既没有类型检查（根配置把 **/*.js 整个忽略了）、也没有测试 ——
// 而它恰恰是「重构时最容易出事」的那种代码：一个 700 行的 main.js，函数互相调用，
// 抽走一个还在被调用的函数，本地 node --check 过得去、打包也不报错，
// 结果**在那台客服机器上启动即崩**（客户端崩了连「我崩了」都上报不了，只能等人说打不开）。
// 这里至少拦住最基本的四类：
//   ① 用了没定义的名字（no-undef）——「删了函数忘了改调用」正是这一类；
//   ② 定义了没人用的名字（no-unused-vars，只提醒不拦）；
//   ③ 重复声明 / 重复键（no-redeclare / no-dupe-keys）；
//   ④ 不可能执行到的代码（no-unreachable）。
//
// 注意：这里不追求「风格统一」，只追求「抓真错」。格式化交给 Prettier，跟根配置一致。
import js from '@eslint/js';

// node / Electron 主进程里天然存在的全局变量（不上 globals 包，手写一份够用且看得见）。
const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  global: 'readonly',
};

const sharedRules = {
  ...js.configs.recommended.rules,
  // 空 catch 在这一端满地都是「故意的忽略」，允许；真正的空 if / for 仍然报错。
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-console': 'off',
};

export default [
  { ignores: ['release*/**', 'node_modules/**', 'public/**', 'build/**'] },
  {
    // main.js / machine-agent.js / update-decisions.js —— CommonJS
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: nodeGlobals },
    rules: sharedRules,
  },
  {
    // 测试与 vitest 配置 —— ESM
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: nodeGlobals },
    rules: sharedRules,
  },
];