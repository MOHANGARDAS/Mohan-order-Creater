import { useState, useCallback } from 'react';

export function useToasts() {
  const [items, setItems] = useState([]);
  const push = useCallback((text, ms = 3600) => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), ms);
  }, []);
  return { items, push };
}

export function Toasts({ items }) {
  if (!items.length) return null;
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className="toast">{t.text}</div>
      ))}
    </div>
  );
}
