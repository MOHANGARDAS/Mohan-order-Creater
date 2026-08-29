import Icon from './Icon.jsx';

export default function Sidebar({ open, chats, activeId, onNew, onSelect, onDelete, onClose }) {
  return (
    <>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sb-top">
          <button type="button" className="newchat" onClick={onNew}>
            <span className="orb-tiny">M</span> New chat
          </button>
        </div>
        <div className="sb-list">
          {chats.length === 0 && (
            <div className="sb-empty">
              Abhi koi chat nahi ✨
              <br />
              <span>Neeche composer se shuru karo!</span>
            </div>
          )}
          {chats.map((c) => (
            <div
              key={c.id}
              className={`sb-item ${c.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(c.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(c.id)}
            >
              <Icon name="chat" size={14} />
              <span className="sb-title">{c.title}</span>
              <button
                type="button"
                className="sb-del"
                title="Delete chat"
                onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="sb-foot">
          <div className="sb-foot-line">⚡ zero-key engine · auto-rotating</div>
          <div className="sb-foot-sub">
            GPT / Claude / Llama / Gemini class models
            <br />
            free public tiers · no login · no cost
          </div>
        </div>
      </aside>
      {open && <div className="backdrop" onClick={onClose} />}
    </>
  );
}
