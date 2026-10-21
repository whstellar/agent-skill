/**
 * README 生成检查 —— 用假 GitHub 验证「书架里能看出是哪本书」
 *
 * 用法：node readme_check.js
 * 退出码：全部通过 0，有失败 1
 *
 * 为什么不用真仓库测：
 *   书架内容依赖「仓库里实际有什么文件」+「books.json 记了什么」两处输入，
 *   真仓库没法构造出「有封面 / 没封面 / 没索引」这些组合。这里用内存里的
 *   假 GitHub 把三种情况一次摆出来，改动 README 渲染后能立刻看出回归。
 */
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), { JSDOM } = require('jsdom');

const html = fs.readFileSync(__dirname + '/book2md.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const dom = new JSDOM(html, { url: 'http://localhost/' });
const win = dom.window;

/* ---------------- 假 GitHub：只实现用到的 6 个接口 ---------------- */
const blobs = new Map();   // sha -> Buffer
const store = new Map();   // path -> { sha }
let seq = 0;
/* 必须算**真正的 git blob sha**（sha1("blob <长度>\0" + 内容)），不能用自增编号糊弄。
   之前用 'b000001' 这种假 sha，页面里本地算出来的真实 sha 永远对不上，
   于是"内容未变就跳过"这条核心优化在测试里从来没被验证过 —— 每次都全量重传也一路绿灯。
   假仓库比真仓库失真，等于测试白写（PATCH 单复数那次已经栽过一回）。 */
const sha1Of = buf => {
  const b = Buffer.from(buf);
  const sha = crypto.createHash('sha1')
    .update('blob ' + b.length + '\0')
    .update(b)
    .digest('hex');
  blobs.set(sha, b);
  return sha;
};
const putFile = (path, content) => store.set(path, { sha: sha1Of(Buffer.from(content)) });

putFile('sanguoyanyi/sanguoyanyi.md', '# 三国演义\n');
putFile('sanguoyanyi/cover.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
putFile('sanguoyanyi/images/01.jpg', Buffer.from([1]));
putFile('sanguoyanyi/images/02.jpg', Buffer.from([2]));
putFile('fankang/fankang.md', '# 反抗者\n');
const OLD_INDEX = {
  sanguoyanyi: {
    title: '三国演义', author: '罗贯中', publisher: '人民文学出版社',
    language: 'zh', chars: 680000, images: 2, cover: 'cover.jpg',
    pdf: false, epub: false, updated: '2026-10-01'
  }
};
putFile('books.json', JSON.stringify(OLD_INDEX, null, 2));

let pendingTree = null;
let pendingBlobB64 = null;
/* 分支头的真实位置：真实 GitHub 上 PATCH 成功后才移动，这里也照做，
   否则「写完立刻读回来对不对」这类断言就变成自欺欺人。 */
let headSha = 'commit-0';
/* 计数用：批量提交成功几次、退回逐文件上传几次。
   逐文件上传是真·降级路径，正常情况下一次都不该出现。 */
let batchPatches = 0, perFilePuts = 0;
const ok = obj => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
const bad = (status, message) => ({ ok: false, status, text: async () => JSON.stringify({ message }) });

async function fakeFetch(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const u = String(url);

  // 树
  if (method === 'GET' && /\/git\/trees\/[^?]+\?recursive=1/.test(u)) {
    return ok({
      tree: [...store.entries()].map(([path, v]) => ({
        path, type: 'blob', sha: v.sha, size: blobs.get(v.sha).length
      }))
    });
  }
  // 读 blob
  let m = u.match(/\/git\/blobs\/([^/?]+)$/);
  if (method === 'GET' && m) {
    const buf = blobs.get(m[1]);
    if (!buf) return bad(404, 'Not Found');
    // 真实 API 的 base64 带换行，顺便验证解码容忍换行
    const b64 = buf.toString('base64').replace(/(.{60})/g, '$1\n');
    return ok({ sha: m[1], content: b64, encoding: 'base64' });
  }
  // 建 blob
  if (method === 'POST' && /\/git\/blobs$/.test(u)) {
    pendingBlobB64 = JSON.parse(opts.body).content;
    return ok({ sha: sha1Of(Buffer.from(pendingBlobB64, 'base64')) });
  }
  // 建 tree
  if (method === 'POST' && /\/git\/trees$/.test(u)) {
    pendingTree = JSON.parse(opts.body).tree;
    return ok({ sha: 'tree-' + String(++seq) });
  }
  // 建 commit
  if (method === 'POST' && /\/git\/commits$/.test(u)) {
    return ok({ sha: 'commit-' + String(++seq) });
  }
  // 移 ref —— 在这里把 tree 真正落到 store，模拟一次提交成功。
  // 端点必须是复数的 /git/refs/heads/<branch>：真实 API 上写 /git/ref/... 会 404，
  // 这里也照做（之前假仓库两个都收，正好把那个 404 一直掩盖到线上）。
  if (method === 'PATCH' && /\/git\/refs\/heads\//.test(u)) {
    if (pendingTree) { for (const e of pendingTree) store.set(e.path, { sha: e.sha }); pendingTree = null; }
    headSha = JSON.parse(opts.body).sha;
    batchPatches++;
    return ok({ ref: 'refs/heads/main', object: { sha: headSha } });
  }
  if (method === 'PATCH' && /\/git\/ref\/heads\//.test(u)) {
    return bad(404, 'Not Found');   // 单数 ref 就是 404，别惯着
  }
  // 读分支头：GET /repos/{o}/{r}/commits/{branch}?per_page=1
  if (method === 'GET' && /\/commits\/[^/?]+(\?|$)/.test(u)) {
    return ok([{ sha: headSha, commit: { message: 'init' } }]);
  }
  // 读分支引用（旧接口，保留以免别处还在用）
  if (method === 'GET' && /\/git\/refs?\/heads\//.test(u)) {
    return ok({ ref: 'refs/heads/main', object: { sha: headSha } });
  }
  // 仓库信息
  if (method === 'GET' && /\/repos\/[^/]+\/[^/]+$/.test(u)) return ok({ default_branch: 'main' });
  if (method === 'GET' && /\/user$/.test(u)) return ok({ login: 'wh' });
  // contents 接口（只有拿不到 sha 时才会走）
  m = u.match(/\/contents\/([^?]+)/);
  if (method === 'GET' && m) {
    const path = decodeURIComponent(m[1]);
    const rec = store.get(path);
    if (!rec) return bad(404, 'Not Found');
    return ok({ path, sha: rec.sha, content: blobs.get(rec.sha).toString('base64') });
  }
  /* 逐文件上传：故意不实现（真机上它能用，这里 404 会逼出问题），
     只记一笔，让断言能说清"到底退化了没有"。 */
  if (method === 'PUT' && /\/contents\//.test(u)) { perFilePuts++; return bad(404, 'Not Found'); }
  return bad(404, 'unhandled ' + method + ' ' + u);
}

const s = {
  window: win, document: win.document, DOMParser: win.DOMParser, Blob, Response, DecompressionStream,
  TextEncoder, TextDecoder, XMLSerializer: win.XMLSerializer, localStorage: win.localStorage,
  FileReader: win.FileReader, File: win.File,
  btoa: x => Buffer.from(x, 'binary').toString('base64'),
  atob: x => Buffer.from(x, 'base64').toString('binary'),
  URL: { createObjectURL: () => 'b', revokeObjectURL: () => {} },
  alert: () => {}, setTimeout, clearTimeout, setInterval, clearInterval, console,
  fetch: fakeFetch
};
s.self = s; s.globalThis = s;
vm.createContext(s);
vm.runInContext(code, s);

/* ---------------- 断言框架 ---------------- */
let pass = 0, total = 0;
const fails = [];
const ck = (name, cond, detail) => {
  total++;
  if (cond) pass++; else fails.push(name + (detail ? ' — ' + detail : ''));
  console.log((cond ? '  OK  ' : '  ✗   ') + name.padEnd(34) + (cond ? '' : (detail || '')));
};

const readStoreText = path => {
  const rec = store.get(path);
  if (!rec) return null;
  return blobs.get(rec.sha).toString('utf8');
};

/* ---------------- 场景 1：上传一本书，索引不能丢掉别的书 ---------------- */
(async () => {
  const doc = win.document;
  doc.getElementById('token').value = 'test-token';
  doc.getElementById('repo').value = 'wh/books';
  doc.getElementById('visibility').checked = false;

  const book = {
    name: '红楼梦.epub', kind: 'epub', folder: '红楼梦',
    state: 'ready', stateLabel: '已就绪',
    markdown: '# 红楼梦\n\n> 作者：曹雪芹\n\n' + '正文'.repeat(3000),
    images: [['1.jpg', new Uint8Array([1])], ['2.jpg', new Uint8Array([2])], ['3.jpg', new Uint8Array([3])]],
    base64: null, origB64: null, edited: false,
    cover: { name: 'cover.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    meta: { title: '红楼梦', creator: '曹雪芹', publisher: '人民文学出版社', language: 'zh' },
    keepOrig: false, skipExisting: false
  };
  book.base64 = Buffer.from(book.markdown, 'utf8').toString('base64');

  const upRes = await s.uploadBook(book);
  if (process.env.DEBUG) {
    console.log('upload result:', JSON.stringify(upRes));
    console.log('--- log ---');
    console.log(win.document.getElementById('logBox').textContent.slice(-1500));
  }

  const idxRaw = readStoreText('books.json');
  let idx = null;
  try { idx = JSON.parse(idxRaw); } catch (e) {}
  if (process.env.DEBUG) console.log('books.json =\n' + idxRaw);

  ck('books.json 已写入', !!idx);
  ck('保留了原书条目', !!(idx && idx.sanguoyanyi && idx.sanguoyanyi.title === '三国演义'),
    '旧条目被覆盖了');
  ck('新书条目带真书名', !!(idx && idx['红楼梦'] && idx['红楼梦'].title === '红楼梦'));
  ck('新书条目带作者', !!(idx && idx['红楼梦'] && idx['红楼梦'].author === '曹雪芹'));
  ck('新书记录字符数', !!(idx && idx['红楼梦'] && idx['红楼梦'].chars > 6000),
    idx && idx['红楼梦'] ? String(idx['红楼梦'].chars) : 'missing');
  ck('新书记录图片数', !!(idx && idx['红楼梦'] && idx['红楼梦'].images === 3));
  ck('封面扩展名跟随实际文件', !!(idx && idx['红楼梦'] && idx['红楼梦'].cover === 'cover.png'),
    idx && idx['红楼梦'] ? String(idx['红楼梦'].cover) : 'missing');

  /* ------------- 场景 2：README 书架 ------------- */
  await s.updateReadme('test-token', { full: 'wh/books', default_branch: 'main' });
  const readme = readStoreText('README.md');
  ck('README.md 已生成', !!readme);

  if (readme) {
    ck('有技能表格表头', /\|\s*封面\s*\|\s*名称\s*\|\s*文件\s*\|\s*规模\s*\|/.test(readme));
    ck('封面用 <img> 真图展示', /<img src="sanguoyanyi\/cover\.jpg" width="76"/.test(readme),
      '封面没有渲染成图片');
    ck('封面路径带目录且中文可读', /<img src="红楼梦\/cover\.png"/.test(readme),
      '路径拼错或中文被整串百分号编码了');
    ck('书名取索引里的真名', /<b>三国演义<\/b>/.test(readme), '只显示文件夹名');
    ck('书名可点进正文', /<a href="sanguoyanyi\/sanguoyanyi\.md"><b>三国演义<\/b><\/a>/.test(readme));
    ck('作者写在书名下面', /<br><sub>罗贯中 · 人民文学出版社<\/sub>/.test(readme));
    ck('规模显示字数与图数', /68 万字<br>2 图/.test(readme), '规模列不对');
    ck('总字数汇总到页首', /约 \*\*[0-9.]+ 万字\*\*/.test(readme));
    ck('无封面的书显示占位', /<sub>无封面<\/sub>/.test(readme));
    ck('每行都是 4 列', readme.split('\n').filter(l => l.startsWith('| <')).every(l => (l.match(/\|/g) || []).length === 5),
      '某一行竖线数量不对，表格会错列');
    ck('没有残留旧式 "### 书名" 标题', !/^### /m.test(readme));
    ck('没有指向 cover 无扩展名的坏链接', !/\/cover\)/.test(readme));
    /* 首页必须自带生成时间：GitHub 目录列表显示的是**目录里文件**的最后修改时间，
       只重建 README 不会动那些文件，目录时间不变 —— 有这一行才分得清
       "首页没刷新"和"书没更新"。 */
    ck('页首标出最近更新时间', /<sub>最近更新 \d{4}-\d{2}-\d{2} \d{2}:\d{2}<\/sub>/.test(readme),
      '没有时间戳，无法判断首页是不是最新');
    ck('每本书标出上传日期', /68 万字<br>2 图<br><sub>2026-10-01<\/sub>/.test(readme),
      '没有把 books.json 里的 updated 显示出来');
    if (process.env.DEBUG) console.log('--- README ---\n' + readme);
  }

  /* ------------- 场景 3：仓库里没有 books.json，退回文件夹名 ------------- */
  store.delete('books.json');
  await s.updateReadme('test-token', { full: 'wh/books', default_branch: 'main' });
  const readme2 = readStoreText('README.md');
  ck('无索引时仍能生成', !!readme2);
  if (readme2) {
    ck('无索引时回退文件夹名', /<b>sanguoyanyi<\/b>/.test(readme2));
    ck('无索引时不编造上传日期', !/<sub>\d{4}-\d{2}-\d{2}<\/sub>/.test(readme2),
      '没有索引却凭空出现了日期');
    ck('无索引时封面照样显示', /<img src="sanguoyanyi\/cover\.jpg"/.test(readme2));
    ck('无索引时规模退回文件大小', /KB|MB|B<br>/.test(readme2));
  }

  /* ------------- 场景 4：真实 EPUB → 上传，核对图片路径 ------------
     这是"GitHub 上看不到图"的直接判据：
     markdown 里引用的每个 images/xxx 都必须真的提交到了仓库同名路径，
     差一个字符（空格、括号、大小写、扩展名）就是一张裂图。 */
  const ep = __dirname + '/samples/dirty.epub';
  if (fs.existsSync(ep)) {
    const buf = fs.readFileSync(ep);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const r = await s.epubToMarkdown(ab);

    const mb = {
      name: 'dirty.epub', kind: 'epub', folder: '脏文件名测试',
      state: 'ready', stateLabel: '已就绪',
      markdown: r.markdown,
      images: r.images,
      base64: Buffer.from(r.markdown, 'utf8').toString('base64'),
      origB64: null, edited: false, cover: r.cover, meta: r.meta,
      keepOrig: false, skipExisting: false
    };
    const patchesBefore = batchPatches, putsBefore = perFilePuts;
    await s.uploadBook(mb);
    // 批量提交是快路径。它一旦失败会静默退回逐文件上传，
    // 书照样传得上去，只是慢 10 倍 —— 所以必须单独断言，不能靠"图片都到了"来代表没退化。
    ck('上传走的是批量提交（1 个 commit）', batchPatches - patchesBefore >= 1,
      '批量提交一次都没成功');
    ck('没有退回逐文件上传', perFilePuts === putsBefore,
      '逐文件上传 ' + (perFilePuts - putsBefore) + ' 次');

    const refs = [...r.markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => decodeURIComponent(m[1]));
    const missing = refs.filter(p => !store.has('脏文件名测试/' + p));
    ck('md 引用的每张图都已提交到仓库', missing.length === 0,
      missing.slice(0, 4).join(' , '));

    const bad = refs.filter(p => /[\s#()]/.test(p) || /%(?![0-9A-Fa-f]{2})/.test(p));
    ck('提交路径里没有会破坏链接的字符', bad.length === 0, bad.slice(0, 4).join(' , '));

    // 大小写不一致的同一张图只能提交一份
    const upNames = [...store.keys()].filter(k => k.startsWith('脏文件名测试/images/') && /up\.jpg$/i.test(k));
    ck('大小写不同的同一张图只存一份', upNames.length === 1, upNames.join(' , '));

    const imgCount = [...store.keys()].filter(k => k.startsWith('脏文件名测试/images/')).length;
    ck('图片数量与转换结果一致', imgCount === r.images.length,
      '仓库 ' + imgCount + ' 张，转换产出 ' + r.images.length + ' 张');

    /* 上传前先在本地看效果：导出的 HTML 必须把图全部内嵌，
       否则存下来打开就是一片裂图，等于没预览。 */
    const demo = s.exportPreviewHtml({ markdown: r.markdown, images: r.images, meta: r.meta, folder: '脏文件名测试' });
    const nImg = (demo.match(/<img /g) || []).length;
    const nData = (demo.match(/src="data:image\//g) || []).length;
    ck('导出的 HTML 是完整文档', /^<!doctype html>/i.test(demo) && /<\/html>\s*$/.test(demo));
    ck('导出的 HTML 每张图都内嵌了', nImg > 0 && nImg === nData, nImg + ' 张，内嵌 ' + nData);
    ck('导出的 HTML 带了书名与图数', demo.includes('脏文件名') || demo.includes('dirty'), '标题丢了');

    /* ---------- 场景 5：勾了「已存在文件一律不覆盖」时，改动会被静默吞掉 ----------
       老大踩的原坑：改完转换逻辑重传，日志写"27 个文件内容未变"，
       但 GitHub 上一点没变（文件夹时间还是昨天的）。
       原因：勾上那个开关后压根不比对内容，看见同名就 continue，日志措辞却是"内容未变"。
       现在必须能明确报出"这些文件其实变了，是被设置挡住的"。 */
    const mdPath = '脏文件名测试/脏文件名测试.md';
    const beforeMd = readStoreText(mdPath);
    const changed = Object.assign({}, mb, {
      markdown: mb.markdown + '\n\n## 新增一节\n\n模拟转换逻辑修复之后的新输出。\n',
      skipExisting: true
    });
    changed.base64 = Buffer.from(changed.markdown, 'utf8').toString('base64');

    const rHeld = await s.uploadBook(changed);
    ck('勾「不覆盖」时能识别出内容确实变了', rHeld.held > 0, 'held=' + rHeld.held + '，被当成没变化了');
    ck('勾「不覆盖」时仓库内容保持不动', readStoreText(mdPath) === beforeMd);

    const rForce = await s.uploadBook(Object.assign({}, changed, { skipExisting: false }));
    ck('取消「不覆盖」后能真正提交', rForce.uploaded > 0, 'uploaded=' + rForce.uploaded);
    ck('取消「不覆盖」后仓库内容已更新', readStoreText(mdPath) !== beforeMd);

    /* 场景 6：内容一模一样时再传一次 —— 必须"0 提交"且能说清是哪几个没变。
       界面以前把这种情况也标成"已上传"，用户去 GitHub 一看没动，只能怀疑工具坏了。 */
    const rSame = await s.uploadBook(Object.assign({}, changed, { skipExisting: false }));
    ck('内容一致时不提交任何文件', rSame.uploaded === 0, 'uploaded=' + rSame.uploaded);
    ck('能报出没变化的文件清单', (rSame.sameFiles || []).some(p => /\.md$/i.test(p)),
      (rSame.sameFiles || []).join(',') || '空');
    ck('内容一致时不算被设置挡住', (rSame.held || 0) === 0, 'held=' + rSame.held);
  }

  /* ------------- 场景 7：无真封面的书（PDF / .md）自动补文字封面 ------------
     封面只在解析 EPUB 时从 OPF 里取，PDF 和直接上传的 .md 根本没有这一步，
     以前这类书在 README 里只能写「无封面」，一排看过去像坏了几本。 */
  {
    const pdfBook = {
      name: '博弈skill.pdf', kind: 'pdf', folder: '博弈skill',
      state: 'ready', stateLabel: '已就绪',
      markdown: '', images: [],
      base64: Buffer.from('%PDF-1.4 fake').toString('base64'),
      origB64: null, edited: false,
      cover: null,
      meta: { title: '博弈skill' },
      keepOrig: false, skipExisting: false
    };
    await s.uploadBook(pdfBook);

    ck('PDF 书会生成文字封面', store.has('博弈skill/cover.svg'), '没有 cover.svg');
    const svg = readStoreText('博弈skill/cover.svg') || '';
    ck('文字封面是合法 SVG 且写着书名', /^<svg[\s>]/.test(svg) && svg.includes('博弈skill'));
    ck('文字封面不含脚本', !/<script/i.test(svg));
    ck('文字封面体积够小（几 KB 以内）', svg.length > 200 && svg.length < 6000, svg.length + ' 字节');

    await s.updateReadme('test-token', { full: 'wh/books', default_branch: 'main' });
    const readme3 = readStoreText('README.md') || '';
    ck('README 引用生成的封面', /<img src="博弈skill\/cover\.svg"/.test(readme3),
      'README 里还是「无封面」');
    ck('books.json 记的是 cover.svg',
      (() => { try { return JSON.parse(readStoreText('books.json'))['博弈skill'].cover === 'cover.svg'; }
               catch (e) { return false; } })());
  }

  /* ------------- 场景 8：补齐历史书籍缺失的封面 -------------
     以前传过的 PDF / .md 书，仓库里只有 xxx.pdf / xxx.md。
     点一次「重建首页」就该把它们补齐，不用一本本重传。 */
  {
    putFile('宏观skill/宏观skill.pdf', Buffer.from('%PDF-1.4 old'));
    const realCoverSha = store.get('sanguoyanyi/cover.jpg').sha;

    const filled = await s.fillMissingCovers('test-token', { full: 'wh/books', default_branch: 'main' });
    ck('能补齐历史书籍缺失的封面', filled >= 1, 'filled=' + filled);
    ck('补出来的封面落在正确目录', store.has('宏观skill/cover.svg'));
    ck('已有真封面的书不会被覆盖', store.get('sanguoyanyi/cover.jpg').sha === realCoverSha);
    ck('补封面不会伪造书籍文件', !store.has('宏观skill/宏观skill.md'));
  }

  /* ------------- 场景 9：空文件必须计入失败 -------------
     「部分成功」这个状态要有实据：EPUB 里某张图解压出来是空的，那就是一个文件没进仓库。
     若空文件被静默跳过，界面就会显示"成功"，而仓库里其实少了一张图。 */
  {
    const badBook = {
      name: '坏文件测试.epub', kind: 'epub', folder: '坏文件测试',
      state: 'ready', stateLabel: '已就绪',
      markdown: '# 坏文件测试\n\n正文',
      images: [['good.png', new Uint8Array([1, 2, 3])], ['empty.png', new Uint8Array(0)]],
      base64: null, origB64: null, edited: false,
      cover: null, meta: { title: '坏文件测试' },
      keepOrig: false, skipExisting: false
    };
    badBook.base64 = Buffer.from(badBook.markdown, 'utf8').toString('base64');
    const r = await s.uploadBook(badBook);
    ck('空文件计入失败', r.failed === 1, 'failed=' + r.failed);
    ck('同一本书的其他文件照常上传', r.uploaded > 0, 'uploaded=' + r.uploaded);
    ck('空文件不会在仓库里留下空壳', !store.has('坏文件测试/images/empty.png'));
    ck('正常文件仍然进了仓库', store.has('坏文件测试/images/good.png'));
  }

  /* 折行必须按视觉宽度：按字符个数折，"博弈skill" 会被切成 "博弈skil" + "l" */
  {
    const rows = t => [...s.makeTextCover(t, 'pdf').matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(m => m[1]);
    ck('中英混排书名不断词', rows('博弈skill').length === 1, JSON.stringify(rows('博弈skill')));
    ck('长书名折成多行', rows('一个特别特别长的书名用来测试折行效果').length === 3);
    ck('英文书名换行不留前导空格', rows('The Art of War').every(r => !/^\s/.test(r)),
      JSON.stringify(rows('The Art of War')));
  }

  console.log('\n通过 ' + pass + ' / ' + total);
  if (fails.length) { console.log('失败：\n  - ' + fails.join('\n  - ')); process.exit(1); }
})().catch(e => { console.error('测试脚本异常：', e); process.exit(1); });
