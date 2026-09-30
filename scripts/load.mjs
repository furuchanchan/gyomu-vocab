// data/ の YAML を読み、中身のつじつまを確かめる。
// 誤りは全部集めてから、まとめて投げる（1つ直すたびに次が出る、を避ける）。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const FREQUENCIES = { 'on-demand': 'OnDemand', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const ARTIFACT_KINDS = { form: 'Form', data: 'Data', document: 'Document', message: 'Message' };

// YAML の文法の誤りは、その場で投げずに、ほかの誤りと一緒に集める（同時に何人かが書いていても、検査が止まらないように）
const readYamlOrError = (path, err) => {
  try { return YAML.parse(readFileSync(path, 'utf8')); }
  catch (e) { err(path, `YAML として読めない：${String(e.message ?? e).split('\n')[0]}`); return null; }
};

// 分担の目安は、3つの事実から決まった規則で導く（vocab/gyomu.ttl の gyomu:aiAllocation と同じ規則）
export function aiAllocation(step) {
  if (step.humanRequired) return 'HumanOnly';
  if (step.requiresJudgment || step.irreversible) return 'AiDraftsHumanConfirms';
  return 'AiCanDo';
}

export function load(dataDir) {
  const errors = [];
  const err = (where, message) => errors.push(`${where}: ${message}`);
  const readYaml = path => readYamlOrError(path, err);

  const text = (where, value, { en = true } = {}) => {
    if (!value || typeof value !== 'object') return err(where, '日本語と英語の組（ja・en）で書く');
    if (typeof value.ja !== 'string' || !value.ja.trim()) err(where, 'ja が無い');
    if (en && (typeof value.en !== 'string' || !value.en.trim())) err(where, 'en が無い');
  };
  const bool = (where, value) => {
    if (typeof value !== 'boolean') err(where, 'true か false で書く');
  };
  const url = (where, value) => {
    if (typeof value !== 'string' || !/^https?:\/\/\S+$/.test(value)) err(where, `URL ではない（${value}）`);
  };

  // 一覧の読み込み。フォルダの中の YAML を全部読み、id の形と重複を確かめ、id から引ける Map にする
  const registry = (dir, kind) => {
    const map = new Map();
    const path = join(dataDir, dir);
    if (!existsSync(path)) { err(dir, 'フォルダが無い'); return map; }
    for (const file of readdirSync(path).filter(f => f.endsWith('.yaml')).sort()) {
      for (const item of readYaml(join(path, file)) ?? []) {
        const where = `${dir}/${file} ${item.id}`;
        if (!ID.test(String(item.id))) err(where, 'id は英小文字・数字・ハイフンで書く');
        if (map.has(item.id)) err(where, `${kind}の id が重複している`);
        map.set(item.id, item);
      }
    }
    return map;
  };

  const occupations = registry('external/estat-occupations', '職業分類');
  const industries = registry('external/estat-industries', '産業分類');
  const roles = registry('roles', '担い手');
  const artifacts = registry('artifacts', '物');
  const regulations = registry('regulations', '制度');
  const toolKinds = registry('tool-kinds', '道具の種類');

  // APQC PCF の要素は、番号が id
  const pcf = new Map();
  const pcfDir = join(dataDir, 'external/apqc-pcf');
  for (const file of existsSync(pcfDir) ? readdirSync(pcfDir).filter(f => f.endsWith('.yaml')).sort() : []) {
    for (const item of readYaml(join(pcfDir, file)) ?? []) {
      const where = `external/apqc-pcf/${file} ${item.id}`;
      if (!/^\d{4,6}$/.test(String(item.id))) err(where, 'id は APQC の要素の番号');
      if (!/^\d{1,2}(\.\d{1,2}){0,4}$/.test(String(item.hierarchy))) err(where, 'hierarchy は 9.6.1 の形');
      if (typeof item.name !== 'string' || !item.name) err(where, 'name が無い');
      if (pcf.has(String(item.id))) err(where, '番号が重複している');
      pcf.set(String(item.id), item);
    }
  }

  const used = { roles: new Set(), artifacts: new Set(), regulations: new Set(), toolKinds: new Set(), pcf: new Set() };

  for (const [id, o] of occupations) { url(`職業分類 ${id} uri`, o.uri); text(`職業分類 ${id} label`, o.label); }
  for (const [id, o] of industries) { url(`産業分類 ${id} uri`, o.uri); text(`産業分類 ${id} label`, o.label); }

  for (const [id, r] of roles) {
    const where = `担い手 ${id}`;
    text(`${where} label`, r.label);
    text(`${where} description`, r.description, { en: false });
    bool(`${where} external`, r.external);
    if (r.occupation !== undefined && !occupations.has(r.occupation)) err(where, `職業分類 ${r.occupation} が無い`);
    if (r.occupationCode !== undefined && !/^\d{2,3}$/.test(String(r.occupationCode))) err(where, 'occupationCode は2桁か3桁の数字');
  }

  for (const [id, a] of artifacts) {
    const where = `物 ${id}`;
    text(`${where} label`, a.label);
    if (!ARTIFACT_KINDS[a.kind]) err(where, `kind は ${Object.keys(ARTIFACT_KINDS).join('・')} のどれか`);
    bool(`${where} fromOutside`, a.fromOutside);
    if (a.description !== undefined) text(`${where} description`, a.description, { en: false });
    for (const side of ['sender', 'recipient']) {
      if (a[side] === undefined) continue;
      const role = roles.get(a[side]);
      if (!role) err(where, `${side} の担い手 ${a[side]} が無い`);
      else if (!role.external) err(where, `${side} は社外の担い手で書く（${a[side]} は社内）`);
      else used.roles.add(a[side]);
    }
    if (a.fromOutside && a.sender === undefined) err(where, '社外から来る物には、送り手（sender）を書く');
    if (!a.fromOutside && a.sender !== undefined) err(where, '送り手（sender）があるのに、fromOutside が false');
  }

  for (const [id, r] of regulations) {
    const where = `制度 ${id}`;
    text(`${where} label`, r.label);
    text(`${where} obligation`, r.obligation, { en: false });
    text(`${where} authority`, r.authority, { en: false });
    if (r.deadline !== undefined) text(`${where} deadline`, r.deadline, { en: false });
    if (r.appliesTo !== undefined) text(`${where} appliesTo`, r.appliesTo, { en: false });
    if (!(r.officialGuidance ?? []).length && !(r.legalBasis ?? []).length) err(where, '法令の条（legalBasis）か、役所の説明のページ（officialGuidance）の、どちらかが要る');
    for (const g of r.officialGuidance ?? []) {
      url(`${where} officialGuidance`, g.url);
      if (!Array.isArray(g.contains) || !g.contains.length) err(where, `officialGuidance ${g.url} に、照合する語（contains）が要る`);
    }
    // 法律にもとづかない制度（条例など）は、legalBasis を書かず basisNote に理由を書く
    if (r.legalBasis === undefined) {
      if (r.basisNote === undefined) err(where, 'legalBasis が無いときは、basisNote に理由を書く');
      else text(`${where} basisNote`, r.basisNote, { en: false });
    } else {
      for (const b of r.legalBasis) {
        if (typeof b.law !== 'string' || !b.law) err(where, 'legalBasis に法令の名前（law）が無い');
        if (!/^[0-9]{3}[A-Z0-9]{12}$/.test(String(b.lawId))) err(where, `legalBasis の lawId は e-Gov の法令ID（${b.lawId}）`);
        if (!Array.isArray(b.articles) || !b.articles.length) err(where, `legalBasis ${b.law} に、条（articles）が要る`);
        for (const a of b.articles ?? []) {
          if (!/^\d+(_\d+)*$/.test(String(a.article))) err(where, `条は 57_4 の形で書く（${a.article}）`);
          if (a.part !== undefined && a.part !== 'suppl') err(where, `part は suppl（附則）だけ（${a.part}）`);
          if (!Array.isArray(a.contains) || !a.contains.length) err(where, `${b.law} ${a.article} に、照合する語（contains）が要る`);
        }
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.verifiedOn))) err(where, 'verifiedOn は 2026-09-30 の形');
  }

  for (const [id, t] of toolKinds) text(`道具の種類 ${id} label`, t.label);

  // 部署とワークフロー
  const departments = [];
  const produced = new Set();
  const received = new Map(); // 物の id → 受け取る工程
  const workflowIds = new Set();

  const ref = (where, kind, map, id, usedSet) => {
    const key = kind === 'APQC PCF' ? String(id) : id;
    if (!map.has(key)) err(where, `${kind} ${id} が無い`);
    else usedSet.add(key);
  };

  const deptRoot = join(dataDir, 'departments');
  for (const dir of readdirSync(deptRoot, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()) {
    const deptFile = join(deptRoot, dir, 'department.yaml');
    if (!existsSync(deptFile)) { err(`departments/${dir}`, 'department.yaml が無い'); continue; }
    const dept = readYaml(deptFile);
    const dWhere = `部署 ${dept.id}`;
    if (dept.id !== dir) err(dWhere, `id はフォルダの名前（${dir}）と同じにする`);
    text(`${dWhere} label`, dept.label);
    text(`${dWhere} description`, dept.description, { en: false });
    if (!Number.isInteger(dept.order)) err(dWhere, 'order は整数');
    for (const p of dept.pcf ?? []) ref(dWhere, 'APQC PCF', pcf, p, used.pcf);
    if (!Array.isArray(dept.workflows) || !dept.workflows.length) err(dWhere, 'workflows（並び順）が要る');

    dept.workflowData = [];
    const files = readdirSync(join(deptRoot, dir)).filter(f => f.endsWith('.yaml') && f !== 'department.yaml');
    for (const f of files) if (!(dept.workflows ?? []).includes(f.replace(/\.yaml$/, ''))) err(dWhere, `${f} が workflows の並びに無い`);

    for (const wid of dept.workflows ?? []) {
      const wFile = join(deptRoot, dir, `${wid}.yaml`);
      if (!existsSync(wFile)) { err(dWhere, `${wid}.yaml が無い`); continue; }
      const w = readYaml(wFile);
      const wWhere = `ワークフロー ${dir}/${w.id}`;
      if (w.id !== wid) err(wWhere, `id はファイルの名前（${wid}）と同じにする`);
      if (!ID.test(String(w.id))) err(wWhere, 'id は英小文字・数字・ハイフンで書く');
      if (workflowIds.has(w.id)) err(wWhere, 'ワークフローの id が、ほかの部署と重複している');
      workflowIds.add(w.id);
      text(`${wWhere} label`, w.label);
      text(`${wWhere} description`, w.description, { en: false });
      if (w.timing !== undefined) text(`${wWhere} timing`, w.timing, { en: false });
      if (!FREQUENCIES[w.frequency]) err(wWhere, `frequency は ${Object.keys(FREQUENCIES).join('・')} のどれか`);
      for (const p of w.pcf ?? []) ref(wWhere, 'APQC PCF', pcf, p, used.pcf);
      for (const r of w.regulations ?? []) ref(wWhere, '制度', regulations, r, used.regulations);
      for (const i of w.industries ?? []) if (!industries.has(i)) err(wWhere, `産業分類 ${i} が無い`);
      if (!Array.isArray(w.stages) || !w.stages.length) { err(wWhere, 'stages が要る'); continue; }

      const stageIds = new Set();
      const stepIds = new Set();
      for (const stage of w.stages) {
        const sWhere = `${wWhere} 段階 ${stage.id}`;
        if (!ID.test(String(stage.id))) err(sWhere, 'id は英小文字・数字・ハイフンで書く');
        if (stageIds.has(stage.id)) err(sWhere, '段階の id が重複している');
        stageIds.add(stage.id);
        text(`${sWhere} label`, stage.label);
        for (const p of stage.pcf ?? []) ref(sWhere, 'APQC PCF', pcf, p, used.pcf);
        if (!Array.isArray(stage.steps) || !stage.steps.length) { err(sWhere, 'steps が要る'); continue; }

        for (const step of stage.steps) {
          const where = `${wWhere} 工程 ${step.id}`;
          if (!ID.test(String(step.id))) err(where, 'id は英小文字・数字・ハイフンで書く');
          if (stepIds.has(step.id)) err(where, '工程の id が、同じワークフローの中で重複している');
          stepIds.add(step.id);
          text(`${where} label`, step.label);
          text(`${where} description`, step.description, { en: false });
          if (step.doneWhen !== undefined) text(`${where} doneWhen`, step.doneWhen, { en: false });
          if (step.timing !== undefined) text(`${where} timing`, step.timing, { en: false });
          bool(`${where} requiresJudgment`, step.requiresJudgment);
          bool(`${where} irreversible`, step.irreversible);
          bool(`${where} humanRequired`, step.humanRequired);
          if (step.requiresJudgment) text(`${where} judgment`, step.judgment, { en: false });
          else if (step.judgment !== undefined) err(where, 'requiresJudgment が false なのに judgment がある');
          if (step.humanRequired) text(`${where} humanRequiredReason`, step.humanRequiredReason, { en: false });
          else if (step.humanRequiredReason !== undefined) err(where, 'humanRequired が false なのに humanRequiredReason がある');

          if (step.performedBy === undefined) err(where, 'performedBy が無い');
          else ref(where, '担い手', roles, step.performedBy, used.roles);
          if (step.confirmedBy !== undefined) {
            ref(where, '担い手', roles, step.confirmedBy, used.roles);
            if (step.confirmedBy === step.performedBy) err(where, '確かめる人が、担い手と同じ');
          }
          for (const a of step.receives ?? []) {
            ref(where, '物', artifacts, a, used.artifacts);
            if (!received.has(a)) received.set(a, where);
          }
          for (const a of step.produces ?? []) { ref(where, '物', artifacts, a, used.artifacts); produced.add(a); }
          if (!(step.receives ?? []).length && !(step.produces ?? []).length) err(where, '受け取る物も渡す物も無い');
          for (const a of step.receives ?? []) if ((step.produces ?? []).includes(a)) err(where, `物 ${a} を、受け取ってそのまま渡している（手を加えた物は別の物として書く）`);
          for (const t of step.toolKinds ?? []) ref(where, '道具の種類', toolKinds, t, used.toolKinds);
          for (const r of step.regulations ?? []) ref(where, '制度', regulations, r, used.regulations);
          for (const p of step.pcf ?? []) ref(where, 'APQC PCF', pcf, p, used.pcf);
        }
      }
      dept.workflowData.push(w);
    }
    departments.push(dept);
  }
  departments.sort((a, b) => a.order - b.order);

  // 物の流れ：受け取る物は、社外から来るか、どこかの工程が作っている
  for (const [a, where] of received) {
    const artifact = artifacts.get(a);
    if (artifact && !artifact.fromOutside && !produced.has(a)) err(where, `物 ${a} を、誰も作っていない（社外から来るなら fromOutside: true）`);
  }
  for (const a of produced) if (artifacts.get(a)?.fromOutside) err(`物 ${a}`, '社外から来る物を、社内の工程が作っている');

  // 使われていない定義は残さない
  const unused = (kind, map, usedSet) => { for (const id of map.keys()) if (!usedSet.has(id)) err(`${kind} ${id}`, 'どこからも使われていない'); };
  unused('担い手', roles, used.roles);
  unused('物', artifacts, used.artifacts);
  unused('制度', regulations, used.regulations);
  unused('道具の種類', toolKinds, used.toolKinds);
  unused('APQC PCF', pcf, used.pcf);
  if (errors.length) {
    const e = new Error(`データに誤りが ${errors.length} 件ある\n` + errors.map(m => `  - ${m}`).join('\n'));
    e.errors = errors;
    throw e;
  }
  return { departments, roles, artifacts, regulations, toolKinds, pcf, occupations, industries, FREQUENCIES, ARTIFACT_KINDS };
}
