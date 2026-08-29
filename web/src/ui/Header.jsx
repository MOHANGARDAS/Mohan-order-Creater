import Icon from './Icon.jsx';

export function healthDot(health) {
  if (!health.ready) return 'grey';
  if (health.slots.some((s) => s.state === 'ready')) return 'green';
  if (health.slots.some((s) => s.state === 'cooling' || s.state === 'throttle')) return 'amber';
  return 'red';
}

const DOT_LABEL = {
  green: 'All systems go',
  amber: 'Auto-rotating',
  grey: 'Warming up',
  red: 'Healing…',
};

export default function Header({
  onMenu, health, healthOpen, onToggleHealth, onToggleTheme, theme, onExportChat, canExport,
}) {
  const dot = healthDot(health);
  return (
    <header className="hdr">
      <button type="button" className="icon-btn" onClick={onMenu} title="Menu">
        <Icon name="menu" />
      </button>
      <div className="brand">
        <span className="orb-min">M</span>
        <span className="brand-name">MOHAN</span>
        <span className="brand-sub">free multi-model AI</span>
      </div>
      <div className="hdr-right">
        {canExport && (
          <button type="button" className="ghost-btn" onClick={onExportChat} title="Chat ko PDF me export karo">
            <Icon name="file" size={15} />
            <span className="hide-sm">PDF</span>
          </button>
        )}
        <button type="button" className="icon-btn" onClick={onToggleTheme} title="Theme">
          {theme === 'dark' ? <Icon name="sun" size={17} /> : <Icon name="moon" size={17} />}
        </button>
        <button type="button" className={`health-pill ${dot}`} onClick={onToggleHealth} title="Engine health — auto rotation">
          <span className="hp-dot" />
          <Icon name="activity" size={14} />
          <span className="hide-sm">{DOT_LABEL[dot]}</span>
        </button>
      </div>
    </header>
  );
}
