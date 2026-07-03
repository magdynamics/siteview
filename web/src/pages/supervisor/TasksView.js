import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const STATUS_COLOR = {
  assigned: '#888', acknowledged: '#1565c0', in_progress: '#e65100',
  blocked: '#b71c1c', complete: '#2e7d32',
};

// Daily task dispatch + live acknowledgment board (technical guideline §4.5/§6.2)
export default function TasksView({ siteId }) {
  const [tasks, setTasks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const [t, e] = await Promise.all([
        api.get(`/tasks?siteId=${siteId}${date ? `&date=${date}` : ''}`),
        api.get(`/employees?siteId=${siteId}`),
      ]);
      setTasks(t.data);
      setEmployees(e.data);
    } catch (err) { alert(err.response?.data?.error || 'Failed to load tasks'); }
  }, [siteId, date]);

  useEffect(() => { load(); }, [load]);

  const counts = {
    assigned: tasks.filter(t => t.status === 'assigned').length,
    blocked: tasks.filter(t => t.status === 'blocked').length,
    complete: tasks.filter(t => t.status === 'complete').length,
  };

  return (
    <div>
      <div style={styles.statsRow}>
        <StatCard label="Tasks Today" value={tasks.length} color="#1a237e" />
        <StatCard label="Awaiting Acknowledgment" value={counts.assigned} color={counts.assigned ? '#e65100' : '#2e7d32'} />
        <StatCard label="Blocked" value={counts.blocked} color={counts.blocked ? '#b71c1c' : '#2e7d32'} />
        <StatCard label="Complete" value={counts.complete} color="#2e7d32" />
      </div>

      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>Task Board</h3>
          <div style={{ display: 'flex', gap: 10 }}>
            <input type="date" style={styles.dateInput} value={date} onChange={e => setDate(e.target.value)} />
            <button style={styles.btn} onClick={() => setShowNew(true)}>+ Dispatch Task</button>
          </div>
        </div>
        <table style={styles.table}>
          <thead>
            <tr>{['Task', 'Assigned To', 'Plan Ref', 'Status', 'Acknowledged', 'Est. Cost', ''].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {tasks.map(t => (
              <tr key={t.id} style={{ ...styles.tr, background: t.status === 'blocked' ? '#ffebee' : 'transparent' }}>
                <td style={styles.td}>
                  <strong>{t.title}</strong>
                  {t.blockedReason && <div style={{ color: '#b71c1c', fontSize: 12 }}>🚧 {t.blockedReason}</div>}
                </td>
                <td style={styles.td}>{t.assignedToName}</td>
                <td style={styles.td}>{t.planReference || '-'}</td>
                <td style={styles.td}>
                  <span style={{ ...styles.badge, background: STATUS_COLOR[t.status] }}>{t.status.replace('_', ' ')}</span>
                </td>
                <td style={styles.td}>
                  {t.acknowledgedAt
                    ? `✓ ${new Date(t.acknowledgedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : <span style={{ color: '#e65100' }}>waiting…</span>}
                </td>
                <td style={styles.td}>{t.estimatedCost?.total ? `$${t.estimatedCost.total}` : '-'}</td>
                <td style={styles.td}>
                  {t.status === 'blocked' && (
                    <button style={{ ...styles.smallBtn, background: '#1565c0' }}
                      onClick={() => api.patch(`/tasks/${t.id}/status`, { status: 'in_progress' }).then(load).catch(e => alert(e.response?.data?.error || 'Failed'))}>
                      Unblock
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {tasks.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: '#aaa' }}>No tasks for this date — dispatch the day's work</td></tr>}
          </tbody>
        </table>
      </div>

      {showNew && <NewTaskModal employees={employees} defaultDate={date} onClose={() => setShowNew(false)} onSave={async (form) => {
        try {
          await api.post('/tasks', { ...form, siteId });
          setShowNew(false);
          load();
        } catch (err) { alert(err.response?.data?.error || 'Failed to create task'); }
      }} />}
    </div>
  );
}

function NewTaskModal({ employees, defaultDate, onClose, onSave }) {
  const [form, setForm] = useState({
    title: '', description: '', assignedTo: '', planReference: '',
    scheduledDate: defaultDate, estimatedHours: '',
  });
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ margin: '0 0 16px', color: '#1a237e' }}>Dispatch Task</h3>
        <input style={styles.input} placeholder="Task title * (e.g. Demolish 5th floor NW wall)" value={form.title} onChange={e => update('title', e.target.value)} />
        <textarea style={{ ...styles.input, minHeight: 60 }} placeholder="Details / instructions" value={form.description} onChange={e => update('description', e.target.value)} />
        <select style={styles.input} value={form.assignedTo} onChange={e => update('assignedTo', e.target.value)}>
          <option value="">Assign to *</option>
          {employees.map(e => <option key={e.uid} value={e.uid}>{e.name}</option>)}
        </select>
        <input style={styles.input} placeholder="Plan reference (e.g. Structural — 5th Floor NW)" value={form.planReference} onChange={e => update('planReference', e.target.value)} />
        <div style={styles.row}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>Scheduled date</label>
            <input type="date" style={styles.input} value={form.scheduledDate} onChange={e => update('scheduledDate', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>Estimated hours</label>
            <input type="number" style={styles.input} placeholder="e.g. 6" value={form.estimatedHours} onChange={e => update('estimatedHours', e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.btn} disabled={!form.title || !form.assignedTo} onClick={() => onSave(form)}>Dispatch</button>
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
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflowX: 'auto' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  cardTitle: { margin: 0, color: '#333', fontSize: 16 },
  dateInput: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13 },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  cancelBtn: { background: '#f5f5f5', color: '#333', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer' },
  smallBtn: { color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 800 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '11px 12px', fontSize: 13, color: '#333' },
  badge: { color: '#fff', padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 16, padding: 28, width: 500, maxHeight: '90vh', overflow: 'auto' },
  input: { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' },
  row: { display: 'flex', gap: 12 },
  label: { display: 'block', fontSize: 12, color: '#888', marginBottom: 4 },
};
