import Icon from './Icon.jsx';

const SUGGESTIONS = [
  { icon: 'sparkle', label: 'Explain', text: 'Quantum computing ko 10 saal ke bachhe jaisa samjhao', mode: 'auto' },
  { icon: 'image', label: 'Image', text: 'Mumbai skyline at sunset, cinematic poster style', mode: 'image' },
  { icon: 'table', label: 'Sheet', text: 'Ek monthly budget template banao — rent, food, travel, savings', mode: 'sheet' },
  { icon: 'file', label: 'Write', text: 'Fresher ke liye professional resume summary likho', mode: 'auto' },
];

export default function EmptyState({ onPick }) {
  return (
    <div className="empty">
      <div className="orb">M</div>
      <h2 className="empty-h">
        Namaste 👋 Main <span className="grad-text">MOHAN</span> hoon
      </h2>
      <p className="empty-sub">
        ChatGPT / Gemini jaisa AI — par poora <b>free</b>. Bina login, bina API key, bina ek rupaya.
        Images, Excel sheets, PDFs, code — sab ban jaata hai, har language me.
      </p>
      <div className="sugg">
        {SUGGESTIONS.map((s) => (
          <button key={s.label} type="button" className="sugg-chip" onClick={() => onPick(s.text, s.mode)}>
            <Icon name={s.icon} size={16} />
            <span className="sugg-label">{s.label}</span>
            <span className="sugg-text">{s.text}</span>
          </button>
        ))}
      </div>
      <p className="empty-hint">🔁 Engine khud best free model choose karta hai — limit aane par automatically switch</p>
    </div>
  );
}
