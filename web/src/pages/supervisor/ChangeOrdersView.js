import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const STATUS_COLOR = { pending: '#888', partially_approved: '#e65100', approved: '#2e7d32', rejected: '#b71c1c' };

// Change orders with threshold-gated dual approval (technical guideline §9)
export default function ChangeOrdersView({ siteId: siteIdProp }) {
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState(siteIdProp || '');
  const [cos, setCos] = useState([]);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (siteIdProp) { setSiteId(siteIdProp); return; }
    api.get('/sites').then(r => { setSites(r.data); if (r.data[0]) setSiteId(r.data[0].id); }).catch(() => {});
  }, [siteIdProp]);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const res = await api.get(`/change-orders?siteId=${siteId}`);
      setCos(res.data);
    } catch (err) { alert(err.response?.data?.error || 'Failed to load change orders'); }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const approve = async (co) => {
    try {
      const res = await api.post(`/change-orders/${co.id}/approve`);
      alert(res.data.message + (res.data.awaiting?.length ? `\nStill needs: ${res.data.awaiting.join(' + ')}` : ''));
      load();
    } catch (err) { alert(err.response?.data?.error || 'Approve failed'); }
  };

  const reject = async (co) => {
    const reason = prompt('Rejection reason:');
    if (!reason) return;
    try {
      await api.patch(`/change-orders/${co.id}/reject`, { reason });
      load();
    } catch (err) { alert(err.response?.data?.error || 'Reject failed'); }
  };

  return (
    <div>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>Change Orders ({cos.length})</h3>
          <div style={{ display: 'flex', gap: 10 }}>
            {!siteIdProp && (
              <select style={styles.select} value={siteId} onChange={e => setSiteId(e.target.value)}>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <button style={styles.btn} onClick={() => setShowNew(true)}>+ New Change Order</button>
          </div>
        </div>
        <table style={styles.table}>
          <thead><tr>{['CO #', 'Description', 'Zone', 'Cost Impact', 'Schedule', 'Status', 'Approvals', ''].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {cos.map(co => (
              <tr key={co.id} style={{ ...styles.tr, background: co.status === 'rejected' ? '#fafafa' : 'transparent' }}>
                <td style={styles.td}><strong>{co.coNumber}</strong><div style={styles.dim}>{co.issuedDate} · {co.issuedBy}</div></td>
                <td style={styles.td}>{co.description?.substring(0, 60)}{co.linkedTaskIds?.length > 0 && <div style={{ color: '#b71c1c', fontSize: 12 }}>⚠️ {co.linkedTaskIds.length} completed task(s) flagged for rework</div>}</td>
                <td style={styles.td}>{co.affectedZone || '-'}</td>
                <td style={{ ...styles.td, fontWeight: 'bold', color: co.requiresDualApproval ? '#e65100' : '#333' }}>
                  ${co.costImpact?.toLocaleString()}
                  {co.requiresDualApproval && <div style={{ fontSize: 11, fontWeight: 'normal' }}>dual approval (≥ ${co.approvalThresholdSnapshot?.toLocaleString()})</div>}
                </td>
                <td style={styles.td}>{co.scheduleImpactDays ? `+${co.scheduleImpactDays}d` : '-'}</td>
                <td style={styles.td}><span style={{ ...styles.badge, background: STATUS_COLOR[co.status] }}>{co.status.replace('_', ' ')}</span></td>
                <td style={styles.td}>
                  {co.approvals?.map((a, i) => <div key={i} style={{ fontSize: 12 }}>✓ {a.approvedByName} <span style={styles.dim}>({a.roleAtTime})</span></div>)}
                  {co.status === 'rejected' && <div style={{ fontSize: 12, color: '#b71c1c' }}>✗ {co.rejectedReason}</div>}
                </td>
                <td style={styles.td}>
                  {['pending', 'partially_approved'].includes(co.status) && (
                    <>
                      <button style={{ ...styles.smallBtn, background: '#2e7d32', marginRight: 6 }} onClick={() => approve(co)}>Approve</button>
                      <button style={{ ...styles.smallBtn, background: '#b71c1c' }} onClick={() => reject(co)}>Reject</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {cos.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#aaa' }}>No change orders</td></tr>}
          </tbody>
        </table>
      </div>

      {showNew && <NewCoModal onClose={() => setShowNew(false)} onSave={async (form) => {
        try {
          await api.post('/change-orders', { ...form, siteId });
          setShowNew(false);
          load();
        } catch (err) { alert(err.response?.data?.error || 'Failed to create change order'); }
      }} />}
    </div>
  );
}

function NewCoModal({ onClose, onSave }) {
  const [form, setForm] = useState({ coNumber: '', issuedBy: '', description: '', affectedZone: '', costImpact: '', scheduleImpactDays: '' });
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ margin: '0 0 16px', color: '#1a237e' }}>New Change Order</h3>
        <div style={styles.row}>
          <input style={styles.input} placeholder="CO number * (e.g. CO-014)" value={form.coNumber} onChange={e => update('coNumber', e.target.value)} />
          <input style={styles.input} placeholder="Issued by (engineer/architect)" value={form.issuedBy} onChange={e => update('issuedBy', e.target.value)} />
        </div>
        <textarea style={{ ...styles.input, minHeight: 70 }} placeholder="Description *" value={form.description} onChange={e => update('description', e.target.value)} />
        <input style={styles.input} placeholder="Affected zone (matches task plan references, e.g. Grid C/3)" value={form.affectedZone} onChange={e => update('affectedZone', e.target.value)} />
        <div style={styles.row}>
          <input style={styles.input} type="number" placeholder="Cost impact ($) *" value={form.costImpact} onChange={e => update('costImpact', e.target.value)} />
          <input style={styles.input} type="number" placeholder="Schedule impact (days)" value={form.scheduleImpactDays} onChange={e => update('scheduleImpactDays', e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.btn} disabled={!form.coNumber || !form.description || !form.costImpact} onClick={() => onSave(form)}>Create</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflowX: 'auto' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  cardTitle: { margin: 0, color: '#333', fontSize: 16 },
  select: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, background: '#fff' },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  cancelBtn: { background: '#f5f5f5', color: '#333', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer' },
  smallBtn: { color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 900 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '11px 12px', fontSize: 13, color: '#333' },
  dim: { color: '#aaa', fontSize: 12 },
  badge: { color: '#fff', padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 16, padding: 28, width: 520 },
  input: { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' },
  row: { display: 'flex', gap: 12 },
};
