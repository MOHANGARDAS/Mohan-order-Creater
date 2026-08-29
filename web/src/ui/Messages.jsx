import { useEffect, useRef, useState, useCallback } from 'react';
import Msg from './Msg.jsx';
import Icon from './Icon.jsx';
import { downloadCode } from '../lib/files.js';
import { highlightInto } from '../lib/markdown.js';

export default function Messages({ chat, streamingId, onRegenerate, onRetry, toast }) {
  const listRef = useRef(null);
  const [stick, setStick] = useState(true);

  // auto-scroll while streaming when user is near the bottom
  useEffect(() => {
    const el = listRef.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  });

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 140);
  }, []);

  // delegate code-block buttons + highlight any un-highlighted blocks
  useEffect(() => { highlightInto(listRef.current); });

  function onContainerClick(e) {
    const copyBtn = e.target.closest && e.target.closest('.cb-copy');
    const dlBtn = e.target.closest && e.target.closest('.cb-dl');
    if (copyBtn) {
      const cb = copyBtn.closest('.cb');
      const raw = decodeURIComponent((cb && cb.dataset.raw) || '');
      navigator.clipboard.writeText(raw).then(
        () => { copyBtn.textContent = 'Copied ✓'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200); },
        () => toast('Copy nahi hua — manually select kar lo'),
      );
    }
    if (dlBtn) {
      const cb = dlBtn.closest('.cb');
      downloadCode(decodeURIComponent((cb && cb.dataset.raw) || ''), (cb && cb.dataset.lang) || 'text');
    }
  }

  const msgs = chat.messages;

  return (
    <div className="chat-scroll" ref={listRef} onScroll={onScroll} onClick={onContainerClick}>
      <div className="msgs">
        {msgs.map((m, i) => (
          <Msg
            key={m.id}
            msg={m}
            isStreaming={m.id === streamingId}
            isLast={i === msgs.length - 1}
            onRegenerate={onRegenerate}
            onRetry={onRetry}
            toast={toast}
          />
        ))}
      </div>
      {!stick && (
        <button
          type="button"
          className="scroll-btn"
          title="Scroll to bottom"
          onClick={() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }}
        >
          <Icon name="chevron" size={18} />
        </button>
      )}
    </div>
  );
}
