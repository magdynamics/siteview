import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const SEVERITY_COLOR = { minor: '#1565c0', moderate: '#e65100', serious: '#b71c1c', critical: '#880e4f' };
const TYPE_LABEL = {
  injury: '🩹 Injury', near_miss: '⚠️ Near Miss', property_damage: '🔨 Property Damage',
  environmental: '🌊 Environmental', other: '📋 Other',
};

// Safety incident log (technical guideline §10.5) — report, review, close
export default function SafetyView({ siteId }) {
  const [incidents, setIncidents] = useState([]);
  const [showClosed, setShowClosed] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    incidentType: 'near_miss', severity: 'minor', description: '',
    location: '', witnesses: '', immediateActionTaken: '',
  });

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const res = await api.get(`/safety?siteId=${siteId}${showClosed ? '' : '&status=open'}`);
      setIncidents(res.data);
    } catch (err) { console.error('Safety load failed:', err.response?.data?.error || err.message); }
  }, [siteId, showClosed]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.description) { alert('Description is required'); return; }
    try {
      await api.post('/safety', { siteId, ...form });
      setShowForm(false);
      setForm({ incidentType: 'near_miss', severity: 'minor', description: '', location: '', witnesses: '', immediateActionTaken: '' });
      load();
      alert('Incident reported');
    } catch (err) { alert(err.response?.data?.error || 'Failed to report incident'); }
  };

  const close = async (incident) => {
    const correctiveAction = prompt('Corrective action taken (required to close):');
    if (!correctiveAction) return;
    try {
      await api.post(`/safety/${incident.id}/close`, { correctiveAction });
      load();
    } catch (err) { alert(err.response?.data?.error || 'Failed to close incident'); }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <h3 style={styles.cardTitle}>Safety Incidents ({incidents.filter(i => i.status === 'open').length} open)</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ fontSize: 13, color: '#666' }}>
            <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> show closed
          </label>
          <button style={styles.btn} onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ Report Incident'}</button>
        </div>
      </div>

      {showForm && (
        <div style={styles.form}>
          <div style={styles.formRow}>
            <select style={styles.input} value={form.incidentType} onChange={set('incidentType')}>
              <option value="injury">Injury</option>
              <option value="near_miss">Near Miss</option>
              <option value="property_damage">Property Damage</option>
              <option value="environmental">Environmental</option>
              <option value="other">Other</option>
            </select>
            <select style={styles.input} value={form.severity} onChange={set('severity')}>
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="serious">Serious (pages managers)</option>
              <option value="critical">Critical (pages managers)</option>
            </select>
          </div>
          <textarea style={{ ...styles.input, width: '100%', minHeight: 70 }} placeholder="What happened? *"
            value={form.description} onChange={set('description')} />
          <div style={styles.formRow}>
            <input style={styles.input} placeholder="Location on site" value={form.location} onChange={set('location')} />
            <input style={styles.input} placeholder="Witnesses" value={form.witnesses} onChange={set('witnesses')} />
          </div>
          <input style={{ ...styles.input, width: '100%' }} placeholder="Immediate action taken"
            value={form.immediateActionTaken} onChange={set('immediateActionTaken')} />
          <button style={{ ...styles.btn, marginTop: 10 }} onClick={submit}>Submit Report</button>
        </div>
      )}

      {incidents.length === 0 && <div style={{ textAlign: 'center', padding: 32, color: '#aaa' }}>No incidents — stay safe 👷</div>}
      {incidents.map(i => (
        <div key={i.id} style={{ ...styles.row, borderLeftColor: SEVERITY_COLOR[i.severity] || '#888', opacity: i.status === 'closed' ? 0.6 : 1 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: '#333' }}>
              {TYPE_LABEL[i.incidentType] || i.incidentType} · <strong style={{ color: SEVERITY_COLOR[i.severity] }}>{i.severity.toUpperCase()}</strong>
              {i.status === 'closed' && ' · ✅ CLOSED'}
            </div>
            <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>{i.description}</div>
            {i.location && <div style={styles.dim}>📍 {i.location}</div>}
            <div style={styles.dim}>
              Reported by {i.reportedByName || 'unknown'} · {new Date(i.reportedAt).toLocaleString()}
            </div>
            {i.correctiveAction && <div style={{ ...styles.dim, color: '#2e7d32' }}>Corrective action: {i.correctiveAction}</div>}
            {(i.photoUrls || []).length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {i.photoUrls.map((u, idx) => (
                  <a key={idx} href={u} target="_blank" rel="noreferrer">
                    <img src={u} alt="incident" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6 }} />
                  </a>
                ))}
              </div>
            )}
          </div>
          {i.status === 'open' && <button style={styles.smallBtn} onClick={() => close(i)}>Close</button>}
        </div>
      ))}
    </div>
  );
}

const styles = {
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  cardTitle: { margin: 0, color: '#333', fontSize: 16 },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  smallBtn: { background: '#2e7d32', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' },
  row: { display: 'flex', alignItems: 'flex-start', gap: 12, borderLeft: '4px solid', borderRadius: 8, background: '#fafafa', padding: '10px 14px', marginBottom: 8 },
  dim: { color: '#999', fontSize: 11, marginTop: 3 },
  form: { background: '#f8f9ff', borderRadius: 10, padding: 14, marginBottom: 16 },
  formRow: { display: 'flex', gap: 10, marginBottom: 10 },
  input: { flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #c5cae9', fontSize: 13, marginBottom: 10 },
};
