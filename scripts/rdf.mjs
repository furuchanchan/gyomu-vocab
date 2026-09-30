// 読み込んだデータを、RDF のトリプルにする。
import N3 from 'n3';
import { aiAllocation } from './load.mjs';

const { DataFactory, Store } = N3;
const { namedNode, literal, quad } = DataFactory;

export const BASE = 'https://w3id.org/gyomu/';
export const PREFIXES = {
  gyomu: `${BASE}ns#`,
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  dcterms: 'http://purl.org/dc/terms/',
  dcat: 'http://www.w3.org/ns/dcat#',
  void: 'http://rdfs.org/ns/void#',
  'p-plan': 'http://purl.org/net/p-plan#',
};

// APQC が、PCF を複製・改変して公開するときに付けるよう求めている文
export const APQC_ATTRIBUTION = "APQC's Process Classification Framework® (PCF) is an open standard developed by APQC, a nonprofit that promotes benchmarking and best practices worldwide. The PCF is intended to facilitate organizational improvement through process management and benchmarking, regardless of industry, size, or geography. To download the full PCF or industry-specific versions of the PCF, as well as associated measures and benchmarking, please visit www.apqc.org/pcf.";
export const ESTAT_ATTRIBUTION = '職業分類と産業分類の項目は、政府統計の総合窓口(e-Stat)の統計LOD（https://data.e-stat.go.jp/lodw/）のURIを参照している。';

export const iri = {
  dataset: () => `${BASE}dataset`,
  department: id => `${BASE}id/department/${id}`,
  workflow: id => `${BASE}id/workflow/${id}`,
  stage: (workflow, id) => `${BASE}id/stage/${workflow}/${id}`,
  step: (workflow, id) => `${BASE}id/step/${workflow}/${id}`,
  role: id => `${BASE}id/role/${id}`,
  artifact: id => `${BASE}id/artifact/${id}`,
  regulation: id => `${BASE}id/regulation/${id}`,
  toolKind: id => `${BASE}id/tool-kind/${id}`,
  pcf: id => `${BASE}id/apqc-pcf/${id}`,
  law: lawId => `https://laws.e-gov.go.jp/law/${lawId}`,
};

// 57_4 → 第57条の4
export const articleLabel = article => {
  const [head, ...rest] = String(article).split('_');
  return `第${head}条${rest.map(n => `の${n}`).join('')}`;
};

export function toStore(data, { version, modified }) {
  const store = new Store();
  const ns = name => namedNode(PREFIXES.gyomu + name);
  const p = (prefix, name) => namedNode(PREFIXES[prefix] + name);
  const A = p('rdf', 'type');
  const add = (s, pred, o) => store.addQuad(quad(namedNode(s), pred, o));
  const lang = (s, pred, value) => {
    if (!value) return;
    for (const l of ['ja', 'en']) if (value[l]) add(s, pred, literal(String(value[l]).trim(), l));
  };
  const typed = (value, type) => literal(String(value), p('xsd', type));
  const link = (s, pred, target) => add(s, pred, namedNode(target));

  // データセット
  const ds = iri.dataset();
  add(ds, A, p('void', 'Dataset'));
  add(ds, A, p('dcat', 'Dataset'));
  lang(ds, p('dcterms', 'title'), { ja: '業務語彙　標準の業務のデータ', en: 'Gyomu Vocabulary: reference business workflows of companies in Japan' });
  lang(ds, p('dcterms', 'description'), {
    ja: '日本の会社に共通する業務を、部署・ワークフロー・段階・工程の4つの層で書いたデータ。工程ごとに、担い手、受け取る物と渡す物、判断の有無、関係する制度を持つ。',
    en: 'Reference business workflows of companies in Japan, described in four layers: department, workflow, stage and step.',
  });
  lang(ds, p('dcterms', 'creator'), { ja: '古野光太朗', en: 'Kotaro Furuno' });
  lang(ds, p('dcterms', 'publisher'), { ja: '株式会社TechWorker', en: 'TechWorker Inc.' });
  link(ds, p('dcterms', 'license'), 'https://creativecommons.org/licenses/by/4.0/');
  link(ds, p('dcterms', 'conformsTo'), `${BASE}ns`);
  link(ds, p('void', 'vocabulary'), PREFIXES.gyomu);
  add(ds, p('dcterms', 'hasVersion'), literal(version));
  add(ds, p('dcterms', 'modified'), typed(modified, 'date'));
  link(ds, p('dcterms', 'source'), 'https://data.e-stat.go.jp/lodw/');
  link(ds, p('dcterms', 'source'), 'https://www.apqc.org/pcf');
  add(ds, p('dcterms', 'rights'), literal(APQC_ATTRIBUTION, 'en'));
  add(ds, p('dcterms', 'rights'), literal(ESTAT_ATTRIBUTION, 'ja'));

  // 外の分類
  for (const e of data.pcf.values()) {
    const s = iri.pcf(e.id);
    add(s, A, ns('PcfElement'));
    add(s, p('dcterms', 'identifier'), literal(String(e.id)));
    add(s, p('skos', 'notation'), literal(String(e.hierarchy)));
    add(s, p('rdfs', 'label'), literal(e.name, 'en'));
    link(s, p('dcterms', 'source'), 'https://www.apqc.org/pcf');
    add(s, p('dcterms', 'isVersionOf'), literal('APQC Process Classification Framework, Cross-Industry, Version 7.4', 'en'));
  }
  const pcfLinks = (s, ids) => { for (const id of ids ?? []) link(s, ns('pcfElement'), iri.pcf(id)); };

  for (const r of data.roles.values()) {
    const s = iri.role(r.id);
    add(s, A, ns('Role'));
    lang(s, p('rdfs', 'label'), r.label);
    lang(s, p('dcterms', 'description'), r.description);
    add(s, ns('external'), typed(r.external, 'boolean'));
    if (r.occupation) link(s, ns('occupationClass'), data.occupations.get(r.occupation).uri);
    if (r.occupationCode !== undefined) add(s, ns('occupationCode'), literal(String(r.occupationCode)));
  }

  for (const a of data.artifacts.values()) {
    const s = iri.artifact(a.id);
    add(s, A, ns('Artifact'));
    lang(s, p('rdfs', 'label'), a.label);
    lang(s, p('dcterms', 'description'), a.description);
    link(s, ns('artifactKind'), PREFIXES.gyomu + data.ARTIFACT_KINDS[a.kind]);
    add(s, ns('fromOutside'), typed(a.fromOutside, 'boolean'));
    if (a.sender) link(s, ns('sender'), iri.role(a.sender));
    if (a.recipient) link(s, ns('recipient'), iri.role(a.recipient));
  }

  for (const t of data.toolKinds.values()) {
    const s = iri.toolKind(t.id);
    add(s, A, ns('ToolKind'));
    lang(s, p('rdfs', 'label'), t.label);
    lang(s, p('dcterms', 'description'), t.description);
  }

  for (const r of data.regulations.values()) {
    const s = iri.regulation(r.id);
    add(s, A, ns('Regulation'));
    lang(s, p('rdfs', 'label'), r.label);
    lang(s, ns('obligation'), r.obligation);
    lang(s, ns('deadline'), r.deadline);
    lang(s, ns('appliesTo'), r.appliesTo);
    lang(s, ns('authority'), r.authority);
    lang(s, p('skos', 'note'), r.basisNote);
    for (const b of r.legalBasis ?? []) {
      const law = iri.law(b.lawId);
      link(s, ns('legalBasis'), law);
      add(law, p('rdfs', 'label'), literal(b.law, 'ja'));
      add(law, p('dcterms', 'identifier'), literal(b.lawId));
      for (const a of b.articles) add(s, ns('legalBasisArticle'), literal(`${b.law} ${articleLabel(a.article)}`, 'ja'));
    }
    for (const g of r.officialGuidance ?? []) link(s, ns('officialGuidance'), g.url);
    add(s, ns('verifiedOn'), typed(r.verifiedOn, 'date'));
  }

  for (const d of data.departments) {
    const dIri = iri.department(d.id);
    add(dIri, A, ns('Department'));
    lang(dIri, p('rdfs', 'label'), d.label);
    lang(dIri, p('dcterms', 'description'), d.description);
    add(dIri, ns('order'), typed(d.order, 'integer'));
    pcfLinks(dIri, d.pcf);

    for (const w of d.workflowData) {
      const wIri = iri.workflow(w.id);
      link(dIri, ns('hasWorkflow'), wIri);
      add(wIri, A, ns('Workflow'));
      lang(wIri, p('rdfs', 'label'), w.label);
      lang(wIri, p('dcterms', 'description'), w.description);
      lang(wIri, ns('timing'), w.timing);
      add(wIri, ns('order'), typed(d.workflows.indexOf(w.id) + 1, 'integer'));
      link(wIri, ns('frequency'), PREFIXES.gyomu + data.FREQUENCIES[w.frequency]);
      pcfLinks(wIri, w.pcf);
      for (const r of w.regulations ?? []) link(wIri, ns('relatedRegulation'), iri.regulation(r));
      for (const i of w.industries ?? []) link(wIri, ns('industryClass'), data.industries.get(i).uri);

      let previous = null;
      w.stages.forEach((stage, si) => {
        const sIri = iri.stage(w.id, stage.id);
        link(wIri, ns('hasStage'), sIri);
        add(sIri, A, ns('Stage'));
        lang(sIri, p('rdfs', 'label'), stage.label);
        lang(sIri, p('dcterms', 'description'), stage.description);
        add(sIri, ns('order'), typed(si + 1, 'integer'));
        link(sIri, p('p-plan', 'isStepOfPlan'), wIri);
        pcfLinks(sIri, stage.pcf);

        stage.steps.forEach((step, ti) => {
          const tIri = iri.step(w.id, step.id);
          link(sIri, ns('hasStep'), tIri);
          add(tIri, A, ns('Step'));
          lang(tIri, p('rdfs', 'label'), step.label);
          lang(tIri, p('dcterms', 'description'), step.description);
          lang(tIri, ns('doneWhen'), step.doneWhen);
          lang(tIri, ns('timing'), step.timing);
          add(tIri, ns('order'), typed(ti + 1, 'integer'));
          link(tIri, p('p-plan', 'isStepOfPlan'), wIri);
          link(tIri, ns('performedBy'), iri.role(step.performedBy));
          if (step.confirmedBy) link(tIri, ns('confirmedBy'), iri.role(step.confirmedBy));
          for (const a of step.receives ?? []) link(tIri, ns('receives'), iri.artifact(a));
          for (const a of step.produces ?? []) link(tIri, ns('produces'), iri.artifact(a));
          add(tIri, ns('requiresJudgment'), typed(step.requiresJudgment, 'boolean'));
          lang(tIri, ns('judgment'), step.judgment);
          add(tIri, ns('irreversible'), typed(step.irreversible, 'boolean'));
          add(tIri, ns('humanRequired'), typed(step.humanRequired, 'boolean'));
          lang(tIri, ns('humanRequiredReason'), step.humanRequiredReason);
          link(tIri, ns('aiAllocation'), PREFIXES.gyomu + aiAllocation(step));
          for (const t of step.toolKinds ?? []) link(tIri, ns('usesToolKind'), iri.toolKind(t));
          for (const r of step.regulations ?? []) link(tIri, ns('relatedRegulation'), iri.regulation(r));
          pcfLinks(tIri, step.pcf);
          if (previous) {
            link(previous, ns('next'), tIri);
            link(tIri, p('p-plan', 'isPrecededBy'), previous);
          }
          previous = tIri;
        });
      });
    }
  }
  return store;
}
