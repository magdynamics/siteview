import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const PRIORITY_COLOR = { low: '#2e7d32', medium: '#f57c00', high: '#e65100', critical: '#b71c1c' };
const STATUS_COLOR = { pending: '#888', approved: '#1565c0', in_progress: '#e65100', completed: '#2e7d32', rejected: '#b71c1c' };

export default function MaintenanceView({ siteId }) {
  const [activeTab, setActiveTab] = useState('tickets');
  const [tickets, setTickets] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [history, setHistory] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [showNewSchedule, setShowNewSchedule] = useState(false);
  const [equipment, setEquipment] = useState([]);

  useEffect(() => {
    if (siteId) {
      loadTickets();
      loadSchedules();
      loadHistory();
      loadEquipment();
    }
  }, [siteId]);

  const loadTickets = async () => {
    const res = await api.get(`/repair-tickets?siteId=${siteId}`);
    setTickets(res.data);
  };
  const loadSchedules = async () => {
    const res = await api.get(`/maintenance-schedule?siteId=${siteId}`);
    setSchedules(res.data);
  };
  const loadHistory = async () => {
    const res = await api.get(`/maintenance?siteId=${siteId}`);
    setHistory(res.data);
  };
  const loadEquipment = async () => {
    const res = await api.get(`/equipment?siteId=${siteId}`);
    setEquipment(res.data);
  };

  const approveTicket = async (id) => {
    const estimatedCost = prompt('Estimated cost ($):');
    const notes = prompt('Approval notes:') || '';

    // Optional technician assignment
    let assignedTo = null;
    try {
      const res = await api.get('/employees');
      const emps = res.data;
      if (emps.length) {
        const list = emps.map((e, i) => `${i + 1}. ${e.name}`).join('\n');
        const pick = prompt(`Assign to (optional — leave blank to skip):\n${list}\n\nEnter number:`);
        const chosen = emps[parseInt(pick, 10) - 1];
        if (chosen) assignedTo = chosen.name;
      }
    } catch {}

    try {
      await api.post(`/repair-tickets/${id}/approve`, { estimatedCost, notes, assignedTo });
      await loadTickets();
      alert(assignedTo ? `Ticket approved and assigned to ${assignedTo}` : 'Ticket approved');
    } catch (err) { alert(err.response?.data?.error || 'Approve failed'); }
  };

  const rejectTicket = async (id) => {
    const reason = prompt('Rejection reason:');
    if (!reason) return;
    await api.post(`/repair-tickets/${id}/reject`, { reason });
    await loadTickets();
  };

  const completeSchedule = async (id) => {
    const hours = prompt('Current machine hours (leave blank if N/A):');
    try {
      await api.post(`/maintenance-schedule/${id}/complete`, {
        completedDate: new Date().toISOString().split('T')[0],
        completedAtHours: hours || null,
      });
      await loadSchedules();
      alert('Maintenance marked as completed and rescheduled');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to complete schedule');
    }
  };

  const pendingTickets = tickets.filter(t => t.status === 'pending').length;
  const overdueSchedules = schedules.filter(s => s.isOverdue).length;
  const dueSoonSchedules = schedules.filter(s => !s.isOverdue && s.daysUntilDue <= 7 && s.daysUntilDue >= 0).length;

  return (
    <div>
      {/* Summary */}
      <div style={styles.statsRow}>
        <StatCard label="Pending Tickets" value={pendingTickets} color={pendingTickets > 0 ? '#b71c1c' : '#2e7d32'} />
        <StatCard label="Overdue Maintenance" value={overdueSchedules} color={overdueSchedules > 0 ? '#b71c1c' : '#2e7d32'} />
        <StatCard label="Due This Week" value={dueSoonSchedules} color={dueSoonSchedules > 0 ? '#e65100' : '#2e7d32'} />
        <StatCard label="Completed Records" value={history.filter(h => h.status === 'completed').length} color="#1a237e" />
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {['tickets', 'schedule', 'history'].map(tab => (
          <div key={tab} style={{ ...styles.tab, ...(activeTab === tab ? styles.tabActive : {}) }} onClick={() => setActiveTab(tab)}>
            {tab === 'tickets' ? `🔖 Repair Tickets (${tickets.length})` : tab === 'schedule' ? `📅 Schedule (${schedules.length})` : '📋 Maintenance History'}
          </div>
        ))}
      </div>

      {/* Repair Tickets */}
      {activeTab === 'tickets' && (
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h3 style={styles.cardTitle}>Repair Tickets</h3>
            <button style={styles.btn} onClick={() => setShowNewTicket(true)}>+ New Ticket</button>
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Equipment', 'Issue', 'Priority', 'Safe?', 'Reported By', 'Date', 'Status', 'Actions'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr key={t.id} style={styles.tr}>
                  <td style={styles.td}><strong>{t.equipmentName}</strong></td>
                  <td style={styles.td}>{t.issueType} — {t.description?.substring(0, 40)}...</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, background: PRIORITY_COLOR[t.priority] }}>{t.priority?.toUpperCase()}</span>
                  </td>
                  <td style={styles.td}>
                    {t.isSafeToOperate
                      ? <span style={{ color: '#2e7d32', fontWeight: 'bold' }}>✓ Yes</span>
                      : <span style={{ color: '#b71c1c', fontWeight: 'bold' }}>✗ NO</span>}
                  </td>
                  <td style={styles.td}>{t.reportedByName || t.reportedBy}</td>
                  <td style={styles.td}>{new Date(t.reportedAt).toLocaleDateString()}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, background: STATUS_COLOR[t.status] || '#888' }}>{t.status}</span>
                  </td>
                  <td style={styles.td}>
                    {t.status === 'pending' && (
                      <>
                        <button style={{ ...styles.smallBtn, background: '#2e7d32', marginRight: 6 }} onClick={() => approveTicket(t.id)}>Approve</button>
                        <button style={{ ...styles.smallBtn, background: '#b71c1c' }} onClick={() => rejectTicket(t.id)}>Reject</button>
                      </>
                    )}
                    {t.status === 'approved' && (
                      <button style={{ ...styles.smallBtn, background: '#1565c0' }} onClick={() => api.post(`/repair-tickets/${t.id}/start`).then(loadTickets)}>Start</button>
                    )}
                    {t.status === 'in_progress' && (
                      <button style={{ ...styles.smallBtn, background: '#2e7d32' }} onClick={() => {
                        const cost = prompt('Actual cost ($):');
                        api.post(`/repair-tickets/${t.id}/complete`, { actualCost: cost }).then(loadTickets);
                      }}>Complete</button>
                    )}
                  </td>
                </tr>
              ))}
              {tickets.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#aaa' }}>No repair tickets</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Maintenance Schedule */}
      {activeTab === 'schedule' && (
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h3 style={styles.cardTitle}>Maintenance Schedule</h3>
            <button style={styles.btn} onClick={() => setShowNewSchedule(true)}>+ Add Schedule</button>
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Equipment', 'Type', 'Interval', 'Next Due Date', 'Next Due Hours', 'Days Left', 'Status', 'Actions'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedules.map(s => (
                <tr key={s.id} style={{ ...styles.tr, background: s.isOverdue ? '#fff3e0' : 'transparent' }}>
                  <td style={styles.td}><strong>{s.equipmentName}</strong></td>
                  <td style={styles.td}>{s.maintenanceType?.replace('_', ' ')}</td>
                  <td style={styles.td}>
                    {s.intervalDays ? `Every ${s.intervalDays} days` : ''}
                    {s.intervalHours ? ` / Every ${s.intervalHours} hrs` : ''}
                  </td>
                  <td style={styles.td}>{s.nextDueDate || '-'}</td>
                  <td style={styles.td}>{s.nextDueHours ? `${s.nextDueHours} hrs` : '-'}</td>
                  <td style={styles.td}>
                    {s.daysUntilDue !== null ? (
                      <span style={{ color: s.isOverdue ? '#b71c1c' : s.daysUntilDue <= 7 ? '#e65100' : '#2e7d32', fontWeight: 'bold' }}>
                        {s.isOverdue ? `${Math.abs(s.daysUntilDue)} days OVERDUE` : `${s.daysUntilDue} days`}
                      </span>
                    ) : '-'}
                  </td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, background: s.status === 'active' ? '#2e7d32' : s.status === 'overdue' ? '#b71c1c' : '#888' }}>
                      {s.status}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {(s.status === 'active' || s.status === 'overdue') && (
                      <>
                        <button style={{ ...styles.smallBtn, background: '#2e7d32', marginRight: 6 }} onClick={() => completeSchedule(s.id)}>Done</button>
                        <button style={{ ...styles.smallBtn, background: '#888' }} onClick={() => api.post(`/maintenance-schedule/${s.id}/pause`).then(loadSchedules)}>Pause</button>
                      </>
                    )}
                    {s.status === 'paused' && (
                      <button style={{ ...styles.smallBtn, background: '#1565c0' }} onClick={() => api.post(`/maintenance-schedule/${s.id}/resume`).then(loadSchedules)}>Resume</button>
                    )}
                  </td>
                </tr>
              ))}
              {schedules.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#aaa' }}>No schedules set up</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Maintenance History */}
      {activeTab === 'history' && (
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Equipment', 'Type', 'Date', 'Performed By', 'Authorized By', 'Hours/Odometer', 'Parts Cost', 'Labor Cost', 'Total', 'Photos'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i} style={styles.tr}>
                  <td style={styles.td}><strong>{h.equipmentName}</strong></td>
                  <td style={styles.td}>{h.maintenanceType}</td>
                  <td style={styles.td}>{h.maintenanceDate}</td>
                  <td style={styles.td}>{h.performedBy}</td>
                  <td style={styles.td}>{h.authorizedBy}</td>
                  <td style={styles.td}>
                    {h.hoursAtService ? `${h.hoursAtService} hrs` : ''}
                    {h.odometerAtService ? ` / ${h.odometerAtService} mi` : ''}
                  </td>
                  <td style={styles.td}>{h.partsCost ? `$${h.partsCost}` : '-'}</td>
                  <td style={styles.td}>{h.laborCost ? `$${h.laborCost}` : '-'}</td>
                  <td style={styles.td}><strong style={{ color: '#2e7d32' }}>{h.totalCost ? `$${h.totalCost}` : '-'}</strong></td>
                  <td style={styles.td}>
                    {h.photos?.length > 0 && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        {h.photos.map(p => (
                          <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                            <img src={p.url} alt={p.photoType} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                          </a>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 32, color: '#aaa' }}>No maintenance history</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* New Schedule Modal */}
      {showNewSchedule && <NewScheduleModal equipment={equipment} onClose={() => setShowNewSchedule(false)} onSave={async (data) => { try { await api.post('/maintenance-schedule', { ...data, siteId }); setShowNewSchedule(false); loadSchedules(); } catch (err) { alert(err.response?.data?.error || 'Failed to create schedule'); } }} />}

      {/* New Ticket Modal */}
      {showNewTicket && <NewTicketModal equipment={equipment} onClose={() => setShowNewTicket(false)} onSave={async (data) => { try { await api.post('/repair-tickets', { ...data, siteId }); setShowNewTicket(false); loadTickets(); } catch (err) { alert(err.response?.data?.error || 'Failed to create ticket'); } }} />}
    </div>
  );
}

function NewScheduleModal({ equipment, onClose, onSave }) {
  const [form, setForm] = useState({
    equipmentId: '', equipmentName: '', maintenanceType: 'oil_change',
    customDescription: '', intervalDays: '', intervalHours: '',
    nextDueDate: '', nextDueHours: '', reminderDaysBefore: 3, isRecurring: true,
  });
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ margin: '0 0 16px', color: '#1a237e' }}>New Maintenance Schedule</h3>
        <select style={styles.input} value={form.equipmentId} onChange={e => { const eq = equipment.find(x => x.id === e.target.value); update('equipmentId', e.target.value); update('equipmentName', eq?.name || ''); }}>
          <option value="">Select Equipment</option>
          {equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.name} ({eq.typeName})</option>)}
        </select>
        <select style={styles.input} value={form.maintenanceType} onChange={e => update('maintenanceType', e.target.value)}>
          <option value="oil_change">Oil Change</option>
          <option value="filter">Filter Replacement</option>
          <option value="inspection">Safety Inspection</option>
          <option value="tires">Tire Service</option>
          <option value="hydraulic">Hydraulic Service</option>
          <option value="greasing">Greasing / Lubrication</option>
          <option value="custom">Custom</option>
        </select>
        {form.maintenanceType === 'custom' && <input style={styles.input} placeholder="Describe maintenance" value={form.customDescription} onChange={e => update('customDescription', e.target.value)} />}
        <div style={styles.row}>
          <input style={styles.input} type="number" placeholder="Every X days" value={form.intervalDays} onChange={e => update('intervalDays', e.target.value)} />
          <input style={styles.input} type="number" placeholder="Every X machine hours" value={form.intervalHours} onChange={e => update('intervalHours', e.target.value)} />
        </div>
        <div style={styles.row}>
          <div><label style={styles.label}>Next Due Date</label><input type="date" style={styles.input} value={form.nextDueDate} onChange={e => update('nextDueDate', e.target.value)} /></div>
          <div><label style={styles.label}>Next Due Hours</label><input type="number" style={styles.input} placeholder="Machine hours" value={form.nextDueHours} onChange={e => update('nextDueHours', e.target.value)} /></div>
        </div>
        <div style={styles.row}>
          <div><label style={styles.label}>Remind X days before</label><input type="number" style={styles.input} value={form.reminderDaysBefore} onChange={e => update('reminderDaysBefore', e.target.value)} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={form.isRecurring} onChange={e => update('isRecurring', e.target.checked)} />
            <label style={styles.label}>Auto-reschedule after completion</label>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.btn} onClick={() => onSave(form)}>Save Schedule</button>
        </div>
      </div>
    </div>
  );
}

function NewTicketModal({ equipment, onClose, onSave }) {
  const [form, setForm] = useState({
    equipmentId: '', equipmentName: '', priority: 'medium',
    issueType: 'mechanical', description: '', isSafeToOperate: true,
  });
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ margin: '0 0 16px', color: '#1a237e' }}>New Repair Ticket</h3>
        <select style={styles.input} value={form.equipmentId} onChange={e => { const eq = equipment.find(x => x.id === e.target.value); update('equipmentId', e.target.value); update('equipmentName', eq?.name || ''); }}>
          <option value="">Select Equipment</option>
          {equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.name} ({eq.typeName})</option>)}
        </select>
        <div style={styles.row}>
          <select style={styles.input} value={form.priority} onChange={e => update('priority', e.target.value)}>
            <option value="low">Low priority</option>
            <option value="medium">Medium priority</option>
            <option value="high">High priority</option>
            <option value="critical">CRITICAL</option>
          </select>
          <select style={styles.input} value={form.issueType} onChange={e => update('issueType', e.target.value)}>
            <option value="mechanical">Mechanical</option>
            <option value="electrical">Electrical</option>
            <option value="hydraulic">Hydraulic</option>
            <option value="body">Body / Structure</option>
            <option value="tires">Tires</option>
            <option value="other">Other</option>
          </select>
        </div>
        <textarea style={{ ...styles.input, minHeight: 80 }} placeholder="Describe the issue" value={form.description} onChange={e => update('description', e.target.value)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input type="checkbox" checked={form.isSafeToOperate} onChange={e => update('isSafeToOperate', e.target.checked)} />
          <label style={styles.label}>Safe to operate while awaiting repair</label>
        </div>
        {!form.isSafeToOperate && <div style={{ color: '#b71c1c', fontSize: 12, marginBottom: 12 }}>⚠️ Equipment will be flagged out of service immediately.</div>}
        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.btn} disabled={!form.equipmentId || !form.description} onClick={() => onSave(form)}>Create Ticket</button>
        </div>
      </div>
    </div>
  );
}

const StatCard = ({ label, value, color }) => (
  <div style={{ flex: 1, background: '#fff', borderRadius: 12, padding: 16, borderTop: `4px solid ${color}`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', textAlign: 'center' }}>
    <div style={{ fontSize: 28, fontWeight: 'bold', color }}>{value}</div>
    <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{label}</div>
  </div>
);

const styles = {
  statsRow: { display: 'flex', gap: 16, marginBottom: 24 },
  tabs: { display: 'flex', background: '#fff', borderRadius: '12px 12px 0 0', overflow: 'hidden', marginBottom: 1 },
  tab: { flex: 1, padding: '14px', textAlign: 'center', cursor: 'pointer', fontSize: 14, color: '#888', borderBottom: '3px solid transparent' },
  tabActive: { color: '#1a237e', fontWeight: 'bold', borderBottomColor: '#1a237e', background: '#f8f9ff' },
  card: { background: '#fff', borderRadius: '0 0 12px 12px', padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflowX: 'auto' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  cardTitle: { margin: 0, color: '#333', fontSize: 16 },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  cancelBtn: { background: '#f5f5f5', color: '#333', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 900 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '11px 12px', fontSize: 13, color: '#333' },
  badge: { color: '#fff', padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap' },
  smallBtn: { color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 16, padding: 28, width: 520, maxHeight: '90vh', overflow: 'auto' },
  input: { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' },
  row: { display: 'flex', gap: 12 },
  label: { display: 'block', fontSize: 12, color: '#888', marginBottom: 4 },
};
