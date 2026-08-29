import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';

export default function HealthPopover({ health, onClose, onRefresh, onReset }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="hp-pop" onClick={(e) => e.stopPropagation()}>
      <div className="hp-head">
        <Icon name="activity" size={16} />
        <div className="hp-head-txt">
          <b>MOHAN engine</b>
          <span>limit hit → auto switch & self-heal</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      <div className="hp-list">
        {health.slots.length === 0 && <div className="hp-none">Free providers discover ho rahe hain…</div>}
        {health.slots.map((s) => (
          <div key={s.id} className="hp-row">
            <span className={`hp-status ${s.state}`} />
            <div className="hp-main">
              <b>{s.label}</b>
              <span className="hp-model">{s.model}</span>
            </div>
            <div className="hp-meta">
              {s.state === 'ready' && <span className="ok">● ready</span>}
              {s.state === 'throttle' && <span className="ok">◌ {Math.ceil(s.waitMs / 1000)}s</span>}
              {s.state === 'cooling' && <span className="warn">cooldown {Math.ceil(s.waitMs / 1000)}s</span>}
              {s.state === 'dead' && <span className="bad">resting {s.waitMs >= 3600000 ? `${Math.round(s.waitMs / 3600000)}h` : `${Math.ceil(s.waitMs / 60000)}m`}</span>}
              {s.avgMs > 0 && <span className="ms">{(s.avgMs / 1000).toFixed(1)}s avg</span>}
              {s.successes > 0 && <span className="served">×{s.successes}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="hp-actions">
        <button type="button" className="ghost-btn" onClick={onRefresh}><Icon name="refresh" size={13} /> Rediscover</button>
        <button type="button" className="ghost-btn" onClick={onReset}>Reset healing</button>
      </div>
      <div className="hp-note">
        🔓 Koi manual key nahi hai — sab keyless free tiers. Rate-limit aate hi slot cool-down hota hai aur
        MOHAN agle model pe switch kar jata hai; limit reset hote hi wapas live. Poora automatic.
      </div>
    </div>
  );
}
