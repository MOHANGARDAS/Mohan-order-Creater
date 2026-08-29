import { useMemo, useRef, useState, useDeferredValue } from 'react';
import Icon from './Icon.jsx';
import { renderAnswer, htmlToPlainText } from '../lib/markdown.js';
import { downloadText, exportMessageXlsx, openPrint, downloadBlob, stamp } from '../lib/files.js';
import { speak, stopSpeak } from '../lib/speech.js';

function ImageCard({ att, toast }) {
  const [err, setErr] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function saveImage() {
    try {
      const r = await fetch(att.url, { referrerPolicy: 'no-referrer' });
      const b = await r.blob();
      if (!b.type.startsWith('image/')) throw new Error('not image');
      downloadBlob(b, `mohan-image-${stamp()}.jpg`);
    } catch {
      window.open(att.directUrl || att.url, '_blank', 'noopener');
    }
  }

  if (att.status === 'error' || err) {
    return (
      <div className="img-card img-err">
        <Icon name="image" size={18} />
        <span>Image load nahi hui (free lane busy thi).</span>
      </div>
    );
  }

  return (
    <figure className="img-card">
      {!loaded && <div className="img-skel"><Icon name="image" size={22} /><span>Image load ho rahi hai…</span></div>}
      <img
        src={att.url}
        alt={att.prompt || 'MOHAN generated image'}
        onLoad={() => setLoaded(true)}
        onError={() => setErr(true)}
        style={loaded ? undefined : { position: 'absolute', opacity: 0, width: 1, height: 1 }}
      />
      <figcaption className="img-actions">
        <span className="img-cap" title={att.prompt}>{att.prompt}</span>
        <span className="img-btns">
          <button type="button" className="ghost-btn" onClick={saveImage} title="Download image">
            <Icon name="download" size={14} /> Save
          </button>
          <button type="button" className="ghost-btn" onClick={() => window.open(att.directUrl || att.url, '_blank', 'noopener')} title="Open full">
            <Icon name="external" size={14} />
          </button>
        </span>
      </figcaption>
    </figure>
  );
}

export default function Msg({ msg, isStreaming, isLast, onRegenerate, onRetry, toast }) {
  const bodyRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showLog, setShowLog] = useState(false);

  // USER bubble
  if (msg.role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble">{msg.content}</div>
      </div>
    );
  }

  // ASSISTANT message
  const deferredContent = useDeferredValue(msg.content);
  const parsed = useMemo(
    () => renderAnswer(isStreaming ? deferredContent : msg.content),
    [deferredContent, msg.content, isStreaming],
  );
  const thinkingText = (msg.thinking || '') + (parsed.thinking ? `\n${parsed.thinking}` : '');
  const notices = msg.notices || [];
  const lastNotice = notices[notices.length - 1];
  const isDone = msg.status === 'done';
  const isError = msg.status === 'error';

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(msg.content || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1300);
    } catch { toast('Copy nahi hua'); }
  };

  const toggleSpeak = () => {
    if (speaking) { stopSpeak(); setSpeaking(false); return; }
    speak(htmlToPlainText(parsed.html));
    setSpeaking(true);
    setTimeout(() => setSpeaking(false), 60_000);
  };

  const doExcel = async () => {
    const ok = await exportMessageXlsx(bodyRef.current, parsed.csvBlocks);
    toast(ok ? 'Excel file download ho gayi 📊' : 'Is message me table nahi mila');
  };

  const doPdf = () => {
    openPrint('MOHAN reply', parsed.html || `<p>${(msg.content || '(empty)').replace(/</g, '&lt;')}</p>`);
  };

  const doMd = () => downloadText(msg.content || '', `mohan-reply-${stamp()}.md`, 'text/markdown');

  return (
    <div className={`msg ai ${isDone ? 'done' : ''} ${isError ? 'error' : ''}`}>
      <div className="avatar" title="MOHAN">M</div>
      <div className="body" ref={bodyRef}>
        {thinkingText.trim() && (
          <details className="think" open={isStreaming && !parsed.html}>
            <summary><Icon name="brain" size={14} /> {isStreaming ? 'Thinking… (process live)' : 'Thinking process'}</summary>
            <div className="think-body">{thinkingText.trim()}</div>
          </details>
        )}

        {isStreaming && lastNotice && !parsed.html && (
          <div className="notice-line">{lastNotice}<span className="caret" /></div>
        )}

        {parsed.html && (
          <div className="md" dangerouslySetInnerHTML={{ __html: parsed.html }} />
        )}

        {isStreaming && parsed.html && <span className="caret tail" />}

        {(msg.attachments || []).map((a, i) => (
          <div key={`${msg.id}-a${i}`}>
            {a.status === 'loading' ? (
              <div className="img-card"><div className="img-skel"><Icon name="image" size={22} /><span>MOHAN canvas pe image ban rahi hai…<br /><small>{lastNotice || '🎨 free image lane warming up'}</small></span></div></div>
            ) : (
              <ImageCard att={a} toast={toast} />
            )}
          </div>
        ))}

        {isError && (
          <div className="err-card">
            <span>😟 {msg.error || 'Kuch atak gaya. Mohan auto-heal kar raha hai — Retry dabao.'}</span>
            <button type="button" className="ghost-btn retry" onClick={() => onRetry(msg)}>
              <Icon name="refresh" size={14} /> Retry
            </button>
          </div>
        )}

        {isDone && (parsed.html || (msg.attachments || []).length > 0) && (
          <div className="toolbar">
            {!!parsed.html && (
              <>
                <button type="button" className="tool" title={copied ? 'Copied!' : 'Copy'} onClick={copyAll}>
                  <Icon name={copied ? 'check' : 'copy'} size={15} />
                </button>
                <button type="button" className="tool" title="Sunna (voice)" onClick={toggleSpeak}>
                  <Icon name={speaking ? 'stop' : 'speaker'} size={15} />
                </button>
                <button type="button" className="tool" title="PDF me save" onClick={doPdf}>
                  <Icon name="file" size={15} />
                </button>
                {(parsed.hasTable || parsed.csvBlocks.length > 0) && (
                  <button type="button" className="tool" title="Excel (.xlsx) download" onClick={doExcel}>
                    <Icon name="table" size={15} />
                  </button>
                )}
                <button type="button" className="tool" title="Markdown download" onClick={doMd}>
                  <Icon name="download" size={15} />
                </button>
              </>
            )}
            {isLast && !isStreaming && (
              <button type="button" className="tool" title="Regenerate" onClick={() => onRegenerate(msg)}>
                <Icon name="refresh" size={15} />
              </button>
            )}
            {(msg.slotLabel || msg.ms > 0 || notices.length > 0) && (
              <button type="button" className="meta" onClick={() => setShowLog((v) => !v)} title="Connection log">
                via {msg.slotLabel || 'MOHAN'}{msg.ms > 0 ? ` · ${(msg.ms / 1000).toFixed(1)}s` : ''}
                {notices.length > 0 ? ` · ${notices.length} switch` : ''}
              </button>
            )}
          </div>
        )}

        {showLog && notices.length > 0 && (
          <div className="log">
            {notices.map((n, i) => (
              <div className="log-line" key={i}>{n}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
