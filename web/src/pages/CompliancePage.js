import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

// Read-only compliance window for municipality / lender (viewer role)
export default function CompliancePage() {
  const { profile, logout } = useAuth();
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/sites').then(r => { setSites(r.data); if (r.data[0]) setSiteId(r.data[0].id); }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const res = await api.get(`/dashboard/compliance?siteId=${siteId}`);
      setData(res.data);
    } catch (err) { alert(err.response?.data?.error || 'Failed to load'); }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div>
          <div style={styles.logoTitle}>BUILD CHAIN — SITEVIEW</div>
          <div style={styles.logoSub}>Compliance View (read-only)</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <select style={styles.select} value={siteId} onChange={e => setSiteId(e.target.value)}>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span style={{ color: '#aab2e8', fontSize: 13 }}>{profile?.name}</span>
          <button style={styles.logoutBtn} onClick={logout}>Logout</button>
        </div>
      </div>

      {data && (
        <div style={styles.main}>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>🏗 {data.site.name}</h3>
            <div style={styles.dim}>{data.site.address} {data.site.currentPhase && `· phase: ${data.site.currentPhase}`}</div>
            <div style={{ marginTop: 10, fontSize: 13 }}>
              Inspections: <strong>{data.inspections.last30Days}</strong> in the last 30 days ({data.inspections.total} total)
              {data.equipmentOutOfService.length > 0 && (
                <div style={{ color: '#b71c1c', marginTop: 6 }}>Out of service: {data.equipmentOutOfService.join(', ')}</div>
              )}
            </div>
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>📦 Material Storage</h3>
            {data.materialStorage.length === 0 && <div style={styles.dim}>No located materials</div>}
            {data.materialStorage.map((m, i) => (
              <div key={i} style={styles.row}>
                <span>{m.description}</span>
                <span>{m.qtyOnHand} {m.unit} — 📍 {[m.location.area, m.location.aisle, m.location.row].filter(Boolean).join('/')}</span>
              </div>
            ))}
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>🗑 Disposal Log</h3>
            {data.disposalLog.length === 0 && <div style={styles.dim}>No disposal records</div>}
            {data.disposalLog.map((d, i) => (
              <div key={i} style={styles.row}>
                <span>{d.material} — {d.qty} {d.unit}</span>
                <span style={styles.dim}>{d.loggedAt?.split('T')[0]} · {d.loggedBy}</span>
              </div>
            ))}
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>📐 Current Plan Documents</h3>
            {data.planDocuments.length === 0 && <div style={styles.dim}>No plans on file</div>}
            {data.planDocuments.map((p, i) => (
              <div key={i} style={styles.row}>
                <span>{p.title} <span style={styles.dim}>({p.discipline})</span></span>
                <span style={styles.dim}>v{p.versionNumber} · {p.uploadedAt?.split('T')[0]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#f5f5f5', fontFamily: 'sans-serif' },
  topBar: { background: '#1a237e', color: '#fff', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  logoTitle: { fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  logoSub: { fontSize: 11, color: '#aab2e8' },
  select: { padding: '7px 12px', borderRadius: 8, border: 'none', fontSize: 13 },
  logoutBtn: { background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 6, cursor: 'pointer' },
  main: { maxWidth: 900, margin: '24px auto', padding: '0 16px' },
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 16 },
  cardTitle: { margin: '0 0 10px', color: '#1a237e', fontSize: 15 },
  row: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13, gap: 12, flexWrap: 'wrap' },
  dim: { color: '#999', fontSize: 12 },
};
