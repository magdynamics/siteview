import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const DISCIPLINES = ['architectural', 'structural', 'mechanical', 'electrical', 'plumbing', 'hvac', 'fire_protection', 'civil', 'lighting'];

// Plan / drawing library with versioning (technical guideline §4.6)
export default function PlansView({ siteId }) {
  const [plans, setPlans] = useState([]);
  const [discipline, setDiscipline] = useState('');
  const [showUpload, setShowUpload] = useState(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const res = await api.get(`/plans?siteId=${siteId}${discipline ? `&discipline=${discipline}` : ''}`);
      setPlans(res.data);
    } catch (err) { alert(err.response?.data?.error || 'Failed to load plans'); }
  }, [siteId, discipline]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>Plan Library ({plans.length} current)</h3>
          <div style={{ display: 'flex', gap: 10 }}>
            <select style={styles.select} value={discipline} onChange={e => setDiscipline(e.target.value)}>
              <option value="">All disciplines</option>
              {DISCIPLINES.map(d => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
            </select>
            <button style={styles.btn} onClick={() => setShowUpload(true)}>+ Upload Plan</button>
          </div>
        </div>
        <table style={styles.table}>
          <thead><tr>{['Title', 'Discipline', 'Version', 'Zones', 'Uploaded', ''].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {plans.map(p => (
              <tr key={p.id} style={styles.tr}>
                <td style={styles.td}><strong>{p.title}</strong></td>
                <td style={styles.td}>{p.discipline.replace('_', ' ')}</td>
                <td style={styles.td}>v{p.versionNumber}</td>
                <td style={styles.td}>{(p.zoneTags || []).join(', ') || '-'}</td>
                <td style={styles.td}>{p.uploadedAt?.split('T')[0]} <span style={styles.dim}>{p.uploadedByName}</span></td>
                <td style={styles.td}>
                  <a href={p.fileUrl} target="_blank" rel="noreferrer" style={styles.link}>Open</a>
                </td>
              </tr>
            ))}
            {plans.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: '#aaa' }}>No plans uploaded yet</td></tr>}
          </tbody>
        </table>
      </div>

      {showUpload && <UploadModal siteId={siteId} onClose={() => setShowUpload(false)} onDone={() => { setShowUpload(false); load(); }} />}
    </div>
  );
}

function UploadModal({ siteId, onClose, onDone }) {
  const [form, setForm] = useState({ title: '', discipline: 'architectural', versionNumber: '1', zoneTags: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('siteId', siteId);
      fd.append('title', form.title);
      fd.append('discipline', form.discipline);
      fd.append('versionNumber', form.versionNumber);
      fd.append('zoneTags', form.zoneTags);
      const res = await api.post('/plans', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (res.data.superseded?.length) alert(`Uploaded — superseded ${res.data.superseded.length} prior version(s)`);
      onDone();
    } catch (err) { alert(err.response?.data?.error || 'Upload failed'); }
    finally { setBusy(false); }
  };

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ margin: '0 0 16px', color: '#1a237e' }}>Upload Plan</h3>
        <input style={styles.input} type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e => setFile(e.target.files[0])} />
        <input style={styles.input} placeholder="Title * (e.g. Structural — 5th Floor)" value={form.title} onChange={e => update('title', e.target.value)} />
        <div style={styles.row}>
          <select style={styles.input} value={form.discipline} onChange={e => update('discipline', e.target.value)}>
            {DISCIPLINES.map(d => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
          </select>
          <input style={styles.input} type="number" placeholder="Version" value={form.versionNumber} onChange={e => update('versionNumber', e.target.value)} />
        </div>
        <input style={styles.input} placeholder="Zone tags, comma separated (e.g. 5th Floor NW, Zone A)" value={form.zoneTags} onChange={e => update('zoneTags', e.target.value)} />
        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.btn} disabled={!file || !form.title || busy} onClick={submit}>{busy ? 'Uploading…' : 'Upload'}</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflowX: 'auto' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  cardTitle: { margin: 0, color: '#333', fontSize: 16 },
  select: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, background: '#fff' },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  cancelBtn: { background: '#f5f5f5', color: '#333', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 700 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '11px 12px', fontSize: 13, color: '#333' },
  dim: { color: '#aaa', fontSize: 12 },
  link: { color: '#1a237e', fontWeight: 'bold', textDecoration: 'none' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 16, padding: 28, width: 480 },
  input: { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' },
  row: { display: 'flex', gap: 12 },
};
