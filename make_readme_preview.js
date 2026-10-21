/**
 * 生成 README 书架的效果预览（readme_preview.html）
 *
 * 走的是页面里真实的 updateReadme()，只是把 GitHub 换成内存里的假仓库，
 * 所以预览出来什么样，真上传后就是什么样。封面用内联 SVG 顶替，免得预览里一片裂图。
 *
 * 用法：NODE_PATH=<工作区 node_modules> node make_readme_preview.js
 */
const fs = require('fs'), vm = require('vm'), { JSDOM } = require('jsdom');
const { marked } = require('marked');

const html = fs.readFileSync(__dirname + '/book2md.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const dom = new JSDOM(html, { url: 'http://localhost/' });
const win = dom.window;

/* ---------- 假仓库：5 本不同形态的书 ---------- */
const blobs = new Map();
const store = new Map();
let seq = 0;
const putBlob = buf => { const sha = 'b' + String(++seq).padStart(6, '0'); blobs.set(sha, Buffer.from(buf)); return sha; };
const putFile = (path, content) => store.set(path, { sha: putBlob(Buffer.from(content)) });

const BOOKS = [
  { dir: '三国演义',   md: true,  pdf: false, epub: true,  cover: 'cover.jpg',  imgs: 2  },
  { dir: '红楼梦',     md: true,  pdf: false, epub: false, cover: 'cover.png',  imgs: 3  },
  { dir: '人类简史',   md: true,  pdf: true,  epub: false, cover: 'cover.jpg',  imgs: 12 },
  { dir: '反抗者',     md: true,  pdf: true,  epub: false, cover: null,         imgs: 0  },
  { dir: '原理-skill', md: true,  pdf: true,  epub: false, cover: null,         imgs: 0  }
];
const INDEX = {
  '三国演义':   { title: '三国演义', author: '罗贯中', publisher: '人民文学出版社', chars: 682000, images: 2,  cover: 'cover.jpg' },
  '红楼梦':     { title: '红楼梦', author: '曹雪芹', publisher: '人民文学出版社', chars: 731000, images: 3,  cover: 'cover.png' },
  '人类简史':   { title: '人类简史：从动物到上帝', author: '尤瓦尔·赫拉利', publisher: '中信出版社', chars: 305000, images: 12, cover: 'cover.jpg' },
  '反抗者':     { title: '反抗者', author: '阿尔贝·加缪', publisher: '上海译文出版社', chars: 183000, images: 0 },
  '原理-skill': { title: '大模型原理速查', author: '', publisher: '', chars: 0, images: 0 }
};
for (const b of BOOKS) {
  putFile(`${b.dir}/${b.dir}.md`, '# ' + b.dir + '\n');
  if (b.cover) putFile(`${b.dir}/${b.cover}`, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  if (b.pdf) putFile(`${b.dir}/${b.dir}.pdf`, '%PDF-1.4');
  if (b.epub) putFile(`${b.dir}/${b.dir}.epub`, 'PK');
  for (let i = 1; i <= b.imgs; i++) putFile(`${b.dir}/images/${String(i).padStart(2, '0')}.jpg`, Buffer.from([i]));
}
putFile('books.json', JSON.stringify(INDEX, null, 2));

let pendingTree = null;
const ok = obj => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
const bad = (status, message) => ({ ok: false, status, text: async () => JSON.stringify({ message }) });

async function fakeFetch(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const u = String(url);
  if (method === 'GET' && /\/git\/trees\/[^?]+\?recursive=1/.test(u)) {
    return ok({ tree: [...store.entries()].map(([path, v]) => ({ path, type: 'blob', sha: v.sha, size: blobs.get(v.sha).length })) });
  }
  let m = u.match(/\/git\/blobs\/([^/?]+)$/);
  if (method === 'GET' && m) {
    const buf = blobs.get(m[1]);
    if (!buf) return bad(404, 'Not Found');
    return ok({ sha: m[1], content: buf.toString('base64'), encoding: 'base64' });
  }
  if (method === 'POST' && /\/git\/blobs$/.test(u)) return ok({ sha: putBlob(Buffer.from(JSON.parse(opts.body).content, 'base64')) });
  if (method === 'POST' && /\/git\/trees$/.test(u)) { pendingTree = JSON.parse(opts.body).tree; return ok({ sha: 'tree' }); }
  if (method === 'POST' && /\/git\/commits$/.test(u)) return ok({ sha: 'commit' });
  if (method === 'PATCH' && /\/git\/refs\/heads\//.test(u)) {
    if (pendingTree) { for (const e of pendingTree) store.set(e.path, { sha: e.sha }); pendingTree = null; }
    return ok({});
  }
  if (method === 'GET' && /\/commits\/[^/?]+(\?|$)/.test(u)) return ok([{ sha: 'commit-0', commit: { message: 'init' } }]);
  if (method === 'GET' && /\/repos\/[^/]+\/[^/]+$/.test(u)) return ok({ default_branch: 'main' });
  if (method === 'GET' && /\/user$/.test(u)) return ok({ login: 'wh' });
  m = u.match(/\/contents\/([^?]+)/);
  if (method === 'GET' && m) {
    const rec = store.get(decodeURIComponent(m[1]));
    if (!rec) return bad(404, 'Not Found');
    return ok({ path: m[1], sha: rec.sha, content: blobs.get(rec.sha).toString('base64') });
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
  alert: () => {}, setTimeout, clearTimeout, setInterval, clearInterval, console, fetch: fakeFetch
};
s.self = s; s.globalThis = s;
vm.createContext(s);
vm.runInContext(code, s);

/* ---------- 假封面：竖排書名，颜色按书名散列 ---------- */
function coverSvg(title, author) {
  const palette = [
    ['#2f3e52', '#e8dcc0'], ['#7a2f2f', '#f3e6d0'], ['#31543f', '#e9e3c8'],
    ['#4a3a63', '#eae0f0'], ['#8a5a24', '#f6e9cf']
  ];
  let h = 0; for (const ch of title) h = (h * 31 + ch.codePointAt(0)) % 997;
  const [bg, fg] = palette[h % palette.length];
  const chars = title.replace(/[：:].*$/, '').split('').slice(0, 6);
  const lines = [];
  for (let i = 0; i < chars.length; i += 4) lines.push(chars.slice(i, i + 4).join(''));
  const ts = lines.map((ln, i) =>
    `<text x="100" y="${96 + i * 34}" text-anchor="middle" font-family="Songti SC,SimSun,serif" font-size="28" fill="${fg}">${ln}</text>`
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" viewBox="0 0 200 280">
<rect width="200" height="280" fill="${bg}"/>
<rect x="9" y="9" width="182" height="262" fill="none" stroke="${fg}" stroke-opacity=".38"/>
<rect x="20" y="52" width="8" height="8" fill="${fg}" opacity=".6"/>
${ts}
<text x="100" y="238" text-anchor="middle" font-family="Songti SC,SimSun,serif" font-size="12" fill="${fg}" opacity=".85">${author || ''}</text>
</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

(async () => {
  await s.updateReadme('t', { full: 'wh/books', default_branch: 'main' });
  const md = blobs.get(store.get('README.md').sha).toString('utf8');
  let body = marked.parse(md);

  // 把占位封面换成能显示的假封面，其余保持原样
  body = body.replace(/<img src="([^"]+)" width="76" alt="([^"]*)">/g, (m, src, alt) => {
    const rec = INDEX[alt] || Object.values(INDEX).find(v => v.title === alt) || {};
    return `<img src="${coverSvg(alt, rec.author)}" width="76" alt="${alt}">`;
  });

  const page = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>README 效果预览（Skill 仓库）</title>
<style>
  :root{ --fg:#1f2328; --muted:#656d76; --line:#d0d7de; --bg:#fff; --link:#0969da; }
  *{box-sizing:border-box}
  body{margin:0;background:#f6f8fa;color:var(--fg);
       font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,"PingFang SC","Microsoft YaHei",sans-serif}
  .note{max-width:980px;margin:0 auto;padding:14px 32px;background:#fff8e5;border-bottom:1px solid #e8d9a8;font-size:13px;color:#7a5c11}
  .note b{color:#5c4409}
  .markdown-body{max-width:980px;margin:0 auto;padding:28px 32px 64px;background:var(--bg);border-left:1px solid var(--line);border-right:1px solid var(--line);min-height:100vh}
  .markdown-body h1{font-size:2em;border-bottom:1px solid var(--line);padding-bottom:.3em;margin:.67em 0}
  .markdown-body h2{font-size:1.5em;border-bottom:1px solid var(--line);padding-bottom:.3em;margin-top:1.6em}
  .markdown-body a{color:var(--link);text-decoration:none}
  .markdown-body a:hover{text-decoration:underline}
  .markdown-body hr{border:0;border-top:1px solid var(--line);margin:24px 0}
  .markdown-body table{border-collapse:collapse;width:100%;margin:16px 0;font-size:14px}
  .markdown-body th,.markdown-body td{border:1px solid var(--line);padding:8px 12px;vertical-align:middle}
  .markdown-body th{background:#f6f8fa;font-weight:600}
  .markdown-body tbody tr:nth-child(2n){background:#f6f8fa}
  .markdown-body img{border-radius:3px;display:block;vertical-align:middle}
  .markdown-body sub{font-size:.75em;color:var(--muted);line-height:1.4}
  .markdown-body blockquote{margin:0;padding:0 1em;color:var(--muted);border-left:.25em solid var(--line)}
  .markdown-body p{margin:0 0 16px}
  .markdown-body div[align="center"]{text-align:center}
  .markdown-body div[align="center"] h1{border:0}
</style></head>
<body>
<div class="note">这是用示例数据渲染的 <b>Skill 仓库 README 效果</b>：封面为内联 SVG 占位图，实际上传时引用的是仓库里真实的 <code>名称/cover.jpg</code>。</div>
<article class="markdown-body">${body}</article>
</body></html>`;

  fs.writeFileSync(__dirname + '/readme_preview.html', page, 'utf8');
  console.log('已生成 readme_preview.html（' + page.length + ' 字节）');
  console.log('README 里的书籍条目：' + (md.match(/^\| </gm) || []).length);
})();
