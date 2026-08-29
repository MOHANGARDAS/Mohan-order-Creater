// MOHAN markdown pipeline: marked + DOMPurify + highlight.js (+ table/csv tools).
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import markdown from 'highlight.js/lib/languages/markdown';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import 'highlight.js/styles/github-dark.min.css';

const langs = { javascript, typescript, python, java, c, cpp, go, rust, ruby, php, css, json, bash, sql, yaml, xml, markdown, kotlin, swift };
for (const [name, def] of Object.entries(langs)) hljs.registerLanguage(name, def);
hljs.registerAliases(['js', 'jsx', 'mjs'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['html', 'vue', 'svelte'], { languageName: 'xml' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['md'], { languageName: 'markdown' });

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const renderer = new marked.Renderer();

renderer.code = (code, infostring) => {
  const lang = String(infostring || '').trim().split(/\s+/)[0].toLowerCase() || 'text';
  const raw = typeof code === 'string' ? code : (code && code.text) || '';
  return (
    `<div class="cb" data-lang="${escapeHtml(lang)}" data-raw="${encodeURIComponent(raw)}">` +
    `<div class="cb-head"><span class="cb-lang">${escapeHtml(lang)}</span>` +
    `<span class="cb-actions"><button type="button" class="cb-btn cb-copy" title="Copy code">Copy</button>` +
    `<button type="button" class="cb-btn cb-dl" title="Download file">⬇</button></span></div>` +
    `<pre><code class="hljs language-${escapeHtml(lang)}">${escapeHtml(raw)}</code></pre></div>`
  );
};

renderer.table = (header, body) =>
  `<div class="tw"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;

renderer.link = (href, title, text) =>
  `<a href="${escapeHtml(href || '#')}" target="_blank" rel="noopener noreferrer">${text}</a>`;

marked.use({ renderer, gfm: true, breaks: true });

export function highlightInto(container) {
  if (!container) return;
  for (const el of container.querySelectorAll('pre code:not([data-hl])')) {
    el.setAttribute('data-hl', '1');
    try { hljs.highlightElement(el); } catch { /* language unknown — leave plain */ }
  }
}

export function extractThinking(raw) {
  const thinks = [];
  let out = raw || '';
  out = out.replace(/<think>([\s\S]*?)<\/think>/gi, (m, g) => { thinks.push(g); return ''; });
  out = out.replace(/<thinking>([\s\S]*?)<\/thinking>/gi, (m, g) => { thinks.push(g); return ''; });
  const tail = out.match(/<think>([\s\S]*)$/i) || out.match(/<thinking>([\s\S]*)$/i);
  if (tail) { if (tail[1].trim()) thinks.push(tail[1]); out = out.slice(0, out.length - tail[0].length); }
  return { main: out, thinking: thinks.filter((t) => t.trim()).join('\n\n').trim() };
}

export function parseCsv(csv) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  const src = String(csv).replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

function csvToMarkdownTable(csv) {
  try {
    const rows = parseCsv(csv);
    if (!rows.length || rows[0].length < 2) return null;
    const width = Math.max(...rows.map((r) => r.length));
    const esc = (s) => String(s).replace(/\|/g, '\\|').trim();
    const head = rows[0].concat(Array(width).fill('')).slice(0, width);
    const bodyRows = rows.slice(1).map((r) => r.concat(Array(width).fill('')).slice(0, width));
    const mdRows = [
      `| ${head.map(esc).join(' | ')} |`,
      `| ${head.map(() => '---').join(' | ')} |`,
      ...bodyRows.map((r) => `| ${r.map(esc).join(' | ')} |`),
    ];
    return mdRows.join('\n');
  } catch { return null; }
}

const SANITIZE_OPTS = {
  ADD_ATTR: ['target', 'rel', 'data-raw', 'data-lang', 'colspan', 'rowspan', 'align'],
  FORBID_TAGS: ['form', 'input', 'button-svg'],
};

export function renderAnswer(raw) {
  const { main, thinking } = extractThinking(raw || '');
  const csvBlocks = [];
  const md = main.replace(/```csv[ \t]*\r?\n([\s\S]*?)```/gi, (m, csv) => {
    csvBlocks.push(csv);
    const table = csvToMarkdownTable(csv);
    return table || `\`\`\`text\n${csv}\`\`\``;
  });
  let html = '';
  try {
    html = DOMPurify.sanitize(String(marked.parse(md, { async: false })), SANITIZE_OPTS);
  } catch {
    html = `<p>${escapeHtml(md)}</p>`;
  }
  return {
    html,
    thinking,
    csvBlocks,
    hasTable: /<table/i.test(html),
  };
}

export function htmlToPlainText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}
