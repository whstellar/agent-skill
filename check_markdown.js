/**
 * Markdown 合规性检查 —— 转换质量的客观标尺
 *
 * 用法：
 *   node check_markdown.js [样本名]
 *   （样本名默认 md_check，即"元素大全"那本）
 *
 * 做法：转换后用**两个解析器**交叉验证，而不是肉眼看输出：
 *   - marked      → GitHub 实际使用的 GFM 解析器（能识别表格、删除线）
 *   - commonmark  → CommonMark 官方规范（基础语法）
 *
 * 检查两类：
 *   A 语法合法性 —— 任何书都必须满足（标记成对、围栏成对、无跳级标题…）
 *   B 元素保真   —— 原书有的元素，输出里必须还在（按样本实际情况条件检查）
 *
 * 退出码：全部通过 0，有失败 1。可直接接入 CI。
 */
const fs = require('fs'), vm = require('vm'), { JSDOM } = require('jsdom');
const { marked } = require('marked');
const CM = require('commonmark');

const SAMPLE = process.argv[2] || 'md_check';
/** 支持两种用法：
 *    node check_markdown.js            → 扫描 samples/ 下所有 EPUB
 *    node check_markdown.js <名字>      → 只跑指定样本
 *  两种模式复用同一套检查逻辑，保证与页面内面板的结论一致。 */
const html = fs.readFileSync(__dirname + '/book2md.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const dom = new JSDOM(html, { url: 'http://localhost/' });
const win = dom.window;
const s = {
  window: win, document: win.document, DOMParser: win.DOMParser, Blob, Response, DecompressionStream,
  TextEncoder, TextDecoder, XMLSerializer: win.XMLSerializer, localStorage: win.localStorage,
  FileReader: win.FileReader, File: win.File,
  btoa: x => Buffer.from(x, 'binary').toString('base64'),
  atob: x => Buffer.from(x, 'base64').toString('binary'),
  URL: { createObjectURL: () => 'b', revokeObjectURL: () => {} },
  alert: () => {}, setTimeout, clearTimeout, setInterval, clearInterval, console
};
s.self = s; s.globalThis = s; vm.createContext(s);
vm.runInContext(code, s);

function cmTypes(md) {
  const ast = new CM.Parser().parse(md);
  const types = {};
  (function walk(n) {
    if (!n) return;
    const t = n.type || (n.t || 'doc');
    types[t] = (types[t] || 0) + 1;
    if (n.firstChild) walk(n.firstChild);
    if (n._next) walk(n._next);
  })(ast);
  return types;
}

let pass = 0, total = 0;
const fails = [];
const ck = (name, cond, detail) => {
  total++;
  if (cond) pass++;
  else fails.push(name + (detail ? ' — ' + detail : ''));
  if (!cond || process.env.VERBOSE) {
    console.log((cond ? '  OK  ' : '  ✗   ') + name.padEnd(32) + (cond ? '' : (detail || '')));
  }
};

/** 条件断言：原书里有某元素时才检查它是否保留下来 */
const ckIf = (cond0, name, cond, detail) => { if (cond0) ck(name, cond, detail); };

/* 标题层级重排的单元测试：与具体哪本书无关，跑一次即可。
   用户实际报过「第 289 行 H2 之后，第 349 行直接是 H4（故事引申）」，
   根因是 normalizeHeadings 用"出现过的级别列表"做映射 —— 那只能保证不同级别不撞车，
   保证不了连续。现在改成父级栈推导深度，这里把"结构上不可能跳级"这件事锁死。 */
function checkHeadingNormalize(){
  const cases = [
    ['章下面直接 h4', ['## 第一章', 'x', '#### 故事引申', 'x', '## 第二章']],
    ['h6 夹在 h2 与 h4 之间', ['## 第一章', 'x', '###### 怪标题', 'x', '#### 故事引申', 'x', '## 第二章']],
    ['正常的 h1–h3', ['# 章', '## 节', '### 小节', '## 节二']],
    ['h1–h6 全用', ['# a', '## b', '### c', '#### d', '##### e', '###### f']]
  ];
  const bad = [];
  for (const [name, lines] of cases) {
    const out = s.normalizeHeadings(lines.join('\n\n'));
    const lv = out.split('\n').filter(l => /^#{1,6} /.test(l)).map(l => l.match(/^#+/)[0].length);
    for (let i = 1; i < lv.length; i++) {
      if (lv[i] - lv[i - 1] > 1) bad.push(`${name}: H${lv[i - 1]}→H${lv[i]}`);
    }
    if (/^#{7,} /m.test(out)) bad.push(name + ': 超过 H6');
    if (lv[0] < 2) bad.push(name + ': 正文出现了 H1（H1 留给书名）');
  }
  return bad;
}

/* 单星号配对扫描的单元测试。
   以前只扫 `**`，单个 `*` 未闭合完全不报 —— 而这种现象很显眼：
   GitHub 会把后面一大段都变斜体，星号还可能原样露出来（"**降低…模**式"就是这一类）。
   难点在误报：乘号 5*3、变量 a*b、代码块/行内代码里的星号都不能算。 */
function checkItalicScan(){
  const cases = [
    ['*用数据说话\n\n**降低不平等的斯堪的纳维亚模**式', true,  '未闭合单星号'],
    ['这是 *斜体* 文字',                              false, '正常斜体'],
    ['这是 **粗体** 文字',                            false, '粗体不该被当成斜体'],
    ['*a* 和 *b* 都斜',                               false, '多组斜体'],
    ['价格 5*3 元',                                   false, '乘号'],
    ['设 a*b 为积',                                   false, '变量相乘'],
    ['```\n*注释\n```',                              false, '代码块里的星号'],
    ['用 `*` 表示星号',                               false, '行内代码'],
    ['显示 \\* 这个符号',                             false, '转义的星号'],
    ['***又粗又斜***',                                false, '粗斜体三星号']
  ];
  const bad = [];
  for (const [md, want, name] of cases) {
    const got = s.scanItalic(md).unmatched;
    if (got !== want) bad.push(name + '：期望 ' + want + '，实际 ' + got);
  }
  return bad;
}

/* 强调标记内侧空白：用户报过「**绝对优**势」——正文里明明加粗了，GitHub 上
   却把 ** 原样印出来。根因不是渲染器，是生成的 Markdown 不合法：
   CommonMark 规定强调标记内侧不能贴空格（`** 绝对优**`、`**绝对优 **` 都不闭合）。
   而电子书里 <b>\n  文字</b> 这种换行缩进太常见，内层文本天然以空格开头。

   这里锁三件事：
     ① wrapMark 一定把首尾空白挪到标记外面（生成侧根治）；
     ② 任何写法的 Markdown 过一遍 cleanupMd，用**真解析器**验证不再露星号（兜底）；
     ③ 扫描器既要报出破损形态（不漏报），又不能把原文里的字面星号当 bug（不误报）。
   第三点是关键：漏报过（只数配对），也误报过（把「直接写 ** 而不加空格」算成错误）。 */
function checkEmphasisRender(){
  const bad = [];
  const plainOf = md => new CM.HtmlRenderer()
    .render(new CM.Parser().parse(md))
    .replace(/<pre>[\s\S]*?<\/pre>/g, '')
    .replace(/<code>[\s\S]*?<\/code>/g, '')
    .replace(/<[^>]+>/g, '');

  // ① wrapMark：首尾空白必须挪到标记外，内层已有 * 时宁可不加标记
  const wm = [
    [' 绝对优 ', '**', '**绝对优**', '首尾空格'],
    ['\u3000绝对优\u3000', '**', '**绝对优**', '全角空格'],
    [' 斜体 ', '*', '*斜体*', '斜体首尾空格'],
    [' 删掉 ', '~~', '~~删掉~~', '删除线首尾空格'],
    ['a*b', '**', 'a*b', '内层已有星号不再套'],
    ['   ', '**', '', '纯空白']
  ];
  for (const [raw, mark, want, name] of wm) {
    const got = s.wrapMark(raw, mark);
    if (got !== want) bad.push(`wrapMark ${name}：期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`);
  }

  // ② 各种脏写法过一遍 cleanupMd，真解析器视角下不许再露 **
  let n = 0;
  for (const pre of ['', '锁。', '## ', '- ', '> '])
    for (const body of ['绝对优', ' 绝对优', '绝对优 ', '\u3000绝对优', '绝对优\u3000', '绝对 优'])
      for (const post of ['', '势']) {
        const src = pre + '**' + body + '**' + post;
        n++;
        if (/\*\*/.test(plainOf(s.cleanupMd(src)))) bad.push(`清洗后仍露星号：${JSON.stringify(src)}`);
      }

  // ③ 扫描器：该报的一个不能漏
  const mustReport = ['** 绝对优**', '**绝对优 **', '**\u3000绝对优**', '**绝对优\u3000**',
                      '锁。** 绝对优**势', '## **绝对优 **势', '- ** 绝对优**'];
  for (const md of mustReport) {
    if (!s.scanBold(md).unmatched) bad.push(`漏报破损粗体：${JSON.stringify(md)}`);
  }
  // ③ 扫描器：原文里的字面星号一个不能报
  const mustNot = ['**绝对优**势', '**绝对优**', '直接写 ** 而不加空格', '2**  y', 'x  **2',
                   '****', '价格 5*3 元', '设 a*b 为积', '用 `**x**` 表示', '* * *',
                   '这是*斜体*，这不是 * 裸星号。',
                   /* 逐字加粗的姓名（<b>徐</b><b>浩</b><b>庆</b>）拼出四个星号连排，
                      cmark 是能渲染的（套一层多余的 strong），不能报错。 */
                   '**徐****浩****庆**，中国社会科学院经济研究所研究员。'];
  for (const md of mustNot) {
    const b = s.scanBold(md).unmatched, i = s.scanItalic(md).unmatched;
    if (b || i) bad.push(`误报字面星号：${JSON.stringify(md)}（粗体=${b} 斜体=${i}）`);
  }

  // ③b 接缝必须被合并成一个 **：**徐****浩****庆** → **徐浩庆**
  for (const [src, want] of [
    ['**徐****浩****庆**', '**徐浩庆**'],
    ['**徐****浩**', '**徐浩**'],
    ['**a****b****c****d**', '**abcd**'],
    ['**徐** + **浩**', '**徐** + **浩**']          // 中间有内容，不能并
  ]) {
    const got = s.cleanupMd(src);
    if (got !== want) bad.push(`接缝未合并：${JSON.stringify(src)} → ${JSON.stringify(got)}（期望 ${JSON.stringify(want)}）`);
  }

  // ③c 行内代码里的示范字符串一个字都不能动
  const codeKeep = '示范 `**徐****浩****庆**` 与 `** a**` 写法';
  if (s.cleanupMd(codeKeep) !== codeKeep) bad.push('行内代码里的示范字符串被改了：' + s.cleanupMd(codeKeep));

  // ④ 报错行号必须指向真正那一行（曾经永远指第 1 行 = 书名，看着莫名其妙）
  const md = '# 书名\n\n## 第一章\n\n正文一段。\n\n** 绝对优**势\n\n后面还有。\n';
  const hit = s.scanBold(md);
  if (!hit.unmatched || hit.line !== 7) bad.push(`行号定位不准：期望第 7 行，实际 ${hit.line}`);

  /* ⑤ 预览必须和 GitHub 一样严格。
     本地预览要是把 `**绝对优 **` 也加粗，用户就永远发现不了问题 ——
     这正是"本地看着好好的、上传后全是星号"的成因。 */
  const pv = [
    ['**绝对优**势', true,  '正常粗体'],
    ['**绝对优 **势', false, '内侧贴空格不该加粗'],
    ['** 绝对优**势', false, '开头贴空格不该加粗'],
    ['*斜体 *后面',   false, '斜体内侧贴空格不该变斜体']
  ];
  for (const [src, want, name] of pv) {
    const out = s.renderMdPreview(src, null);
    const got = /<strong>|<em>/.test(out);
    if (got !== want) bad.push(`预览与 GitHub 不一致（${name}）：期望加粗=${want}，实际=${got}`);
  }

  return { bad, n };
}

/* 代码块：位置不能被挪走，内容里的 ``` 也不能提前关掉围栏。
   以前 cleanupMd 把围栏块抽出来**追加到文末**，第 2 章的示例代码会跑到全书最后；
   围栏又固定写三个反引号，内容里的 ```python 会被当成结束标记 ——
   两种错叠在一起，GitHub 上看到的是半本书变成灰色代码块。 */
function checkCodeFence(){
  const bad = [];
  let n = 0;
  const md = s.htmlToMarkdown(
    '<h1>第一章</h1><p>代码块之前</p>' +
    '<pre><code>```\n# 这是注释不是标题\nprint(1)\n```</code></pre>' +
    '<p>代码块之后</p>',
    { currentFile: 'OEBPS/c1.xhtml', mapImage: null });

  /* ① 代码块必须停在原来的位置。
     以前 cleanupMd 把围栏块抽出来**追加到文末** —— 第 2 章的代码会跑到全书最后，
     而日志里一个字都不会提，只能靠人翻到底才发现。 */
  const before = md.indexOf('代码块之前'), after = md.indexOf('代码块之后'),
        fence = md.indexOf('```');
  n++;
  if(!(fence > before && fence < after)) bad.push('代码块被挪到了文末：' + JSON.stringify(md));

  /* ② 内容里的 ``` 不能提前关掉围栏 —— 围栏必须比内容里最长一段反引号更长。
     固定写三个反引号的话，代码块后半截会漏出去，后面的正文整个变成代码块。 */
  n++;
  if(!/^````$/m.test(md)) bad.push('内容含 ``` 时围栏没有加长：' + JSON.stringify(md));

  /* ③ 围栏仍然成对。破栏的话文档末尾会多出两个空壳围栏。 */
  n++;
  if((md.match(/^`{3,}/gm) || []).length % 2 !== 0)
    bad.push('围栏不成对：' + JSON.stringify(md));

  /* ④ 语言标注：<code class="language-x"> 要带到围栏上，GitHub 才做语法高亮 */
  const md2 = s.htmlToMarkdown('<pre><code class="language-python">print(1)</code></pre>',
                               { currentFile: 'OEBPS/c1.xhtml', mapImage: null });
  n++;
  if(!/^```python$/m.test(md2)) bad.push('代码块没带语言标注：' + JSON.stringify(md2));

  /* ⑤ 表格单元格里的 <br> 要保留成 <br>，不能被空白压成一个空格。
     否则"第一行 / 第二行"粘成"第一行第二行"，数据静默变形。 */
  const md3 = s.htmlToMarkdown('<table><tr><th>列</th></tr><tr><td>a<br>b</td></tr></table>',
                               { currentFile: 'OEBPS/c1.xhtml', mapImage: null });
  n++;
  if(!/\| a<br>b \|/.test(md3)) bad.push('表格单元格换行被吃掉了：' + JSON.stringify(md3));

  return { bad, n };
}

/* 重复配图：同一张装饰图在书里被引用几十次是常态（真实书《现代》4827 张图里
   71 张内容完全相同，image_000.png 一个文件出现 26 次）。不去重就是白传 25 个
   一模一样的文件 —— 多 25 次 API 请求、多占仓库、README 上也看不出区别。
   这里用 check_markdown 之外的做法：直接对样例书做端到端验证。 */
async function checkImageDedupe(){
  const bad = [];
  const buf = fs.readFileSync(__dirname + '/samples/dup_img.epub');
  const r = await s.epubToMarkdown(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  // 4 张图里有 3 张内容相同 → 应该只剩 2 张
  if (r.images.length !== 2) bad.push(`应合并成 2 张图，实际 ${r.images.length} 张`);
  const names = r.images.map(([n]) => n);
  const refs = [...r.markdown.matchAll(/images\/([^)\s]+)/g)].map(m => m[1]);
  // 正文里的 4 处引用必须全部指向保留下来的那一张，不能出现"引用了被删掉的文件"
  for (const ref of refs) {
    if (!names.includes(ref)) bad.push(`正文引用了不存在的图：${ref}（实际有 ${names.join('、')}）`);
  }
  if (refs.length !== 5) bad.push(`应有 5 处配图引用（3+2），实际 ${refs.length} 处`);
  if (new Set(refs.filter(x => /divider/.test(x))).size !== 1) bad.push('同一张装饰图的引用没有统一指向一份');
  return bad;
}

(async () => {
  const arg = process.argv[2];
  const hb = checkHeadingNormalize();
  const is = checkItalicScan();
  const em = checkEmphasisRender();
  const cf = checkCodeFence();
  const dm = await checkImageDedupe();
  if (is.length) {
    console.log('✗ 斜体标记扫描不准：' + is.join('；') + '\n');
    if (!arg) process.exit(1);
  } else if (!arg) {
    console.log('  ✓ 斜体标记扫描：10 种情况（未闭合/正常/乘号/代码块/转义/三星号）判定全对\n');
  }
  if (em.bad.length) {
    console.log('✗ 强调标记内侧空白：' + em.bad.slice(0, 5).join('；') + '\n');
    if (!arg) process.exit(1);
  } else if (!arg) {
    console.log(`  ✓ 强调标记内侧空白：wrapMark 6 例 + ${em.n} 种脏写法清洗后真解析器不再露星 + 漏报 7 / 误报 12 / 接缝合并 4 / 行内代码免疫 1 / 预览对齐 4 例，全过\n`);
  }
  if (dm.length) {
    console.log('✗ 重复配图没合并：' + dm.join('；') + '\n');
    if (!arg) process.exit(1);
  } else if (!arg) {
    console.log('  ✓ 重复配图：3 张内容相同的装饰图合并成 1 张，正文 5 处引用全部改指向它\n');
  }
  if (cf.bad.length) {
    console.log('✗ 代码块：' + cf.bad.slice(0, 5).join('；') + '\n');
    if (!arg) process.exit(1);
  } else if (!arg) {
    console.log(`  ✓ 代码块：${cf.n} 条（留在原位 / 内容含围栏时自动加长 / 语言标注 / 表格换行保留）全过\n`);
  }
  if (hb.length) {
    console.log('✗ 标题层级重排产生跳级：' + hb.join('；') + '\n');
    if (!arg) process.exit(1);
  } else if (!arg) {
    console.log('  ✓ 标题层级重排：4 种脏结构（章下直接 h4 / h6 夹中间 / 正常三级 / 六级全用）均无跳级\n');
  }
  if(!arg){
    const dir = __dirname + '/samples';
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.epub')) : [];
    if(!files.length){ console.log('samples/ 下没有 EPUB 可检查'); process.exit(0); }
    console.log('批量检查 ' + files.length + ' 本：' + files.map(f => f.replace(/\.epub$/, '')).join('、') + '\n');
    const bad = [];
    for(const f of files){
      const name = f.replace(/\.epub$/, '');
      const rc = await runOne(name);
      if(rc !== 0) bad.push(name);
      console.log('');
    }
    console.log(bad.length === 0
      ? `结论：全部 ${files.length} 本通过`
      : `结论：${bad.length} / ${files.length} 本有问题 → ${bad.join('、')}`);
    process.exit(bad.length ? 1 : 0);
  }
  process.exit(await runOne(arg));
})().catch(e => { console.error('FAIL:', e.stack); process.exit(1); });

async function runOne(SAMPLE){
  pass = 0; total = 0; fails.length = 0;
  const buf = fs.readFileSync(__dirname + '/samples/' + SAMPLE + '.epub');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const t0 = Date.now();
  const r = await s.epubToMarkdown(ab);
  const ms = Date.now() - t0;
  const md = r.markdown;
  const cm = cmTypes(md);
  let gfm = '', markedErr = null;
  try { gfm = marked.parse(md, { gfm: true }); } catch (e) { markedErr = e.message; }

  if (process.env.SHOW) { console.log(md); console.log(); }

  // ---------- A0. 内置校验器（页面里实时用的那一套）----------
  // 批量检查复用页面内置逻辑，保证"命令行报告"与"用户看到的面板"结论一致
  const v = s.validateMarkdown(md, new Set(r.images.map(([n]) => n)));
  ck('内置校验器无错误', v.errorCount === 0, v.issues.filter(i => i.level === 'err').map(i => i.msg).join('; '));
  v.issues.filter(i => i.level === 'warn').forEach(i =>
    console.log('     提醒: ' + i.msg));

  // ---------- A. 语法合法性：与具体书无关，任何输出都必须满足 ----------
  /* 标题必须排除代码围栏里的行 —— 代码块里的 `# 注释` 不是标题。
     用页面里同一套 fenceMask，保证"命令行报告"和"用户看到的面板"结论一致。 */
  const mls = md.split('\n');
  const msk = s.fenceMask(mls);
  const hs = mls.filter((l, i) => !msk[i] && /^#{1,6} /.test(l))
                .map(l => l.match(/^(#{1,6}) /)[1].length);
  const stripped = md.replace(/^\s*```[\s\S]*?^\s*```/gm, '');
  /* 表格按「连续以 | 开头的行」分块。整篇一起比会误报：
     一本书里 2 列的表和 4 列的表同时存在是正常的。 */
  const tableBlocks = [];
  { let cur = [];
    for (const l of md.split('\n')) {
      if (/^\|/.test(l)) cur.push(l);
      else if (cur.length) { tableBlocks.push(cur); cur = []; }
    }
    if (cur.length) tableBlocks.push(cur);
  }
  const tableLines = tableBlocks.flat();
  let tickDepth = 0;
  for (const m of stripped.matchAll(/`+/g)) {
    const n = m[0].length;
    if (tickDepth === 0) tickDepth = n;
    else if (tickDepth === n) tickDepth = 0;
  }
  let jump = null;
  for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) { jump = hs[i - 1] + '→' + hs[i]; break; }

  ck('转换器未抛异常', true);
  ck('marked 解析无异常', markedErr === null, markedErr || '');
  /* 不能只数 `**` 的奇偶 —— 原文里的字面星号（"直接写 ** 而不加空格"）会让
     计数变成奇数，那是合法内容。要问的是"能不能渲染出来"，交给扫描器。 */
  ck('** 粗体标记能渲染', !s.scanBold(md).unmatched, s.scanBold(md).snippet || '');
  ck('``` 围栏成对', (md.match(/^```/gm) || []).length % 2 === 0);
  ck('行内反引号跨度闭合', tickDepth === 0);
  ck('<sub> 成对', (md.match(/<sub>/g) || []).length === (md.match(/<\/sub>/g) || []).length);
  ck('<sup> 成对', (md.match(/<sup>/g) || []).length === (md.match(/<\/sup>/g) || []).length);
  ck('标题层级不跳级', jump === null, jump || '');
  ck('标题层级在 H1-H6', hs.every(h => h >= 1 && h <= 6), 'levels=' + [...new Set(hs)].join(','));
  ck('每张表内部列数一致', tableBlocks.every(rows => {
    const cols = rows
      .filter(l => !/^\|[\s:|-]+\|$/.test(l))
      .map(l => l.replace(/\\\|/g, '\u0001').split('|').length);
    return cols.length === 0 || cols.every(c => c === cols[0]);
  }), '');

  /* EPUB 里的图片名常带空格、括号、井号（"my photo 1.jpg"、"figure(2).png"），
     这些字符在 Markdown 链接里是语法的一部分，出现在目标里就等于裂图。 */
  const imgTargets = [...md.matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)].map(m => m[1]);
  const badTargets = imgTargets.filter(t => /[\s#()]/.test(t));
  ck('图片路径无未编码空格/括号/井号', badTargets.length === 0, badTargets.slice(0, 3).join(' , '));
  const barePercent = imgTargets.filter(t => /%(?![0-9A-Fa-f]{2})/.test(t));
  ck('图片路径无裸百分号', barePercent.length === 0, barePercent.slice(0, 3).join(' , '));

  ck('文首标题非空', !/^#{1,6}\s*$/m.test(md), '有空标题行');
  ck('链接目标无未编码空格', !/\]\([^)]* [^)]*\)/.test(md));
  // 判定方式：正文（围栏外）里不应出现"以 # 开头的代码注释"。
  // 不能简单检查 stripped 里有没有 # —— 那会把正常的书名标题也算进去。
  ck('代码块内 # 未变成标题', (() => {
    const outside = stripped.split('\n').filter(l => /^# /.test(l));
    // 正文中允许的标题：以 # 开头且后面是中文/字母标题文字（而非代码语句）
    const suspicious = outside.filter(l => {
      const t = l.replace(/^#+\s*/, '');
      return /^\s*(def |class |import |from |return |print\(|[{};]|\/\/|\/\*|\*\/|#)/.test(t);
    });
    return suspicious.length === 0;
  })(), (() => {
    const outside = stripped.split('\n').filter(l => /^# /.test(l));
    return outside.length ? '围栏外出现 #' + outside.slice(0, 3).join(' / ') : '';
  })());
  ck('非空输出', md.trim().length > 0);

  // ---------- B. 元素保真：原书里有才查 ----------
  ckIf((cm.emph || 0) > 0, '斜体被保留', /<em>/.test(gfm), '输出无 <em>');
  ckIf(/\*\*/.test(md), '粗体被保留', /<strong>/.test(gfm), '输出无 <strong>');
  ckIf(/~~/.test(md), '删除线被保留', /<del>/.test(gfm), '输出无 <del>');
  ckIf((cm.code || 0) > 0 || /`/.test(stripped), '行内代码被保留', /<code>/.test(gfm), '输出无 <code>');
  ckIf(/^```/m.test(md), '围栏代码块被保留', /<pre><code/.test(gfm), '输出无 <pre>');
  ckIf(tableLines.length > 0, '表格被识别', /<table>/.test(gfm), '输出无 <table>');
  ckIf(tableLines.length > 0, '表头被识别', /<th>/.test(gfm), '输出无 <th>');
  ckIf(/^\s*[-*]\s/m.test(md), '无序列表被识别', /<ul>/.test(gfm), '输出无 <ul>');
  ckIf(/^\s*\d+\.\s/m.test(md), '有序列表被识别', /<ol>/.test(gfm), '输出无 <ol>');
  ckIf(/^\s*[-*]\s.*\n\s*[-*]\s/m.test(md), '多列表项被识别', /<li>[\s\S]*<li>/.test(gfm), '列表项未成组');
  ckIf(/^>\s/m.test(md), '引用块被识别', /<blockquote>/.test(gfm), '输出无 <blockquote>');
  ckIf(/!\[[^\]]*\]\([^)]+\)/.test(md), '图片被识别', /<img /.test(gfm), '输出无 <img>');
  // 链接断言必须排除图片语法 ![alt](path)，否则纯图片的书会被误判
  const linkOnly = /(^|[^!\\])\[[^\]]+\]\([^)]+\)/;
  ckIf(linkOnly.test(md), '链接被识别', /<a href/.test(gfm), '输出无 <a>');
  ckIf(/<sub>|<sup>/.test(md), '上下标被保留', /<sub>|<sup>/.test(gfm), '输出无 sub/sup');
  ckIf(/<img[^>]*\.svg|\.svg\)/.test(md), 'SVG 图片已导出', /\.svg\)/.test(md), '未见 svg 引用');

  // ---------- C. 内容保真：抽样若干原文片段，确认没被误删 ----------
  // 原书是 deflate 压缩的，直接在二进制里搜标签找不到；
  // 用转换器自己解出的章节 HTML 来判断（原书里有什么）。
  const original = (r.__chapters || []).join('\n');
  ckIf(original.includes('page-header'), '页眉已剔除', !/第三章\n/.test(md));
  ckIf(original.includes('— 12 —'), '页脚已剔除', !md.includes('— 12 —'));
  // 不能写死具体文字（各样本不同）：只要原书有 epub:type="footnote"，
  // 就检查输出里 footnote 元素的内容确实流出来了。
  ckIf(/epub:type="footnote"/.test(original), '脚注正文保留', (() => {
    const m = original.match(/epub:type="footnote"[^>]*>([\s\S]{0,300}?)<\/aside>/);
    if (!m) return true;
    // 取出脚注里的纯文字（去标签），检查是否出现在输出中
    const phrase = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
    return phrase.length < 3 || md.replace(/\s+/g, '').includes(phrase);
  })());
  ckIf(original.includes('class="bd"') || original.includes('font-weight:bold'), '整段加粗已剥离', !/\*\*这一整段很长的加粗文字/.test(md));
  ckIf(original.includes('class="em"'), 'CSS 类强调已识别', md.includes('*样式斜体*'));
  ckIf(original.includes('<svg') && original.includes('<text'), 'SVG 文本未泄漏', !md.includes('图内文字'));
  ckIf(original.includes('||'), '竖线已转义', md.includes('\\|'));

  console.log(`  ${SAMPLE}：${md.length} 字符 / ${r.images.length} 图 / ${ms}ms  →  ${pass}/${total} 通过`);
  if (fails.length){
    console.log('  失败项：');
    fails.forEach(f => console.log('    - ' + f));
    return 1;
  }
  return 0;
}