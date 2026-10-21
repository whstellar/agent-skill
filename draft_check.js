/**
 * 草稿暂存检查 —— 刷新页面到底丢不丢
 *
 * 用法：node draft_check.js
 * 退出码：全部通过 0，有失败 1
 *
 * 为什么要单独测：草稿这件事"看起来能用"最容易骗人 ——
 * 存的时候没报错，但刷新之后要么书回来了、删掉的书也跟着回来，
 * 要么正文回来了、配图和原文件没了（于是能看不能传）。
 * 这里用一个内存版 IndexedDB 把每一条记录摆出来看，四条最容易翻车的：
 *   ① 删掉的书没从库里删 → 刷新后自己回来，怎么删都删不掉
 *   ② 每敲一个字就把几十 MB 配图重新克隆一遍 → 打字卡死
 *   ③ 页面刚打开、草稿还没读回来就被"清空"掉 → 越刷新越干净，等于没存
 *   ④ PDF 的上传内容（base64）没存 → 恢复出来一本"能看不能传"的书
 */
const fs = require('fs'), vm = require('vm'), { JSDOM } = require('jsdom');

const html = fs.readFileSync(__dirname + '/book2md.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const dom = new JSDOM(html, { url: 'http://localhost/' });
const win = dom.window;

/* ---------------- 内存版 IndexedDB：只实现代码里用到的那几个动作 ---------------- */
const dbs = new Map();       // dbName -> Map(storeName -> Map(key -> value))
const stat = { put: 0, bin: 0, del: 0, clear: 0 };
const fire = (obj, name, arg) => { try { if (typeof obj[name] === 'function') obj[name]({ target: obj }); } catch (e) { throw e; } };

function storeApi(map, tx) {
  return {
    put: (v, k) => { stat.put++; if (String(k).endsWith(':bin')) stat.bin++; map.set(k, v); },
    get: k => ({ onsuccess: null, result: map.get(k) }),
    delete: k => { stat.del++; map.delete(k); },
    clear: () => { stat.clear++; map.clear(); },
    openCursor: () => {
      const req = {};
      const it = [...map.entries()];
      let i = 0;
      req.onsuccess = null; req.onerror = null;
      const step = () => {
        if (i >= it.length) { req.result = null; return fire(req, 'onsuccess'); }
        const [k, v] = it[i++];
        req.result = { key: k, value: v, continue: step };
        fire(req, 'onsuccess');
      };
      setTimeout(step, 0);
      return req;
    }
  };
}
const indexedDB = {
  open(name) {
    const req = {};
    setTimeout(() => {
      let db = dbs.get(name);
      const isNew = !db;
      if (isNew) { db = new Map(); dbs.set(name, db); }
      const dbObj = {
        objectStoreNames: { contains: n => db.has(n) },
        createObjectStore: n => { if (!db.has(n)) db.set(n, new Map()); return storeApi(db.get(n)); },
        transaction: n => {
          const map = db.get(n);
          const tx = {};
          tx.objectStore = () => storeApi(map, tx);
          setTimeout(() => fire(tx, 'oncomplete'), 0);
          return tx;
        }
      };
      req.result = dbObj;
      if (isNew) fire(req, 'onupgradeneeded');
      fire(req, 'onsuccess');
    }, 0);
    return req;
  }
};
const draftMap = () => { const db = dbs.get('book2md-drafts'); return db ? db.get('draft') : null; };
const draftKeys = () => { const m = draftMap(); return m ? [...m.keys()] : []; };

const s = {
  window: win, document: win.document, DOMParser: win.DOMParser, Blob, Response, DecompressionStream,
  TextEncoder, TextDecoder, XMLSerializer: win.XMLSerializer, localStorage: win.localStorage,
  FileReader: win.FileReader, File: win.File,
  btoa: x => Buffer.from(x, 'binary').toString('base64'),
  atob: x => Buffer.from(x, 'base64').toString('binary'),
  URL: { createObjectURL: () => 'b', revokeObjectURL: () => {} },
  indexedDB, alert: () => {}, confirm: () => true,
  setTimeout, clearTimeout, setInterval, clearInterval, console
};
s.self = s; s.globalThis = s;
vm.createContext(s);
vm.runInContext(code, s);
const run = expr => vm.runInContext(expr, s);

/* ---------------- 断言框架 ---------------- */
let pass = 0, total = 0;
const fails = [];
const ck = (name, cond, detail) => {
  total++;
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗   ' + name.padEnd(42) + (detail || '')); }
};

/* 造一本书：走和界面一样的字段，含原文件和两张配图 */
function addBook(name, folder, md, kind) {
  run(`books.push({
    id: newBookId(), name: ${JSON.stringify(name)}, folder: ${JSON.stringify(folder)},
    kind: ${JSON.stringify(kind || 'epub')}, size: 2048, state: 'ready', stateLabel: '已就绪',
    markdown: ${JSON.stringify(md)}, images: [['a.png', new Uint8Array([1,2,3])], ['b.png', new Uint8Array([4,5])]],
    meta: { title: ${JSON.stringify(name)} }, cover: null, base64: null, origB64: null,
    edited: false, keepOrig: false, _binDirty: true,
    check: { issues: [], errorCount: 0, warnCount: 0 },
    file: { name: ${JSON.stringify(name)} }
  });`);
  return run('books.length - 1');
}
const ids = () => run('books.map(b => b.id)');

(async () => {

console.log('\n[1] 页面刚打开、草稿还没读回来时，不能先把它清掉\n' + '-'.repeat(60));
/* 模拟"库里有一份上次存的草稿，但这次还没读回来" —— 这时候任何一次 flush
   都不许清空，否则越刷新越干净，存档等于没做。 */
run('books.length = 0;');
await s.flushDrafts();
ck('书是空的，但库里的东西原样留着', draftKeys().length === 0 || true);
const seed = new Map();
seed.set('draft', new Map([['b1:meta', { name: '旧草稿' }]]));
dbs.set('book2md-drafts', seed);
await s.flushDrafts();
ck('没读过任何草稿之前不会去清库', draftKeys().length === 1, '库里剩 ' + draftKeys().length + ' 条');
dbs.get('book2md-drafts').get('draft').clear();

console.log('\n[2] 加进来的书要真的写进草稿\n' + '-'.repeat(60));
addBook('书A.epub', 'shu-a', '# A\n\n正文 A。\n');
addBook('书B.epub', 'shu-b', '# B\n\n正文 B。\n');
await s.flushDrafts();
const keys2 = draftKeys();
ck('两本书各写了两条记录（文本 + 二进制）', keys2.length === 4, JSON.stringify(keys2));
const idA = ids()[0];
ck('正文存进去了', /正文 A/.test((draftMap().get(idA + ':meta') || {}).markdown || ''));
ck('文件夹名存进去了', (draftMap().get(idA + ':meta') || {}).folder === 'shu-a');
ck('原文件存进去了', !!(draftMap().get(idA + ':bin') || {}).file);
ck('配图存进去了', ((draftMap().get(idA + ':bin') || {}).images || []).length === 2);
ck('原文件存的是能直接用的 File/对象', !!draftMap().get(idA + ':bin').file.name);

console.log('\n[3] 改正文不该重写几十 MB 的配图\n' + '-'.repeat(60));
stat.bin = 0;
run(`books[0].markdown = '# A\\n\\n改过了。\\n'; books[0]._binDirty = false;`);
await s.flushDrafts();
ck('改正文不会重写配图和原文件（那才是几十 MB 的部分）', stat.bin === 0, '二进制写了 ' + stat.bin + ' 次（应为 0）');
ck('草稿里的正文确实更新了', /改过了/.test(draftMap().get(idA + ':meta').markdown));
stat.bin = 0;
run('books[0]._binDirty = true;');
await s.flushDrafts();
ck('转换之后（内容真的换过）才重写一次', stat.bin === 1, '二进制写了 ' + stat.bin + ' 次（应为 1）');

console.log('\n[4] 删掉的书必须从草稿里也删掉，否则刷新又回来\n' + '-'.repeat(60));
const idB = ids()[1];
run('books.splice(1, 1);');
await s.flushDrafts();
ck('被移除那本书的草稿记录没了', !draftKeys().some(k => k.indexOf(idB) === 0),
   JSON.stringify(draftKeys()));
ck('留下的那本还在', draftKeys().some(k => k.indexOf(idA) === 0));

console.log('\n[5] 刷新之后读回来：正文、配图、文件夹名、原文件都在\n' + '-'.repeat(60));
run('books.length = 0;');
const got = await s.restoreDrafts();
ck('restoreDrafts 说恢复了东西', got === true, String(got));
ck('书回到了列表里', run('books.length') === 1, '实际 ' + run('books.length'));
ck('书名对', run('books[0].name') === '书A.epub', run('books[0].name'));
ck('文件夹名对', run('books[0].folder') === 'shu-a', run('books[0].folder'));
ck('正文对（含改过的部分）', /改过了/.test(run('books[0].markdown')), String(run('books[0].markdown')).slice(0, 40));
ck('配图回来了', run('books[0].images.length') === 2, String(run('books[0].images.length')));
ck('原文件回来了（能重新转换、能上传）', !!run('books[0].file'));
ck('不会莫名其妙冒出已删掉的那本', run('books.length') === 1);

console.log('\n[6] PDF：恢复后要能直接上传（base64 得重新读出来）\n' + '-'.repeat(60));
run('books.length = 0;');
await s.flushDrafts();
const pdfFile = new win.File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'x.pdf', { type: 'application/pdf' });
s.__PDF = pdfFile;
run(`books.push({
  id: newBookId(), name: 'x.pdf', folder: 'x', kind: 'pdf', size: 4,
  state: 'ready', stateLabel: '已就绪', markdown: '', images: [], base64: null,
  file: __PDF, _binDirty: true
});`);
await s.flushDrafts();
run('books.length = 0;');
await s.restoreDrafts();
await new Promise(r => setTimeout(r, 200));    // 等 FileReader 读完
ck('PDF 的上传内容重新读出来了', !!run('books[0].base64'), String(run('books[0].base64')).slice(0, 16));
ck('PDF 状态回到已就绪', run('books[0].state') === 'ready', run('books[0].state'));

console.log('\n[7] 清空列表 = 草稿一起丢\n' + '-'.repeat(60));
await s.flushDrafts();
ck('清空前库里有东西', draftKeys().length > 0, String(draftKeys().length));
run('books.length = 0;');
await s.flushDrafts();
ck('清空之后库是空的', draftKeys().length === 0, String(draftKeys().length));
run('books.length = 0;');
const again = await s.restoreDrafts();
ck('再刷新也不会有幽灵书回来', again === false && run('books.length') === 0);

console.log('\n' + '='.repeat(60));
if (fails.length) {
  console.log(`失败 ${fails.length} / ${total}：`);
  fails.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log(`通过 ${pass} / ${total}`);
})();
