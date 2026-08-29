// MOHAN local chat store (localStorage — no account, no server DB).
const KEY = 'mohan.chats.v1';
const SETTINGS_KEY = 'mohan.settings.v1';

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function titleOf(text) {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  return t.length > 44 ? t.slice(0, 44) + '…' : t || 'New chat';
}

export function loadChats() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY));
    if (j && Array.isArray(j.index) && j.items) return j;
  } catch { /* noop */ }
  return { index: [], items: {} };
}

function slim(chat) {
  return {
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt,
    messages: (chat.messages || []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content || '',
      thinking: m.thinking || '',
      model: m.model || '',
      slotLabel: m.slotLabel || '',
      ms: m.ms || 0,
      ts: m.ts,
      mode: m.mode || 'chat',
      status: m.status === 'error' ? 'error' : 'done',
      error: m.error || '',
      notices: (m.notices || []).slice(0, 8),
      attachments: (m.attachments || []).map((a) => ({
        type: a.type,
        url: a.directUrl || a.url,
        directUrl: a.directUrl || a.url,
        prompt: a.prompt || '',
        provider: a.provider || '',
        status: 'done',
      })),
    })),
  };
}

let saveTimer = null;
export function saveChats(store) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const index = [...store.index].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
      const items = {};
      for (const it of index) if (store.items[it.id]) items[it.id] = slim(store.items[it.id]);
      localStorage.setItem(KEY, JSON.stringify({ index, items }));
    } catch { /* quota exceeded — chat stays in memory */ }
  }, 300);
}

export function loadSettings() {
  try { return { theme: 'dark', sidebar: true, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) }; }
  catch { return { theme: 'dark', sidebar: true }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* noop */ }
}
