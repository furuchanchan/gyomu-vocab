// 制度の根拠を、一次情報に照らして確かめる。
//   - 法令の条：e-Gov 法令API から条を1つ取り出し、法令の名前と、照合する語が本文にあるかを見る
//   - 役所のページ：ページを取得し、照合する語が本文にあるかを見る
// 結果は verification/latest.json に残す。1つでも外れたら終了コード 1。
//
// 使い方：node scripts/verify-sources.mjs            （全部）
//         node scripts/verify-sources.mjs hr sales   （data/regulations/hr.yaml と sales.yaml だけ）
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { articleLabel } from './rdf.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const regDir = join(root, 'data/regulations');
const outFile = join(root, 'verification/latest.json');
const only = process.argv.slice(2);
const today = new Date().toISOString().slice(0, 10);
const UA = 'gyomu-vocab-verify/0.1 (+https://w3id.org/gyomu/)';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// 全角と半角、空白の違いで外れないようにそろえる
const norm = s => String(s).normalize('NFKC').replace(/\s+/g, '');
const missing = (text, words) => words.filter(w => !norm(text).includes(norm(w)));

const nodeText = n => (typeof n === 'string' ? n : Array.isArray(n) ? n.map(nodeText).join('') : n && typeof n === 'object' ? nodeText(n.children ?? []) : '');

async function checkArticle(basis, a) {
  const part = a.part === 'suppl' ? 'SupplProvision' : 'MainProvision';
  const url = `https://laws.e-gov.go.jp/api/2/law_data/${basis.lawId}?elm=${part}-Article_${a.article}&law_full_text_format=json&asof=${today}`;
  const name = `${basis.law} ${articleLabel(a)}`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) return { kind: 'article', name, url, ok: false, reason: `HTTP ${res.status}` };
    const body = await res.json();
    const title = body.revision_info?.law_title;
    const text = nodeText(body.law_full_text);
    if (title !== basis.law) return { kind: 'article', name, url, ok: false, reason: `法令の名前が違う（e-Gov は「${title}」）` };
    if (!text) return { kind: 'article', name, url, ok: false, reason: '条の本文が空' };
    const miss = missing(text, a.contains);
    return {
      kind: 'article', name, url, ok: miss.length === 0,
      reason: miss.length ? `本文に無い語：${miss.join('、')}` : undefined,
      revision: body.revision_info?.law_revision_id,
      enforcedOn: body.revision_info?.amendment_enforcement_date,
      head: text.slice(0, 60),
    };
  } catch (e) {
    return { kind: 'article', name, url, ok: false, reason: String(e.message ?? e) };
  }
}

function decode(buffer, contentType) {
  const head = new TextDecoder('latin1').decode(buffer.slice(0, 2048));
  const charset = (/charset=["']?([\w-]+)/i.exec(contentType ?? '') ?? /charset=["']?([\w-]+)/i.exec(head))?.[1] ?? 'utf-8';
  try { return new TextDecoder(charset.toLowerCase()).decode(buffer); } catch { return new TextDecoder('utf-8').decode(buffer); }
}

function pdfText(buffer) {
  const dir = mkdtempSync(join(tmpdir(), 'gyomu-verify-'));
  const file = join(dir, 'page.pdf');
  writeFileSync(file, buffer);
  return execFileSync('pdftotext', ['-raw', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

async function checkPage(g) {
  try {
    const res = await fetch(g.url, { headers: { 'user-agent': UA, accept: 'text/html,application/pdf;q=0.9,*/*;q=0.5' }, redirect: 'follow' });
    if (!res.ok) return { kind: 'page', name: g.url, url: g.url, ok: false, reason: `HTTP ${res.status}` };
    const buffer = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get('content-type') ?? '';
    const isPdf = /pdf/i.test(type) || /\.pdf($|\?)/i.test(g.url);
    const raw = isPdf ? pdfText(buffer) : decode(buffer, type);
    const text = isPdf ? raw : raw.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    const miss = missing(text, g.contains);
    return { kind: 'page', name: g.url, url: g.url, ok: miss.length === 0, reason: miss.length ? `ページに無い語：${miss.join('、')}` : undefined, finalUrl: res.url !== g.url ? res.url : undefined };
  } catch (e) {
    return { kind: 'page', name: g.url, url: g.url, ok: false, reason: String(e.message ?? e) };
  }
}

const files = readdirSync(regDir).filter(f => f.endsWith('.yaml')).filter(f => !only.length || only.includes(f.replace(/\.yaml$/, ''))).sort();
const previous = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : { results: {} };
const results = { ...previous.results };
let failed = 0;

for (const file of files) {
  for (const r of YAML.parse(readFileSync(join(regDir, file), 'utf8')) ?? []) {
    const checks = [];
    for (const b of r.legalBasis ?? []) for (const a of b.articles ?? []) { checks.push(await checkArticle(b, a)); await sleep(700); }
    for (const g of r.officialGuidance ?? []) { checks.push(await checkPage(g)); await sleep(700); }
    const ok = checks.length > 0 && checks.every(c => c.ok);
    results[r.id] = { ok, checkedOn: today, file, checks };
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${r.id}`);
    for (const c of checks.filter(c => !c.ok)) console.log(`       ${c.name}: ${c.reason}`);
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ checkedOn: today, results }, null, 2) + '\n');
const total = Object.keys(results).length;
console.log(`\n確かめた制度 ${files.length ? Object.values(results).filter(r => files.includes(r.file)).length : 0} 件、外れ ${failed} 件（記録の合計 ${total} 件）`);
process.exit(failed ? 1 : 0);
