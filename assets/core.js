/* =====================================================================
 * core.js —— 纯逻辑函数（不依赖 DOM），供 app.js 使用；
 * 同时可在 Node.js 中被 tools/test_core.cjs 单元测试。
 * ===================================================================== */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  /* ---------------- 基础小工具 ---------------- */

  function stripQuotes(v) {
    v = String(v == null ? '' : v).trim();
    if (v.length >= 2) {
      var a = v.charAt(0), b = v.charAt(v.length - 1);
      if ((a === '"' && b === '"') || (a === "'" && b === "'")) return v.slice(1, -1).trim();
      if (a === '[' && b === ']') v = v.slice(1, -1).trim(); /* yaml 数组 [a, b] */
    }
    return v;
  }

  /* 中英文逗号 / 分号 / 顿号 分隔的列表 */
  function splitList(v) {
    return stripQuotes(v).split(/[,，;；、]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, '&#39;');
  }

  function dateKey(d) {
    var t = Date.parse(d);
    return isNaN(t) ? 0 : t;
  }

  function fmtDate(d) {
    d = String(d || '').trim();
    if (!d) return '';
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(d);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    var t = Date.parse(d);
    if (!isNaN(t)) {
      var dt = new Date(t);
      return dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2);
    }
    return d; /* 保留作者手写的原始日期（如“2026 年春”） */
  }

  function fmtSize(bytes) {
    bytes = Number(bytes || 0);
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function encSeg(s) { return encodeURIComponent(String(s)); }

  function prettifyName(repoName) {
    var s = String(repoName || '').replace(/[-_]+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '论文站';
  }

  /* ---------------- 仓库识别 ----------------
   * GitHub Pages 项目页:  https://owner.github.io/repo/...  → owner=reponame 拆出
   * GitHub 用户主页:      https://owner.github.io/          → repo=owner.github.io
   * 其它（自定义域名/本地）: 需在 config.js 手工填 owner/repo
   * ------------------------------------------------------- */
  function detectRepo(cfg, loc) {
    cfg = cfg || {};
    loc = loc || (typeof location !== 'undefined' ? location : { hostname: '', pathname: '' });
    var out = {
      owner: String(cfg.owner || '').trim(),
      repo: String(cfg.repo || '').trim(),
      branch: String(cfg.branch || '').trim(),
      papersDir: String(cfg.papersDir || 'papers').replace(/^\/+|\/+$/g, '') || 'papers',
      ok: false,
      source: 'config'
    };
    if (out.owner && out.repo) { out.ok = true; return out; }
    var host = String(loc.hostname || '').toLowerCase();
    if (/\.github\.io$/.test(host)) {
      var sub = host.replace(/\.github\.io$/, '');
      var segs = String(loc.pathname || '').split('/').filter(Boolean);
      out.owner = sub;
      out.repo = segs.length ? segs[0] : sub + '.github.io';
      out.source = 'auto';
      out.ok = true;
    }
    return out;
  }

  /* ---------------- URL 构造 ---------------- */

  function rawUrl(repo, pathInRepo) {
    var segs = String(pathInRepo).split('/').filter(Boolean).map(encSeg);
    return 'https://raw.githubusercontent.com/' + encSeg(repo.owner) + '/' + encSeg(repo.repo) +
      '/HEAD/' + segs.join('/');
  }

  function apiUrl(repo, pathInRepo) {
    var segs = String(pathInRepo).split('/').filter(Boolean).map(encSeg);
    return 'https://api.github.com/repos/' + encSeg(repo.owner) + '/' + encSeg(repo.repo) +
      (segs.length ? '/' + segs.join('/') : '');
  }

  /* ---------------- front matter 解析 ----------------
   * 支持:  key: value / "带引号" / [a, b] / 块级(|、>，多行合并为一行)
   * --------------------------------------------------- */
  function parseFrontMatter(text) {
    text = String(text || '');
    var meta = {}, body = text;
    var m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*---[ \t]*(?:\r?\n|$)/.exec(text);
    if (m) {
      body = text.slice(m[0].length).replace(/^(\r?\n)+/, '');  /* 去掉紧随的前导空行 */
      var lines = m[1].split(/\r?\n/);
      var key = null, blockMode = false, buf = [];
      function flush() {
        if (key) meta[key] = stripQuotes(buf.join(' ').replace(/\s+/g, ' ').trim());
        key = null; blockMode = false; buf = [];
      }
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var kv = /^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:[ \t]?(.*)$/.exec(line);
        if (kv) {
          flush();
          key = kv[1].toLowerCase();
          var v = kv[2].trim();
          if (v === '|' || v === '>' || v === '|-' || v === '>-') { blockMode = true; buf = []; }
          else { meta[key] = stripQuotes(v); key = null; }
        } else if (key && blockMode && /^\s*\S/.test(line)) {
          buf.push(line.trim());
        } else if (key && blockMode && /^\s*$/.test(line)) {
          buf.push('');
        } else if (key && blockMode) {
          flush();
        }
        /* 其余行忽略 */
      }
      flush();
    }
    return { meta: meta, body: body };
  }

  function metaFromFrontMatter(fileName, meta) {
    meta = meta || {};
    var nameNoExt = fileName.replace(/\.(md|markdown)$/i, '');
    return {
      name: fileName,
      type: 'md',
      title: stripQuotes(meta.title) || nameNoExt,
      author: stripQuotes(meta.author || meta.authors || ''),
      date: stripQuotes(meta.date || meta.published || ''),
      abstract: stripQuotes(meta.abstract || meta.summary || ''),
      tags: meta.tags ? splitList(meta.tags) : (meta.keywords ? splitList(meta.keywords) : []),
      code: meta.code ? splitList(meta.code) : (meta.repo ? splitList(meta.repo) : [])
    };
  }

  /* ---------------- 论文条目 ----------------
   * sidecar 约定： papers/foo.pdf 的元信息文件是 papers/foo.pdf.json
   * ------------------------------------------------ */
  function isSidecarName(n) { return /\.json$/i.test(n); }
  function sidecarKeyOf(n) { return n.slice(0, -5); }        /* 去掉 ".json" */
  function sidecarNameFor(baseName) { return baseName + '.json'; }

  function mergeMeta(entry, src) {
    if (!src) return entry;
    if (src.title) entry.title = String(src.title);
    if (src.author) entry.author = String(src.author);
    if (src.date) entry.date = String(src.date);
    if (src.abstract) entry.abstract = String(src.abstract);
    if (src.tags && src.tags.length) entry.tags = src.tags.slice();
    if (src.code && src.code.length) entry.code = src.code.slice();
    return entry;
  }

  function metaFromSidecar(jsonText) {
    var s = {};
    try { s = JSON.parse(jsonText) || {}; } catch (e) { s = {}; }
    return {
      title: s.title || '',
      author: s.author || '',
      date: s.date || '',
      abstract: s.abstract || '',
      tags: Array.isArray(s.tags) ? s.tags.map(String)
        : (s.tags ? splitList(String(s.tags)) : []),
      code: Array.isArray(s.code) ? s.code.map(String)
        : (s.code ? splitList(String(s.code)) : [])
    };
  }

  /**
   * files: [{name, sha, size, title?, date?, ...}]  （GitHub API 或 index.json）
   * mdMetaMap:  { 文件名: front matter 解析结果 }
   * sidecarMap: { 文件名: sidecar 解析结果 }
   * 优先级：front matter > index.json 自带字段 > sidecar
   */
  function buildEntries(files, mdMetaMap, sidecarMap) {
    mdMetaMap = mdMetaMap || {};
    sidecarMap = sidecarMap || {};
    var entries = [];
    (files || []).forEach(function (f) {
      var name = typeof f === 'string' ? f : (f && f.name) || '';
      if (!name || name.indexOf('/') !== -1) return;
      var c0 = name.charAt(0);
      if (c0 === '.' || c0 === '_') return;          /* 隐藏文件 / 下划线文件不展示 */
      if (isSidecarName(name)) return;               /* sidecar 本身不展示 */
      var type = /\.(md|markdown)$/i.test(name) ? 'md' : (/\.pdf$/i.test(name) ? 'pdf' : null);
      if (!type) return;                             /* 只支持 md / pdf */
      var e = {
        name: name, type: type,
        sha: (f && f.sha) || '',
        size: Number((f && f.size) || 0),
        title: name.replace(/\.(md|markdown|pdf)$/i, ''),
        author: '', date: '', abstract: '', tags: [], code: []
      };
      mergeMeta(e, (f && (f.title || f.date || f.abstract || f.tags)) ? f : null);
      mergeMeta(e, mdMetaMap[name]);
      mergeMeta(e, sidecarMap[name]);
      e.date = fmtDate(e.date);
      entries.push(e);
    });
    entries.sort(function (a, b) {
      var d = dateKey(b.date) - dateKey(a.date);     /* 新的在前 */
      if (d) return d;
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return entries;
  }

  function filterEntries(entries, query, tag) {
    var q = String(query || '').trim().toLowerCase();
    return (entries || []).filter(function (e) {
      if (tag && (e.tags || []).indexOf(tag) === -1) return false;
      if (!q) return true;
      var hay = [e.title, e.author, e.abstract, e.name,
                 (e.tags || []).join(' '), (e.code || []).join(' ')].join(' ').toLowerCase();
      return q.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
    });
  }

  /* ---------------- 数学公式保护 ----------------
   * 在 Markdown 解析【前】：
   *   1) 把代码区（围栏代码块 + 行内代码）里的 $ 换成 ZMDOL 令牌，
   *      避免代码里的 $$ 被误当成公式定界符；
   *   2) 把公式摘出来存好、换成 ZMTOK 占位符；
   * 渲染成 DOM 后再由 app.js 把占位符换回原文，交给 KaTeX
   * （KaTeX 自身会忽略 pre/code 标签，代码里保持原样）。
   * ------------------------------------------------ */
  var TOKEN_RE = /ZMTOK(\d+)END/g;
  var DOL_RE = /ZMDOL(\d+)END/g;

  function maskDollarsInCode(text, dolStore) {
    var lines = String(text).split('\n');
    var inFence = false, fenceCh = '';
    function mask(str) {
      return str.replace(/\$/g, function () {
        dolStore.push(1);
        return 'ZMDOL' + (dolStore.length - 1) + 'END';
      });
    }
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var fOpen = /^\s*(`{3,}|~{3,})/.exec(raw);
      var fClose = /^\s*(`{3,}|~{3,})\s*$/.exec(raw);
      if (inFence) {
        lines[i] = mask(raw);
        if (fClose && fClose[1].charAt(0) === fenceCh) inFence = false;
      } else if (fOpen) {
        inFence = true;
        fenceCh = fOpen[1].charAt(0);
        lines[i] = mask(raw);
      } else {
        lines[i] = raw.replace(/`[^`\n]*`/g, mask);   /* 行内代码段 */
      }
    }
    return lines.join('\n');
  }

  function protectMath(src) {
    var store = [], dolStore = [];
    function stash(m) { store.push(m); return 'ZMTOK' + (store.length - 1) + 'END'; }
    var s = maskDollarsInCode(String(src || ''), dolStore);
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, stash);           /* $$...$$ 可跨行 */
    s = s.replace(/\\\[([\s\S]+?)\\\]/g, stash);           /* \[...\] */
    s = s.replace(/\\\(([\s\S]+?)\\\)/g, stash);           /* \(...\) */
    /* 单 $...$：同行、非空、前一字符不是 \ 或 $（避免吃掉转义 \$ 和货币符号相邻情形） */
    s = s.replace(/(^|[^\$\\])\$([^$\n]+?)\$(?!\$)/g,
      function (all, p1, p2) { return p1 + stash('$' + p2 + '$'); });
    return { text: s, store: store, dolStore: dolStore };
  }

  /* ---------------- base64（UTF-8 安全） ---------------- */

  function utf8ToB64(str) {
    var bytes = new TextEncoder().encode(String(str));
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64ToUtf8(b64) {
    var bin = atob(String(b64 || '').replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /* ---------------- 导出 ---------------- */

  var PaperCore = {
    VERSION: VERSION,
    stripQuotes: stripQuotes,
    splitList: splitList,
    escapeHtml: escapeHtml,
    dateKey: dateKey,
    fmtDate: fmtDate,
    fmtSize: fmtSize,
    encSeg: encSeg,
    prettifyName: prettifyName,
    detectRepo: detectRepo,
    rawUrl: rawUrl,
    apiUrl: apiUrl,
    parseFrontMatter: parseFrontMatter,
    metaFromFrontMatter: metaFromFrontMatter,
    isSidecarName: isSidecarName,
    sidecarKeyOf: sidecarKeyOf,
    sidecarNameFor: sidecarNameFor,
    mergeMeta: mergeMeta,
    metaFromSidecar: metaFromSidecar,
    buildEntries: buildEntries,
    filterEntries: filterEntries,
    TOKEN_RE: TOKEN_RE,
    protectMath: protectMath,
    utf8ToB64: utf8ToB64,
    b64ToUtf8: b64ToUtf8
  };

  global.PaperCore = PaperCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = PaperCore;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
