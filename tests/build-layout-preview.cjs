// 生成 tests/layout-preview.html：抽取 mountUI 的全部面板模板，
// 用于在浏览器中验证「外框固定（标题/底部按钮）+ 内容区内滚」布局（无需启动 SillyTavern）。
// 用法：node tests/build-layout-preview.cjs
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

const marker = 'root.innerHTML = `';
const start = src.indexOf(marker) + marker.length;
const end = src.indexOf('`;', start);
if (start < marker.length || end < 0) throw new Error('未找到 mountUI 模板');
let markup = src.slice(start, end).replace(/\$\{[^}]*\}/g, '');

const panels = ['se-panel', 'se-settings', 'se-events', 'se-presets', 'se-api-log', 'se-sub-modal', 'se-stage-modal', 'se-prompt-viewer-modal', 'se-world-info-modal'];
const bar = panels.map((p, i) => `<button data-show="${p}" ${i === 1 ? 'class="on"' : ''}>${p.replace(/^se-/, '').replace(/-modal$/, '')}</button>`).join('');

const html = `<!doctype html><html lang="zh"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>二级弹窗布局预览（外框固定+内容内滚）</title>
<link rel="stylesheet" href="../style.css">
<style>
body{background:#e9e9e4;margin:0}
*{box-sizing:border-box}
button{font:inherit}
.se-preview-bar{position:fixed;top:6px;left:6px;z-index:99999;display:flex;gap:4px;flex-wrap:wrap;max-width:80vw;background:#fff;border:1px solid #ccc;border-radius:8px;padding:6px;box-shadow:0 2px 8px rgba(0,0,0,.15)}
.se-preview-bar button{padding:4px 8px;font-size:12px;cursor:pointer;border:1px solid #ccc;background:#fff;border-radius:6px}
.se-preview-bar button.on{background:#333;color:#fff;border-color:#333}
</style></head><body>
<div class="se-preview-bar">${bar}</div>
<div id="st-direct-event-root" data-theme="cream">${markup}</div>
<script>
// 动态容器注入示例内容，验证内滚
const card = (n) => '<div class="se-preset-card"><div class="se-preset-title">示例条目 ' + n + '</div><div class="se-preset-desc">说明文字：撑高度用，验证内容区内部滚动、顶栏与底栏保持固定。</div><textarea rows="3">示例内容 ' + n + '</textarea></div>';
['se-preset-list','se-api-log-list','se-event-list','se-sub-body','se-stage-modal-body','se-wi-list'].forEach(id => {
  const el = document.getElementById(id);
  if (el && !el.children.length) { let h = ''; for (let i = 1; i <= 10; i++) h += card(i); el.innerHTML = h; }
});
const pv = document.getElementById('se-prompt-viewer-body');
if (pv && !pv.children.length) {
  let h = '<div class="se-pv-stats-row"><div class="se-pv-stats-left"><span class="se-pv-token-counter">12,345</span><span class="se-pv-msg-counter">示例统计行（固定验证）</span></div></div>';
  for (let i = 1; i <= 10; i++) h += '<div class="se-preset-card"><div class="se-preset-title">消息块 ' + i + '</div><div class="se-preset-desc">说明文字：撑高度用。</div></div>';
  pv.innerHTML = h;
}
const PANELS = ${JSON.stringify(panels)};
function show(id) {
  PANELS.forEach(p => { const el = document.getElementById(p); if (el) el.style.display = (p === id) ? 'flex' : 'none'; });
  document.querySelectorAll('[data-show]').forEach(b => b.classList.toggle('on', b.dataset.show === id));
}
document.querySelector('.se-preview-bar').addEventListener('click', e => { const b = e.target.closest('[data-show]'); if (b) show(b.dataset.show); });
show('se-settings');
</script></body></html>`;

fs.writeFileSync(path.join(__dirname, 'layout-preview.html'), html);
console.log('written:', path.join(__dirname, 'layout-preview.html'));
