// 打包 src/ 多模組 → dist/anime1-plus.user.js（單檔油猴腳本）
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

const VERSION = '0.4.9';
const REPO = 'bakabaka0613/anime1-plus';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/dist/anime1-plus.user.js`;

// Userscript metadata block。@connect 列出所有跨域目標（Bangumi API 與圖床）。
const banner = `// ==UserScript==
// @name         Anime1.me Plus
// @namespace    https://github.com/${REPO}
// @version      ${VERSION}
// @description  Anime1.me 增強：自動封面圖、觀看記錄、續播、自動下一集、快捷鍵
// @author       bakabaka0613
// @match        https://anime1.me/*
// @icon         https://anime1.me/favicon.ico
// @homepageURL  https://github.com/${REPO}
// @supportURL   https://github.com/${REPO}/issues
// @updateURL    ${RAW}
// @downloadURL  ${RAW}
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      api.bgm.tv
// @connect      lain.bgm.tv
// @run-at       document-idle
// @noframes
// ==/UserScript==
`;

mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  charset: 'utf8',
  banner: { js: banner },
  outfile: 'dist/anime1-plus.user.js',
  legalComments: 'none',
});

console.log('✓ built dist/anime1-plus.user.js');
