// 統計LOD の分類のURIを1つずつ開き、名前（日本語・英語）を取り出して YAML にする
import N3 from 'n3';
import { writeFileSync } from 'node:fs';
const NS = 'http://data.e-stat.go.jp/lod/ontology/crossDomain/code/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sets = [
  { out: '/Users/koutaroufuruno/Projects/gyomu-vocab/data/external/estat-occupations/major-groups.yaml', prefix: 'occupationalClassification2009-', idPrefix: 'jsoc-', codes: 'ABCDEFGHIJKL'.split(''),
    head: '# 日本標準職業分類（平成21年12月統計基準設定）の大分類。\n# 出典：政府統計の総合窓口(e-Stat) 統計LOD（https://data.e-stat.go.jp/lodw/）。名前は統計LODの skos:prefLabel から、先頭のコードを除いたもの。\n' },
  { out: '/Users/koutaroufuruno/Projects/gyomu-vocab/data/external/estat-industries/major-groups.yaml', prefix: 'industryClassification2013-', idPrefix: 'jsic-', codes: 'ABCDEFGHIJKLMNOPQRST'.split(''),
    head: '# 日本標準産業分類（平成25年10月改定）の大分類。\n# 出典：政府統計の総合窓口(e-Stat) 統計LOD（https://data.e-stat.go.jp/lodw/）。名前は統計LODの skos:prefLabel から、先頭のコードを除いたもの。\n' },
];
for (const set of sets) {
  let yaml = set.head;
  for (const code of set.codes) {
    const uri = NS + set.prefix + code;
    const res = await fetch(uri, { headers: { accept: 'text/turtle' } });
    if (!res.ok) throw new Error(`${uri} HTTP ${res.status}`);
    const quads = new N3.Parser({ baseIRI: uri }).parse(await res.text());
    const label = l => quads.find(q => q.subject.value === uri && q.predicate.value.endsWith('core#prefLabel') && q.object.language === l)?.object.value;
    const ja = label('ja'), en = label('en');
    if (!ja || !en) throw new Error(`${uri} に名前が無い`);
    if (!ja.startsWith(code + ' ')) throw new Error(`${uri} の名前がコードで始まらない：${ja}`);
    yaml += `- id: ${set.idPrefix}${code.toLowerCase()}\n  code: ${code}\n  uri: ${uri}\n  label:\n    ja: ${JSON.stringify(ja.slice(2))}\n    en: ${JSON.stringify(en)}\n`;
    console.log(code, ja, '/', en);
    await sleep(800);
  }
  writeFileSync(set.out, yaml);
}
