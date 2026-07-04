import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const SEVERITY = {
  critical: { color: '#b71c1c', icon: '🔴' },
  warning: { color: '#e65100', icon: '🟡' },
  info: { color: '#1565c0', icon: '🔵' },
};

// Persisted alert queue with acknowledge flow (technical guideline §8)
export default function AlertsView({ siteId }) {
  const [alerts, setAlerts] = useState([]);
  const [showAcked, setShowAcked] = useState(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const res = await api.get(`/alerts?siteId=${siteId}${showAcked ? '' : '&acknowledged=false'}`);
      setAlerts(res.data);
    } catch (err) { alert(err.response?.data?.error || 'Failed to load alerts'); }
  }, [siteId, showAcked]);

  useEffect(() => { load(); }, [load]);

  const ack = async (a) => {
    try {
      await api.patch(`/alerts/${a.id}/acknowledge`);
      load();
    } catch (err) { alert(err.response?.data?.error || 'Failed'); }
  };

  const evaluate = async () => {
    try {
      const res = await api.post('/alerts/evaluate');
      alert(`${res.data.newAlerts} new alert(s) raised`);
      load();
    } catch (err) { alert(err.response?.data?.error || 'Only managers/admins can run evaluation'); }
  };

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <h3 style={styles.cardTitle}>Alerts ({alerts.filter(a => !a.acknowledged).length} open)</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ fontSize: 13, color: '#666' }}>
            <input type="checkbox" checked={showAcked} onChange={e => setShowAcked(e.target.checked)} /> show acknowledged
          </label>
          <button style={styles.btn} onClick={evaluate}>Run Evaluation Now</button>
        </div>
      </div>
      {alerts.length === 0 && <div style={{ textAlign: 'center', padding: 32, color: '#aaa' }}>No open alerts — all clear ✅</div>}
      {alerts.map(a => {
        const sv = SEVERITY[a.severity] || SEVERITY.info;
        return (
          <div key={a.id} style={{ ...styles.alertRow, borderLeftColor: sv.color, opacity: a.acknowledged ? 0.5 : 1 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: '#333' }}>{sv.icon} <strong>{a.alertType.replace(/_/g, ' ')}</strong> — {a.message}</div>
              <div style={styles.dim}>
                {new Date(a.createdAt).toLocaleString()}
                {a.acknowledged && ` · acknowledged ${new Date(a.acknowledgedAt).toLocaleString()}`}
              </div>
            </div>
            {!a.acknowledged && <button style={styles.smallBtn} onClick={() => ack(a)}>Acknowledge</button>}
          </div>
        );
      })}
    </div>
  );
}

const styles = {
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  cardTitle: { margin: 0, color: '#333', fontSize: 16 },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  smallBtn: { background: '#2e7d32', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' },
  alertRow: { display: 'flex', alignItems: 'center', gap: 12, borderLeft: '4px solid', borderRadius: 8, background: '#fafafa', padding: '10px 14px', marginBottom: 8 },
  dim: { color: '#999', fontSize: 11, marginTop: 3 },
};
