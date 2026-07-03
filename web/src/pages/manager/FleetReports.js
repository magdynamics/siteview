import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

// Fleet utilization / downtime / compliance dashboard (manager + admin)
export default function FleetReports() {
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [util, setUtil] = useState(null);
  const [down, setDown] = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [idle, setIdle] = useState(null);
  const [cost, setCost] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const q = siteId ? `?siteId=${siteId}` : '';
    try {
      const [u, d, c, i, ch] = await Promise.all([
        api.get(`/fleet-reports/utilization${q}`),
        api.get(`/fleet-reports/downtime${q}`),
        api.get(`/fleet-reports/maintenance-compliance${q}`),
        api.get(`/fleet-reports/idle-assets${q}`),
        api.get(`/fleet-reports/cost-per-hour${q}`),
      ]);
      setUtil(u.data); setDown(d.data); setCompliance(c.data); setIdle(i.data); setCost(ch.data);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to load fleet reports');
    } finally { setLoading(false); }
  }, [siteId]);

  useEffect(() => {
    api.get('/sites').then(r => setSites(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const siteName = (id) => sites.find(s => s.id === id)?.name || id || '-';

  const transferEquipment = async (item) => {
    const others = sites.filter(s => s.id !== item.siteId);
    if (!others.length) { alert('No other site to transfer to'); return; }
    const list = others.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    const pick = prompt(`Transfer "${item.equipmentName}" to which site?\n${list}\n\nEnter number:`);
    const target = others[parseInt(pick, 10) - 1];
    if (!target) return;
    const reason = prompt('Reason (optional):') || '';
    try {
      const res = await api.post(`/equipment/${item.equipmentId}/transfer`, { toSiteId: target.id, reason });
      alert(res.data.message);
      load();
    } catch (err) { alert(err.response?.data?.error || 'Transfer failed'); }
  };

  if (loading && !util) return <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Loading fleet reports...</div>;

  return (
    <div>
      {/* Site filter */}
      <div style={styles.filterRow}>
        <select style={styles.select} value={siteId} onChange={e => setSiteId(e.target.value)}>
          <option value="">All Sites</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {util && <span style={styles.periodNote}>Period: {util.period.start} — {util.period.end} ({util.hoursPerDay} hrs/day available)</span>}
      </div>

      {/* KPI row */}
      <div style={styles.statsRow}>
        <StatCard label="Avg Utilization" value={util ? `${util.averageUtilizationPct}%` : '-'}
          color={util?.averageUtilizationPct >= 50 ? '#2e7d32' : util?.averageUtilizationPct >= 25 ? '#e65100' : '#b71c1c'} />
        <StatCard label="MTTR (repair turnaround)" value={down?.mttrHours != null ? `${down.mttrHours} hrs` : 'n/a'} color="#1a237e" />
        <StatCard label="Maintenance Compliance" value={compliance ? `${compliance.compliancePct}%` : '-'}
          color={compliance?.compliancePct >= 90 ? '#2e7d32' : '#e65100'} />
        <StatCard label="Idle Assets (7d+)" value={idle?.count ?? '-'} color={idle?.count > 0 ? '#e65100' : '#2e7d32'} />
        <StatCard label="Open Downtime" value={down ? `${down.openDowntimeHours} hrs` : '-'} color={down?.openTickets > 0 ? '#b71c1c' : '#2e7d32'} />
      </div>

      {/* Utilization */}
      <Section title="🚜 Equipment Utilization">
        <table style={styles.table}>
          <thead><tr>{['Equipment', 'Site', 'Status', 'Hours Run', 'Utilization', 'Last Log'].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {util?.equipment.map(e => (
              <tr key={e.equipmentId} style={styles.tr}>
                <td style={styles.td}><strong>{e.equipmentName}</strong> <span style={styles.dim}>{e.typeName}</span></td>
                <td style={styles.td}>{siteName(e.siteId)}</td>
                <td style={styles.td}>{e.status}</td>
                <td style={styles.td}>{e.hoursRun} / {e.availableHours}</td>
                <td style={styles.td}>
                  <div style={styles.barWrap}>
                    <div style={{ ...styles.bar, width: `${e.utilizationPct}%`, background: e.utilizationPct >= 50 ? '#2e7d32' : e.utilizationPct >= 25 ? '#f9a825' : '#b71c1c' }} />
                  </div>
                  <span style={{ fontSize: 12 }}>{e.utilizationPct}%</span>
                </td>
                <td style={styles.td}>{e.lastHoursLogDate || <span style={{ color: '#b71c1c' }}>never</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Idle assets */}
      {idle?.count > 0 && (
        <Section title={`💤 Idle Assets — candidates to transfer (${idle.count})`}>
          <table style={styles.table}>
            <thead><tr>{['Equipment', 'Site', 'Days Idle', ''].map((h, i) => <th key={i} style={styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {idle.idle.map(e => (
                <tr key={e.equipmentId} style={styles.tr}>
                  <td style={styles.td}><strong>{e.equipmentName}</strong> <span style={styles.dim}>{e.typeName}</span></td>
                  <td style={styles.td}>{siteName(e.siteId)}</td>
                  <td style={styles.td}>{e.daysIdle != null ? `${e.daysIdle} days` : 'no hours ever logged'}</td>
                  <td style={styles.td}>
                    <button style={styles.smallBtn} onClick={() => transferEquipment(e)}>Transfer →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Downtime */}
      <Section title="🔻 Downtime & Repair Turnaround">
        <div style={styles.causeRow}>
          {down && Object.entries(down.byCause).map(([cause, v]) => (
            <div key={cause} style={styles.causePill}>
              <strong>{cause}</strong>: {v.count} ticket(s), {v.hours} hrs
            </div>
          ))}
          {down && !Object.keys(down.byCause).length && <span style={styles.dim}>No repair tickets in period</span>}
        </div>
        <table style={styles.table}>
          <thead><tr>{['Equipment', 'Issue', 'Priority', 'Status', 'Downtime'].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {down?.tickets.slice(0, 10).map(t => (
              <tr key={t.ticketId} style={styles.tr}>
                <td style={styles.td}><strong>{t.equipmentName}</strong></td>
                <td style={styles.td}>{t.issueType}</td>
                <td style={styles.td}>{t.priority}</td>
                <td style={styles.td}>{t.status}{t.isOpen ? ' (ongoing)' : ''}</td>
                <td style={{ ...styles.td, color: t.isOpen ? '#b71c1c' : '#333', fontWeight: t.isOpen ? 'bold' : 'normal' }}>{t.hours} hrs</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Compliance + cost per hour */}
      <div style={{ display: 'flex', gap: 16 }}>
        <Section title="📅 Maintenance Compliance" flex>
          {compliance && (
            <div>
              <div style={styles.kvRow}><span>Active schedules</span><strong>{compliance.active}</strong></div>
              <div style={styles.kvRow}><span>Overdue now</span><strong style={{ color: compliance.overdue ? '#b71c1c' : '#2e7d32' }}>{compliance.overdue}</strong></div>
              <div style={styles.kvRow}><span>Avg days overdue</span><strong>{compliance.avgDaysOverdue}</strong></div>
              <div style={styles.kvRow}><span>Completions logged</span><strong>{compliance.completionsLogged}</strong></div>
              {compliance.overdueList.map(o => (
                <div key={o.scheduleId} style={styles.overdueItem}>
                  ⚠️ {o.equipmentName} — {o.maintenanceType} (due {o.nextDueDate || `${o.nextDueHours} hrs`})
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section title="💰 Cost per Operating Hour" flex>
          <table style={styles.table}>
            <thead><tr>{['Equipment', 'Hours', 'Maint. Cost', '$/hr'].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {cost?.equipment.map(e => (
                <tr key={e.equipmentId} style={styles.tr}>
                  <td style={styles.td}>{e.equipmentName}</td>
                  <td style={styles.td}>{e.currentHours}</td>
                  <td style={styles.td}>${e.totalMaintenanceCost}</td>
                  <td style={styles.td}><strong>{e.costPerHour != null ? `$${e.costPerHour}` : '-'}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}

const StatCard = ({ label, value, color }) => (
  <div style={{ flex: 1, background: '#fff', borderRadius: 12, padding: 16, borderTop: `4px solid ${color}`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', textAlign: 'center' }}>
    <div style={{ fontSize: 24, fontWeight: 'bold', color }}>{value}</div>
    <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{label}</div>
  </div>
);

const Section = ({ title, children, flex }) => (
  <div style={{ background: '#fff', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflowX: 'auto', ...(flex ? { flex: 1 } : {}) }}>
    <h3 style={{ margin: '0 0 14px', color: '#1a237e', fontSize: 15 }}>{title}</h3>
    {children}
  </div>
);

const styles = {
  filterRow: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 },
  select: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, background: '#fff' },
  periodNote: { fontSize: 12, color: '#888' },
  statsRow: { display: 'flex', gap: 12, marginBottom: 16 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '9px 10px', fontSize: 13, color: '#333' },
  dim: { color: '#aaa', fontSize: 12 },
  barWrap: { background: '#f0f0f0', borderRadius: 4, height: 8, width: 120, display: 'inline-block', marginRight: 8, verticalAlign: 'middle' },
  bar: { height: 8, borderRadius: 4 },
  smallBtn: { background: '#1a237e', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  causeRow: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 },
  causePill: { background: '#f5f7ff', borderRadius: 16, padding: '5px 14px', fontSize: 12, color: '#333' },
  kvRow: { display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13 },
  overdueItem: { fontSize: 12, color: '#b71c1c', marginTop: 8 },
};
