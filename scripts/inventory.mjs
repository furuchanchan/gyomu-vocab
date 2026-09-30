// 定義済みの id の一覧を出す。ほかの部署を書くときに、そのまま使える id を知るため。 node scripts/inventory.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const list = (dir, show) => {
  console.log(`\n## ${dir}`);
  for (const file of readdirSync(join(root, dir)).filter(f => f.endsWith('.yaml')).sort()) {
    let items;
    try { items = YAML.parse(readFileSync(join(root, dir, file), 'utf8')) ?? []; } catch { console.log(`  （${file} は今は読めない）`); continue; }
    for (const item of items) console.log(`  ${item.id}  ${show(item)}  [${file}]`);
  }
};
list('roles', r => `${r.label?.ja ?? ''}${r.external ? '（社外）' : ''}`);
list('artifacts', a => `${a.label?.ja ?? ''}${a.fromOutside ? `（${a.sender} から届く）` : ''}${a.recipient ? `（${a.recipient} へ出す）` : ''}`);
list('regulations', r => r.label?.ja ?? '');
list('tool-kinds', t => t.label?.ja ?? '');
list('external/apqc-pcf', e => `${e.hierarchy} ${e.name}`);
list('external/estat-occupations', o => `${o.code} ${o.label?.ja ?? ''}`);
console.log('\n## departments');
for (const d of readdirSync(join(root, 'departments'), { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name).sort()) {
  try { const dep = YAML.parse(readFileSync(join(root, 'departments', d, 'department.yaml'), 'utf8')); console.log(`  ${d}  ${dep.label?.ja}  order=${dep.order}  workflows=${(dep.workflows ?? []).join(', ')}`); } catch { console.log(`  ${d}  （今は読めない）`); }
}
