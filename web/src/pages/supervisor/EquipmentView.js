import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const STATUS_COLOR = {
  available: '#2e7d32',
  in_use: '#1565c0',
  maintenance: '#e65100',
  out_of_service: '#b71c1c',
};

export default function EquipmentView({ siteId }) {
  const [equipment, setEquipment] = useState([]);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('status');
  const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (siteId) {
      loadEquipment();
    }
  }, [siteId]);

  const loadEquipment = async () => {
    const res = await api.get(`/equipment?siteId=${siteId}`);
    setEquipment(res.data);
  };

  const loadLogs = async () => {
    const res = await api.get(`/equipment/logs?siteId=${siteId}&startDate=${logDate}&endDate=${logDate}`);
    setLogs(res.data);
  };

  const markMaintenance = async (id, status) => {
    await api.put(`/equipment/${id}`, { status });
    await loadEquipment();
  };

  const summary = {
    available: equipment.filter(e => e.status === 'available').length,
    in_use: equipment.filter(e => e.status === 'in_use').length,
    maintenance: equipment.filter(e => e.status === 'maintenance').length,
    out_of_service: equipment.filter(e => e.status === 'out_of_service').length,
  };

  return (
    <div>
      {/* Summary */}
      <div style={styles.statsRow}>
        {Object.entries(summary).map(([status, count]) => (
          <div key={status} style={{ ...styles.statCard, borderTopColor: STATUS_COLOR[status] }}>
            <div style={{ ...styles.statValue, color: STATUS_COLOR[status] }}>{count}</div>
            <div style={styles.statLabel}>{status.replace('_', ' ').toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {['status', 'logs'].map(tab => (
          <div
            key={tab}
            style={{ ...styles.tab, ...(activeTab === tab ? styles.tabActive : {}) }}
            onClick={() => { setActiveTab(tab); if (tab === 'logs') loadLogs(); }}
          >
            {tab === 'status' ? 'Equipment Status' : 'Usage Logs'}
          </div>
        ))}
      </div>

      {activeTab === 'status' && (
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Equipment', 'Type', 'Make/Model', 'Serial #', 'Status', 'Assigned To', 'Since', 'Actions'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {equipment.map(eq => (
                <tr key={eq.id} style={styles.tr}>
                  <td style={styles.td}><strong>{eq.name}</strong></td>
                  <td style={styles.td}>{eq.typeName}</td>
                  <td style={styles.td}>{eq.make} {eq.model}</td>
                  <td style={styles.td}>{eq.serialNumber || '-'}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, background: STATUS_COLOR[eq.status] }}>
                      {eq.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={styles.td}>{eq.assignedTo || '-'}</td>
                  <td style={styles.td}>
                    {eq.assignedAt ? new Date(eq.assignedAt).toLocaleTimeString() : '-'}
                  </td>
                  <td style={styles.td}>
                    <select
                      style={styles.actionSelect}
                      onChange={e => { if (e.target.value) markMaintenance(eq.id, e.target.value); }}
                      defaultValue=""
                    >
                      <option value="">Set status...</option>
                      <option value="available">Available</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="out_of_service">Out of Service</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'logs' && (
        <div style={styles.card}>
          <div style={styles.filterRow}>
            <input
              type="date"
              value={logDate}
              onChange={e => setLogDate(e.target.value)}
              style={styles.input}
            />
            <button style={styles.btn} onClick={loadLogs}>Load Logs</button>
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Equipment', 'Type', 'Employee', 'Checked Out', 'Returned', 'Duration', 'Condition', 'Notes'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => {
                const duration = log.checkedInAt
                  ? ((new Date(log.checkedInAt) - new Date(log.checkedOutAt)) / 3600000).toFixed(1) + 'h'
                  : 'Still out';
                return (
                  <tr key={i} style={styles.tr}>
                    <td style={styles.td}><strong>{log.equipmentName}</strong></td>
                    <td style={styles.td}>{log.typeName}</td>
                    <td style={styles.td}>{log.employeeId}</td>
                    <td style={styles.td}>{new Date(log.checkedOutAt).toLocaleTimeString()}</td>
                    <td style={styles.td}>{log.checkedInAt ? new Date(log.checkedInAt).toLocaleTimeString() : <span style={{ color: '#1565c0' }}>In use</span>}</td>
                    <td style={styles.td}>{duration}</td>
                    <td style={styles.td}>
                      {log.conditionIn && (
                        <span style={{
                          ...styles.badge,
                          background: log.conditionIn === 'good' ? '#2e7d32' : log.conditionIn === 'needs_maintenance' ? '#e65100' : '#b71c1c'
                        }}>
                          {log.conditionIn}
                        </span>
                      )}
                    </td>
                    <td style={styles.td}>{log.returnNotes || '-'}</td>
                  </tr>
                );
              })}
              {logs.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#aaa' }}>No logs for this date</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const styles = {
  statsRow: { display: 'flex', gap: 16, marginBottom: 24 },
  statCard: { flex: 1, background: '#fff', borderRadius: 12, padding: 16, borderTop: '4px solid', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', textAlign: 'center' },
  statValue: { fontSize: 28, fontWeight: 'bold' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 4, letterSpacing: 1 },
  tabs: { display: 'flex', background: '#fff', borderRadius: '12px 12px 0 0', overflow: 'hidden', marginBottom: 1 },
  tab: { flex: 1, padding: '14px', textAlign: 'center', cursor: 'pointer', fontSize: 14, color: '#888', borderBottom: '3px solid transparent' },
  tabActive: { color: '#1a237e', fontWeight: 'bold', borderBottomColor: '#1a237e', background: '#f8f9ff' },
  card: { background: '#fff', borderRadius: '0 0 12px 12px', padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflowX: 'auto' },
  filterRow: { display: 'flex', gap: 12, marginBottom: 16 },
  input: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 800 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '11px 12px', fontSize: 13, color: '#333' },
  badge: { color: '#fff', padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap' },
  actionSelect: { padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 12, cursor: 'pointer' },
};
