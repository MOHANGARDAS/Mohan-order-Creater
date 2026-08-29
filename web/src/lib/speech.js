// MOHAN voice — browser-native (free, unlimited, multilingual incl. Hindi).
export const canMic = () =>
  typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

export function startMic({ onText, onError, onEnd } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { onError && onError('Voice input is browser me supported nahi hai (Chrome/Edge try karo)'); return null; }
  const rec = new SR();
  try { rec.lang = navigator.language || 'en-US'; } catch { rec.lang = 'en-US'; }
  rec.interimResults = true;
  rec.continuous = false;
  let finalTxt = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const tr = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalTxt += tr + ' ';
      else interim += tr;
    }
    onText && onText((finalTxt + interim).trim());
  };
  rec.onerror = (e) => {
    onError && onError(e.error === 'not-allowed' ? 'Mic permission chahiye — address bar me allow karo' : `Mic error: ${e.error || 'unknown'}`);
    onEnd && onEnd();
  };
  rec.onend = () => { onEnd && onEnd(); };
  try { rec.start(); } catch { onError && onError('Mic start nahi hua'); return null; }
  return { stop: () => { try { rec.stop(); } catch { /* noop */ } } };
}

export function speak(text) {
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 1400));
    const hindi = /[\u0900-\u097F]/.test(text);
    const voices = synth.getVoices();
    const pick =
      voices.find((v) => (hindi ? /^hi/i.test(v.lang) : /^en/i.test(v.lang))) ||
      voices.find((v) => /^en/i.test(v.lang));
    if (pick) { u.voice = pick; u.lang = pick.lang; } else u.lang = hindi ? 'hi-IN' : 'en-US';
    u.rate = 1;
    synth.speak(u);
  } catch { /* speech unavailable */ }
}

export function stopSpeak() {
  try { window.speechSynthesis.cancel(); } catch { /* noop */ }
}
