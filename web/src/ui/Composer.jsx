import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { startMic, canMic } from '../lib/speech.js';

const MODES = [
  { id: 'auto', icon: 'sparkle', label: 'Auto' },
  { id: 'image', icon: 'image', label: 'Image' },
  { id: 'sheet', icon: 'table', label: 'Sheet' },
];

const PLACEHOLDERS = {
  auto: 'MOHAN se kuch bhi poochho… (message likho ya 🎙️ bolo)',
  image: 'Image describe karo — e.g. "gateway of india at sunset, cinematic"',
  sheet: 'Kis data ki Excel chahiye? e.g. "weekly expense tracker" / "class timetable"',
};

export default function Composer({ mode, setMode, busy, onSend, onStop, toast }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const taRef = useRef(null);
  const micRef = useRef(null);
  const micBase = useRef('');

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(200, ta.scrollHeight)}px`;
  }, [text]);

  useEffect(() => () => { micRef.current && micRef.current.stop(); }, []);

  const doSend = () => {
    const t = text.trim();
    if (!t || busy) return;
    if (micRef.current) { micRef.current.stop(); micRef.current = null; }
    setListening(false);
    onSend(t, mode);
    setText('');
    setTimeout(() => taRef.current && taRef.current.focus(), 30);
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  const toggleMic = () => {
    if (listening) {
      if (micRef.current) micRef.current.stop();
      micRef.current = null;
      setListening(false);
      return;
    }
    micBase.current = text;
    const handle = startMic({
      onText: (v) => setText(micBase.current ? `${micBase.current} ${v}` : v),
      onError: (err) => toast(err),
      onEnd: () => { setListening(false); micRef.current = null; },
    });
    if (handle) {
      micRef.current = handle;
      setListening(true);
      toast('🎙️ Bolo… (Hindi/Hinglish/English sab chalega)');
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer-inner">
        <div className="mode-chips" role="tablist" aria-label="MOHAN modes">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`chip ${mode === m.id ? 'active' : ''}`}
              onClick={() => setMode(m.id)}
              role="tab"
              aria-selected={mode === m.id}
            >
              <Icon name={m.icon} size={13} /> {m.label}
            </button>
          ))}
          {mode === 'image' && <span className="chip-hint">🎨 FLUX / Turbo free lanes</span>}
          {mode === 'sheet' && <span className="chip-hint">📊 Reply ke saath .xlsx download button</span>}
        </div>
        <div className={`composer ${listening ? 'listening' : ''}`}>
          <textarea
            ref={taRef}
            value={text}
            rows={1}
            placeholder={PLACEHOLDERS[mode] || PLACEHOLDERS.auto}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            aria-label="Message MOHAN"
          />
          <div className="composer-bar">
            <div className="cb-left">
              {canMic() && (
                <button
                  type="button"
                  className={`icon-btn round ${listening ? 'live' : ''}`}
                  onClick={toggleMic}
                  title={listening ? 'Mic band karo' : 'Voice input'}
                >
                  <Icon name="mic" size={17} />
                </button>
              )}
              <span className="cb-hint hide-sm">Enter = send · Shift+Enter = new line</span>
            </div>
            {busy ? (
              <button type="button" className="send stop" onClick={onStop} title="Stop">
                <Icon name="stop" size={15} />
              </button>
            ) : (
              <button type="button" className="send" onClick={doSend} disabled={!text.trim()} title="Send">
                <Icon name="send" size={17} />
              </button>
            )}
          </div>
        </div>
        <div className="composer-note">MOHAN free public AI tiers use karta hai — kabhi-kabhi lane busy ho to engine auto-rotate karta hai ⚡</div>
      </div>
    </div>
  );
}
