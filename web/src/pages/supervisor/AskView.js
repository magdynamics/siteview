import React, { useState } from 'react';
import api from '../../services/api';
import { startListening, speechSupported } from '../../services/speech';

// Voice/text query — "Where is beam 5012?" (technical guideline §6.4)
export default function AskView({ siteId }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [history, setHistory] = useState([]);

  const ask = async (q) => {
    const question = (q || text).trim();
    if (!question) return;
    setText('');
    try {
      const res = await api.post('/voice/query', { text: question, siteId });
      setHistory(h => [{ q: question, ...res.data }, ...h]);
    } catch (err) {
      setHistory(h => [{ q: question, answer: err.response?.data?.error || 'Query failed', intent: 'error' }, ...h]);
    }
  };

  const mic = () => {
    const ok = startListening((transcript) => { setText(transcript); ask(transcript); }, () => setListening(false));
    if (ok) setListening(true);
    else alert('Voice input needs Chrome or Edge — type your question instead.');
  };

  return (
    <div>
      <div style={styles.card}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            style={styles.input}
            placeholder='Ask anything — "Where is beam 5012?", "What did we spend this week?", "Status of the excavator"'
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && ask()}
          />
          <button style={{ ...styles.micBtn, background: listening ? '#b71c1c' : '#1a237e' }} onClick={mic} title={speechSupported() ? 'Speak' : 'Voice not supported in this browser'}>
            {listening ? '🔴' : '🎙'}
          </button>
          <button style={styles.btn} onClick={() => ask()}>Ask</button>
        </div>
      </div>

      {history.map((h, i) => (
        <div key={i} style={styles.answerCard}>
          <div style={styles.question}>❓ {h.q}</div>
          <div style={styles.answer}>{h.answer}</div>
          <div style={styles.meta}>intent: {h.intent}{h.source ? ' · source: ' + Object.entries(h.source).map(([k, v]) => `${k}=${String(v).slice(0, 12)}…`).join(', ') : ''}</div>
        </div>
      ))}
      {history.length === 0 && (
        <div style={{ textAlign: 'center', color: '#aaa', padding: 30, fontSize: 14 }}>
          Answers come with their source — every reply traces to a logged event.
        </div>
      )}
    </div>
  );
}

const styles = {
  card: { background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 16 },
  input: { flex: 1, padding: '11px 14px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 },
  micBtn: { color: '#fff', border: 'none', borderRadius: 8, width: 46, cursor: 'pointer', fontSize: 16 },
  btn: { background: '#2e7d32', color: '#fff', border: 'none', padding: '0 22px', borderRadius: 8, cursor: 'pointer', fontSize: 14 },
  answerCard: { background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 10 },
  question: { fontSize: 13, color: '#888', marginBottom: 6 },
  answer: { fontSize: 15, color: '#1a237e', fontWeight: 600 },
  meta: { fontSize: 11, color: '#bbb', marginTop: 6 },
};
