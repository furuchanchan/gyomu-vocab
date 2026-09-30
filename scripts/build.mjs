// data/ を読み、RDF（Turtle・N-Triples・JSON-LD）と、URIごとのページを dist/ に出す。
// 出す前に、SHACL の検査と、Turtle と JSON-LD が同じ中身かの突き合わせをする。
//
// 使い方：node scripts/build.mjs [データのフォルダ] [出力のフォルダ]
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import N3 from 'n3';
import jsonld from 'jsonld';
import SHACLValidator from 'rdf-validate-shacl';
import { load } from './load.mjs';
import { toStore, PREFIXES, BASE } from './rdf.mjs';
import { writeSite } from './site.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.argv[2] ?? join(root, 'data');
const outDir = process.argv[3] ?? join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const context = JSON.parse(readFileSync(join(root, 'vocab/context.jsonld'), 'utf8'));

const serialize = (quads, format) => new Promise((resolve, reject) => {
  const writer = new N3.Writer({ prefixes: format === 'N-Triples' ? undefined : PREFIXES, format });
  writer.addQuads(quads);
  writer.end((error, result) => (error ? reject(error) : resolve(result)));
});
const sorted = store => store.getQuads().sort((a, b) => (a.subject.value + a.predicate.value + a.object.value).localeCompare(b.subject.value + b.predicate.value + b.object.value));

// JSON-LD は、文脈（@context）を中に入れて、外を見に行かなくても読める形で出す
const noRemote = async url => { throw new Error(`外の文脈を読みに行こうとした：${url}`); };
async function toJsonLd(quads) {
  const nquads = await serialize(quads, 'N-Triples');
  const expanded = await jsonld.fromRDF(nquads, { format: 'application/n-quads', useNativeTypes: false });
  return jsonld.compact(expanded, context, { documentLoader: noRemote, compactArrays: true });
}
async function fromJsonLd(doc) {
  const nquads = await jsonld.toRDF(doc, { format: 'application/n-quads', documentLoader: noRemote });
  return new N3.Store(new N3.Parser({ format: 'N-Quads' }).parse(nquads));
}
function sameTriples(a, b, name) {
  const missing = a.getQuads().filter(q => !b.has(q));
  const extra = b.getQuads().filter(q => !a.has(q));
  if (missing.length || extra.length) {
    const show = q => `${q.subject.value} ${q.predicate.value} ${q.object.value}`;
    throw new Error(`${name}：中身が合わない（足りない ${missing.length}、余分 ${extra.length}）\n  ${[...missing.slice(0, 3), ...extra.slice(0, 3)].map(show).join('\n  ')}`);
  }
}

const data = load(dataDir);
const store = toStore(data, { version: pkg.version, modified: new Date().toISOString().slice(0, 10) });

// SHACL の検査。クラスの検査（sh:class）のために、語彙の定義も合わせて渡す
const vocabTtl = readFileSync(join(root, 'vocab/gyomu.ttl'), 'utf8');
const shapesTtl = readFileSync(join(root, 'vocab/shapes.ttl'), 'utf8');
const vocab = new N3.Store(new N3.Parser().parse(vocabTtl));
const shapes = new N3.Store(new N3.Parser().parse(shapesTtl));
const report = await new SHACLValidator(shapes).validate(new N3.Store([...store.getQuads(), ...vocab.getQuads()]));
if (!report.conforms) {
  const lines = report.results.slice(0, 20).map(r => `  - ${r.focusNode?.value} ${r.path?.value ?? ''} ${r.message.map(m => m.value).join(' ') || r.sourceConstraintComponent?.value}`);
  throw new Error(`SHACL の検査に ${report.results.length} 件外れた\n${lines.join('\n')}`);
}

// 出力
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const quads = sorted(store);
const turtle = await serialize(quads, 'Turtle');
const ntriples = await serialize(quads, 'N-Triples');
const doc = await toJsonLd(quads);

// 出した物を読み直して、元と同じ中身かを確かめる
sameTriples(store, new N3.Store(new N3.Parser().parse(turtle)), 'Turtle');
sameTriples(store, new N3.Store(new N3.Parser({ format: 'N-Triples' }).parse(ntriples)), 'N-Triples');
sameTriples(store, await fromJsonLd(doc), 'JSON-LD');

writeFileSync(join(outDir, 'gyomu-data.ttl'), turtle);
writeFileSync(join(outDir, 'gyomu-data.nt'), ntriples);
writeFileSync(join(outDir, 'gyomu-data.jsonld'), JSON.stringify(doc, null, 2) + '\n');
copyFileSync(join(root, 'vocab/gyomu.ttl'), join(outDir, 'gyomu-vocab.ttl'));
copyFileSync(join(root, 'vocab/shapes.ttl'), join(outDir, 'gyomu-shapes.ttl'));
copyFileSync(join(root, 'vocab/context.jsonld'), join(outDir, 'context.jsonld'));

const pages = await writeSite({ data, store, vocab, outDir, serialize, toJsonLd, version: pkg.version });

const count = type => store.getQuads(null, PREFIXES.rdf + 'type', PREFIXES.gyomu + type).length;
const external = store.getQuads().filter(q => q.object.termType === 'NamedNode' && !q.object.value.startsWith(BASE) && /estat|e-gov|apqc/.test(q.object.value)).length;
console.log(`トリプル ${store.size}（語彙 ${vocab.size}）`);
console.log(`部署 ${count('Department')}、ワークフロー ${count('Workflow')}、段階 ${count('Stage')}、工程 ${count('Step')}`);
console.log(`担い手 ${count('Role')}、物 ${count('Artifact')}、制度 ${count('Regulation')}、道具の種類 ${count('ToolKind')}、APQC PCF ${count('PcfElement')}`);
console.log(`外へのリンク（統計LOD・e-Gov・APQC） ${external}`);
console.log(`SHACL の検査：合格。Turtle・N-Triples・JSON-LD の突き合わせ：一致。`);
console.log(`ページ ${pages} 枚 → ${outDir}`);
