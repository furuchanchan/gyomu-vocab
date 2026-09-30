// データのつじつまだけを確かめる（変換はしない）。 node scripts/check.mjs
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, aiAllocation } from './load.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const data = load(join(root, 'data'));
  for (const d of data.departments) {
    console.log(`${d.label.ja}`);
    for (const w of d.workflowData) {
      const steps = w.stages.flatMap(s => s.steps);
      const count = k => steps.filter(s => aiAllocation(s) === k).length;
      console.log(`  ${w.label.ja}：段階 ${w.stages.length}、工程 ${steps.length}（AIに任せられる ${count('AiCanDo')}、AIが下書き ${count('AiDraftsHumanConfirms')}、人が行う ${count('HumanOnly')}）`);
    }
  }
  console.log(`担い手 ${data.roles.size}、物 ${data.artifacts.size}、制度 ${data.regulations.size}、道具の種類 ${data.toolKinds.size}、APQC PCF ${data.pcf.size}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
