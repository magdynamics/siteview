import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import AlertsView from '../supervisor/AlertsView';

// Executive dashboard: budget/schedule variance, CO exposure, risk (guideline §7)
export default function ExecutiveView() {
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/sites').then(r => { setSites(r.data); if (r.data[0]) setSiteId(r.data[0].id); }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const res = await api.get(`/dashboard/executive?siteId=${siteId}`);
      setData(res.data);
    } catch (err) { alert(err.response?.data?.error || 'Failed to load'); }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <div style={{ color: '#888', padding: 20 }}>Loading…</div>;
  const { site, budgetWeek, schedule, changeOrders, risk } = data;

  return (
    <div>
      <div style={styles.filterRow}>
        <select style={styles.select} value={siteId} onChange={e => setSiteId(e.target.value)}>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span style={styles.dim}>
          {site.currentPhase && `Phase: ${site.currentPhase} · `}
          {site.targetCompletionDate && `Target completion: ${site.targetCompletionDate} · `}
          {site.budgetTotal && `Project budget: $${site.budgetTotal.toLocaleString()}`}
        </span>
      </div>

      <div style={styles.statsRow}>
        <Card label="Week Budget Variance" color={budgetWeek.variance > 0 ? '#b71c1c' : '#2e7d32'}
          value={`${budgetWeek.variance > 0 ? '+' : ''}$${budgetWeek.variance.toLocaleString()}`}
          sub={`$${budgetWeek.actual.toLocaleString()} of $${budgetWeek.planned.toLocaleString()}`} />
        <Card label="Task Completion" color="#1a237e"
          value={`${schedule.complete}/${schedule.totalTasks}`}
          sub={`${schedule.overdue} overdue · ${schedule.blocked} blocked`} />
        <Card label="Rework Flagged" color={schedule.reworkFlagged ? '#b71c1c' : '#2e7d32'}
          value={schedule.reworkFlagged} sub="tasks hit by change orders" />
        <Card label="Approved CO Impact" color={changeOrders.approvedCostImpact ? '#e65100' : '#2e7d32'}
          value={`$${changeOrders.approvedCostImpact.toLocaleString()}`}
          sub={`+${changeOrders.approvedScheduleImpactDays} days · ${changeOrders.pending} pending`} />
        <Card label="Safety / Risk" color={(risk.criticalTickets || risk.equipmentDown) ? '#b71c1c' : '#2e7d32'}
          value={risk.criticalTickets + risk.equipmentDown}
          sub={`${risk.criticalTickets} critical tickets · ${risk.equipmentDown} machines down`} />
      </div>

      <AlertsView siteId={siteId} />
    </div>
  );
}

const Card = ({ label, value, sub, color }) => (
  <div style={{ flex: 1, minWidth: 170, background: '#fff', borderRadius: 12, padding: 16, borderTop: `4px solid ${color}`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', textAlign: 'center' }}>
    <div style={{ fontSize: 24, fontWeight: 'bold', color }}>{value}</div>
    <div style={{ fontSize: 12, color: '#555', marginTop: 4, fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{sub}</div>
  </div>
);

const styles = {
  filterRow: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, flexWrap: 'wrap' },
  select: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, background: '#fff' },
  statsRow: { display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
  dim: { color: '#888', fontSize: 12 },
};
