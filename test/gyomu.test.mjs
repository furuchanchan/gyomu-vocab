// 検査そのものが働くことを確かめる。 node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import N3 from 'n3';
import YAML from 'yaml';
import SHACLValidator from 'rdf-validate-shacl';
import { load, aiAllocation } from '../scripts/load.mjs';
import { toStore, PREFIXES, iri, articleLabel } from '../scripts/rdf.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { namedNode } = N3.DataFactory;

// 小さなデータを、一時フォルダに作る。change で一部を書き換えられる
function fixture(change = d => d) {
  const d = change({
    roles: [
      { id: 'clerk', label: { ja: '担当', en: 'Clerk' }, description: { ja: '実務を行う役割。' }, external: false },
      { id: 'partner', label: { ja: '取引先', en: 'Partner' }, description: { ja: '社外の相手。' }, external: true },
    ],
    artifacts: [
      { id: 'letter', label: { ja: '届いた書類', en: 'Letter' }, kind: 'form', fromOutside: true, sender: 'partner' },
      { id: 'record', label: { ja: '記録', en: 'Record' }, kind: 'data', fromOutside: false, recipient: 'partner' },
    ],
    steps: [
      { id: 'receive', label: { ja: '書類を受け取る', en: 'Receive the letter' }, description: { ja: '届いた書類を記録する。' }, performedBy: 'clerk', receives: ['letter'], produces: ['record'], requiresJudgment: false, irreversible: false, humanRequired: false },
    ],
  });
  const dir = mkdtempSync(join(tmpdir(), 'gyomu-test-'));
  const put = (path, value) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), YAML.stringify(value)); };
  for (const empty of ['external/estat-occupations', 'external/estat-industries', 'external/apqc-pcf', 'regulations', 'tool-kinds']) mkdirSync(join(dir, empty), { recursive: true });
  put('roles/all.yaml', d.roles);
  put('artifacts/all.yaml', d.artifacts);
  put('departments/office/department.yaml', { id: 'office', order: 1, label: { ja: '事務', en: 'Office' }, description: { ja: '事務を行う部署。', en: 'The office.' }, workflows: ['intake'] });
  put('departments/office/intake.yaml', { id: 'intake', label: { ja: '受け付け', en: 'Intake' }, description: { ja: '書類を受け付ける流れ。', en: 'Intake of letters.' }, frequency: 'on-demand', stages: [{ id: 'main', label: { ja: '受け付け', en: 'Intake' }, steps: d.steps }] });
  return dir;
}
const errorsOf = dir => { try { load(dir); return []; } catch (e) { return e.errors ?? [String(e)]; } };

test('分担の目安は、3つの事実から決まった規則で導かれる', () => {
  const step = (humanRequired, requiresJudgment, irreversible) => aiAllocation({ humanRequired, requiresJudgment, irreversible });
  assert.equal(step(false, false, false), 'AiCanDo');
  assert.equal(step(false, true, false), 'AiDraftsHumanConfirms');
  assert.equal(step(false, false, true), 'AiDraftsHumanConfirms');
  assert.equal(step(false, true, true), 'AiDraftsHumanConfirms');
  assert.equal(step(true, false, false), 'HumanOnly');
  assert.equal(step(true, true, true), 'HumanOnly');
});

test('条の書き方を、日本語の表記にする', () => {
  assert.equal(articleLabel('36'), '第36条');
  assert.equal(articleLabel('57_4'), '第57条の4');
  assert.equal(articleLabel('66_10'), '第66条の10');
  assert.equal(articleLabel({ article: '143', part: 'suppl' }), '附則 第143条');
});

test('正しい小さなデータは、検査を通る', () => {
  assert.deepEqual(errorsOf(fixture()), []);
});

test('誰も作っていない物を受け取る工程を見つける', () => {
  const dir = fixture(d => { d.artifacts[0] = { id: 'letter', label: { ja: '届いた書類', en: 'Letter' }, kind: 'form', fromOutside: false }; return d; });
  const errors = errorsOf(dir);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /物 letter を、誰も作っていない/);
});

test('判断があるのに、判断の中身が無い工程を見つける', () => {
  const errors = errorsOf(fixture(d => { d.steps[0].requiresJudgment = true; return d; }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /judgment/);
});

test('人が行う必要があるのに、理由が無い工程を見つける', () => {
  const errors = errorsOf(fixture(d => { d.steps[0].humanRequired = true; return d; }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /humanRequiredReason/);
});

test('社内の担い手を、社外から来る物の送り手にできない', () => {
  const errors = errorsOf(fixture(d => { d.artifacts[0].sender = 'clerk'; return d; }));
  assert.ok(errors.some(e => /sender は社外の担い手/.test(e)), errors.join('\n'));
});

test('使われていない定義を見つける', () => {
  const errors = errorsOf(fixture(d => { d.roles.push({ id: 'idle', label: { ja: '使わない役割', en: 'Idle' }, description: { ja: '使わない。' }, external: false }); return d; }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /担い手 idle: どこからも使われていない/);
});

test('SHACL の検査が、欠けたデータを見つける', async () => {
  const data = load(fixture());
  const store = toStore(data, { version: '0.0.0', modified: '2026-01-01' });
  const vocab = new N3.Parser().parse(readFileSync(join(root, 'vocab/gyomu.ttl'), 'utf8'));
  const shapes = new N3.Store(new N3.Parser().parse(readFileSync(join(root, 'vocab/shapes.ttl'), 'utf8')));
  const validate = s => new SHACLValidator(shapes).validate(new N3.Store([...s.getQuads(), ...vocab]));

  assert.equal((await validate(store)).conforms, true);

  const step = namedNode(iri.step('intake', 'receive'));
  const broken = new N3.Store(store.getQuads());
  broken.removeQuads(broken.getQuads(step, namedNode(PREFIXES.gyomu + 'performedBy'), null));
  const report = await validate(broken);
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(r => r.focusNode.value === step.value && r.path?.value === PREFIXES.gyomu + 'performedBy'));

  // 判断があるのに中身が無い、も SHACL の側で見つかる
  const noJudgment = new N3.Store(store.getQuads());
  noJudgment.removeQuads(noJudgment.getQuads(step, namedNode(PREFIXES.gyomu + 'requiresJudgment'), null));
  noJudgment.addQuad(step, namedNode(PREFIXES.gyomu + 'requiresJudgment'), N3.DataFactory.literal('true', namedNode(PREFIXES.xsd + 'boolean')));
  assert.equal((await validate(noJudgment)).conforms, false);
});

test('公開するデータは、検査を通る', () => {
  const data = load(join(root, 'data'));
  assert.ok(data.departments.length >= 1);
});

test('制度は、どれも一次情報との照合が通っている', () => {
  const log = JSON.parse(readFileSync(join(root, 'verification/latest.json'), 'utf8'));
  const dir = join(root, 'data/regulations');
  for (const file of readdirSync(dir).filter(f => f.endsWith('.yaml'))) {
    for (const r of YAML.parse(readFileSync(join(dir, file), 'utf8')) ?? []) {
      const record = log.results[r.id];
      assert.ok(record, `${r.id}：照合の記録が無い（node scripts/verify-sources.mjs）`);
      assert.equal(record.ok, true, `${r.id}：照合に外れている`);
      assert.ok(record.checkedOn >= String(r.verifiedOn), `${r.id}：確かめた日（${r.verifiedOn}）より、照合の記録（${record.checkedOn}）が古い`);
      const expected = (r.legalBasis ?? []).reduce((n, b) => n + b.articles.length, 0) + (r.officialGuidance ?? []).length;
      assert.equal(record.checks.length, expected, `${r.id}：照合した数が、根拠の数と合わない（書き換えたあとに照合し直していない）`);
    }
  }
});
