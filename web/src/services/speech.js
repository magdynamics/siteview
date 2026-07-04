// Browser speech-to-text via the Web Speech API (free; Chrome/Edge).
// Returns false if unsupported so callers fall back to typing.
export function startListening(onResult, onEnd) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;
  const rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => onResult(e.results[0][0].transcript);
  rec.onend = () => onEnd && onEnd();
  rec.onerror = () => onEnd && onEnd();
  rec.start();
  return true;
}

export const speechSupported = () =>
  !!(window.SpeechRecognition || window.webkitSpeechRecognition);
