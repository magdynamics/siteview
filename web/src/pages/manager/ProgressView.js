import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Progress tracking — distinct from job costing: how much of the known
// scope (by task count and by estimated hours) is actually done, and how
// that's trended over a chosen date range.
export default function ProgressView() {
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [summary, setSummary] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    api.get('/sites').then(r => { setSites(r.data); if (r.data[0]) setSiteId(r.data[0].id); }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const [s, t] = await Promise.all([
        api.get(`/progress/summary?siteId=${siteId}`),
        api.get(`/progress/timeline?siteId=${siteId}&startDate=${startDate}&endDate=${endDate}`),
      ]);
      setSummary(s.data);
      setTimeline(t.data.series);
    } catch (err) { console.error('Progress load failed:', err.response?.data?.error || err.message); }
  }, [siteId, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={styles.filterRow}>
        <select style={styles.input} value={siteId} onChange={e => setSiteId(e.target.value)}>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" style={styles.input} value={startDate} onChange={e => setStartDate(e.target.value)} />
        <span style={{ color: '#888', fontSize: 13 }}>to</span>
        <input type="date" style={styles.input} value={endDate} onChange={e => setEndDate(e.target.value)} />
      </div>

      {summary && (
        <div style={styles.statsRow}>
          <StatCard label="Complete by Task Count" value={`${summary.percentByCount}%`} sub={`${summary.completedTasks} of ${summary.totalTasks} tasks`} color="#1a237e" />
          <StatCard label="Complete by Estimated Hours" value={`${summary.percentByHours}%`} sub={`${summary.completedEstimatedHours} of ${summary.totalEstimatedHours} hrs`} color="#2e7d32" />
          <StatCard label="Blocked" value={summary.byStatus.blocked} sub="tasks currently blocked" color={summary.byStatus.blocked ? '#b71c1c' : '#2e7d32'} />
          <StatCard label="In Progress" value={summary.byStatus.in_progress} sub="tasks active now" color="#e65100" />
        </div>
      )}

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Cumulative Completion Over Time</h3>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
              <Tooltip formatter={(v) => `${v}%`} />
              <Line type="monotone" dataKey="percentComplete" stroke="#1a237e" strokeWidth={2} dot={false} name="% Complete" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {timeline.length === 0 && <div style={styles.empty}>No timeline data for this range</div>}
      </div>

      {summary?.blockedTasks?.length > 0 && (
        <div style={{ ...styles.card, marginTop: 16 }}>
          <h3 style={styles.cardTitle}>Blocked Tasks</h3>
          {summary.blockedTasks.map(t => (
            <div key={t.id} style={{ padding: '8px 0', borderBottom: '1px solid #f9f9f9', fontSize: 13 }}>
              <strong>{t.title}</strong>
              {t.blockedReason && <div style={{ color: '#b71c1c', fontSize: 12 }}>🚧 {t.blockedReason}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const StatCard = ({ label, value, sub, color }) => (
  <div style={{ flex: 1, background: '#fff', borderRadius: 12, padding: 16, borderTop: `4px solid ${color}`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', textAlign: 'center' }}>
    <div style={{ fontSize: 28, fontWeight: 'bold', color }}>{value}</div>
    <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>{sub}</div>}
  </div>
);

const styles = {
  filterRow: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' },
  statsRow: { display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' },
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardTitle: { margin: '0 0 12px', color: '#333', fontSize: 16 },
  input: { padding: '8px 10px', borderRadius: 8, border: '1px solid #c5cae9', fontSize: 13 },
  empty: { textAlign: 'center', padding: 24, color: '#aaa', fontSize: 13 },
};
