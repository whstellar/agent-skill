/**
 * 仓库「门面」检查 —— .gitattributes + 每本书的目录页
 *
 * 用法：node repo_pages_check.js
 * 退出码：全部通过 0，有失败 1
 *
 * 为什么单独测：这两样东西决定的不是「书能不能传上去」，
 * 而是「别人打开仓库主页的第一眼」。它们坏了不会报错、日志一片绿，
 * 只有真的打开 GitHub 页面才会发现——那时候书已经传完了。
 *
 * 重点盯死链：目录页里写一个指向不存在文件的链接，
 * 界面上显示上传成功，但用户点下去就是 404。
 * 这种错误靠肉眼看文件列表是看不出来的，必须逐条解析链接去对仓库。
 */
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'),
      os = require('os'), path = require('path'), cp = require('child_process');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(__dirname + '/book2md.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const dom = new JSDOM(html, { url: 'http://localhost/' });
const win = dom.window;

/* ---------------- 假 GitHub ---------------- */
const blobs = new Map(), store = new Map();
let seq = 0, blobPosts = 0;
const sha1Of = buf => {
  const b = Buffer.from(buf);
  const sha = crypto.createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex');
  blobs.set(sha, b); return sha;
};
const readText = p => { const s = store.get(p); return s == null ? null : blobs.get(s).toString('utf8'); };

let headSha = 'commit-0';
let pendingTree = null;
const ok = o => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
const bad = (st, msg) => ({ ok: false, status: st, text: async () => JSON.stringify({ message: msg }) });

async function fakeFetch(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const u = String(url);
  let m;
  if(method === 'GET' && /\/git\/trees\/[^?]+\?recursive=1/.test(u))
    return ok({ tree: [...store.entries()].map(([p, sha]) => ({ path: p, type: 'blob', sha, size: blobs.get(sha).length })) });
  m = u.match(/\/git\/blobs\/([^/?]+)$/);
  if(method === 'GET' && m){
    const buf = blobs.get(m[1]);
    if(!buf) return bad(404, 'Not Found');
    return ok({ sha: m[1], content: buf.toString('base64'), encoding: 'base64' });
  }
  if(method === 'POST' && /\/git\/blobs$/.test(u)){
    blobPosts++;
    return ok({ sha: sha1Of(Buffer.from(JSON.parse(opts.body).content, 'base64')) });
  }
  if(method === 'POST' && /\/git\/trees$/.test(u)){
    pendingTree = JSON.parse(opts.body).tree;
    return ok({ sha: 'tree-' + String(++seq) });
  }
  if(method === 'POST' && /\/git\/commits$/.test(u)) return ok({ sha: 'commit-' + String(++seq) });
  if(method === 'PATCH' && /\/git\/refs\/heads\//.test(u)){
    if(pendingTree){
      for(const e of pendingTree){
        if(e.sha === null || e.sha === undefined) store.delete(e.path);
        else store.set(e.path, e.sha);
      }
      pendingTree = null;
    }
    headSha = JSON.parse(opts.body).sha;
    return ok({ ref: 'refs/heads/main', object: { sha: headSha } });
  }
  if(method === 'GET' && /\/git\/refs\/heads\/.+/.test(u)) return ok({ ref: 'refs/heads/main', object: { sha: headSha } });
  if(method === 'GET' && /\/commits\/[^/?]+(\?|$)/.test(u)) return ok([{ sha: headSha }]);
  if(method === 'GET' && /\/repos\/[^/]+\/[^/]+$/.test(u)) return ok({ default_branch: 'main' });
  if(method === 'GET' && /\/user$/.test(u)) return ok({ login: 'wh' });
  m = u.match(/\/contents\/([^?]+)/);
  if(method === 'GET' && m){
    const sha = store.get(decodeURIComponent(m[1]));
    if(sha == null) return bad(404, 'Not Found');
    return ok({ sha, content: blobs.get(sha).toString('base64') });
  }
  return bad(404, 'unhandled ' + method + ' ' + u);
}

const s = {
  window: win, document: win.document, DOMParser: win.DOMParser, Blob: win.Blob, Response,
  TextEncoder, TextDecoder, XMLSerializer: win.XMLSerializer, localStorage: win.localStorage,
  FileReader: win.FileReader, File: win.File, fetch: fakeFetch,
  btoa: x => Buffer.from(x, 'binary').toString('base64'),
  atob: x => Buffer.from(x, 'base64').toString('binary'),
  crypto: win.crypto, alert: () => {}, confirm: () => true, prompt: () => '',
  setTimeout, clearTimeout, setInterval, clearInterval, console,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  IS_SANDBOX: true
};
s.self = s; s.globalThis = s;
vm.createContext(s);
vm.runInContext(code, s);

/* ---------------- 断言框架 ---------------- */
let pass = 0, total = 0;
const fails = [];
const ck = (name, cond, extra) => {
  total++;
  if(cond){ pass++; console.log('  OK  ' + name); }
  else{ fails.push(name + (extra ? '（' + extra + '）' : '')); console.log('  ✗   ' + name + (extra ? '  → ' + extra : '')); }
};
const head = t => console.log('\n' + t + '\n' + '-'.repeat(60));

/* 抽出 markdown 里的链接目标：![alt](url) 和 [text](url) */
const links = md => [...String(md).matchAll(/!?\[[^\]]*\]\(([^)\s]+)/g)].map(m => m[1]);

/* 把目录页里的相对链接解析成仓库内的绝对路径。
   GitHub 的解析规则：`x.md` 相对**当前文件所在目录**，`/x.md` 相对**仓库根**。
   所以不能一见到 / 就判死链——它只是换了个基准，仍可能指向真实文件。 */
const resolveInRepo = (baseDir, u) =>
  path.posix.normalize(u.startsWith('/') ? u.slice(1) : path.posix.join(baseDir, u));

const brokenLinks = (md, baseDir) => links(md).filter(u => {
  if(/^(https?:|mailto:|#)/.test(u)) return false;   // 外链和锚点不归仓库管
  return !store.has(resolveInRepo(baseDir, u));
});

(async () => {
  s.document.getElementById('token').value = 'test-token';
  s.document.getElementById('repo').value = 'wh/books';

  /* ================= 场景 1：EPUB（带原件） ================= */
  head('[1] EPUB 上传后的目录页');
  const epub = {
    name: '三国演义.epub', kind: 'epub', folder: '三国演义',
    state: 'ready', stateLabel: '已就绪',
    markdown: '# 第一回\n\n话说天下大势。\n',
    images: [['01.jpg', new Uint8Array([1, 2, 3])]],
    base64: null, origB64: 'UEsDBA==', edited: false, cover: null,
    meta: { title: '三国演义', creator: '罗贯中', publisher: '人民文学出版社', language: 'zh' },
    keepOrig: true, skipExisting: false
  };
  epub.base64 = Buffer.from(epub.markdown, 'utf8').toString('base64');
  await s.uploadBook(epub);

  const page = readText('三国演义/README.md');
  ck('生成了书籍目录页', page != null);
  ck('目录页有书名', /^# 三国演义$/m.test(page || ''));
  ck('目录页有作者和出版社', /罗贯中/.test(page || '') && /人民文学出版社/.test(page || ''));

  /* 死链检测：目录页里的每个链接，按「当前文件所在目录」解析后必须真实存在 */
  const all = links(page || '');
  ck('目录页里确实有链接', all.length > 0, '找到 ' + all.length + ' 个');
  const broken = brokenLinks(page || '', '三国演义');
  ck('目录页里没有死链', broken.length === 0, '死链: ' + broken.join(', '));
  /* 相对写法比 / 开头稳妥：仓库被 fork、或换了用户名/组织之后，
     以 / 开头的链接基准会跟着变，相对写法不会。 */
  ck('目录页用相对写法（fork 后仍有效）', all.every(u => !u.startsWith('/')),
    all.filter(u => u.startsWith('/')).join(', '));

  /* 封面路径必须指向真实文件——裂图是首页最难看的一种坏 */
  const img = /<img src="([^"]+)"/.exec(page || '');
  ck('目录页有封面图', !!img);
  ck('封面图文件真实存在', img ? store.has('三国演义/' + img[1]) : false, img && img[1]);

  /* ================= 场景 2：不保留原件 ================= */
  head('[2] 不勾「保留原件」时不该出现 epub 链接');
  store.clear(); blobs.clear();
  const noOrig = {
    name: '简本书.epub', kind: 'epub', folder: '简本书',
    state: 'ready', stateLabel: '已就绪',
    markdown: '# 简本\n\n内容。\n',
    images: [], base64: null, origB64: null, edited: false, cover: null,
    meta: { title: '简本书', creator: '佚名' },
    keepOrig: false, skipExisting: false
  };
  noOrig.base64 = Buffer.from(noOrig.markdown, 'utf8').toString('base64');
  await s.uploadBook(noOrig);

  const p2 = readText('简本书/README.md') || '';
  ck('没有上传 epub 原件', !store.has('简本书/简本书.epub'));
  ck('目录页里也没有 epub 链接', !/\.epub\)/.test(p2), p2.match(/\(.*\.epub\)/) || '');
  const broken2 = brokenLinks(p2, '简本书');
  ck('不保留原件时目录页仍无死链', broken2.length === 0, '死链: ' + broken2.join(', '));

  /* ================= 场景 3：PDF ================= */
  head('[3] PDF 的目录页给对入口');
  store.clear(); blobs.clear();
  const pdf = {
    name: '报告.pdf', kind: 'pdf', folder: '报告',
    state: 'ready', stateLabel: '已就绪',
    markdown: '', images: [], base64: 'JVBERi0=', origB64: null, edited: false,
    cover: null, meta: { title: '年度报告' },
    keepOrig: false, skipExisting: false
  };
  await s.uploadBook(pdf);

  const p3 = readText('报告/README.md') || '';
  ck('PDF 目录页指向 PDF 原件', /报告\.pdf\)/.test(p3));
  /* 注意别写成 !/\.md\)/ —— 末尾「返回书库首页 ../README.md」也是 .md，会被误判。
     要测的是"没有指向正文的在线阅读入口"。 */
  ck('PDF 目录页不给「在线阅读」入口（PDF 在 GitHub 上不渲染）', !/在线阅读/.test(p3));
  const broken3 = brokenLinks(p3, '报告');
  ck('PDF 目录页无死链', broken3.length === 0, '死链: ' + broken3.join(', '));

  /* ================= 场景 4：返回首页链接 ================= */
  head('[4] 返回首页的链接');
  ck('目录页有返回首页入口', /\.\.\/README\.md/.test(p3));
  ck('首页文件真实存在', store.has('README.md'));

  /* ================= 场景 5：.gitattributes ================= */
  head('[5] .gitattributes 随上传自动写入');
  const ga = readText('.gitattributes');
  ck('自动生成了 .gitattributes', ga != null);
  ck('封面标成自动生成', /^cover\.svg\s+linguist-generated/m.test(ga || ''));
  const need = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'epub', 'pdf', 'mobi', 'azw3', 'djvu'];
  const miss = need.filter(e => !new RegExp('^\\*\\.' + e + '\\s+binary', 'm').test(ga || ''));
  ck('资源后缀都标成 binary', miss.length === 0, '缺: ' + miss.join(','));
  ck('开头有说明不会无脑覆盖手写内容', /自动维护/.test(ga || ''));

  /* 用**真的 git** 验证属性语义，而不是自己解析文本。
     git 的属性是「按属性逐条合并、同名才覆盖」，
     所以 cover.svg 最终会同时拿到 binary + generated + vendored ——
     这条如果理解反了（以为整行覆盖），规则就白写了。 */
  let gaOk = false, gaDetail = '';
  try{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-'));
    cp.execSync('git init -q .', { cwd: tmp, stdio: 'ignore' });   // check-attr 必须在仓库里跑
    fs.writeFileSync(path.join(tmp, '.gitattributes'), ga || '');
    /* 属性名走命令行、路径走 stdin —— 命令行模式下 git 分不清哪些是属性，
       会把 binary / linguist-generated 当成路径去查，结果全是 unspecified。 */
    const out = cp.execSync('git check-attr text binary linguist-generated linguist-vendored --stdin',
                            { cwd: tmp, encoding: 'utf8', input: 'cover.svg\n' });
    gaDetail = out.trim().replace(/\n/g, ' | ');
    gaOk = /cover\.svg: linguist-generated: set/.test(out) &&
           /cover\.svg: binary: set/.test(out);
    fs.rmSync(tmp, { recursive: true, force: true });
  }catch(e){ gaDetail = String(e.message || e); }
  ck('真 git 认这两条规则（不是整行覆盖）', gaOk, gaDetail);

  console.log('\n通过 ' + pass + ' / ' + total);
  if(fails.length){ console.log('失败：\n  - ' + fails.join('\n  - ')); process.exit(1); }
})().catch(e => { console.error('测试脚本异常：', e); process.exit(1); });
