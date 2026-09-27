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

const panels = ['se-panel', 'se-settings', 'se-events', 'se-presets', 'se-api-log', 'se-sub-modal', 'se-stage-modal', 'se-prompt-viewer-modal', 'se-world-info-modal', 'se-custom-template-modal'];
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
// 预设工坊用与 renderPresets 相同的手风琴结构（details > summary + 嵌套子手风琴 + 长文本 textarea），
// 用于复现「overflow:hidden 的 flex 子项被压扁」类问题
const longText = (n) => Array.from({ length: n }, (_, i) => '这是用于验证内容区内部滚动与子项不被压缩的示例提示词长文本第' + (i + 1) + '句，足够长的中文内容会把卡片与手风琴撑到真实高度。').join('');
const pcard = (title, desc, rows, val) => '<div class="se-preset-card">' + (title ? '<div class="se-preset-title">' + title + '</div>' : '') + (desc ? '<div class="se-preset-desc">' + desc + '</div>' : '') + '<textarea rows="' + rows + '">' + val + '</textarea></div>';
const subSec = (key, title, inner) => '<details class="se-preset-sub-accordion" data-section-key="' + key + '" open><summary class="se-preset-sub-summary"><span class="se-preset-sub-chevron">▾</span>' + title + '</summary><div class="se-preset-sub-body">' + inner + '</div></details>';
const genre = (key, title, inner) => '<details class="se-preset-accordion" data-section-key="presets-' + key + '" open><summary class="se-preset-accordion-summary">' + title + '</summary><div class="se-preset-accordion-body">' + inner + '</div></details>';
const genreBody = (label) =>
  subSec('main', '大事件基础导演预设', pcard('', '', 7, longText(14))) +
  subSec('sub', '小事件流派预设（5 个细分）', [1, 2, 3, 4, 5].map(i => pcard(label + '流派 ' + i, '说明：' + label + '流派 ' + i + ' 的玩法与反噬描述。', 5, longText(8))).join('')) +
  subSec('diff', '挑战难度预设（5 档 + 自定义）', ['轻松', '标准', '困难', '噩梦', '自定义'].map(t => pcard(t, '难度「' + t + '」档提示词。', 3, longText(4))).join(''));
// 世界书弹窗用与 renderWorldInfoModal 相同的分组结构（组头 sticky 吸顶 + 折叠 body），
// 用于验证组头吸附、点组头折叠与「.se-wi-list > * flex-shrink:0」下组块不被压缩
const wiCard = (n) => '<div class="se-wi-item-card" data-wi-uid="demo-' + n + '"><div class="se-wi-item-header"><label class="se-wi-checkbox-label"><input type="checkbox" class="se-wi-checkbox"' + (n % 3 === 0 ? ' checked' : '') + '><span style="font-size:12px; font-weight:600; margin-left:6px;">注入</span></label><span class="se-wi-badge se-wi-badge-normal">普通条目</span><div class="se-wi-item-title-wrap"><input type="text" class="se-wi-item-title-input" value="示例条目 ' + n + '"></div></div><div class="se-wi-item-body"><textarea class="se-wi-item-textarea" rows="3">示例条目正文 ' + n + '：撑高度用，验证组头吸顶时卡片可从其下方滚过。</textarea></div></div>';
const wiGroup = (book, sourceClass, sourceLabel, count, open) => '<div class="se-wi-group' + (open ? '' : ' se-wi-group-collapsed') + '" data-wi-book="' + book + '"><div class="se-wi-group-header" data-action="wi-toggle-group" data-wi-book="' + book + '"><span class="se-wi-group-chevron">▾</span><span class="se-wi-group-title">' + book + '</span><span class="se-wi-group-source ' + sourceClass + '">' + sourceLabel + '</span><span class="se-wi-group-count" data-wi-group-count>已选 ' + count + '</span><span class="se-wi-group-ops"><button type="button" class="se-btn-action" data-action="wi-group-select-all" data-wi-book="' + book + '">全选</button><button type="button" class="se-btn-action" data-action="wi-group-clear" data-wi-book="' + book + '">清空</button></span></div><div class="se-wi-group-body">' + Array.from({ length: 8 }, (_, i) => wiCard(i + 1)).join('') + '</div></div>';
['se-api-log-list', 'se-event-list', 'se-sub-body', 'se-stage-modal-body'].forEach(id => {
  const el = document.getElementById(id);
  if (el && !el.children.length) { let h = ''; for (let i = 1; i <= 10; i++) h += card(i); el.innerHTML = h; }
});
const wiList = document.getElementById('se-wi-list');
if (wiList && !wiList.children.length) {
  wiList.innerHTML =
    wiGroup('海津岛（示例）', 'se-wi-source-char', '角色卡', '3/8', true) +
    wiGroup('[示例附加书 小鸟游六花]', 'se-wi-source-extra', '附加/其他', '1/8', false) +
    wiGroup('全局示例书', 'se-wi-source-global', '全局激活', '2/8', false) +
    wiGroup('自定义条目', 'se-wi-source-custom', '自定义', '1/1', false);
}
const pl = document.getElementById('se-preset-list');
if (pl && !pl.children.length) {
  pl.innerHTML =
    genre('jailbreak', '破限与防审查提示词（置顶注入与外审破限）',
      pcard('头部小说破限（雪融雪降 · 过外审预填充）', '针对 build、gcli、one-api 等严格外审渠道。在对话最前端以 User 身份预填充万字纯文学小说样本，由 Assistant 虚假确认承接，使模型在首轮审查时误判为文学品读分析，彻底瓦解拒答与道德过滤。', 8, longText(12)) +
      pcard('系统级破限与创作准则（Dramatron 深度缝合版）', '源自 Kemini Dramatron 特化破限与私密沙盒豁免架构，深度缝合不媚 USER 去主角化、防机械化生活对白、防全知有限视角。', 12, longText(16))) +
    genre('combat', '战斗预设（大事件导演 / 小事件流派 / 难度 / 死线）', genreBody('战斗') +
      subSec('death', '死亡危险死线提示词（极高死亡危险模式注入）', pcard('', '开启「极高死亡危险模式」时注入的死线与因果判定准则。', 5, longText(8)))) +
    genre('reasoning', '推理预设（大事件导演 / 小事件流派 / 难度）', genreBody('推理')) +
    genre('romance', '恋爱预设（大事件导演 / 小事件流派 / 浓度）', genreBody('恋爱')) +
    genre('random', '随机事件预设（大事件导演）', subSec('main', '大事件基础导演预设', pcard('', '', 7, longText(14))));
}
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
// 预览页模拟世界书组头折叠交互（真实实现见 index.js 的 wi-toggle-group / wi-group-* 委托）
document.getElementById('st-direct-event-root').addEventListener('click', e => {
  const header = e.target.closest('.se-wi-group-header');
  if (!header) return;
  if (e.target.closest('[data-action="wi-group-select-all"], [data-action="wi-group-clear"]')) return;
  header.closest('.se-wi-group').classList.toggle('se-wi-group-collapsed');
});
show('se-settings');
</script></body></html>`;

fs.writeFileSync(path.join(__dirname, 'layout-preview.html'), html);
console.log('written:', path.join(__dirname, 'layout-preview.html'));
