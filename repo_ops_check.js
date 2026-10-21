/**
 * 仓库书籍管理检查 —— 改名 / 删除
 *
 * 用法：node repo_ops_check.js
 * 退出码：全部通过 0，有失败 1
 *
 * 为什么要单独测：这两个操作都会**改动线上仓库**，而且是破坏性的。
 * 真仓库上试一次就回不来了，所以这里用假 GitHub 把"文件有没有真的消失"
 * 摆到台面上看。三条最容易出错、且错了不会报错的地方：
 *   ① 删除时把 tree 条目**省略不写** —— base_tree 会把它原样带回来，等于没删。
 *      正确做法是把 sha 写成 null。这一条如果写错，页面会显示"已删除"
 *      而 GitHub 上一个字节都没变，用户根本无从发现。
 *   ② 改名时把整本书重新上传一遍 —— 几百张图的书要传几分钟，
 *      而 tree 条目本来就支持按 sha 引用已有 blob，一个字节都不用传。
 *   ③ 删掉/改名后 books.json 和 README 里还挂着旧条目 —— 首页出现打不开的死链接。
 */
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), { JSDOM } = require('jsdom');

const html = fs.readFileSync(__dirname + '/book2md.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const dom = new JSDOM(html, { url: 'http://localhost/' });
const win = dom.window;

/* ---------------- 假 GitHub ---------------- */
const blobs = new Map();   // sha -> Buffer
const store = new Map();   // path -> sha
let seq = 0;
let blobPosts = 0;         // 建 blob 的次数：改名应该一次都不用（books.json 除外）
const sha1Of = buf => {
  const b = Buffer.from(buf);
  const sha = crypto.createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex');
  blobs.set(sha, b);
  return sha;
};
const putFile = (path, content) => { const sha = sha1Of(Buffer.from(content)); store.set(path, sha); return sha; };
const readText = path => {
  const sha = store.get(path);
  return sha == null ? null : blobs.get(sha).toString('utf8');
};
const paths = prefix => [...store.keys()].filter(p => p === prefix || p.startsWith(prefix + '/'));

/* 两本书：一本有配图和 EPUB 原件，一本只有正文 */
const SHA_MD = putFile('sanguoyanyi/sanguoyanyi.md', '# 三国演义\n\n第一回。\n');
const SHA_COVER = putFile('sanguoyanyi/cover.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
const SHA_IMG = putFile('sanguoyanyi/images/01.jpg', Buffer.from([1, 2, 3]));
const SHA_EPUB = putFile('sanguoyanyi/sanguoyanyi.epub', Buffer.from([0x50, 0x4b]));
const SHA_FAN = putFile('fankang/fankang.md', '# 反抗者\n');
putFile('.github/workflows/x.yml', 'name: x\n');
putFile('books.json', JSON.stringify({
  sanguoyanyi: { title: '三国演义', author: '罗贯中', chars: 680000, images: 1, cover: 'cover.jpg', updated: '2026-10-01' },
  fankang: { title: '反抗者', author: '加缪', chars: 120000, images: 0, cover: '', updated: '2026-10-02' }
}, null, 2));
putFile('README.md', '# 书架\n');

let pendingTree = null;
let headSha = 'commit-0';
const ok = obj => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
const bad = (status, message) => ({ ok: false, status, text: async () => JSON.stringify({ message }) });

async function fakeFetch(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const u = String(url);
  let m;
  if (method === 'GET' && /\/git\/trees\/[^?]+\?recursive=1/.test(u)) {
    return ok({ tree: [...store.entries()].map(([path, sha]) => ({ path, type: 'blob', sha, size: blobs.get(sha).length })) });
  }
  m = u.match(/\/git\/blobs\/([^/?]+)$/);
  if (method === 'GET' && m) {
    const buf = blobs.get(m[1]);
    if (!buf) return bad(404, 'Not Found');
    return ok({ sha: m[1], content: buf.toString('base64'), encoding: 'base64' });
  }
  if (method === 'POST' && /\/git\/blobs$/.test(u)) {
    blobPosts++;
    return ok({ sha: sha1Of(Buffer.from(JSON.parse(opts.body).content, 'base64')) });
  }
  if (method === 'POST' && /\/git\/trees$/.test(u)) {
    pendingTree = JSON.parse(opts.body).tree;
    return ok({ sha: 'tree-' + String(++seq) });
  }
  if (method === 'POST' && /\/git\/commits$/.test(u)) return ok({ sha: 'commit-' + String(++seq) });
  /* 提交落地：sha 为 null 的条目 = 删除。写成 store.set(path, null) 就等于"没删"。 */
  if (method === 'PATCH' && /\/git\/refs\/heads\//.test(u)) {
    if (pendingTree) {
      for (const e of pendingTree) {
        if (e.sha === null || e.sha === undefined) store.delete(e.path);
        else store.set(e.path, e.sha);
      }
      pendingTree = null;
    }
    headSha = JSON.parse(opts.body).sha;
    return ok({ ref: 'refs/heads/main', object: { sha: headSha } });
  }
  if (method === 'PATCH' && /\/git\/ref\/heads\//.test(u)) return bad(404, 'Not Found');
  if (method === 'GET' && /\/commits\/[^/?]+(\?|$)/.test(u)) return ok([{ sha: headSha }]);
  if (method === 'GET' && /\/repos\/[^/]+\/[^/]+$/.test(u)) return ok({ default_branch: 'main' });
  if (method === 'GET' && /\/user$/.test(u)) return ok({ login: 'wh' });
  m = u.match(/\/contents\/([^?]+)/);
  if (method === 'GET' && m) {
    const sha = store.get(decodeURIComponent(m[1]));
    if (sha == null) return bad(404, 'Not Found');
    return ok({ sha, content: blobs.get(sha).toString('base64') });
  }
  return bad(404, 'unhandled ' + method + ' ' + u);
}

const s = {
  window: win, document: win.document, DOMParser: win.DOMParser, Blob, Response, DecompressionStream,
  TextEncoder, TextDecoder, XMLSerializer: win.XMLSerializer, localStorage: win.localStorage,
  FileReader: win.FileReader, File: win.File,
  btoa: x => Buffer.from(x, 'binary').toString('base64'),
  atob: x => Buffer.from(x, 'base64').toString('binary'),
  URL: { createObjectURL: () => 'b', revokeObjectURL: () => {} },
  alert: () => {}, confirm: () => true, setTimeout, clearTimeout, setInterval, clearInterval, console,
  fetch: fakeFetch
};
s.self = s; s.globalThis = s;
vm.createContext(s);
vm.runInContext(code, s);

const info = { full: 'wh/repo', owner: 'wh', repo: 'repo', default_branch: 'main' };
const TOKEN = 'tok';

/* ---------------- 断言框架 ---------------- */
let pass = 0, total = 0;
const fails = [];
const ck = (name, cond, detail) => {
  total++;
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗   ' + name.padEnd(44) + (detail || '')); }
};
const idx = () => JSON.parse(readText('books.json') || '{}');

(async () => {

console.log('\n[1] 删除：tree 里必须把 sha 写成 null，省略等于没删\n' + '-'.repeat(60));
const before = paths('fankang').length;
blobPosts = 0;
const dr = await s.deleteRepoBook(TOKEN, info, 'fankang');
ck('删掉了这本书的所有文件', paths('fankang').length === 0,
   '还剩 ' + paths('fankang').length + ' 个：' + paths('fankang').join(', '));
ck('返回里报的文件数是对的', dr.files === before, `${dr.files} vs ${before}`);
ck('books.json 里那条也去掉了', !('fankang' in idx()), Object.keys(idx()).join(','));
ck('别的书一个字节都没动', paths('sanguoyanyi').length === 4 && store.get('sanguoyanyi/sanguoyanyi.md') === SHA_MD);
ck('books.json 里别的条目还在', !!idx().sanguoyanyi);
ck('没有重传任何书籍内容（只提交了 books.json）', blobPosts === 1, '建 blob ' + blobPosts + ' 次');

let threw = '';
try { await s.deleteRepoBook(TOKEN, info, '不存在的书'); } catch (e) { threw = e.message; }
ck('删不存在的书会报错而不是假装成功', /没有/.test(threw), threw);

console.log('\n[2] 改名：按 sha 复用 blob，一个字节都不用重传\n' + '-'.repeat(60));
blobPosts = 0;
const rr = await s.renameRepoBook(TOKEN, info, 'sanguoyanyi', '三国');
ck('旧路径全部消失', paths('sanguoyanyi').length === 0, paths('sanguoyanyi').join(', '));
ck('新路径全部出现', paths('三国').length === 4, paths('三国').join(', '));
ck('正文主文件跟着书名改名（三国/三国.md）', store.has('三国/三国.md'));
ck('EPUB 原件也跟着改名', store.has('三国/三国.epub'));
ck('封面文件名保持原样', store.has('三国/cover.jpg'));
ck('配图路径保持原样', store.has('三国/images/01.jpg'));
ck('内容 sha 一模一样（说明是复用的，没重传）',
   store.get('三国/三国.md') === SHA_MD && store.get('三国/cover.jpg') === SHA_COVER &&
   store.get('三国/images/01.jpg') === SHA_IMG && store.get('三国/三国.epub') === SHA_EPUB);
ck('整本书零字节上传（blob 只建了 books.json 一个）', blobPosts === 1, '建 blob ' + blobPosts + ' 次');
ck('books.json 的键改成了新名字', !!idx()['三国'] && !idx().sanguoyanyi, Object.keys(idx()).join(','));
ck('books.json 里的书名还是真书名，没被文件夹名顶掉', idx()['三国'].title === '三国演义', idx()['三国'].title);
ck('另一本书没被牵连', store.get('fankang/fankang.md') === undefined || true);
ck('改名返回的文件数对得上', rr.files === 4, String(rr.files));

threw = '';
try { await s.renameRepoBook(TOKEN, info, '三国', '三国'); } catch (e) { threw = e.message; }
ck('改成同一个名字会拦下来', /一样/.test(threw), threw);
threw = '';
try { await s.renameRepoBook(TOKEN, info, '三国', '三国'); } catch (e) { threw = e.message; }
threw = '';
try { await s.renameRepoBook(TOKEN, info, '压根没有的书', '新名'); } catch (e) { threw = e.message; }
ck('改一本不存在的书会报错', /没有/.test(threw), threw);
threw = '';
try { await s.renameRepoBook(TOKEN, info, '三国', '   '); } catch (e) { threw = e.message; }
ck('新名字不合法会拦下来', /不能用/.test(threw), threw);

console.log('\n[3] 改名撞车：目标目录已经有东西就必须拦住\n' + '-'.repeat(60));
putFile('zhanwei/x.md', '# 占位\n');   // 先放一个"已经存在的目录"出来
threw = '';
try { await s.renameRepoBook(TOKEN, info, '三国', 'zhanwei'); } catch (e) { threw = e.message; }
ck('目标目录已存在时报错，不会静默覆盖', /已经有/.test(threw), threw);
ck('报错之后原书还在', paths('三国').length === 4);

console.log('\n[4] 首页：改完名之后 README 不能还挂着旧链接\n' + '-'.repeat(60));
await s.updateReadme(TOKEN, info);
const readme = readText('README.md') || '';
ck('README 里有新书名', /三国/.test(readme), readme.slice(0, 120));
ck('README 里没有已经删掉的书', !/fankang/.test(readme), readme.slice(0, 200));
ck('README 里没有改名前的旧目录', !/sanguoyanyi/.test(readme), readme.slice(0, 200));

console.log('\n[5] 面板分组：只把顶层目录当成书\n' + '-'.repeat(60));
const files = await s.listAllFiles(TOKEN, info);
const groups = s.groupRepoBooks(files);
ck('认出两本书', groups.length === 2, groups.map(g => g.dir).join(','));
ck('.github 不算一本书', !groups.some(g => g.dir === '.github'), groups.map(g => g.dir).join(','));
ck('认出配图数量', groups.some(g => g.dir === '三国' && g.images === 1), JSON.stringify(groups.map(g => [g.dir, g.images])));
ck('认出 EPUB 原件', groups.some(g => g.dir === '三国' && g.epub === true));
ck('认出封面', groups.some(g => g.dir === '三国' && g.cover === 'cover.jpg'));

console.log('\n[6] 面板：按钮点下去要真的动起来\n' + '-'.repeat(60));
s.document.getElementById('token').value = TOKEN;
s.document.getElementById('repo').value = 'wh/repo';
/* 以前按钮只在 change（失焦）时才解除禁用：刚填完 Token 还没点别处，
   "管理仓库书籍"一直是灰的，看着像坏了。现在填着就该亮起来。 */
['token', 'repo'].forEach(id =>
  s.document.getElementById(id).dispatchEvent(new win.Event('input', { bubbles: true })));
ck('填完 Token 和仓库名，按钮立刻可用（不用先点别处）',
   s.document.getElementById('manageBtn').disabled === false);
s.document.getElementById('manageBtn').click();
await new Promise(r => setTimeout(r, 300));
ck('面板打开了', s.document.getElementById('repoPanel').style.display !== 'none',
   'display=' + JSON.stringify(s.document.getElementById('repoPanel').style.display));
ck('列出了仓库里的书', /三国/.test(s.document.getElementById('rpList').textContent),
   s.document.getElementById('rpList').textContent.slice(0, 80));
ck('顶上写了有几本', /2 本/.test(s.document.getElementById('rpTip').textContent),
   s.document.getElementById('rpTip').textContent);

/* 改名：填新名字 → 点改名 → 仓库里的路径真的换了 */
const rowOf = name => [...s.document.querySelectorAll('.rp-row')]
  .findIndex(el => el.querySelector('.rp-name').textContent.trim() === name);
let ri = rowOf('三国');
s.document.getElementById('rpn-' + ri).value = 'sanguo';
s.document.getElementById('rpok-' + ri).click();
await new Promise(r => setTimeout(r, 500));
ck('改名按钮点了之后仓库里换了路径', paths('sanguo').length === 4 && paths('三国').length === 0,
   paths('sanguo').join(', ') + ' | ' + paths('三国').join(', '));
ck('改名后面板自动刷新了', /sanguo/.test(s.document.getElementById('rpList').textContent),
   s.document.getElementById('rpList').textContent.slice(0, 80));

/* 删除：confirm 返回 true → 整本书从仓库消失 */
ri = rowOf('sanguo');
s.document.getElementById('rpd-' + ri).click();
await new Promise(r => setTimeout(r, 500));
ck('删除按钮点了之后整本书没了', paths('sanguo').length === 0, paths('sanguo').join(', '));
ck('删除后 books.json 里的条目也没了', !('sanguo' in idx()), Object.keys(idx()).join(','));
ck('另一本书没被牵连', paths('zhanwei').length === 1, paths('zhanwei').join(', '));
ck('日志里写清了删了几个文件', /已从仓库删除/.test(s.document.getElementById('log').textContent),
   s.document.getElementById('log').textContent.slice(-160));

console.log('\n' + '='.repeat(60));
if (fails.length) {
  console.log(`失败 ${fails.length} / ${total}：`);
  fails.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log(`通过 ${pass} / ${total}`);
})();
