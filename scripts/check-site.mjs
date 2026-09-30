// 出したページのリンクが、全部つながっているかを確かめる。 node scripts/check-site.mjs [出力のフォルダ]
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(process.argv[2] ?? join(root, 'dist'));

const pages = [];
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.html')) pages.push(p); } };
walk(dir);

let links = 0;
const broken = [];
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    links++;
    let target = resolve(dirname(page), href.split('#')[0]);
    if (href.endsWith('/')) target = join(target, 'index.html');
    if (!existsSync(target)) broken.push(`${page.slice(dir.length + 1)} → ${href}`);
  }
}
console.log(`ページ ${pages.length}、ページの中のリンク ${links}、切れ ${broken.length}`);
for (const b of broken.slice(0, 20)) console.log(`  - ${b}`);
process.exit(broken.length ? 1 : 0);
