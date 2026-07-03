import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

// Bill-of-materials with location tracking (technical guideline §4.4)
export default function MaterialsView({ siteId }) {
  const [materials, setMaterials] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [ticketFor, setTicketFor] = useState(null);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const [m, a] = await Promise.all([
        api.get(`/materials?siteId=${siteId}`),
        api.get(`/materials/alerts/open?siteId=${siteId}`),
      ]);
      setMaterials(m.data);
      setAlerts(a.data);
    } catch (err) { alert(err.response?.data?.error || 'Failed to load materials'); }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const filtered = search
    ? materials.filter(m => m.description.toLowerCase().includes(search.toLowerCase()) || (m.specReference || '').toLowerCase().includes(search.toLowerCase()))
    : materials;

  const zoneText = (loc) => loc
    ? [loc.zone.area, loc.zone.aisle && `Aisle ${loc.zone.aisle}`, loc.zone.row && `Row ${loc.zone.row}`].filter(Boolean).join(', ')
    : null;

  return (
    <div>
      {/* BOM alerts */}
      {alerts.map(a => (
        <div key={a.id} style={{ ...styles.alertBar, background: a.type === 'bom_overrun' ? '#ffebee' : '#fff8e1', borderLeftColor: a.type === 'bom_overrun' ? '#b71c1c' : '#f9a825' }}>
          {a.type === 'bom_overrun' ? '🔴' : '🟡'} {a.message}
        </div>
      ))}

      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>Bill of Materials ({materials.length})</h3>
          <div style={{ display: 'flex', gap: 10 }}>
            <input style={styles.search} placeholder="🔍 Find material (e.g. beam 5012)" value={search} onChange={e => setSearch(e.target.value)} />
            <button style={styles.btn} onClick={() => setShowAdd(true)}>+ Add Material</button>
          </div>
        </div>
        <table style={styles.table}>
          <thead>
            <tr>{['Material', 'Spec Ref', 'Planned', 'Received', 'Consumed', 'On Hand', 'Location', ''].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.map(m => {
              const consumedPct = m.qtyPlanned ? (m.qtyConsumed / m.qtyPlanned) * 100 : 0;
              return (
                <tr key={m.id} style={styles.tr}>
                  <td style={styles.td}><strong>{m.description}</strong> <span style={styles.dim}>{m.unitOfMeasure}</span></td>
                  <td style={styles.td}>{m.specReference || '-'}</td>
                  <td style={styles.td}>{m.qtyPlanned}</td>
                  <td style={styles.td}>{m.qtyReceived}</td>
                  <td style={{ ...styles.td, color: consumedPct > 100 ? '#b71c1c' : consumedPct >= 90 ? '#e65100' : '#333', fontWeight: consumedPct >= 90 ? 'bold' : 'normal' }}>
                    {m.qtyConsumed} ({consumedPct.toFixed(0)}%)
                  </td>
                  <td style={styles.td}><strong>{m.qtyOnHand}</strong></td>
                  <td style={styles.td}>
                    {m.currentLocation
                      ? <span title={`Logged by ${m.currentLocation.loggedByName || '-'}`}>📍 {zoneText(m.currentLocation)}</span>
                      : <span style={styles.dim}>not located</span>}
                  </td>
                  <td style={styles.td}>
                    <button style={styles.smallBtn} onClick={() => setTicketFor(m)}>Log</button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: '#aaa' }}>{search ? 'No materials match' : 'No materials yet — add the bill of materials'}</td></tr>}
          </tbody>
        </table>
      </div>

      {showAdd && <AddMaterialModal onClose={() => setShowAdd(false)} onSave={async (form) => {
        try {
          await api.post('/materials', { ...form, siteId });
          setShowAdd(false);
          load();
        } catch (err) { alert(err.response?.data?.error || 'Failed to add material'); }
      }} />}

      {ticketFor && <TicketModal material={ticketFor} onClose={() => setTicketFor(null)} onSave={async (form) => {
        try {
          const res = await api.post(`/materials/${ticketFor.id}/tickets`, form);
          setTicketFor(null);
          load();
          const q = res.data.quantities;
          alert(`Logged. On hand: ${q.qtyOnHand} ${ticketFor.unitOfMeasure}`);
        } catch (err) { alert(err.response?.data?.error || 'Failed to log ticket'); }
      }} />}
    </div>
  );
}

function AddMaterialModal({ onClose, onSave }) {
  const [form, setForm] = useState({ description: '', specReference: '', unitOfMeasure: 'each', qtyPlanned: '', unitCost: '' });
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ margin: '0 0 16px', color: '#1a237e' }}>Add Material (BOM line)</h3>
        <input style={styles.input} placeholder="Description (e.g. Steel beam 5012)" value={form.description} onChange={e => update('description', e.target.value)} />
        <div style={styles.row}>
          <input style={styles.input} placeholder="Spec / plan reference" value={form.specReference} onChange={e => update('specReference', e.target.value)} />
          <select style={styles.input} value={form.unitOfMeasure} onChange={e => update('unitOfMeasure', e.target.value)}>
            {['each', 'ft', 'm', 'sqft', 'cuyd', 'ton', 'kg', 'liter', 'gallon', 'box', 'pallet'].map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div style={styles.row}>
          <input style={styles.input} type="number" placeholder="Planned quantity *" value={form.qtyPlanned} onChange={e => update('qtyPlanned', e.target.value)} />
          <input style={styles.input} type="number" placeholder="Unit cost ($)" value={form.unitCost} onChange={e => update('unitCost', e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.btn} disabled={!form.description || !form.qtyPlanned} onClick={() => onSave(form)}>Add</button>
        </div>
      </div>
    </div>
  );
}

function TicketModal({ material, onClose, onSave }) {
  const [form, setForm] = useState({ ticketType: 'receive', qty: '', area: '', aisle: '', row: '', poReference: '', supplier: '', notes: '' });
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const needsZone = ['receive', 'relocate'].includes(form.ticketType);
  const needsQty = form.ticketType !== 'relocate';

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ margin: '0 0 4px', color: '#1a237e' }}>{material.description}</h3>
        <div style={{ ...styles.dim, marginBottom: 14 }}>On hand: {material.qtyOnHand} {material.unitOfMeasure}</div>
        <select style={styles.input} value={form.ticketType} onChange={e => update('ticketType', e.target.value)}>
          <option value="receive">📦 Receive shipment</option>
          <option value="consume">🔨 Consume / install</option>
          <option value="dispose">🗑 Dispose / waste</option>
          <option value="relocate">📍 Relocate</option>
        </select>
        {needsQty && <input style={styles.input} type="number" placeholder={`Quantity (${material.unitOfMeasure}) *`} value={form.qty} onChange={e => update('qty', e.target.value)} />}
        {needsZone && (
          <div style={styles.row}>
            <input style={styles.input} placeholder="Area * (e.g. A)" value={form.area} onChange={e => update('area', e.target.value)} />
            <input style={styles.input} placeholder="Aisle" value={form.aisle} onChange={e => update('aisle', e.target.value)} />
            <input style={styles.input} placeholder="Row" value={form.row} onChange={e => update('row', e.target.value)} />
          </div>
        )}
        {form.ticketType === 'receive' && (
          <div style={styles.row}>
            <input style={styles.input} placeholder="PO reference" value={form.poReference} onChange={e => update('poReference', e.target.value)} />
            <input style={styles.input} placeholder="Supplier" value={form.supplier} onChange={e => update('supplier', e.target.value)} />
          </div>
        )}
        <input style={styles.input} placeholder="Notes" value={form.notes} onChange={e => update('notes', e.target.value)} />
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.btn}
            disabled={(needsQty && !form.qty) || (needsZone && !form.area)}
            onClick={() => onSave({
              ticketType: form.ticketType,
              qty: form.qty || null,
              locationZone: needsZone ? { area: form.area, aisle: form.aisle, row: form.row } : undefined,
              poReference: form.poReference || undefined,
              supplier: form.supplier || undefined,
              notes: form.notes,
            })}>Log</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  alertBar: { borderLeft: '4px solid', borderRadius: 8, padding: '10px 14px', marginBottom: 10, fontSize: 13, color: '#333' },
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflowX: 'auto' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  cardTitle: { margin: 0, color: '#333', fontSize: 16 },
  search: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, width: 240 },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  cancelBtn: { background: '#f5f5f5', color: '#333', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer' },
  smallBtn: { background: '#1a237e', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 800 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '11px 12px', fontSize: 13, color: '#333' },
  dim: { color: '#aaa', fontSize: 12 },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 16, padding: 28, width: 480, maxHeight: '90vh', overflow: 'auto' },
  input: { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' },
  row: { display: 'flex', gap: 12 },
};
