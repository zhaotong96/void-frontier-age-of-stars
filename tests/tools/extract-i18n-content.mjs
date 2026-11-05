/**
 * tests/tools/extract-i18n-content.mjs — 深度叙事文本国际化词条抽取（doc5 TD4）
 *
 * 扫描 src/content/events.js（EVENT_DEFS：titleZh/bodyZh + choices[].labelZh/hintZh）
 * 与 src/content/anomalies.js（ANOMALY_TEMPLATES：nameZh/descZh/risks[]）中的中文文案，
 * 按稳定键位合并为双语词典键位映射，输出
 * src/content/localization/events-content.json（目录不存在则创建）。
 *
 * 键位约定（扁平点键，与 content/localization/zh-CN.js / en-US.js 同风格）：
 *   evt.<eventId>.title | evt.<eventId>.body
 *   evt.<eventId>.choice.<choiceId>.label | .hint
 *   ano.<anomalyId>.name | .desc | .risk.<index>
 *
 * 输出确定性：无时间戳、无随机；键序 = 内容源数组顺序（插入序）。
 * 运行时零改动：本脚本只生成翻译记忆（供 en-US 词典补全与校对），
 * 不重写 EventsView / narrative 的取词路径 —— 后续接入点为
 * content/localization/index.js 的 registerDict 合并本文件 keys
 * （键位已与词典风格一致），以及在 EventsView 渲染处以 L(key) 取词。
 *
 * 用法：node tests/tools/extract-i18n-content.mjs [--stdout]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT_DEFS } from '../../src/content/events.js';
import { ANOMALY_TEMPLATES } from '../../src/content/anomalies.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'src', 'content', 'localization', 'events-content.json');

/** 抽取全部内容键位 → 中文文案（键序 = 源数组顺序，确定性） */
export function extractContentI18n() {
  const keys = {};
  let eventCount = 0;
  let anomalyCount = 0;

  for (const ev of EVENT_DEFS) {
    eventCount += 1;
    if (typeof ev.titleZh === 'string') keys[`evt.${ev.id}.title`] = ev.titleZh;
    if (typeof ev.bodyZh === 'string') keys[`evt.${ev.id}.body`] = ev.bodyZh;
    for (const ch of ev.choices || []) {
      if (typeof ch.labelZh === 'string') keys[`evt.${ev.id}.choice.${ch.id}.label`] = ch.labelZh;
      if (typeof ch.hintZh === 'string') keys[`evt.${ev.id}.choice.${ch.id}.hint`] = ch.hintZh;
    }
  }

  for (const ano of ANOMALY_TEMPLATES) {
    anomalyCount += 1;
    if (typeof ano.nameZh === 'string') keys[`ano.${ano.id}.name`] = ano.nameZh;
    if (typeof ano.descZh === 'string') keys[`ano.${ano.id}.desc`] = ano.descZh;
    (ano.risks || []).forEach((risk, i) => {
      keys[`ano.${ano.id}.risk.${i}`] = String(risk);
    });
  }

  return {
    generatedBy: 'tests/tools/extract-i18n-content.mjs',
    sourceFiles: ['src/content/events.js', 'src/content/anomalies.js'],
    counts: { events: eventCount, anomalies: anomalyCount, keys: Object.keys(keys).length },
    keys,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const doc = extractContentI18n();
  if (process.argv.includes('--stdout')) {
    console.log(JSON.stringify(doc, null, 2));
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    console.log(`词条抽取完成：${doc.counts.events} 事件 / ${doc.counts.anomalies} 异常 / ${doc.counts.keys} 键位 → ${OUT}`);
  }
}
