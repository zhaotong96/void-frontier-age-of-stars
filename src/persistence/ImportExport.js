/**
 * persistence/ImportExport.js — 存档文件导入导出（任务书 8.3）
 * 文件下载/选择均走浏览器标准 API；导入文本一律视为不可信输入。
 */

import { exportSaveText } from './SaveCodec.js';

/** 导出存档为 JSON 文件下载 */
export function downloadSave(record, filename) {
  const text = exportSaveText(record);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `void-frontier-save-${record.worldTick}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 打开文件选择器并读取文本（返回 Promise<string>） */
export function pickSaveFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) {
        reject(new Error('未选择文件'));
        return;
      }
      if (file.size > 24 * 1024 * 1024) {
        reject(new Error('文件超出大小上限'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('读取失败'));
      reader.readAsText(file);
    };
    input.click();
  });
}
