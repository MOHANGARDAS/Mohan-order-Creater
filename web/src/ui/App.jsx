import { useEffect, useRef, useState, useCallback } from 'react';
import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx';
import HealthPopover from './HealthPopover.jsx';
import Messages from './Messages.jsx';
import EmptyState from './EmptyState.jsx';
import Composer from './Composer.jsx';
import { Toasts, useToasts } from './Toast.jsx';
import { uid, titleOf, loadChats, saveChats, loadSettings, saveSettings } from '../lib/store.js';
import { remember, memoryBlock } from '../lib/memory.js';
import * as engine from '../engine/engine.js';
import { generateImage } from '../engine/images.js';
import { buildChatPayload, shouldAutoImage } from '../engine/persona.js';
import { renderAnswer } from '../lib/markdown.js';
import { openPrint } from '../lib/files.js';

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function App() {
  const [store, setStore] = useState(loadChats);
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [streamingId, setStreamingId] = useState(null);
  const [mode, setMode] = useState('auto');
  const [theme, setTheme] = useState(() => loadSettings().theme || 'dark');
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 900);
  const [health, setHealth] = useState({ ready: false, slots: [] });
  const [hpOpen, setHpOpen] = useState(false);
  const { items: toasts, push: toast } = useToasts();

  const storeRef = useRef(store);
  const activeRef = useRef(null);
  const busyRef = useRef(false);
  const abortRef = useRef(null);

  const setStoreR = useCallback((updater) => {
    setStore((s) => {
      const n = typeof updater === 'function' ? updater(s) : updater;
      storeRef.current = n;
      return n;
    });
  }, []);

  useEffect(() => { activeRef.current = activeId; }, [activeId]);
  useEffect(() => { saveChats(store); }, [store]);
  useEffect(() => { document.documentElement.dataset.theme = theme; saveSettings({ theme }); }, [theme]);

  useEffect(() => {
    let alive = true;
    engine.ensureReady().then(() => { if (alive) setHealth(engine.getHealth()); });
    const off = engine.onHealth(setHealth);
    return () => { alive = false; off(); };
  }, []);

  useEffect(() => {
    if (!hpOpen) return;
    const fn = (e) => {
      if (!(e.target.closest && (e.target.closest('.hp-pop') || e.target.closest('.health-pill')))) setHpOpen(false);
    };
    document.addEventListener('click', fn);
    return () => document.removeEventListener('click', fn);
  }, [hpOpen]);

  const chat = activeId ? store.items[activeId] : null;

  useEffect(() => {
    document.title = chat ? `${chat.title} · MOHAN` : 'MOHAN · Free AI';
  }, [chat, activeId]);

  const patchChat = useCallback((chatId, fn) => {
    setStoreR((s) => {
      const c = s.items[chatId];
      if (!c) return s;
      const c2 = fn(c);
      if (!c2 || c2 === c) return s;
      const entry = { id: chatId, title: c2.title, updatedAt: c2.updatedAt };
      const idx = s.index.some((i) => i.id === chatId);
      return {
        index: idx ? s.index.map((i) => (i.id === chatId ? entry : i)) : [entry, ...s.index],
        items: { ...s.items, [chatId]: c2 },
      };
    });
  }, [setStoreR]);

  const patchMsg = useCallback((chatId, msgId, fn) => {
    patchChat(chatId, (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === msgId ? fn(m) : m)),
      updatedAt: Date.now(),
    }));
  }, [patchChat]);

  const newChat = useCallback(() => { setActiveId(null); if (window.innerWidth <= 900) setSidebar(false); }, []);
  const selectChat = useCallback((id) => { setActiveId(id); if (window.innerWidth <= 900) setSidebar(false); }, []);
  const deleteChat = useCallback((id) => {
    setStoreR((s) => {
      const items = { ...s.items };
      delete items[id];
      return { index: s.index.filter((i) => i.id !== id), items };
    });
    if (activeRef.current === id) setActiveId(null);
  }, [setStoreR]);

  const runChat = useCallback(async (chatId, msgId, mMode, signal) => {
    const c = storeRef.current.items[chatId];
    const history = (c ? c.messages : [])
      .filter((m) => m.id !== msgId && m.content && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }));
    const payload = buildChatPayload(history, mMode, { memory: memoryBlock() });
    try {
      const res = await engine.chat({
        messages: payload,
        signal,
        onSlot: (slot) => patchMsg(chatId, msgId, (m) => ({ ...m, slotLabel: slot.label })),
        onNotice: (txt) => patchMsg(chatId, msgId, (m) => ({ ...m, notices: [...(m.notices || []), txt].slice(-8) })),
        onToken: (t) => patchMsg(chatId, msgId, (m) => ({ ...m, content: m.content + t })),
        onThinking: (t) => patchMsg(chatId, msgId, (m) => ({ ...m, thinking: (m.thinking || '') + t })),
      });
      patchMsg(chatId, msgId, (m) => ({ ...m, status: 'done', ms: res.ms, model: res.slot.model, slotLabel: res.slot.label }));
    } catch (e) {
      if (e && e.name === 'AbortError') {
        patchMsg(chatId, msgId, (m) => (m.content ? { ...m, status: 'done' } : { ...m, status: 'error', error: 'Rok diya gaya.' }));
      } else if (e && e.kind === 'exhausted') {
        patchMsg(chatId, msgId, (m) => ({ ...m, status: 'error', error: 'Saari free lanes abhi busy hain 😔 — kuch seconds me auto-heal ho jayengi. Bas Retry dabao.' }));
      } else if (e && e.kind === 'stream-broken') {
        patchMsg(chatId, msgId, (m) => (m.content ? { ...m, status: 'done' } : { ...m, status: 'error', error: 'Stream beech me ruk gayi. Retry dabao — agla model sambhal lega.' }));
      } else {
        patchMsg(chatId, msgId, (m) => ({ ...m, status: 'error', error: 'Network hiccup 😐 — Retry dabao, engine agle model se laayega.' }));
      }
    }
  }, [patchMsg]);

  const runImage = useCallback(async (chatId, msgId, prompt, signal) => {
    patchMsg(chatId, msgId, (m) => ({ ...m, attachments: [{ type: 'image', status: 'loading', prompt }] }));
    try {
      const res = await generateImage(prompt, {
        signal,
        onStatus: (txt) => patchMsg(chatId, msgId, (m) => ({ ...m, notices: [...(m.notices || []), txt].slice(-6) })),
      });
      patchMsg(chatId, msgId, (m) => ({
        ...m,
        status: 'done',
        ms: res.ms,
        slotLabel: res.provider,
        content: m.content || 'Image taiyaar hai ✅ — niche **Save** se download karo. Doosri style chahiye? Regenerate dabao ya prompt badal ke bhejo.',
        attachments: [{ type: 'image', status: 'done', url: res.url, directUrl: res.directUrl, prompt, provider: res.provider, blobbed: res.blobbed }],
      }));
    } catch (e) {
      if (e && e.name === 'AbortError') {
        patchMsg(chatId, msgId, (m) => ({ ...m, status: 'done', content: m.content || '(stopped)', attachments: (m.attachments || []).map((a) => ({ ...a, status: a.status === 'loading' ? 'error' : a.status })) }));
      } else {
        patchMsg(chatId, msgId, (m) => ({ ...m, status: 'error', error: 'Image lane abhi busy lag rahi hai 😔 — Retry dabao, engine doosre model/seed se try karega.', attachments: [{ type: 'image', status: 'error', prompt }] }));
      }
    }
  }, [patchMsg]);

  const send = useCallback(async (text, m) => {
    const t = (text || '').trim();
    if (!t || busyRef.current) return;
    // 🧠 MOHAN Memory — learn from every user message (naam/pasand/yaad-rakho…)
    const learned = remember(t);
    if (learned.length) toast(`🧠 Yaad rakh liya: ${learned.map((f) => f.k).join(', ')}`);
    // 🎯 Auto intent routing — picture/photo requests in AUTO mode go to the image engine
    const useMode = m || (shouldAutoImage(t) ? 'image' : 'auto');
    let cid = activeRef.current && storeRef.current.items[activeRef.current] ? activeRef.current : null;
    if (!cid) {
      const id = uid();
      const now = Date.now();
      setStoreR((s) => ({
        index: [{ id, title: titleOf(t), updatedAt: now }, ...s.index],
        items: { ...s.items, [id]: { id, title: titleOf(t), updatedAt: now, messages: [] } },
      }));
      setActiveId(id);
      cid = id;
    }
    const userMsg = { id: uid(), role: 'user', content: t, ts: Date.now(), status: 'done' };
    const aMsg = { id: uid(), role: 'assistant', content: '', thinking: '', notices: [], attachments: [], ts: Date.now(), status: 'streaming', mode: useMode };
    setStreamingId(aMsg.id);
    patchChat(cid, (c) => ({ ...c, messages: [...c.messages, userMsg, aMsg], updatedAt: Date.now(), title: c.messages.length ? c.title : titleOf(t) }));
    busyRef.current = true;
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      if (useMode === 'image') await runImage(cid, aMsg.id, t, ctrl.signal);
      else await runChat(cid, aMsg.id, useMode, ctrl.signal);
    } finally {
      busyRef.current = false;
      setBusy(false);
      abortRef.current = null;
      setStreamingId(null);
    }
  }, [patchChat, runChat, runImage, setStoreR]);

  const regenerate = useCallback(async (msg) => {
    if (busyRef.current) return;
    const c = storeRef.current.items[activeRef.current];
    if (!c) return;
    const i = c.messages.findIndex((m) => m.id === msg.id);
    if (i < 0) return;
    let j = i - 1;
    while (j >= 0 && c.messages[j].role !== 'user') j--;
    if (j < 0) return;
    const text = c.messages[j].content;
    const useMode = c.messages[i].mode || 'auto';
    const chatId = c.id;
    const aMsg = { id: uid(), role: 'assistant', content: '', thinking: '', notices: [], attachments: [], ts: Date.now(), status: 'streaming', mode: useMode };
    setStoreR((s) => {
      const cc = s.items[chatId];
      if (!cc) return s;
      return { ...s, items: { ...s.items, [chatId]: { ...cc, messages: [...cc.messages.slice(0, j + 1), aMsg], updatedAt: Date.now() } } };
    });
    setStreamingId(aMsg.id);
    busyRef.current = true;
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      if (useMode === 'image') await runImage(chatId, aMsg.id, text, ctrl.signal);
      else await runChat(chatId, aMsg.id, useMode, ctrl.signal);
    } finally {
      busyRef.current = false;
      setBusy(false);
      abortRef.current = null;
      setStreamingId(null);
    }
  }, [runChat, runImage, setStoreR]);

  const stop = useCallback(() => { if (abortRef.current) abortRef.current.abort(); }, []);

  const exportChatPdf = useCallback(() => {
    const c = activeRef.current && storeRef.current.items[activeRef.current];
    if (!c || !c.messages.length) return;
    const parts = [];
    for (const m of c.messages) {
      if (m.status === 'streaming') continue;
      if (m.role === 'user') {
        parts.push(`<div class="who">🧑 You</div><p>${escapeHtml(m.content).replace(/\n/g, '<br/>')}</p>`);
      } else {
        if (m.content) parts.push(`<div class="who ai">🤖 MOHAN</div>${renderAnswer(m.content).html}`);
        for (const a of (m.attachments || [])) {
          if (a.type === 'image' && a.status === 'done') {
            parts.push(`<p>🖼️ <b>Image</b>: ${escapeHtml(a.prompt || '')}<br/><small>${escapeHtml(a.directUrl || a.url || '')}</small></p>`);
          }
        }
      }
    }
    if (parts.length) openPrint(`Chat · ${c.title}`, parts.join(''));
  }, []);

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return (
    <div className="app">
      <Sidebar
        open={sidebar}
        chats={store.index}
        activeId={activeId}
        onNew={newChat}
        onSelect={selectChat}
        onDelete={deleteChat}
        onClose={() => setSidebar(false)}
      />
      <div className="main">
        <Header
          onMenu={() => setSidebar((v) => !v)}
          health={health}
          healthOpen={hpOpen}
          onToggleHealth={() => setHpOpen((v) => !v)}
          onToggleTheme={toggleTheme}
          theme={theme}
          canExport={!!(chat && chat.messages.length)}
          onExportChat={exportChatPdf}
        />
        {hpOpen && (
          <HealthPopover
            health={health}
            onClose={() => setHpOpen(false)}
            onRefresh={() => { engine.refreshDiscovery().then(() => setHealth(engine.getHealth())).catch(() => {}); toast('Providers re-discover ho rahe hain…'); }}
            onReset={() => { engine.resetEngineState(); toast('Healing state reset — sab slots fresh ✨'); }}
          />
        )}
        {(!chat || chat.messages.length === 0) ? (
          <div className="chat-scroll empty-wrap">
            <EmptyState onPick={(text, m) => { setMode(m); send(text, m); }} />
          </div>
        ) : (
          <Messages chat={chat} streamingId={streamingId} onRegenerate={regenerate} onRetry={regenerate} toast={toast} />
        )}
        <Composer mode={mode} setMode={setMode} busy={busy} onSend={send} onStop={stop} toast={toast} />
        <Toasts items={toasts} />
      </div>
    </div>
  );
}
