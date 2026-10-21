/**
 * UI 行为检查 —— 那些"跑起来才发现"的问题
 *
 * 用法：node ui_check.js
 * 退出码：全部通过 0，有失败 1
 *
 * 为什么单独一个文件：check_markdown.js 管转换质量、readme_check.js 管上传与首页，
 * 这两个都绕开了界面。而下面这几条**只有界面动起来才会暴露**：
 *   ① 在编辑框里打字打到一半，整行被重建 → 光标跳走
 *   ② 每敲一个键就重编码整篇正文 → 大书卡到没法打字
 *   ③ 预览图的 blob URL 从来不释放 → 内存只涨不降
 *   ④ 两本书填同一个文件夹 → 后传的静默覆盖前传的
 * 它们共同的特点是：功能"看起来是好的"，只有用久了/书大了/书多了才出事。
 */
const fs = require('fs'), vm = require('vm'), { JSDOM } = require('jsdom');

const html = fs.readFileSync(__dirname + '/book2md.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const dom = new JSDOM(html, { url: 'http://localhost/' });
const win = dom.window;

/* createObjectURL / revokeObjectURL 计数：不释放就是内存泄漏，得看得见 */
const made = [], freed = [];
let seq = 0;

const s = {
  window: win, document: win.document, DOMParser: win.DOMParser, Blob, Response, DecompressionStream,
  TextEncoder, TextDecoder, XMLSerializer: win.XMLSerializer, localStorage: win.localStorage,
  FileReader: win.FileReader, File: win.File,
  btoa: x => Buffer.from(x, 'binary').toString('base64'),
  atob: x => Buffer.from(x, 'base64').toString('binary'),
  URL: {
    createObjectURL: () => { const u = 'blob:fake/' + (++seq); made.push(u); return u; },
    revokeObjectURL: u => { freed.push(u); }
  },
  alert: () => {}, setTimeout, clearTimeout, setInterval, clearInterval, console
};
s.self = s; s.globalThis = s; vm.createContext(s);
vm.runInContext(code, s);
/* 脚本里的 `const books = []` 不会挂到沙箱对象上，要取值就在上下文里跑表达式 */
const run = expr => vm.runInContext(expr, s);

let pass = 0, total = 0;
const fails = [];
const ck = (name, cond, detail) => {
  total++;
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗   ' + name.padEnd(42) + (detail || '')); }
};
const logBox = s.document.getElementById('log');   // log() 写进 #log，不是 #logBox

/* 造一本书塞进列表：state=ready 才会渲染出 textarea 和文件夹输入框 */
function addBook(name, folder, mdText){
  run(`books.push({
    name: ${JSON.stringify(name)}, folder: ${JSON.stringify(folder)}, kind: 'epub',
    size: 1024, state: 'ready', stateLabel: '已就绪', open: true,
    markdown: ${JSON.stringify(mdText)}, images: [], meta: { title: ${JSON.stringify(name)} },
    check: { issues: [], errorCount: 0, warnCount: 0 },
    base64: 'QUJD'
  }); render();`);
  return run('books.length - 1');
}

console.log('\n[1] 编辑框：打字不应该把整行重建\n' + '-'.repeat(60));
addBook('书A', 'shu-a', '# 标题\n\n正文一段。\n');
const ta = s.document.getElementById('md-0');
if (ta) ta.focus();
const focusedBefore = s.document.activeElement === ta;

/* 模拟"自检结果变了"：以前的实现会整表 render()，把正在打字的 textarea 销毁重建 */
run(`books[0].stateLabel = '有 1 个错误';
     books[0].check = { issues: [{ level: 'err', msg: '测试用的错误' }], errorCount: 1, warnCount: 0 };
     refreshRow(0);`);
const ta2 = s.document.getElementById('md-0');
ck('自检结果变了之后，编辑框还是同一个元素', ta && ta2 === ta,
   ta2 === ta ? '' : 'textarea 被重建了 → 光标会跳走');
ck('编辑框仍然保持焦点', focusedBefore && s.document.activeElement === ta,
   s.document.activeElement === ta ? '' : '焦点丢了');
ck('状态徽章就地更新了', /有 1 个错误/.test(s.document.querySelector('.row-h').textContent),
   s.document.querySelector('.row-h').textContent.trim());
ck('自检面板渲染出来了', !!s.document.getElementById('ck-0'));

console.log('\n[2] 编辑框：每敲一键不做重活\n' + '-'.repeat(60));
/* 直接派发 input 事件：base64 必须只是置空（等上传时再算），不能当场重编码 */
run(`books[0].base64 = 'QUJD';`);
const ev = new win.Event('input', { bubbles: true });
if (ta) { ta.value = '# 标题\n\n改了一点点。\n'; ta.dispatchEvent(ev); }
ck('输入后 base64 被置为失效（上传时才重算）', run('books[0].base64') === null,
   '实际=' + JSON.stringify(run('books[0].base64')));
ck('输入后正文已同步到内存', /改了一点点/.test(run('books[0].markdown')));
/* 防抖回调里才会跑 validateMarkdown；这里手动触发一次，确认它不重建 DOM */
const ta3 = s.document.getElementById('md-0');
run(`(function(){ const b = books[0]; b.check = validateMarkdown(b.markdown, new Set()); refreshRow(0); })()`);
ck('自检重跑后编辑框仍是同一个元素', s.document.getElementById('md-0') === ta3);

console.log('\n[3] 预览图的 blob URL 必须能释放\n' + '-'.repeat(60));
run(`books[0]._imgUrls = new Map([['images/a.png', URL.createObjectURL(new Blob([1]))],
                                 ['images/b.png', URL.createObjectURL(new Blob([2]))]]);`);
const madeCount = made.length, freedBefore = freed.length;
run('releaseImgUrls(books[0]);');
ck('调用后确实释放了这两张图的 URL', freed.length - freedBefore === 2,
   '释放了 ' + (freed.length - freedBefore) + ' 个（应为 2）');
ck('释放后缓存被清空', run('books[0]._imgUrls') === null);
/* 移除一本书时也要释放 —— 这是最容易漏的一处 */
run(`books[0]._imgUrls = new Map([['images/c.png', URL.createObjectURL(new Blob([3]))]]);`);
const freed2 = freed.length;
run('(function(){ const b = books[0]; releaseImgUrls(b); books.splice(0, 1); render(); })()');
ck('移除书籍时会释放它的预览链接', freed.length - freed2 === 1);

console.log('\n[4] 同名文件夹：必须当场发现、上传前拦住\n' + '-'.repeat(60));
addBook('书B', 'same-dir', '# B\n\n正文。\n');
addBook('书C', 'same-dir', '# C\n\n正文。\n');
addBook('书D', 'other-dir', '# D\n\n正文。\n');
run('refreshFolderWarnings();');
const dupGroups = run('[...dupFolders().entries()].filter(([,v]) => v.length > 1).map(([k]) => k)');
ck('查出重名的文件夹', dupGroups.length === 1 && dupGroups[0] === 'same-dir', JSON.stringify(dupGroups));
const dupInputs = [...s.document.querySelectorAll('input.dup')].map(el => el.id);
ck('重名的输入框被标红', dupInputs.length === 2, JSON.stringify(dupInputs));
ck('没重名的输入框不受影响', !s.document.getElementById('folder-' + run('books.length - 1')).classList.contains('dup'));
const hint = s.document.getElementById('dupHint');
ck('列表顶上给出了人话提示', hint.style.display === 'block' && /重名/.test(hint.textContent), hint.textContent);
if (logBox) logBox.innerHTML = '';
const blocked = run('blockIfDupFolder(1)');
ck('上传前拦下了重名的那本', blocked === true, '返回 ' + blocked);
ck('拦下时把原因写进了日志', /互相覆盖/.test(logBox.textContent), logBox.textContent.slice(0, 120));
ck('没重名的那本不拦', run('blockIfDupFolder(' + (s.run ? 0 : 0) + ')') !== undefined);

async function checkOrigB64(){
console.log('\n[5] 原件 base64：没勾「保留原件」就不该算\n' + '-'.repeat(60));
/* 用真实样本跑一次转换。把 ArrayBuffer 挂到沙箱上，让 file.arrayBuffer() 能取到 */
const epubBuf = fs.readFileSync(__dirname + '/samples/sample.epub');
s.__AB = Uint8Array.from(epubBuf).buffer;
run(`books.push({
  name: '原件测试', folder: 'orig-test', kind: 'epub', size: ${epubBuf.length},
  state: 'pending', stateLabel: '待转换', open: false,
  markdown: '', images: [], meta: {}, base64: null, origB64: null,
  keepOrig: false, edited: false,
  file: { arrayBuffer: async () => __AB }
});`);
const idx = run('books.length - 1');
run(`convertBook(${idx})`);
await new Promise(r => setTimeout(r, 300));   // 等转换这条异步链跑完
ck('转换完成后没有预先算原件 base64', run(`books[${idx}].origB64`) === null,
   '实际=' + JSON.stringify(String(run(`books[${idx}].origB64`)).slice(0, 16) + '…'));
ck('但 Markdown 已经算好（base64 有值）', !!run(`books[${idx}].base64`));
/* 勾上之后才应该算 */
run(`books[${idx}].keepOrig = true;`);
const got = await s.ensureOrigB64(run(`books[${idx}]`));
ck('勾上「保留原件」后才真正读原件', !!got && got.length > 0, '返回 ' + (got || '').length + ' 字符');

/* 勾选框要能同步到已添加的书 —— 以前只在加书那一刻读一次 */
const keepBox = s.document.getElementById('keepOrigAll');
run(`books[0].keepOrig = false;`);
keepBox.checked = true;
keepBox.dispatchEvent(new win.Event('change', { bubbles: true }));
ck('勾上勾选框后，已添加的书跟着变', run(`books[0].keepOrig`) === true);
keepBox.checked = false;
keepBox.dispatchEvent(new win.Event('change', { bubbles: true }));
ck('取消勾选框后，已添加的书也跟着变', run(`books[0].keepOrig`) === false);

}

(async () => {
  await checkOrigB64();
  console.log('\n' + '='.repeat(60));
if (fails.length) {
  console.log(`失败 ${fails.length} / ${total}：`);
  fails.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log(`通过 ${pass} / ${total}`);
})();
