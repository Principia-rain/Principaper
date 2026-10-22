/* =====================================================================
 * app.js —— 论文站主逻辑
 * 结构：工具 → 主题 → 路由 → 列表加载/渲染 → 阅读视图 → Markdown 管线
 *       → 关于页 → 管理员（登录/上传/删除）→ 模态与提示 → 启动
 * 依赖：core.js（PaperCore）、marked/KaTeX/highlight.js（CDN，可缺席降级）
 * ===================================================================== */
(function () {
  'use strict';

  var C = window.PaperCore;
  var cfg = window.PAPERSITE_CONFIG || {};

  /* ================= 工具 ================= */

  function $(sel, root) { return (root || document).querySelector(sel); }

  function esc(s) { return C.escapeHtml(s); }

  function lsGet(key, ttlMs) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o.t !== 'number') return null;
      if (ttlMs && (Date.now() - o.t) > ttlMs) return null;
      return o.v;
    } catch (e) { return null; }
  }
  function lsSet(key, v) {
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: v })); } catch (e) { /* 容量满则忽略 */ }
  }
  function lsDel(key) { try { localStorage.removeItem(key); } catch (e) {} }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* ================= 全局状态 ================= */

  var state = {
    repo: null,            // detectRepo 结果
    entries: null,         // 论文条目数组
    filtered: [],
    query: '',
    tag: null,
    visibleCount: 20,
    loadingPromise: null,
    admin: null,           // {token}
    unconfigured: false,
    dataSource: '',        // api / cache / local
    pendingFiles: []
  };

  function repo() {
    if (!state.repo) state.repo = C.detectRepo(cfg, window.location);
    return state.repo;
  }

  function CK() {
    var r = repo();
    return {
      /* 版本号 v3：修改缓存结构时递增，旧键（含被污染的空列表）自动作废 */
      list: 'ps_list:v3:' + r.owner + '/' + r.repo,
      about: 'ps_about:' + r.owner + '/' + r.repo
    };
  }

  function siteName() {
    return (cfg.siteName || '').trim() || (repo().ok ? C.prettifyName(repo().repo) : '论文站');
  }

  /* ================= 主题 ================= */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var btn = $('#theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    var l = $('#css-hljs-light'), d = $('#css-hljs-dark');
    if (l) l.disabled = (theme === 'dark');
    if (d) d.disabled = (theme !== 'dark');
    try { localStorage.setItem('ps_theme', theme); } catch (e) {}
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('ps_theme'); } catch (e) {}
    var prefersDark = false;
    try { prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) {}
    applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  }

  /* ================= URL / 请求基础 ================= */

  /* 某“目录前缀”下取原始文件的基地址；未配置仓库时退化为本地相对路径 */
  function rawBase(dirInRepo) {
    var r = repo();
    if (!r.ok) return (dirInRepo ? dirInRepo.replace(/\/?$/, '/') : '');
    var segs = String(dirInRepo || '').split('/').filter(Boolean).map(C.encSeg).join('/');
    return 'https://raw.githubusercontent.com/' + C.encSeg(r.owner) + '/' + C.encSeg(r.repo) +
      '/HEAD/' + (segs ? segs + '/' : '');
  }

  function ghHeaders(withToken) {
    var h = { 'Accept': 'application/vnd.github+json' };
    if (withToken !== false && state.admin && state.admin.token) {
      h['Authorization'] = 'Bearer ' + state.admin.token;
    }
    return h;
  }

  function ghApiUrl(pathInRepo) { return C.apiUrl(repo(), pathInRepo); }

  /* 站点自身部署基地址（同源）：
   * https://owner.github.io/repo/... → https://owner.github.io/repo/
   * 用户主页 / 自定义域名 → origin + '/'
   * 同源文件不存在 CORS 问题，也不占 GitHub API 配额，
   * 是代理/限流环境下降级加载的最可靠数据源。 */
  function siteBase() {
    try {
      var host = String(window.location.hostname || '').toLowerCase();
      var segs = window.location.pathname.split('/').filter(Boolean);
      if (/\.github\.io$/.test(host) && segs.length) {
        return window.location.origin + '/' + C.encSeg(segs[0]) + '/';
      }
      return window.location.origin + '/';
    } catch (e) { return '/'; }
  }

  async function apiError(res, prefix) {
    var msg = prefix || '请求失败';
    try {
      var j = await res.json();
      if (j && j.message) msg = prefix + '：' + j.message;
    } catch (e) {}
    if (res.status === 401) msg = prefix + '：Token 无效或已过期';
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      msg = 'GitHub API 匿名限流（60 次/小时/IP）。请稍后再试，或在 config.js 开启 useIndexJson 并运行 tools/build_index.py。';
    }
    if (res.status === 404) msg = prefix + '：不存在（检查路径，或目录为空）';
    return new Error(msg + ' [HTTP ' + res.status + ']');
  }

  /* ================= 列表数据加载 ================= */

  async function fetchContents() {
    var r = repo();
    var url = ghApiUrl(r.papersDir) + (r.branch ? '?ref=' + C.encSeg(r.branch) : '');
    var usedToken = !!(state.admin && state.admin.token);
    var res = await fetch(url, { headers: ghHeaders() });

    if (res.status === 401 && usedToken) {
      /* token 失效时不影响游客浏览 → 匿名重试 */
      res = await fetch(url, { headers: ghHeaders(false) });
    }

    if (res.status === 404) {
      var probe = await fetch(ghApiUrl(''), { headers: ghHeaders(false) });
      if (probe.status === 404) {
        throw new Error('找不到仓库 ' + r.owner + '/' + r.repo +
          '。请确认：仓库已创建且为 Public（私有仓库匿名无法读取）、用户名/仓库名正确、GitHub Pages 已开启。');
      }
      return [];   /* papers 目录不存在或为空 */
    }
    if (!res.ok) throw await apiError(res, '读取论文目录失败');
    var arr = await res.json();
    if (!Array.isArray(arr)) throw new Error('GitHub API 返回格式异常');
    return arr.filter(function (x) { return x && x.type === 'file'; });
  }

  async function fetchRawText(name, sha) {
    var r = repo();
    var key = sha ? 'ps_raw:' + sha
                  : 'ps_name:' + r.owner + '/' + r.repo + '/' + name;
    var ttl = sha ? 7 * 24 * 3600 * 1000 : (cfg.cacheMinutes || 30) * 60 * 1000;
    var hit = lsGet(key, ttl);
    if (hit != null) return hit;

    /* 同源（GitHub Pages）优先；失败再试 raw.githubusercontent.com */
    var dir = r.papersDir.split('/').filter(Boolean).map(C.encSeg).join('/');
    var candidates = [
      siteBase() + (dir ? dir + '/' : '') + C.encSeg(name),
      rawBase(r.papersDir) + C.encSeg(name)
    ];
    for (var i = 0; i < candidates.length; i++) {
      try {
        var res = await fetch(candidates[i], { cache: 'no-store' });
        if (res.ok) {
          var text = await res.text();
          if (text.length < 300000) lsSet(key, text);
          return text;
        }
      } catch (e) { /* 试下一个候选地址 */ }
    }
    throw new Error('读取论文失败：' + name);
  }

  function loadIndex(force) {
    if (state.entries && !force) return Promise.resolve(state.entries);
    if (state.loadingPromise && !force) return state.loadingPromise;
    state.loadingPromise = loadIndexInner(force).finally(function () { state.loadingPromise = null; });
    return state.loadingPromise;
  }

  /* 读同源（优先）/ raw 的 index.json；只有非空结果才算数，返回条目数组或 null */
  async function tryIndexJson(dataSourceLabel) {
    var r = repo();
    var dirSeg = r.papersDir.split('/').filter(Boolean).map(C.encSeg).join('/');
    var candidates = [
      siteBase() + (dirSeg ? dirSeg + '/' : '') + 'index.json',
      rawBase(r.papersDir) + 'index.json'
    ];
    for (var ci = 0; ci < candidates.length; ci++) {
      try {
        var res = await fetch(candidates[ci], { cache: 'no-store' });
        if (res.ok) {
          var j = await res.json();
          var es = C.buildEntries((j && j.papers) || [], {}, {});
          if (es.length) {
            state.dataSource = dataSourceLabel;
            return es;
          }
        }
      } catch (e) { /* 试下一个候选地址 */ }
    }
    return null;
  }

  async function loadIndexInner(force) {
    var r = repo();
    var entries = null;

    /* ---- 情形一：本地/未配置仓库 —— 尝试相对路径的 index.json ---- */
    if (!r.ok) {
      try {
        var res = await fetch('papers/index.json', { cache: 'no-store' });
        if (res.ok) {
          var j = await res.json();
          entries = C.buildEntries((j && j.papers) || [], {}, {});
          state.dataSource = 'local';
        }
      } catch (e) { /* file:// 或无 index.json */ }
      if (!entries) {
        state.entries = [];
        state.unconfigured = true;
        renderList();
        return [];
      }
      state.entries = entries;
      state.unconfigured = false;
      renderList();
      return entries;
    }

    /* ---- 情形二：正式部署 —— 缓存 / index.json / GitHub API ---- */
    if (!force) {
      var cached = lsGet(CK().list, (cfg.cacheMinutes || 30) * 60 * 1000);
      if (cached && cached.length !== undefined) {
        state.entries = cached;
        state.dataSource = 'cache';
        renderList();
        return cached;
      }
    }

    if (cfg.useIndexJson) {
      try {
        var res2 = await fetch(rawBase(r.papersDir) + 'index.json', { cache: 'no-store' });
        if (res2.ok) {
          var j2 = await res2.json();
          entries = C.buildEntries((j2 && j2.papers) || [], {}, {});
          state.dataSource = 'index.json';
        }
      } catch (e) { /* 退回 API */ }
    }

    var apiErr = null;
    if (entries === null) {
      showStatusLoading();
      try {
        var files = await fetchContents();

        /* sidecar（如 foo.pdf.json）元信息 */
        var sidecarMap = {};
        files.forEach(function (f) {
          if (C.isSidecarName(f.name) && f.content) {
            var key = C.sidecarKeyOf(f.name);
            try { sidecarMap[key] = C.metaFromSidecar(C.b64ToUtf8(f.content)); } catch (e) {}
          }
        });

        /* 每篇 .md 的 front matter（并行 + sha 缓存） */
        var mdMetaMap = {};
        var mdFiles = files.filter(function (f) {
          var c0 = f.name.charAt(0);
          return /\.(md|markdown)$/i.test(f.name) && c0 !== '_' && c0 !== '.';
        });
        await Promise.all(mdFiles.map(async function (f) {
          try {
            var t = await fetchRawText(f.name, f.sha);
            mdMetaMap[f.name] = C.metaFromFrontMatter(f.name, C.parseFrontMatter(t).meta);
          } catch (e) { /* 单篇失败不影响整体 */ }
        }));

        entries = C.buildEntries(files, mdMetaMap, sidecarMap);
        state.dataSource = 'api';
      } catch (err) {
        apiErr = err;    /* 记住原因，降级也失败时给用户看 */
      }
    }

    /* API 返回空列表不可信（代理缓存的旧响应/瞬时空窗）：
       用同源 index.json 交叉验证，非空则以 index.json 为准 */
    if (entries !== null && entries.length === 0 && !cfg.useIndexJson) {
      var verified = await tryIndexJson('index.json（校验）');
      if (verified) entries = verified;
    }

    if (entries === null && !cfg.useIndexJson) {
      /* API 失败（被代理拦掉 CORS / 匿名限流等）→ 降级读同源 index.json */
      var fallback = await tryIndexJson('index.json（降级）');
      if (fallback) entries = fallback;
    }

    if (entries === null) throw (apiErr || new Error('无法读取论文列表'));

    state.entries = entries;
    state.unconfigured = false;
    /* 空列表不写缓存：空几乎总是瞬时的误报，下次访问重新探测 */
    if (entries.length) lsSet(CK().list, entries);
    renderList();
    return entries;
  }

  /* ================= 列表渲染 ================= */

  function showStatusLoading() {
    $('#list-status').innerHTML =
      '<div class="skeleton-block"></div><div class="skeleton-block"></div><div class="skeleton-block"></div>' +
      '<p class="status-line center">正在从 GitHub 读取论文目录…</p>';
    $('#paper-list').innerHTML = '';
  }

  function showStatusError(err) {
    $('#list-status').innerHTML =
      '<div class="error-box">😕 ' + esc(err.message || String(err)) +
      ' <div style="margin-top:8px"><button class="btn small" id="retry-btn">重试</button></div></div>';
    var b = $('#retry-btn');
    if (b) b.onclick = function () { ensureAndRender(true); };
  }

  function showSetupBanner() {
    $('#list-status').innerHTML =
      '<div class="setup-banner">' +
      '<h3>站点尚未连接到 GitHub 仓库</h3>' +
      '<p>当前在<strong>本地预览</strong>模式。两种用法：</p>' +
      '<ol>' +
      '<li><strong>本地预览论文</strong>：在本目录运行 <code>python tools/build_index.py</code> 生成 <code>papers/index.json</code>，' +
      '再运行 <code>python -m http.server 8000</code>，访问 <code>http://localhost:8000</code>。</li>' +
      '<li><strong>部署到 GitHub Pages</strong>：把整个文件夹上传到你的公开仓库，开启 Pages 后，' +
      '站点会从网址自动识别仓库，无需任何配置。详见仓库根目录的 <code>README.md</code>。</li>' +
      '</ol></div>';
  }

  function showEmptyState() {
    var isAdmin = !!state.admin;
    $('#list-status').innerHTML =
      '<div class="empty-state"><span class="big">📄</span>' +
      '<p><strong>papers/ 目录还没有论文</strong></p>' +
      '<p>站主可以通过右上角「' + (isAdmin ? '管理面板' : '站主登录') + '」直接上传，' +
      '或在 GitHub 仓库的 <code>papers/</code> 目录里上传 .md / .pdf 文件。<br>' +
      '写作格式见 <code>papers/示例论文.md</code> 与仓库 <code>README.md</code>。</p>' +
      '<p style="margin-top:14px"><button class="btn" id="empty-admin-btn">' + (isAdmin ? '打开管理面板' : '站主登录') + '</button></p>' +
      '</div>';
    var b = $('#empty-admin-btn');
    if (b) b.onclick = function () { adminBtnAction(); };
  }

  function buildTagBar(entries) {
    var counts = {};
    entries.forEach(function (e) {
      (e.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    var tags = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    var html = '<button class="tag' + (state.tag ? '' : ' active') + '" data-tag="">全部 (' + entries.length + ')</button>';
    tags.slice(0, 16).forEach(function (t) {
      html += '<button class="tag' + (state.tag === t ? ' active' : '') + '" data-tag="' + esc(t) + '">' +
        esc(t) + ' (' + counts[t] + ')</button>';
    });
    $('#tag-bar').innerHTML = html;
  }

  function cardHtml(e) {
    var href = '#/read/' + C.encSeg(e.name);
    var tags = (e.tags || []).slice(0, 4).map(function (t) {
      return '<button class="tag" data-tag="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('');
    var codeBtns = (e.code || []).map(function (u, i) {
      return '<a class="btn small ghost" href="' + esc(u) + '" target="_blank" rel="noopener">💻 代码仓库' +
        ((e.code || []).length > 1 ? ' ' + (i + 1) : '') + '</a>';
    }).join('');
    var metaBits = [];
    if (e.author) metaBits.push(esc(e.author));
    if (e.date) metaBits.push(esc(e.date));
    return '<article class="card" data-name="' + esc(e.name) + '">' +
      '<div class="card-top"><span class="badge ' + e.type + '">' + (e.type === 'md' ? 'Markdown' : 'PDF') + '</span>' +
      (e.size ? '<span class="card-size">' + C.fmtSize(e.size) + '</span>' : '') + '</div>' +
      '<h3 class="card-title"><a href="' + href + '">' + esc(e.title) + '</a></h3>' +
      (metaBits.length ? '<div class="card-meta">' + metaBits.join(' · ') + '</div>' : '') +
      (e.abstract ? '<p class="card-abs">' + esc(e.abstract) + '</p>' : '') +
      (tags ? '<div class="card-tags">' + tags + '</div>' : '') +
      '<div class="card-actions"><a class="btn small" href="' + href + '">阅读</a>' + codeBtns + '</div>' +
      '</article>';
  }

  function renderList() {
    var entries = state.entries || [];
    buildTagBar(entries);

    var filtered = C.filterEntries(entries, state.query, state.tag);
    state.filtered = filtered;

    if (state.unconfigured) showSetupBanner();
    else if (!entries.length) showEmptyState();
    else $('#list-status').innerHTML = '';

    $('#list-count').textContent = entries.length
      ? ('共 ' + entries.length + ' 篇' + (filtered.length !== entries.length ? ' · 筛选出 ' + filtered.length + ' 篇' : ''))
      : '';

    var visible = filtered.slice(0, state.visibleCount);
    $('#paper-list').innerHTML = visible.map(cardHtml).join('');

    var more = filtered.length > visible.length
      ? '<button class="btn ghost" id="more-btn">显示更多（还有 ' + (filtered.length - visible.length) + ' 篇）</button>'
      : '';
    $('#list-more').innerHTML = more;
    var mb = $('#more-btn');
    if (mb) mb.onclick = function () { state.visibleCount += 20; renderList(); };

    updateFooter();
  }

  function ensureAndRender(force) {
    return loadIndex(force).catch(function (err) {
      state.entries = state.entries || [];
      renderList();
      showStatusError(err);
    });
  }

  function updateFooter() {
    var r = repo();
    var el = $('#footer-src');
    if (!el) return;
    if (r.ok) {
      el.innerHTML = '数据源：<a href="https://github.com/' + esc(r.owner) + '/' + esc(r.repo) +
        '" target="_blank" rel="noopener">github.com/' + esc(r.owner) + '/' + esc(r.repo) + '</a> 的 <code>' +
        esc(r.papersDir) + '/</code> 目录' +
        (state.dataSource ? '（' + esc(state.dataSource) + '）' : '');
    } else if (state.dataSource === 'local') {
      el.textContent = '本地预览模式（读取 papers/index.json）';
    } else {
      el.textContent = '未连接仓库';
    }
  }

  /* ================= Markdown 渲染管线 ================= */

  /* 把占位符换回原文（DOM 级替换）：
   *  - ZMDOL 令牌 → '$'（代码区伪装的美元符，KaTeX 会忽略 pre/code）
   *  - ZMTOK 令牌 → 公式原文（交给 KaTeX 渲染） */
  function restoreMathInDom(root, pm) {
    pm = pm || {};
    var store = pm.store || [];
    var dolCount = pm.dolStore ? pm.dolStore.length : 0;
    if (!store.length && !dolCount) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var v = node.nodeValue;
      if (!v || (v.indexOf('ZMTOK') === -1 && v.indexOf('ZMDOL') === -1)) return;
      if (dolCount && v.indexOf('ZMDOL') !== -1) {
        v = v.replace(/ZMDOL(\d+)END/g, function (m0, i) {
          return (+i < dolCount) ? '$' : m0;
        });
      }
      if (store.length && v.indexOf('ZMTOK') !== -1) {
        C.TOKEN_RE.lastIndex = 0;
        var m, frag = document.createDocumentFragment(), last = 0, changed = false;
        while ((m = C.TOKEN_RE.exec(v))) {
          var tex = store[+m[1]];
          if (tex == null) continue;
          changed = true;
          frag.appendChild(document.createTextNode(v.slice(last, m.index)));
          frag.appendChild(document.createTextNode(tex));
          last = m.index + m[0].length;
        }
        if (changed) {
          frag.appendChild(document.createTextNode(v.slice(last)));
          if (node.parentNode) node.parentNode.replaceChild(frag, node);
          return;
        }
      }
      node.nodeValue = v;
    });
  }

  function renderMath(el) {
    if (cfg.math === false || !window.renderMathInElement) return;
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false
      });
    } catch (e) {}
  }

  function highlightCode(el) {
    if (cfg.highlight === false || !window.hljs) return;
    var blocks = el.querySelectorAll('pre code');
    for (var i = 0; i < blocks.length; i++) {
      try { window.hljs.highlightElement(blocks[i]); } catch (e) {}
    }
  }

  /* 相对路径图片/链接 → 指向仓库 raw 地址；外链新标签打开 */
  function postProcessLinks(art, baseDir) {
    var base = rawBase(baseDir);
    var imgs = art.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var s = imgs[i].getAttribute('src') || '';
      if (!/^(https?:|data:|\/\/)/i.test(s)) {
        var segs = s.split('/').filter(function (x) { return x && x !== '.'; }).map(C.encSeg);
        imgs[i].src = base + segs.join('/');
      }
      imgs[i].loading = 'lazy';
    }
    var links = art.querySelectorAll('a[href]');
    for (var k = 0; k < links.length; k++) {
      var h = links[k].getAttribute('href') || '';
      if (/^#/ .test(h)) continue;
      if (!/^(https?:|mailto:|\/\/)/i.test(h)) {
        var segs2 = h.split('#')[0].split('/').filter(function (x) { return x && x !== '.'; }).map(C.encSeg);
        links[k].href = base + segs2.join('/');
      }
      links[k].target = '_blank';
      links[k].rel = 'noopener';
    }
  }

  function renderMarkdownInto(art, mdText) {
    var pm;
    try { pm = C.protectMath(mdText); }
    catch (e) { pm = { text: String(mdText || ''), store: [], dolStore: [] }; }

    var html = '';
    if (window.marked && window.marked.parse) {
      try { html = window.marked.parse(pm.text); }
      catch (e) { html = '<pre class="md-fallback">' + esc(pm.text) + '</pre>'; }
    } else {
      html = '<div class="warn-box">Markdown 渲染库加载失败（CDN 可能不可达），以下为原始文本：</div>' +
        '<pre class="md-fallback">' + esc(pm.text) + '</pre>';
    }

    var tpl = document.createElement('template');
    tpl.innerHTML = html;
    restoreMathInDom(tpl.content, pm);
    art.appendChild(tpl.content);
  }

  /* ================= 阅读视图 ================= */

  function readHeadHtml(e) {
    var r = repo();
    var rawLink = r.ok ? C.rawUrl(r, r.papersDir + '/' + e.name)
                       : (r.papersDir + '/' + C.encSeg(e.name));
    var metaBits = [];
    if (e.author) metaBits.push(esc(e.author));
    if (e.date) metaBits.push(esc(e.date));
    if (e.size) metaBits.push(C.fmtSize(e.size));
    var codeBtns = (e.code || []).map(function (u, i) {
      return '<a class="btn small ghost" href="' + esc(u) + '" target="_blank" rel="noopener">💻 代码仓库' +
        ((e.code || []).length > 1 ? ' ' + (i + 1) : '') + '</a>';
    }).join('');
    var delBtn = state.admin
      ? '<button class="btn small danger" id="read-del-btn" data-name="' + esc(e.name) + '">🗑 删除</button>'
      : '';
    return '<div class="read-col">' +
      '<a class="back" href="#/">← 返回论文列表</a>' +
      '<h1 class="page-title">' + esc(e.title) + '</h1>' +
      (metaBits.length ? '<div class="read-meta">' + metaBits.join(' · ') + '</div>' : '') +
      '<div class="read-actions">' +
      '<a class="btn small ghost" href="' + esc(rawLink) + '" target="_blank" rel="noopener">原始文件 ↗</a>' +
      codeBtns + delBtn +
      '</div><hr class="read-divider">';
  }

  async function openReader(name) {
    var view = $('#view-read');
    view.innerHTML = '<div class="read-col"><p class="status-line">加载中…</p></div>';
    window.scrollTo(0, 0);

    try { await loadIndex(); }
    catch (err) {
      view.innerHTML = '<div class="read-col"><a class="back" href="#/">← 返回论文列表</a>' +
        '<div class="error-box">😕 ' + esc(err.message || String(err)) + '</div></div>';
      return;
    }

    var e = null;
    (state.entries || []).forEach(function (x) { if (x.name === name) e = x; });
    if (!e) {
      view.innerHTML = '<div class="read-col"><a class="back" href="#/">← 返回论文列表</a>' +
        '<div class="error-box">未找到论文「' + esc(name) + '」。若刚上传，请等 1–2 分钟后再刷新。</div></div>';
      return;
    }

    document.title = e.title + ' · ' + siteName();
    var head = readHeadHtml(e);

    if (e.type === 'pdf') {
      var r = repo();
      var pdfUrl = r.ok ? C.rawUrl(r, r.papersDir + '/' + e.name)
                        : (r.papersDir + '/' + C.encSeg(e.name));
      view.innerHTML = head +
        '<div class="pdf-frame"><iframe src="' + esc(pdfUrl) + '#view=FitH" title="' + esc(e.title) + '"></iframe></div>' +
        '<p class="pdf-note">若上方无法显示（部分手机浏览器不支持内嵌 PDF），' +
        '<a href="' + esc(pdfUrl) + '" target="_blank" rel="noopener">在新标签页打开 ↗</a></p></div>';
      bindReaderActions(view, e);
      return;
    }

    view.innerHTML = head + '<article class="paper-body" id="read-body"></article></div>';
    var art = $('#read-body', view);
    try {
      var text = await fetchRawText(e.name, e.sha);
      var parsed = C.parseFrontMatter(text);   /* 剥离 front matter，只渲染正文 */
      renderMarkdownInto(art, parsed.body);
      postProcessLinks(art, repo().papersDir);
      /* 若正文第一个元素是 h1 且与标题相同，去掉避免重复 */
      var first = art.firstElementChild;
      if (first && first.tagName === 'H1' && first.textContent.trim() === e.title.trim()) first.remove();
      renderMath(art);
      highlightCode(art);
    } catch (err) {
      art.innerHTML = '<div class="error-box">😕 论文内容加载失败：' + esc(err.message || String(err)) + '</div>';
    }
    bindReaderActions(view, e);
  }

  function bindReaderActions(view, e) {
    var del = $('#read-del-btn', view);
    if (del) del.onclick = function () { deletePaperFlow(e.name); };
  }

  /* ================= 关于页 ================= */

  async function openAbout() {
    var view = $('#view-about');
    view.innerHTML = '<div class="about-col"><p class="status-line">加载中…</p></div>';
    var name = (cfg.about || 'about.md').replace(/^\/+/, '');
    try {
      var text = await (function () {
        var key = CK().about;
        var hit = lsGet(key, 3600 * 1000);
        if (hit != null) return Promise.resolve(hit);
        var candidates = [siteBase() + C.encSeg(name), rawBase('') + C.encSeg(name)];
        var chain = Promise.reject();
        candidates.forEach(function (url) {
          chain = chain.catch(function () {
            return fetch(url, { cache: 'no-store' }).then(function (res) {
              if (!res.ok) throw new Error('HTTP ' + res.status);
              return res.text();
            });
          });
        });
        return chain.then(function (t) { lsSet(key, t); return t; });
      })();
      view.innerHTML = '<div class="about-col">' +
        '<h1 class="page-title">' + esc(cfg.aboutTitle || '关于本站') + '</h1>' +
        '<article class="paper-body" id="about-body"></article></div>';
      var art = $('#about-body', view);
      renderMarkdownInto(art, text);
      postProcessLinks(art, '');
      var first = art.firstElementChild;
      if (first && first.tagName === 'H1') {
        /* about.md 自带一级标题则不重复显示页面标题 */
        var pt = $('.page-title', view);
        if (pt) pt.remove();
      }
      renderMath(art);
      highlightCode(art);
    } catch (err) {
      view.innerHTML = '<div class="about-col">' +
        '<div class="error-box">「关于」页加载失败：' + esc(err.message || String(err)) +
        '（可在仓库根目录创建 about.md）</div></div>';
    }
  }

  /* ================= 路由 ================= */

  function route() {
    var h = window.location.hash || '#/';
    closeModal();
    var m = /^#\/read\/(.+)$/i.exec(h);
    var view = m ? 'read' : (/^#\/about/i.test(h) ? 'about' : 'list');

    $('#view-list').hidden = (view !== 'list');
    $('#view-read').hidden = (view !== 'read');
    $('#view-about').hidden = (view !== 'about');
    $('#nav-list').classList.toggle('active', view === 'list');
    $('#nav-about').classList.toggle('active', view === 'about');

    if (view === 'read') {
      openReader(decodeURIComponent(m[1]));
    } else if (view === 'about') {
      document.title = (cfg.aboutTitle || '关于') + ' · ' + siteName();
      openAbout();
    } else {
      document.title = siteName();
      if (!state.entries && !state.loadingPromise) ensureAndRender(false);
    }
  }

  /* ================= 管理员 ================= */

  function readStoredAdmin() {
    var stores = [localStorage, sessionStorage];
    for (var i = 0; i < stores.length; i++) {
      try {
        var a = JSON.parse(stores[i].getItem('ps_admin') || 'null');
        if (a && a.token && a.owner === repo().owner && a.repo === repo().repo) {
          return { token: a.token, remember: stores[i] === localStorage };
        }
      } catch (e) {}
    }
    return null;
  }

  function updateAdminUi() {
    state.admin = readStoredAdmin();
    var label = state.admin ? '管理面板' : '站主登录';
    $('#admin-btn').textContent = label;
    $('#footer-admin').textContent = label;
  }

  function adminBtnAction() {
    if (state.admin) openAdminPanel();
    else openLoginModal();
  }

  function openLoginModal() {
    var m = openModal(
      '<h3>站主登录</h3>' +
      '<p class="sub">验证一个 GitHub Token 后即可在网页上直接上传/删除论文。' +
      'Token 只保存在<strong>你自己的浏览器</strong>里，本站是纯静态页面、没有后端，Token 只会发送给 api.github.com。</p>' +
      '<details class="token-help"><summary>如何创建 Fine-grained Token（点开看步骤）</summary><ol>' +
      '<li>登录 GitHub → 右上角头像 → <b>Settings</b> → 最底部 <b>Developer settings</b></li>' +
      '<li><b>Personal access tokens → Fine-grained tokens → Generate new token</b></li>' +
      '<li>Repository access 选 <b>Only select repositories</b>，只勾选本论文仓库</li>' +
      '<li>Permissions → Repository permissions → <b>Contents: Read and write</b>（Metadata 会自动变为 Read-only）</li>' +
      '<li>生成后复制 Token（github_pat_ 开头），粘贴到下面。有效期自选，到期后在同一页面续期。</li>' +
      '</ol></details>' +
      '<div class="field"><label>GitHub Token</label>' +
      '<input id="tok-input" type="password" placeholder="github_pat_… 或 ghp_…" autocomplete="off"></div>' +
      '<div class="field"><label style="font-weight:400;display:flex;gap:8px;align-items:center">' +
      '<input type="checkbox" id="tok-remember" checked style="width:auto"> 在此浏览器记住（存入 localStorage，可随时退出登录清除）</label></div>' +
      '<div class="warn-box" style="font-size:12.5px">安全提示：请只授予这一个仓库的 Contents 权限；' +
      '若怀疑泄露，到 GitHub → Settings → Developer settings 里立即删除该 Token。</div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">' +
      '<button class="btn ghost" id="tok-cancel">取消</button>' +
      '<button class="btn" id="tok-go">验证并登录</button></div>' +
      '<p id="tok-msg" class="muted" style="min-height:1em;margin:10px 0 0;font-size:13px"></p>'
    );

    $('#tok-cancel', m.el).onclick = closeModal;
    var go = $('#tok-go', m.el);
    go.onclick = async function () {
      var token = $('#tok-input', m.el).value.trim();
      var msg = $('#tok-msg', m.el);
      if (!token) { msg.textContent = '请先粘贴 Token。'; return; }
      go.disabled = true; msg.textContent = '正在验证…';
      try {
        var res = await fetch(ghApiUrl(''), {
          headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token }
        });
        if (res.status === 401) throw new Error('Token 无效或已过期（401）');
        if (res.status === 403) throw new Error('Token 没有访问该仓库的权限（403）。请检查 Token 是否选择了本仓库。');
        if (!res.ok) throw new Error('GitHub 返回 HTTP ' + res.status);
        var store = $('#tok-remember', m.el).checked ? localStorage : sessionStorage;
        store.setItem('ps_admin', JSON.stringify({
          token: token, owner: repo().owner, repo: repo().repo, savedAt: Date.now()
        }));
        updateAdminUi();
        closeModal();
        toast('登录成功 ✓');
        openAdminPanel();
      } catch (err) {
        msg.textContent = '❌ ' + (err.message || String(err));
        go.disabled = false;
      }
    };
    setTimeout(function () { var inp = $('#tok-input', m.el); if (inp) inp.focus(); }, 50);
  }

  function invalidateCaches() {
    lsDel(CK().list);
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('ps_name:') === 0) localStorage.removeItem(k);
      });
    } catch (e) {}
    state.entries = null;
  }

  function sanitizeFileName(n) {
    n = String(n || '').replace(/[\\/:*?"<>|#%&{}$!'`+=@]/g, '-').trim();
    n = n.replace(/^[-._ ]+/, '');
    return n || 'paper';
  }

  async function fileToBase64(file) {
    if (/\.(md|markdown|json|txt)$/i.test(file.name)) {
      var text = await file.text();
      return C.utf8ToB64(text);
    }
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { reject(new Error('读取文件失败')); };
      r.readAsDataURL(file);
    });
  }

  async function ghPut(pathInRepo, b64, message) {
    var res = await fetch(ghApiUrl(pathInRepo), {
      method: 'PUT',
      headers: ghHeaders(),
      body: JSON.stringify({ message: message, content: b64 })
    });
    if (!res.ok) throw await apiError(res, '上传失败');
    return res.json();
  }

  function openAdminPanel() {
    if (!state.admin) { openLoginModal(); return; }
    var r = repo();
    var today = new Date().toISOString().slice(0, 10);

    var m = openModal(
      '<h3>管理面板</h3>' +
      '<p class="sub">以 <b>' + esc(r.owner + '/' + r.repo) + '</b> 登录 · ' +
      '<a href="#" id="adm-logout">退出登录</a> · 上传后约 1 分钟内全站可见（访客缓存最长 ' +
      esc(String(cfg.cacheMinutes || 30)) + ' 分钟，可点列表 ⟳ 立即刷新）</p>' +

      '<h4>① 上传论文</h4>' +
      '<div class="dropzone" id="adm-drop">点击选择或把 .md / .pdf 文件拖到这里（可多选）' +
      '<span class="picked" id="adm-picked"></span></div>' +
      '<input type="file" id="adm-file" multiple accept=".md,.markdown,.pdf" style="display:none">' +

      '<div id="adm-pdf-fields" hidden>' +
      '<div class="field"><label>论文标题（生成同名 .json 元信息，让首页卡片显示标题/摘要）</label>' +
      '<input id="f-title" placeholder="默认用文件名"></div>' +
      '<div class="field" style="display:flex;gap:10px"><div style="flex:1"><label>作者</label><input id="f-author"></div>' +
      '<div style="flex:1"><label>日期</label><input id="f-date" type="date" value="' + today + '"></div></div>' +
      '<div class="field"><label>标签（逗号分隔）</label><input id="f-tags" placeholder="凝聚态, 数值"></div>' +
      '<div class="field"><label>摘要</label><textarea id="f-abs"></textarea></div>' +
      '<div class="field"><label>代码仓库链接（可多个，逗号分隔）</label><input id="f-code" placeholder="https://github.com/…"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;align-items:center;margin-top:8px">' +
      '<button class="btn" id="adm-upload" disabled>开始上传</button>' +
      '<span id="adm-note" class="muted" style="font-size:13px"></span></div>' +

      '<h4>② papers/ 目录内容</h4>' +
      '<div id="adm-files"><p class="status-line">加载中…</p></div>'
    );

    $('#adm-logout', m.el).onclick = function (ev) {
      ev.preventDefault();
      try { localStorage.removeItem('ps_admin'); sessionStorage.removeItem('ps_admin'); } catch (e) {}
      updateAdminUi();
      closeModal();
      toast('已退出登录');
      if (state.entries && !state.entries.length) renderList();
    };

    var drop = $('#adm-drop', m.el);
    var fileInput = $('#adm-file', m.el);
    drop.onclick = function () { fileInput.click(); };
    drop.ondragover = function (ev) { ev.preventDefault(); drop.classList.add('dragover'); };
    drop.ondragleave = function () { drop.classList.remove('dragover'); };
    drop.ondrop = function (ev) {
      ev.preventDefault(); drop.classList.remove('dragover');
      if (ev.dataTransfer && ev.dataTransfer.files) setPendingFiles(ev.dataTransfer.files);
    };
    fileInput.onchange = function () { setPendingFiles(fileInput.files); };

    function setPendingFiles(list) {
      state.pendingFiles = [];
      for (var i = 0; i < list.length; i++) {
        var f = list[i];
        if (/\.(md|markdown|pdf)$/i.test(f.name)) state.pendingFiles.push(f);
      }
      var names = state.pendingFiles.map(function (f) { return f.name; }).join('、');
      $('#adm-picked', m.el).textContent = names ? '已选：' + names : '';
      $('#adm-upload', m.el).disabled = !state.pendingFiles.length;
      /* 恰好选了一个 PDF 时显示元信息表单 */
      var showFields = state.pendingFiles.length === 1 && /\.pdf$/i.test(state.pendingFiles[0].name);
      $('#adm-pdf-fields', m.el).hidden = !showFields;
      if (showFields) {
        $('#f-title', m.el).value = state.pendingFiles[0].name.replace(/\.pdf$/i, '');
      }
    }

    $('#adm-upload', m.el).onclick = async function () {
      var btn = $('#adm-upload', m.el);
      var note = $('#adm-note', m.el);
      btn.disabled = true;
      var okCount = 0, failMsg = '';

      var onlyPdf = state.pendingFiles.length === 1 && /\.pdf$/i.test(state.pendingFiles[0].name);
      var fields = null;
      if (onlyPdf) {
        fields = {
          title: $('#f-title', m.el).value.trim(),
          author: $('#f-author', m.el).value.trim(),
          date: $('#f-date', m.el).value.trim(),
          abstract: $('#f-abs', m.el).value.trim(),
          tags: C.splitList($('#f-tags', m.el).value),
          code: C.splitList($('#f-code', m.el).value)
        };
      }

      for (var i = 0; i < state.pendingFiles.length; i++) {
        var file = state.pendingFiles[i];
        var name = sanitizeFileName(file.name);
        if (/\.json$/i.test(name)) { failMsg += '「' + file.name + '」文件名不能以 .json 结尾；'; continue; }
        note.textContent = '（' + (i + 1) + '/' + state.pendingFiles.length + '）正在上传 ' + file.name + ' …';
        try {
          var b64 = await fileToBase64(file);
          await ghPut(r.papersDir + '/' + name, b64, '上传论文：' + name + '（via 论文站管理面板）');
          /* PDF 且填写了元信息 → 生成 sidecar */
          if (fields && /\.pdf$/i.test(name) &&
              (fields.title || fields.author || fields.date || fields.abstract || fields.tags.length || fields.code.length)) {
            var sidecar = {};
            if (fields.title) sidecar.title = fields.title;
            if (fields.author) sidecar.author = fields.author;
            if (fields.date) sidecar.date = fields.date;
            if (fields.abstract) sidecar.abstract = fields.abstract;
            if (fields.tags.length) sidecar.tags = fields.tags;
            if (fields.code.length) sidecar.code = fields.code;
            await ghPut(r.papersDir + '/' + C.sidecarNameFor(name),
              C.utf8ToB64(JSON.stringify(sidecar, null, 2)),
              '添加元信息：' + C.sidecarNameFor(name));
          }
          okCount++;
        } catch (err) {
          failMsg += '「' + file.name + '」' + (err.message || String(err)) + '；';
        }
      }

      note.textContent = '';
      btn.disabled = false;
      state.pendingFiles = [];
      $('#adm-picked', m.el).textContent = '';
      $('#adm-upload', m.el).disabled = true;
      $('#adm-pdf-fields', m.el).hidden = true;

      if (okCount) {
        invalidateCaches();
        await ensureAndRender(true);
        refreshAdminFiles(m);
        toast(okCount === 1 ? '上传成功 ✓（GitHub Pages 约 1 分钟后同步）'
                            : '成功上传 ' + okCount + ' 篇 ✓');
      }
      if (failMsg) toast('部分失败：' + failMsg, 'err');
    };

    refreshAdminFiles(m);
  }

  async function refreshAdminFiles(m) {
    var box = $('#adm-files', m.el);
    if (!box) return;
    box.innerHTML = '<p class="status-line">加载中…</p>';
    try {
      var r = repo();
      var url = ghApiUrl(r.papersDir) + (r.branch ? '?ref=' + C.encSeg(r.branch) : '');
      var res = await fetch(url, { headers: ghHeaders(), cache: 'no-store' });
      if (!res.ok) throw await apiError(res, '读取目录失败');
      var files = (await res.json()).filter(function (x) { return x && x.type === 'file'; });
      if (!files.length) { box.innerHTML = '<p class="muted" style="font-size:13px">目录为空</p>'; return; }
      box.innerHTML = files.map(function (f) {
        var deletable = !/^index\.json$/i.test(f.name);
        return '<div class="admin-file-row">' +
          '<span class="name">' + esc(f.name) + '</span>' +
          '<span class="meta">' + C.fmtSize(f.size) + '</span>' +
          (deletable ? '<button class="btn small danger" data-del="' + esc(f.name) + '">删除</button>' : '') +
          '</div>';
      }).join('');
      var btns = box.querySelectorAll('[data-del]');
      for (var i = 0; i < btns.length; i++) {
        btns[i].onclick = function () { deletePaperFlow(this.getAttribute('data-del'), m); };
      }
    } catch (err) {
      box.innerHTML = '<div class="error-box">' + esc(err.message || String(err)) + '</div>';
    }
  }

  async function deletePaperFlow(name, panelModal) {
    if (!state.admin) { openLoginModal(); return; }
    if (!window.confirm('确定要删除论文「' + name + '」吗？此操作会创建一个删除提交，可在 Git 历史中恢复。')) return;

    var r = repo();
    var path = r.papersDir + '/' + name;

    async function getSha() {
      var res = await fetch(ghApiUrl(path), { headers: ghHeaders(), cache: 'no-store' });
      if (!res.ok) throw await apiError(res, '获取文件信息失败');
      var j = await res.json();
      return j.sha;
    }

    try {
      var sha = await getSha();
      var res = await fetch(ghApiUrl(path), {
        method: 'DELETE',
        headers: ghHeaders(),
        body: JSON.stringify({ message: '删除论文：' + name + '（via 论文站管理面板）', sha: sha })
      });
      if (res.status === 409 || res.status === 422) {
        /* sha 过期 → 重取一次重试 */
        sha = await getSha();
        res = await fetch(ghApiUrl(path), {
          method: 'DELETE',
          headers: ghHeaders(),
          body: JSON.stringify({ message: '删除论文：' + name + '（via 论文站管理面板）', sha: sha })
        });
      }
      if (!res.ok) throw await apiError(res, '删除失败');

      invalidateCaches();
      await ensureAndRender(true);
      if (panelModal) refreshAdminFiles(panelModal);
      toast('已删除「' + name + '」');
    } catch (err) {
      toast(err.message || String(err), 'err');
    }
  }

  /* ================= 模态框 & Toast ================= */

  function openModal(innerHtml) {
    closeModal();
    var ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' +
      '<button class="modal-close" aria-label="关闭">×</button>' + innerHtml + '</div>';
    $('#modal-root').appendChild(ov);
    ov.addEventListener('click', function (ev) { if (ev.target === ov) closeModal(); });
    $('.modal-close', ov).onclick = closeModal;
    return { el: ov };
  }

  function closeModal() {
    var root = $('#modal-root');
    while (root && root.firstChild) root.removeChild(root.firstChild);
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeModal();
  });

  function toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    $('#toast-root').appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 350);
    }, 3600);
  }

  /* ================= 启动 ================= */

  function init() {
    initTheme();
    updateAdminUi();

    $('#site-name').textContent = siteName();
    document.title = siteName();

    $('#theme-toggle').onclick = function () {
      var cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'dark' ? 'light' : 'dark');
    };
    $('#admin-btn').onclick = adminBtnAction;
    $('#footer-admin').onclick = function (ev) { ev.preventDefault(); adminBtnAction(); };
    $('#refresh-btn').onclick = function () {
      ensureAndRender(true).then(function () { toast('列表已刷新'); });
    };

    $('#search').addEventListener('input', debounce(function (ev) {
      state.query = ev.target.value;
      state.visibleCount = 20;
      if (state.entries) renderList();
    }, 140));

    /* 标签点击（列表卡片 + 顶栏共用，事件委托） */
    document.addEventListener('click', function (ev) {
      var tag = ev.target.closest ? ev.target.closest('.tag') : null;
      if (tag && tag.hasAttribute('data-tag')) {
        var t = tag.getAttribute('data-tag');
        state.tag = (state.tag === t || t === '') ? null : t;
        state.visibleCount = 20;
        renderList();
        return;
      }
      var card = ev.target.closest ? ev.target.closest('.card') : null;
      if (card && !ev.target.closest('a, button')) {
        window.location.hash = '#/read/' + C.encSeg(card.getAttribute('data-name'));
      }
    });

    window.addEventListener('hashchange', route);
    route();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
