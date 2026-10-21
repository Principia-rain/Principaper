/* =====================================================================
 * test_core.cjs —— core.js 纯逻辑单元测试
 * 运行： node tools/test_core.cjs
 * ===================================================================== */
'use strict';

const C = require('../assets/core.js');
const assert = require('assert');

let passed = 0;
function ok(cond, name) {
  if (!cond) { console.error('✗ FAIL: ' + name); process.exit(1); }
  passed++;
  console.log('✓ ' + name);
}

/* ---------------- detectRepo ---------------- */
ok(JSON.stringify(C.detectRepo({}, { hostname: 'zhangsan.github.io', pathname: '/my-papers/' })) ===
   JSON.stringify({ owner: 'zhangsan', repo: 'my-papers', branch: '', papersDir: 'papers', ok: true, source: 'auto' }),
   'detectRepo: 项目页自动识别');

const d2 = C.detectRepo({}, { hostname: 'zhangsan.github.io', pathname: '/' });
ok(d2.owner === 'zhangsan' && d2.repo === 'zhangsan.github.io', 'detectRepo: 用户主页识别');

const d3 = C.detectRepo({ owner: 'abc', repo: 'xyz', branch: 'dev' }, { hostname: 'localhost', pathname: '/' });
ok(d3.owner === 'abc' && d3.repo === 'xyz' && d3.branch === 'dev' && d3.source === 'config', 'detectRepo: config 优先');

ok(C.detectRepo({}, { hostname: 'localhost', pathname: '/x/' }).ok === false, 'detectRepo: 本地未配置 → ok=false');

/* ---------------- parseFrontMatter ---------------- */
const fm1 = C.parseFrontMatter('---\ntitle: "我的论文"\nauthor: 张三\ntags: [示例, 模板]\n---\n\n# 正文');
ok(fm1.meta.title === '我的论文' && fm1.meta.author === '张三', 'front matter: 基本字段+去引号');
ok(JSON.stringify(C.splitList(fm1.meta.tags)) === JSON.stringify(['示例', '模板']), 'front matter: yaml 数组拆分');
ok(fm1.body.startsWith('# 正文'), 'front matter: body 正确剥离');

const fm2 = C.parseFrontMatter('---\nabstract: |\n  第一行。\n  第二行，带逗号。\nyear: 2026\n---\nbody');
ok(fm2.meta.abstract === '第一行。 第二行，带逗号。', 'front matter: 块级 abstract 多行合并');
ok(fm2.meta.year === '2026', 'front matter: 块级之后的普通键');

const fm3 = C.parseFrontMatter('---\ntitle: X\n---');
ok(fm3.meta.title === 'X' && fm3.body === '', 'front matter: 结尾无换行');

const fm4 = C.parseFrontMatter('# 无 front matter');
ok(Object.keys(fm4.meta).length === 0 && fm4.body === '# 无 front matter', 'front matter: 缺失时全当正文');

const fm5 = C.parseFrontMatter('---\r\ntitle: 换行符\r\n---\r\n正文');
ok(fm5.meta.title === '换行符', 'front matter: CRLF 兼容');

const fm6 = C.parseFrontMatter('---\ncode: https://github.com/a/b, https://github.com/c/d\n---\nx');
ok(C.splitList(fm6.meta.code).length === 2, 'front matter: 多代码链接拆分');

/* ---------------- metaFromFrontMatter ---------------- */
const mf = C.metaFromFrontMatter('my-paper.md', { title: '标题', date: '2026-01-05', tags: 'a，b；c' });
ok(mf.title === '标题' && mf.date === '2026-01-05' && mf.tags.length === 3, 'metaFromFrontMatter: 中英文分隔符');

const mf2 = C.metaFromFrontMatter('no-meta.md', {});
ok(mf2.title === 'no-meta', 'metaFromFrontMatter: 标题回退到文件名');

/* ---------------- protectMath ---------------- */
const p1 = C.protectMath('行内 $E=mc^2$ 与 $\\hbar$。');
ok(p1.store.length === 2 && p1.store[0] === '$E=mc^2$', 'protectMath: 行内公式计数');
ok(!/\$E=mc/.test(p1.text), 'protectMath: 公式已替换为占位符');

const p2 = C.protectMath('$$\nx = \\begin{aligned}a_b\\end{aligned}\n$$\n后文');
ok(p2.store.length === 1 && /\n/.test(p2.store[0]), 'protectMath: $$ 可跨行');

const p3 = C.protectMath('\\[ a_1 \\] 和 \\( b_2 \\)');
ok(p3.store.length === 2, 'protectMath: \\[ \\] 与 \\( \\)');

const p4 = C.protectMath('价格 \\$5，而公式 $x+y$ 有效');
ok(p4.store.length === 1 && p4.store[0] === '$x+y$', 'protectMath: 转义 \\$ 不误判');

const p5 = C.protectMath('```\n$$x$$\n```\n普通 $y$');
ok(p5.store.length === 1 && p5.store[0] === '$y$', 'protectMath: 代码块内的 $$ 不入公式库');
ok(p5.dolStore && p5.dolStore.length === 4, 'protectMath: 代码块内 4 个 $ 被伪装');
ok(!/\$\$x/.test(p5.text), 'protectMath: 代码块内已无裸 $');

const p8 = C.protectMath('用 `$$` 表示：\n\n$$\nx = 1\n$$');
ok(p8.store.length === 1 && p8.store[0] === '$$\nx = 1\n$$', 'protectMath: 行内代码里的 $$ 不干扰真公式');
ok(p8.dolStore.length === 2, 'protectMath: 行内代码的 2 个 $ 被伪装');

const p6 = C.protectMath('孤立的 $ 符号不配对');
ok(p6.store.length === 0 && p6.dolStore.length === 0, 'protectMath: 单个 $ 不误判');

const p7 = C.protectMath('相邻公式 $a$ 与 $b$ 与 $c$');
ok(p7.store.length === 3, 'protectMath: 连续多个行内公式');

/* ---------------- buildEntries ---------------- */
const files = [
  { name: 'b论文.pdf', sha: 's2', size: 2048 },
  { name: 'a论文.pdf.json', sha: 's3', size: 100 },
  { name: 'a论文.pdf', sha: 's4', size: 4096 },
  { name: '_草稿.md', sha: 's5', size: 10 },
  { name: 'c笔记.md', sha: 's6', size: 500 },
  { name: 'd图片.png', sha: 's7', size: 900 },
];
const mdMeta = { 'c笔记.md': { name: 'c笔记.md', type: 'md', title: '笔记C', date: '2026-01-01', abstract: '关于光速', tags: ['光'], code: [] } };
const sidecars = { 'a论文.pdf': { title: '论文A', date: '2026-05-01', abstract: '', tags: [], code: [] } };
const entries = C.buildEntries(files, mdMeta, sidecars);

ok(entries.length === 3, 'buildEntries: 只保留 md/pdf，滤掉 sidecar/下划线/其它扩展名');
ok(entries[0].name === 'a论文.pdf' && entries[0].title === '论文A', 'buildEntries: 按日期倒序 + sidecar 合并');
ok(entries[1].name === 'c笔记.md' && entries[1].title === '笔记C', 'buildEntries: front matter 合并');
ok(entries.every(e => e.name.indexOf('.json') === -1), 'buildEntries: sidecar 不出现在条目里');

const noDate = C.buildEntries([{ name: 'x.md' }, { name: 'a.pdf' }], {}, {});
ok(noDate[0].name === 'a.pdf', 'buildEntries: 无日期时按文件名排序');

/* ---------------- filterEntries ---------------- */
ok(C.filterEntries(entries, '光速', null).length === 1, 'filterEntries: 关键词搜摘要');
ok(C.filterEntries(entries, '笔记 光', null).length === 1, 'filterEntries: 多关键词 AND');
ok(C.filterEntries(entries, '', '光').length === 1, 'filterEntries: 标签过滤');
ok(C.filterEntries(entries, '', null).length === 3, 'filterEntries: 空条件全通过');

/* ---------------- base64 往返 ---------------- */
const sample = '中文内容 Chinese 𝑥 + 换行\n第二行';
ok(C.b64ToUtf8(C.utf8ToB64(sample)) === sample, 'base64: UTF-8 往返一致');

/* ---------------- URL 构造 ---------------- */
const rep = { owner: 'zhang san', repo: 'my-papers' };
ok(C.rawUrl(rep, 'papers/示例 论文.md') ===
   'https://raw.githubusercontent.com/zhang%20san/my-papers/HEAD/papers/%E7%A4%BA%E4%BE%8B%20%E8%AE%BA%E6%96%87.md',
   'rawUrl: 中文与空格编码');
ok(C.apiUrl(rep, 'papers') === 'https://api.github.com/repos/zhang%20san/my-papers/papers', 'apiUrl: 编码');

/* ---------------- 日期 ---------------- */
ok(C.fmtDate('2026-10-21') === '2026-10-21', 'fmtDate: 标准日期');
ok(C.fmtDate('2026-1-5') === '2026-01-05', 'fmtDate: 补零');
ok(C.fmtDate('October 21, 2026') === '2026-10-21', 'fmtDate: 英文日期归一');
ok(C.fmtDate('2026 年春') === '2026 年春', 'fmtDate: 手写日期原样保留');

/* ---------------- sidecar 约定 ---------------- */
ok(C.sidecarNameFor('a.pdf') === 'a.pdf.json' && C.sidecarKeyOf('a.pdf.json') === 'a.pdf', 'sidecar 命名约定');

/* ---------------- metaFromSidecar 容错 ---------------- */
ok(C.metaFromSidecar('{bad json').title === '', 'metaFromSidecar: 坏 JSON 不抛异常');

console.log('\n全部 ' + passed + ' 项测试通过 ✅');
