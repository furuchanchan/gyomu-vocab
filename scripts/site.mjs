// URIごとのページ（HTML）と、URIごとの Turtle・JSON-LD を出す。
// ページどうしのリンクは相対パスで書く（どの場所に置いても動くように）。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { aiAllocation } from './load.mjs';
import { iri, BASE, PREFIXES, articleLabel, APQC_ATTRIBUTION } from './rdf.mjs';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const AI = {
  AiCanDo: { ja: 'AIに任せられる', why: '判断がなく、取り消せる操作だけで、人が行う必要もないため。' },
  AiDraftsHumanConfirms: { ja: 'AIが下書きし、人が確かめる', why: '' },
  HumanOnly: { ja: '人が行う', why: '' },
};
const FREQ = { 'on-demand': '都度', daily: '毎日', weekly: '毎週', monthly: '毎月', quarterly: '四半期ごと', yearly: '毎年' };
const KIND = { form: '帳票', data: 'データ', document: '文書', message: '連絡' };

const CSS = `
:root { --fg: #111; --sub: #555; --bg: #fff; --line: #ddd; --soft: #f5f5f5; }
@media (prefers-color-scheme: dark) { :root { --fg: #eee; --sub: #aaa; --bg: #111; --line: #333; --soft: #1c1c1c; } }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif; line-height: 1.8; font-size: 16px; }
a { color: inherit; text-underline-offset: 3px; }
header.site, main, footer.site { max-width: 820px; margin: 0 auto; padding: 0 20px; }
header.site { padding-top: 20px; font-size: 14px; color: var(--sub); }
header.site a { text-decoration: none; margin-right: 12px; }
header.site .name { color: var(--fg); font-weight: 700; margin-right: 12px; }
nav.crumb { margin-top: 28px; font-size: 14px; color: var(--sub); }
h1 { font-size: 30px; line-height: 1.4; margin: 6px 0 0; }
.en { color: var(--sub); font-size: 15px; margin: 2px 0 0; }
.lead { margin: 20px 0 0; }
h2 { font-size: 19px; margin: 44px 0 8px; }
h3 { font-size: 16px; margin: 28px 0 6px; }
p { margin: 8px 0; }
ul, ol { margin: 8px 0; padding-left: 1.4em; }
li { margin: 4px 0; }
.tag { display: inline-block; border: 1px solid var(--line); border-radius: 999px; padding: 0 10px; font-size: 13px; line-height: 1.9; color: var(--sub); white-space: nowrap; }
ol.steps { list-style: none; padding: 0; margin: 8px 0 0; border-top: 1px solid var(--line); }
ol.steps li { display: grid; grid-template-columns: 2.2em 1fr; align-items: baseline; padding: 12px 0; margin: 0; border-bottom: 1px solid var(--line); }
ol.steps .no { color: var(--sub); font-variant-numeric: tabular-nums; }
ol.steps .row { display: flex; flex-wrap: wrap; gap: 2px 14px; align-items: baseline; justify-content: space-between; }
ol.steps .what { font-weight: 600; }
ol.steps .meta { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
ol.steps .who { color: var(--sub); font-size: 14px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; margin-top: 12px; padding: 0; list-style: none; }
.cards li { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin: 0; }
.cards a { font-weight: 700; text-decoration: none; }
.cards small { display: block; color: var(--sub); font-size: 13px; line-height: 1.6; margin-top: 4px; }
.data { margin-top: 56px; padding: 16px 18px; background: var(--soft); border-radius: 10px; font-size: 14px; overflow-wrap: anywhere; }
.data p { margin: 2px 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
table { border-collapse: collapse; width: 100%; font-size: 14px; margin-top: 8px; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px 8px 0; border-bottom: 1px solid var(--line); }
th { color: var(--sub); font-weight: 400; white-space: nowrap; }
footer.site { margin-top: 72px; padding-top: 20px; padding-bottom: 48px; border-top: 1px solid var(--line); font-size: 13px; color: var(--sub); }
@media (max-width: 600px) { h1 { font-size: 24px; } body { font-size: 15px; } }
`;

export async function writeSite({ data, store, vocab, outDir, serialize, toJsonLd, version }) {
  let pages = 0;
  const pathOf = uri => (uri === `${BASE}ns` ? 'ns' : uri.startsWith(BASE) ? uri.slice(BASE.length) : null);
  const href = (from, uri) => {
    const to = pathOf(uri);
    if (to === null) return uri;
    return (relative(from, to) || '.') + '/';
  };
  const write = (path, body) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };

  const page = ({ path, title, en, crumb = [], lead, body, uri }) => {
    const root = relative(path, '') || '.';
    const link = (u, text) => `<a href="${esc(href(path, u))}">${esc(text)}</a>`;
    const name = path.split('/').pop();
    const alt = uri && path !== 'ns' ? `
<link rel="alternate" type="text/turtle" href="../${esc(name)}.ttl">
<link rel="alternate" type="application/ld+json" href="../${esc(name)}.jsonld">` : '';
    const dataBox = uri ? `
<section class="data">
<p>URI　<code>${esc(uri)}</code></p>
${path === 'ns' ? `<p>データ　<a href="${root}/gyomu-vocab.ttl">Turtle</a>　<a href="${root}/context.jsonld">JSON-LD の文脈</a>　<a href="${root}/gyomu-shapes.ttl">SHACL</a></p>` : `<p>データ　<a href="../${esc(name)}.ttl">Turtle</a>　<a href="../${esc(name)}.jsonld">JSON-LD</a></p>`}
</section>` : '';
    const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}｜業務語彙</title>${alt}
<style>${CSS}</style>
</head>
<body>
<header class="site"><a class="name" href="${root}/">業務語彙</a><a href="${root}/ns/">語彙の定義</a><a href="https://github.com/furuchanchan/gyomu-vocab">GitHub</a></header>
<main>
${crumb.length ? `<nav class="crumb">${crumb.map(([u, t]) => link(u, t)).join(' › ')}</nav>` : '<nav class="crumb"></nav>'}
<h1>${esc(title)}</h1>
${en ? `<p class="en" lang="en">${esc(en)}</p>` : ''}
${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
${body(link)}
${dataBox}
</main>
<footer class="site">
<p>業務語彙 ${esc(version)}　データは <a href="https://creativecommons.org/licenses/by/4.0/deed.ja">CC BY 4.0</a> で公開。元のデータと直し方は <a href="https://github.com/furuchanchan/gyomu-vocab">GitHub</a>。作った人：古野光太朗（株式会社TechWorker）。</p>
<p>職業分類と産業分類は、政府統計の総合窓口(e-Stat)の統計LODのURIを参照。制度の根拠は、e-Gov 法令検索と役所のページに照らして確かめている。</p>
<p lang="en">${esc(APQC_ATTRIBUTION)}</p>
</footer>
</body>
</html>
`;
    write(join(outDir, path, 'index.html'), html);
    pages++;
  };

  // URIごとの Turtle と JSON-LD
  const entityFiles = async uri => {
    const path = pathOf(uri);
    const quads = store.getQuads(uri);
    write(join(outDir, `${path}.ttl`), await serialize(quads, 'Turtle'));
    write(join(outDir, `${path}.jsonld`), JSON.stringify(await toJsonLd(quads), null, 2) + '\n');
  };

  // 逆引きの索引
  const all = [];
  for (const d of data.departments) for (const w of d.workflowData) w.stages.forEach((stage, si) => stage.steps.forEach((step, ti) => all.push({ d, w, stage, si, step, ti })));
  all.forEach((x, i) => { x.no = all.filter(y => y.w === x.w).indexOf(x) + 1; x.prev = all[i - 1]?.w === x.w ? all[i - 1] : null; x.next = all[i + 1]?.w === x.w ? all[i + 1] : null; });
  const stepUri = x => iri.step(x.w.id, x.step.id);
  const stepName = x => `${x.w.label.ja}：${x.step.label.ja}`;
  const list = items => (items.length ? `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>` : '<p>なし</p>');
  const pcfLine = (link, ids) => (ids ?? []).map(id => { const e = data.pcf.get(String(id)); return `${link(iri.pcf(e.id), `${e.hierarchy} ${e.name}`)}`; });

  // 入口
  page({
    path: '',
    title: '業務語彙',
    en: 'Gyomu Vocabulary',
    lead: '日本の会社の業務を、部署・ワークフロー・段階・工程の4つの層で書いた、開かれたデータ。工程ごとに、担い手、受け取る物と渡す物、判断の有無、取り消せない操作かどうか、関係する制度を持つ。AIに業務を渡す前の、共通の言葉として使える。',
    uri: null,
    body: link => `
<h2>部署</h2>
${data.departments.map(d => `
<h3>${link(iri.department(d.id), d.label.ja)}</h3>
<ul class="cards">${d.workflowData.map(w => `<li>${link(iri.workflow(w.id), w.label.ja)}<small>${esc(FREQ[w.frequency])}　工程 ${w.stages.flatMap(s => s.steps).length}</small></li>`).join('')}</ul>`).join('')}
<h2>数</h2>
<table>
<tr><th>部署</th><td>${data.departments.length}</td></tr>
<tr><th>ワークフロー</th><td>${data.departments.flatMap(d => d.workflowData).length}</td></tr>
<tr><th>工程</th><td>${all.length}</td></tr>
<tr><th>担い手</th><td>${data.roles.size}</td></tr>
<tr><th>物</th><td>${data.artifacts.size}</td></tr>
<tr><th>制度</th><td>${data.regulations.size}</td></tr>
<tr><th>トリプル</th><td>${store.size}</td></tr>
</table>
<h2>制度</h2>
${list([...data.regulations.values()].map(r => link(iri.regulation(r.id), r.label.ja)))}
<h2>まとめてダウンロード</h2>
<ul>
<li><a href="gyomu-data.ttl">Turtle</a>　<a href="gyomu-data.jsonld">JSON-LD</a>　<a href="gyomu-data.nt">N-Triples</a></li>
<li>語彙の定義　<a href="gyomu-vocab.ttl">Turtle</a>　<a href="gyomu-shapes.ttl">SHACL</a>　<a href="context.jsonld">JSON-LD の文脈</a></li>
</ul>
<h2>つなげている外のデータ</h2>
<ul>
<li>担い手 → 日本標準職業分類（e-Stat 統計LOD の URI）</li>
<li>制度 → 法令（e-Gov 法令検索）、役所の説明のページ</li>
<li>ワークフロー → APQC Process Classification Framework の要素</li>
<li>語彙 → P-Plan、W3C ORG、schema.org</li>
</ul>`,
  });

  for (const d of data.departments) {
    page({
      path: pathOf(iri.department(d.id)), uri: iri.department(d.id), title: d.label.ja, en: d.label.en, lead: d.description.ja,
      crumb: [[BASE, '業務語彙']],
      body: link => `
<h2>ワークフロー</h2>
<ul class="cards">${d.workflowData.map(w => `<li>${link(iri.workflow(w.id), w.label.ja)}<small>${esc(w.description.ja)}</small></li>`).join('')}</ul>
${(d.pcf ?? []).length ? `<h2>近い APQC PCF の要素</h2>${list(pcfLine(link, d.pcf))}` : ''}`,
    });
    await entityFiles(iri.department(d.id));

    for (const w of d.workflowData) {
      const mine = all.filter(x => x.w === w);
      page({
        path: pathOf(iri.workflow(w.id)), uri: iri.workflow(w.id), title: w.label.ja, en: w.label.en, lead: w.description.ja,
        crumb: [[BASE, '業務語彙'], [iri.department(d.id), d.label.ja]],
        body: link => `
<p><span class="tag">${esc(FREQ[w.frequency])}</span>${w.timing ? `　${esc(w.timing.ja)}` : ''}</p>
${w.stages.map((stage, si) => `
<h2>${si + 1}　${esc(stage.label.ja)}</h2>
<ol class="steps">${mine.filter(x => x.stage === stage).map(x => `<li><span class="no">${x.no}</span><span class="row"><span class="what">${link(stepUri(x), x.step.label.ja)}</span><span class="meta"><span class="who">${esc(data.roles.get(x.step.performedBy).label.ja)}</span><span class="tag">${esc(AI[aiAllocation(x.step)].ja)}</span></span></span></li>`).join('')}</ol>`).join('')}
${(w.regulations ?? []).length ? `<h2>関係する制度</h2>${list(w.regulations.map(r => link(iri.regulation(r), data.regulations.get(r).label.ja)))}` : ''}
${(w.pcf ?? []).length ? `<h2>近い APQC PCF の要素</h2>${list(pcfLine(link, w.pcf))}` : ''}`,
      });
      await entityFiles(iri.workflow(w.id));

      for (const [si, stage] of w.stages.entries()) {
        const sUri = iri.stage(w.id, stage.id);
        page({
          path: pathOf(sUri), uri: sUri, title: stage.label.ja, en: stage.label.en, lead: stage.description?.ja,
          crumb: [[BASE, '業務語彙'], [iri.department(d.id), d.label.ja], [iri.workflow(w.id), w.label.ja]],
          body: link => `
<p><span class="tag">段階 ${si + 1}</span></p>
<h2>工程</h2>
<ol class="steps">${mine.filter(x => x.stage === stage).map(x => `<li><span class="no">${x.no}</span><span class="row"><span class="what">${link(stepUri(x), x.step.label.ja)}</span><span class="meta"><span class="who">${esc(data.roles.get(x.step.performedBy).label.ja)}</span><span class="tag">${esc(AI[aiAllocation(x.step)].ja)}</span></span></span></li>`).join('')}</ol>
${(stage.pcf ?? []).length ? `<h2>近い APQC PCF の要素</h2>${list(pcfLine(link, stage.pcf))}` : ''}`,
        });
        await entityFiles(sUri);
      }

      for (const x of mine) {
        const s = x.step;
        const kind = aiAllocation(s);
        const why = kind === 'HumanOnly' ? s.humanRequiredReason.ja
          : kind === 'AiDraftsHumanConfirms' ? [s.requiresJudgment && '判断がある', s.irreversible && '取り消せない操作を含む'].filter(Boolean).join('。') + 'ため。'
          : AI.AiCanDo.why;
        const artifact = (link, id) => {
          const a = data.artifacts.get(id);
          const side = a.sender ? `（${data.roles.get(a.sender).label.ja}から届く）` : a.recipient ? `（${data.roles.get(a.recipient).label.ja}へ出す）` : '';
          return `${link(iri.artifact(id), a.label.ja)}　<span class="tag">${esc(KIND[a.kind])}</span>${esc(side)}`;
        };
        page({
          path: pathOf(stepUri(x)), uri: stepUri(x), title: s.label.ja, en: s.label.en, lead: s.description.ja,
          crumb: [[BASE, '業務語彙'], [iri.department(d.id), d.label.ja], [iri.workflow(w.id), w.label.ja], [iri.stage(w.id, x.stage.id), x.stage.label.ja]],
          body: link => `
<p><span class="tag">工程 ${x.no}</span></p>
<h2>担い手</h2>
<ul><li>${link(iri.role(s.performedBy), data.roles.get(s.performedBy).label.ja)}</li>${s.confirmedBy ? `<li>確かめる人　${link(iri.role(s.confirmedBy), data.roles.get(s.confirmedBy).label.ja)}</li>` : ''}</ul>
<h2>受け取る物</h2>
${list((s.receives ?? []).map(a => artifact(link, a)))}
<h2>渡す物</h2>
${list((s.produces ?? []).map(a => artifact(link, a)))}
${s.doneWhen ? `<h2>できあがりの条件</h2><p>${esc(s.doneWhen.ja)}</p>` : ''}
<h2>判断</h2>
<p>${s.requiresJudgment ? `ある。${esc(s.judgment.ja)}` : 'ない。決まった手順で結果が決まる。'}</p>
<h2>取り消せない操作</h2>
<p>${s.irreversible ? '含む。行ったあとで、自社だけでは元に戻せない。' : '含まない。'}</p>
<h2>AIとの分担の目安</h2>
<p><span class="tag">${esc(AI[kind].ja)}</span>　${esc(why)}</p>
${(s.toolKinds ?? []).length ? `<h2>使う道具の種類</h2>${list(s.toolKinds.map(t => link(iri.toolKind(t), data.toolKinds.get(t).label.ja)))}` : ''}
${(s.regulations ?? []).length ? `<h2>関係する制度</h2>${list(s.regulations.map(r => link(iri.regulation(r), data.regulations.get(r).label.ja)))}` : ''}
${(s.pcf ?? []).length ? `<h2>近い APQC PCF の要素</h2>${list(pcfLine(link, s.pcf))}` : ''}
<h2>前後の工程</h2>
<ul>
<li>前　${x.prev ? link(stepUri(x.prev), `${x.prev.no} ${x.prev.step.label.ja}`) : 'なし（最初の工程）'}</li>
<li>次　${x.next ? link(stepUri(x.next), `${x.next.no} ${x.next.step.label.ja}`) : 'なし（最後の工程）'}</li>
</ul>`,
        });
        await entityFiles(stepUri(x));
      }
    }
  }

  for (const r of data.roles.values()) {
    const performs = all.filter(x => x.step.performedBy === r.id);
    const confirms = all.filter(x => x.step.confirmedBy === r.id);
    const sends = [...data.artifacts.values()].filter(a => a.sender === r.id);
    const gets = [...data.artifacts.values()].filter(a => a.recipient === r.id);
    const occ = r.occupation ? data.occupations.get(r.occupation) : null;
    page({
      path: pathOf(iri.role(r.id)), uri: iri.role(r.id), title: r.label.ja, en: r.label.en, lead: r.description.ja,
      crumb: [[BASE, '業務語彙']],
      body: link => `
<p><span class="tag">担い手</span>　<span class="tag">${r.external ? '社外' : '社内'}</span></p>
${occ ? `<h2>職業分類</h2><ul><li><a href="${esc(occ.uri)}">${esc(occ.code)} ${esc(occ.label.ja)}</a>（日本標準職業分類の大分類、e-Stat 統計LOD）</li>${r.occupationCode !== undefined ? `<li>中分類・小分類のコード　${esc(r.occupationCode)}</li>` : ''}</ul>` : ''}
${performs.length ? `<h2>行う工程</h2>${list(performs.map(x => link(stepUri(x), stepName(x))))}` : ''}
${confirms.length ? `<h2>確かめる工程</h2>${list(confirms.map(x => link(stepUri(x), stepName(x))))}` : ''}
${sends.length ? `<h2>会社に届ける物</h2>${list(sends.map(a => link(iri.artifact(a.id), a.label.ja)))}` : ''}
${gets.length ? `<h2>会社から受け取る物</h2>${list(gets.map(a => link(iri.artifact(a.id), a.label.ja)))}` : ''}`,
    });
    await entityFiles(iri.role(r.id));
  }

  for (const a of data.artifacts.values()) {
    const makers = all.filter(x => (x.step.produces ?? []).includes(a.id));
    const takers = all.filter(x => (x.step.receives ?? []).includes(a.id));
    page({
      path: pathOf(iri.artifact(a.id)), uri: iri.artifact(a.id), title: a.label.ja, en: a.label.en, lead: a.description?.ja,
      crumb: [[BASE, '業務語彙']],
      body: link => `
<p><span class="tag">物</span>　<span class="tag">${esc(KIND[a.kind])}</span></p>
<h2>作る工程</h2>
${a.sender ? `<p>社外から届く。送り手は ${link(iri.role(a.sender), data.roles.get(a.sender).label.ja)}。</p>` : list(makers.map(x => link(stepUri(x), stepName(x))))}
<h2>受け取る工程</h2>
${list(takers.map(x => link(stepUri(x), stepName(x))))}
${a.recipient ? `<h2>社外の宛先</h2><p>${link(iri.role(a.recipient), data.roles.get(a.recipient).label.ja)}</p>` : ''}`,
    });
    await entityFiles(iri.artifact(a.id));
  }

  for (const r of data.regulations.values()) {
    const steps = all.filter(x => (x.step.regulations ?? []).includes(r.id));
    const flows = data.departments.flatMap(d => d.workflowData).filter(w => (w.regulations ?? []).includes(r.id));
    page({
      path: pathOf(iri.regulation(r.id)), uri: iri.regulation(r.id), title: r.label.ja, en: r.label.en,
      crumb: [[BASE, '業務語彙']],
      body: link => `
<p><span class="tag">制度</span></p>
<h2>会社がやること</h2>
<p>${esc(r.obligation.ja)}</p>
${r.deadline ? `<h2>期限</h2><p>${esc(r.deadline.ja)}</p>` : ''}
${r.appliesTo ? `<h2>対象になる会社</h2><p>${esc(r.appliesTo.ja)}</p>` : ''}
<h2>所管</h2>
<p>${esc(r.authority.ja)}</p>
<h2>根拠</h2>
${r.basisNote ? `<p>${esc(r.basisNote.ja)}</p>` : ''}
${list([
  ...(r.legalBasis ?? []).map(b => `<a href="${esc(iri.law(b.lawId))}">${esc(b.law)}</a>　${b.articles.map(a => esc(articleLabel(a))).join('、')}`),
  ...(r.officialGuidance ?? []).map(g => `<a href="${esc(g.url)}">${esc(g.url)}</a>`),
])}
<p>根拠の条と、役所のページに照らして確かめた日　${esc(r.verifiedOn)}</p>
${flows.length ? `<h2>関係するワークフロー</h2>${list(flows.map(w => link(iri.workflow(w.id), w.label.ja)))}` : ''}
${steps.length ? `<h2>関係する工程</h2>${list(steps.map(x => link(stepUri(x), stepName(x))))}` : ''}`,
    });
    await entityFiles(iri.regulation(r.id));
  }

  for (const t of data.toolKinds.values()) {
    const steps = all.filter(x => (x.step.toolKinds ?? []).includes(t.id));
    page({
      path: pathOf(iri.toolKind(t.id)), uri: iri.toolKind(t.id), title: t.label.ja, en: t.label.en, lead: t.description?.ja,
      crumb: [[BASE, '業務語彙']],
      body: link => `
<p><span class="tag">道具の種類</span></p>
<h2>使う工程</h2>
${list(steps.map(x => link(stepUri(x), stepName(x))))}`,
    });
    await entityFiles(iri.toolKind(t.id));
  }

  for (const e of data.pcf.values()) {
    const id = String(e.id);
    const has = ids => (ids ?? []).map(String).includes(id);
    const flows = data.departments.flatMap(d => d.workflowData).filter(w => has(w.pcf) || w.stages.some(s => has(s.pcf)));
    const depts = data.departments.filter(d => has(d.pcf));
    page({
      path: pathOf(iri.pcf(id)), uri: iri.pcf(id), title: `${e.hierarchy} ${e.name}`,
      crumb: [[BASE, '業務語彙']],
      body: link => `
<p><span class="tag">APQC PCF の要素</span>　<span class="tag">要素の番号 ${esc(id)}</span></p>
<p>APQC Process Classification Framework, Cross-Industry, Version 7.4 の要素。名前は APQC の表記のまま。</p>
${depts.length ? `<h2>近い部署</h2>${list(depts.map(d => link(iri.department(d.id), d.label.ja)))}` : ''}
${flows.length ? `<h2>近いワークフロー</h2>${list(flows.map(w => link(iri.workflow(w.id), w.label.ja)))}` : ''}`,
    });
    await entityFiles(iri.pcf(id));
  }

  // 語彙の定義のページ
  const NS = PREFIXES.gyomu;
  const lit = (s, p, lang) => vocab.getQuads(s, p, null).find(q => q.object.language === lang)?.object.value;
  const terms = [...new Set(vocab.getQuads(null, PREFIXES.rdfs + 'isDefinedBy', null).map(q => q.subject.value))].filter(u => u.startsWith(NS));
  const typeOf = u => vocab.getQuads(u, PREFIXES.rdf + 'type', null).map(q => q.object.value);
  const OWL = 'http://www.w3.org/2002/07/owl#';
  const row = u => `<tr id="${esc(u.slice(NS.length))}"><td><code>gyomu:${esc(u.slice(NS.length))}</code></td><td>${esc(lit(u, PREFIXES.rdfs + 'label', 'ja') ?? lit(u, PREFIXES.skos + 'prefLabel', 'ja'))}</td><td>${esc(lit(u, PREFIXES.rdfs + 'comment', 'ja') ?? lit(u, PREFIXES.skos + 'definition', 'ja') ?? '')}</td></tr>`;
  const table = (title, filter) => { const rows = terms.filter(filter); return rows.length ? `<h2>${title}</h2><table><tr><th>名前</th><th>日本語</th><th>説明</th></tr>${rows.map(row).join('')}</table>` : ''; };
  page({
    path: 'ns', uri: `${BASE}ns`, title: '語彙の定義', en: 'Gyomu Vocabulary',
    lead: '業務を書くための、クラスと性質の一覧。名前空間は https://w3id.org/gyomu/ns# 。',
    crumb: [[BASE, '業務語彙']],
    body: () => `
${table('クラス', u => typeOf(u).includes(OWL + 'Class'))}
${table('つながりを表す性質', u => typeOf(u).includes(OWL + 'ObjectProperty'))}
${table('値を持つ性質', u => typeOf(u).includes(OWL + 'DatatypeProperty'))}
${table('決まった値', u => typeOf(u).some(t => t.startsWith(NS)))}
<h2>そろえている外の語彙</h2>
<ul>
<li>P-Plan：ワークフローは p-plan:Plan、段階は p-plan:MultiStep、工程は p-plan:Step、物は p-plan:Variable の下位</li>
<li>W3C ORG：担い手は org:Role の下位</li>
<li>schema.org：ワークフローは schema:HowTo、段階は schema:HowToSection、工程は schema:HowToStep に近い</li>
</ul>`,
  });

  return pages;
}
