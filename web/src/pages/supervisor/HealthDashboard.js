import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const COLOR_MAP = {
  green:  { bg: '#e8f5e9', border: '#2e7d32', text: '#2e7d32', badge: '#2e7d32' },
  yellow: { bg: '#fffde7', border: '#f9a825', text: '#f57c00', badge: '#f9a825' },
  orange: { bg: '#fff3e0', border: '#e65100', text: '#e65100', badge: '#e65100' },
  red:    { bg: '#ffebee', border: '#b71c1c', text: '#b71c1c', badge: '#b71c1c' },
};

export default function HealthDashboard({ siteId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedEquip, setSelectedEquip] = useState(null);
  const [costData, setCostData] = useState(null);

  useEffect(() => {
    if (siteId) loadHealth();
  }, [siteId]);

  const loadHealth = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/health/${siteId}`);
      setData(res.data);
    } catch {}
    finally { setLoading(false); }
  };

  const loadCostDetails = async (equipmentId) => {
    const res = await api.get(`/health/costs/${equipmentId}`);
    setCostData(res.data);
  };

  const openDetails = (item) => {
    setSelectedEquip(item);
    loadCostDetails(item.equipment.id);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Loading health data...</div>;
  if (!data) return null;

  const { summary, equipment } = data;

  return (
    <div>
      {/* Fleet Summary */}
      <div style={styles.fleetSummary}>
        <h3 style={styles.fleetTitle}>Fleet Health Overview</h3>
        <div style={styles.fleetBars}>
          {[
            { label: 'Good', count: summary.green, color: '#2e7d32' },
            { label: 'Fair', count: summary.yellow, color: '#f9a825' },
            { label: 'Poor', count: summary.orange, color: '#e65100' },
            { label: 'Critical', count: summary.red, color: '#b71c1c' },
          ].map(b => (
            <div key={b.label} style={styles.fleetBar}>
              <div style={{ ...styles.fleetBarFill, background: b.color, height: `${(b.count / (summary.total || 1)) * 80}px`, minHeight: b.count > 0 ? 8 : 0 }} />
              <div style={{ ...styles.fleetBarCount, color: b.color }}>{b.count}</div>
              <div style={styles.fleetBarLabel}>{b.label}</div>
            </div>
          ))}
        </div>
        <div style={styles.totalCost}>
          Total Fleet Maintenance Cost: <strong style={{ color: '#e65100' }}>${summary.totalMaintenanceCost?.toLocaleString()}</strong>
        </div>
      </div>

      {/* Equipment Cards */}
      <div style={styles.equipGrid}>
        {equipment.map((item, i) => {
          const c = COLOR_MAP[item.health.color] || COLOR_MAP.green;
          return (
            <div key={i} style={{ ...styles.equipCard, borderLeftColor: c.border, borderLeftWidth: 5 }}
              onClick={() => openDetails(item)}>
              {/* Score Gauge */}
              <div style={styles.cardTop}>
                <div>
                  <div style={styles.equipName}>{item.equipment.name}</div>
                  <div style={styles.equipType}>{item.equipment.typeName}</div>
                </div>
                <div style={{ ...styles.scoreCircle, borderColor: c.border }}>
                  <div style={{ ...styles.scoreValue, color: c.text }}>{item.health.score}</div>
                  <div style={styles.scoreLabel}>/ 100</div>
                </div>
              </div>

              <div style={{ ...styles.healthBadge, background: c.badge }}>
                {item.health.label}
              </div>

              {/* Issues list */}
              {item.health.issues.length > 0 && (
                <div style={styles.issuesList}>
                  {item.health.issues.map((issue, j) => (
                    <div key={j} style={styles.issueItem}>• {issue}</div>
                  ))}
                </div>
              )}

              {/* Stats */}
              <div style={styles.cardStats}>
                <StatPill label="Hours" value={`${item.currentHours} hrs`} />
                <StatPill label="Open Tickets" value={item.openTickets} color={item.openTickets > 0 ? '#b71c1c' : '#888'} />
                <StatPill label="Maint. Cost" value={`$${item.totalMaintenanceCost}`} />
              </div>

              {item.lastInspection && (
                <div style={styles.lastInsp}>
                  Last inspection: {item.lastInspection.date} —
                  <span style={{ color: item.lastInspection.condition === 'good' ? '#2e7d32' : '#e65100', fontWeight: 'bold' }}>
                    {' '}{item.lastInspection.condition?.replace('_', ' ')}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Detail Modal */}
      {selectedEquip && (
        <div style={styles.modalOverlay} onClick={() => { setSelectedEquip(null); setCostData(null); }}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={{ margin: 0, color: '#1a237e' }}>{selectedEquip.equipment.name} — Cost Analysis</h3>
              <button onClick={() => { setSelectedEquip(null); setCostData(null); }} style={styles.closeBtn}>✕</button>
            </div>
            {costData ? (
              <div style={styles.modalBody}>
                <div style={styles.costSummaryRow}>
                  <CostBox label="Total Cost" value={`$${costData.totalCost}`} color="#e65100" />
                  <CostBox label="Total Hours" value={`${costData.currentHours} hrs`} color="#1a237e" />
                  <CostBox label="Cost / Hour" value={`$${costData.costPerHour}`} color="#2e7d32" />
                  <CostBox label="Maintenance Events" value={costData.maintenanceCount} color="#888" />
                </div>

                <h4 style={{ color: '#333', marginTop: 20 }}>Monthly Cost Breakdown</h4>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {['Month', 'Labor', 'Parts', 'Total', 'Events'].map(h => (
                        <th key={h} style={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(costData.monthlyCosts || {}).sort(([a], [b]) => b.localeCompare(a)).map(([month, costs]) => (
                      <tr key={month} style={styles.tr}>
                        <td style={styles.td}>{month}</td>
                        <td style={styles.td}>${costs.labor.toFixed(2)}</td>
                        <td style={styles.td}>${costs.parts.toFixed(2)}</td>
                        <td style={styles.td}><strong>${costs.total.toFixed(2)}</strong></td>
                        <td style={styles.td}>{costs.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>Loading...</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const StatPill = ({ label, value, color = '#555' }) => (
  <div style={{ textAlign: 'center' }}>
    <div style={{ fontSize: 15, fontWeight: 'bold', color }}>{value}</div>
    <div style={{ fontSize: 11, color: '#aaa' }}>{label}</div>
  </div>
);

const CostBox = ({ label, value, color }) => (
  <div style={{ textAlign: 'center', padding: '12px 16px', background: '#f9f9f9', borderRadius: 10, flex: 1, margin: '0 6px' }}>
    <div style={{ fontSize: 22, fontWeight: 'bold', color }}>{value}</div>
    <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{label}</div>
  </div>
);

const styles = {
  fleetSummary: { background: '#fff', borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  fleetTitle: { margin: '0 0 16px', color: '#1a237e' },
  fleetBars: { display: 'flex', gap: 24, alignItems: 'flex-end', height: 100, marginBottom: 12 },
  fleetBar: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1 },
  fleetBarFill: { width: '60%', borderRadius: 4, transition: 'height 0.3s' },
  fleetBarCount: { fontSize: 20, fontWeight: 'bold' },
  fleetBarLabel: { fontSize: 12, color: '#888' },
  totalCost: { fontSize: 14, color: '#555', marginTop: 8 },
  equipGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 },
  equipCard: {
    background: '#fff', borderRadius: 12, padding: 16,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)', cursor: 'pointer',
    transition: 'transform 0.1s', borderLeft: '5px solid #ddd',
  },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  equipName: { fontSize: 16, fontWeight: 'bold', color: '#1a237e' },
  equipType: { fontSize: 12, color: '#888', marginTop: 2 },
  scoreCircle: {
    width: 56, height: 56, borderRadius: '50%', borderWidth: 3, borderStyle: 'solid',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  },
  scoreValue: { fontSize: 18, fontWeight: 'bold', lineHeight: 1 },
  scoreLabel: { fontSize: 9, color: '#aaa' },
  healthBadge: { color: '#fff', borderRadius: 12, padding: '3px 10px', fontSize: 12, fontWeight: 'bold', display: 'inline-block', marginBottom: 8 },
  issuesList: { marginBottom: 10 },
  issueItem: { fontSize: 12, color: '#e65100', marginBottom: 2 },
  cardStats: { display: 'flex', justifyContent: 'space-around', padding: '10px 0', borderTop: '1px solid #f5f5f5', marginTop: 8 },
  lastInsp: { fontSize: 11, color: '#aaa', marginTop: 8 },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: '#fff', borderRadius: 16, width: 640, maxHeight: '90vh', overflow: 'auto' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #f0f0f0' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#888' },
  modalBody: { padding: 24 },
  costSummaryRow: { display: 'flex', gap: 0, marginBottom: 8 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '8px 12px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '10px 12px', fontSize: 13, color: '#333' },
};
