// MOHAN Language Lock — detects the user's language/script and returns a hard
// directive so the reply MIRRORS the user (Hindi→Devanagari, Hinglish→Roman
// Hindi, English→English, plus Bengali/Tamil/Telugu/Gujarati/Urdu/Arabic/CJK…).

const SCRIPTS = [
  { re: /[\u0900-\u097F]/, code: 'hi', name: 'Hindi (Devanagari)', lock: 'Reply ONLY in Hindi, written in Devanagari script — never Roman, never English.' },
  { re: /[\u0980-\u09FF]/, code: 'bn', name: 'Bengali', lock: 'Reply ONLY in Bengali, in Bengali script.' },
  { re: /[\u0A00-\u0A7F]/, code: 'pa', name: 'Punjabi', lock: 'Reply ONLY in Punjabi, in Gurmukhi script.' },
  { re: /[\u0A80-\u0AFF]/, code: 'gu', name: 'Gujarati', lock: 'Reply ONLY in Gujarati, in Gujarati script.' },
  { re: /[\u0B80-\u0BFF]/, code: 'ta', name: 'Tamil', lock: 'Reply ONLY in Tamil, in Tamil script.' },
  { re: /[\u0C00-\u0C7F]/, code: 'te', name: 'Telugu', lock: 'Reply ONLY in Telugu, in Telugu script.' },
  { re: /[\u0C80-\u0CFF]/, code: 'kn', name: 'Kannada', lock: 'Reply ONLY in Kannada, in Kannada script.' },
  { re: /[\u0D00-\u0D7F]/, code: 'ml', name: 'Malayalam', lock: 'Reply ONLY in Malayalam, in Malayalam script.' },
  { re: /[\u0E00-\u0E7F]/, code: 'th', name: 'Thai', lock: 'Reply ONLY in Thai, in Thai script.' },
  { re: /[\u0590-\u05FF]/, code: 'he', name: 'Hebrew', lock: 'Reply ONLY in Hebrew, in Hebrew script.' },
  { re: /[\u0600-\u06FF\u0750-\u077F]/, code: 'ar', name: 'Arabic/Urdu (Arabic script)', lock: 'Reply ONLY in the same Arabic-script language the user used (Urdu or Arabic), in that script.' },
  { re: /[\u0400-\u04FF]/, code: 'ru', name: 'Russian (Cyrillic)', lock: 'Reply ONLY in Russian, in Cyrillic script.' },
  { re: /[\u3040-\u30FF]/, code: 'ja', name: 'Japanese', lock: 'Reply ONLY in Japanese.' },
  { re: /[\u4E00-\u9FFF]/, code: 'zh', name: 'Chinese', lock: 'Reply ONLY in Chinese.' },
  { re: /[\uAC00-\uD7AF]/, code: 'ko', name: 'Korean', lock: 'Reply ONLY in Korean.' },
  { re: /[\u0370-\u03FF]/, code: 'el', name: 'Greek', lock: 'Reply ONLY in Greek.' },
];

// Strong Hinglish markers (unambiguous Roman-Hindi words).
const HINGLISH_STRONG = [
  'kya', 'kyu', 'kyun', 'kaise', 'kaisa', 'kaisi', 'nahi', 'nahin', 'nav', 'haan', 'hanji',
  'mujhe', 'muje', 'tum', 'tumhara', 'aap', 'aapka', 'hamara', 'hum', 'apna', 'apni',
  'karo', 'karna', 'kardo', 'banao', 'banana', 'banado', 'batao', 'bata', 'batana',
  'chahiye', 'chahiyea', 'accha', 'achha', 'acha', 'theek', 'tik', 'matlab', 'samajh',
  'samjha', 'jaldi', 'abhi', 'kal', 'aaj', 'bahut', 'bohot', 'bohat', 'thoda', 'zyada',
  'bhai', 'bhaiya', 'yaar', 'namaste', 'dhanyavad', 'shukriya', 'paisa', 'paise', 'khana',
  'paani', 'chalo', 'dekho', 'dekho', 'suno', 'achaa', 'wala', 'wali', 'vala', 'hoga',
  'hona', 'hogya', 'hojayega', 'karta', 'kartа', 'karte', 'karunga', 'raha', 'rahi', 'liye', 'waje',
];
const HINGLISH_MED = ['mera', 'meri', 'mere', 'tera', 'teri', 'tere', 'iska', 'uska', 'kaha', 'keh', 'laga', 'lage', 'de', 'na', 'hi', 'se', 'me', 'mein', 'par', 'aur', 'ek'];
const WORD_RE = /[A-Za-z']+/g;

export function detectLang(text) {
  const t = text || '';
  for (const s of SCRIPTS) {
    if (s.re.test(t)) return { code: s.code, name: s.name, lock: s.lock };
  }
  const words = (t.toLowerCase().match(WORD_RE) || []);
  if (!words.length) return { code: 'xx', name: '', lock: '' };
  const set = new Set(words);
  let score = 0;
  for (const w of set) if (HINGLISH_STRONG.includes(w)) score += 2;
  let med = 0;
  for (const w of set) if (HINGLISH_MED.includes(w)) med++;
  // ≥1 strong marker → Hinglish; or ≥3 medium markers with a long message
  if (score >= 2 || (score >= 1 && med >= 2) || med >= 4) {
    return { code: 'hi-latin', name: 'Hinglish (Roman-script Hindi)', lock: 'Reply ONLY in Hinglish — Hindi written in Roman/Latin script (jaise "kaise ho", "main samajh gaya"). NO Devanagari, NO shuddh English sentences.' };
  }
  return { code: 'en', name: 'English', lock: 'Reply ONLY in English (the user wrote in English).' };
}
