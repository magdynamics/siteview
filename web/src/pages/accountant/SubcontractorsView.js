import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const STATUS_COLOR = { pending: '#e65100', approved: '#1565c0', paid: '#2e7d32', rejected: '#b71c1c' };

// Subcontractor registry + invoices (technical guideline §10.6). Approved/paid
// invoices land in the weekly budget; unpaid ones in the cash forecast.
export default function SubcontractorsView() {
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [subs, setSubs] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [showSubForm, setShowSubForm] = useState(false);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [showInvForm, setShowInvForm] = useState(false);
  const [subForm, setSubForm] = useState({ name: '', trade: '', contactName: '', phone: '' });
  const [vendorForm, setVendorForm] = useState({ name: '', category: 'materials', contactName: '', phone: '', paymentTerms: '' });
  const [invForm, setInvForm] = useState({ subcontractorId: '', invoiceNumber: '', description: '', amount: '', periodStart: '', periodEnd: '' });

  useEffect(() => {
    api.get('/sites').then(r => { setSites(r.data); if (r.data[0]) setSiteId(r.data[0].id); }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, v, i] = await Promise.all([
        api.get('/subcontractors'),
        api.get('/vendors'),
        siteId ? api.get(`/subcontractors/invoices?siteId=${siteId}`) : Promise.resolve({ data: [] }),
      ]);
      setSubs(s.data);
      setVendors(v.data);
      setInvoices(i.data);
    } catch (err) { console.error('Subcontractors load failed:', err.response?.data?.error || err.message); }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const addVendor = async () => {
    if (!vendorForm.name) { alert('Name is required'); return; }
    try {
      await api.post('/vendors', vendorForm);
      setVendorForm({ name: '', category: 'materials', contactName: '', phone: '', paymentTerms: '' });
      setShowVendorForm(false);
      load();
    } catch (err) { alert(err.response?.data?.error || 'Failed'); }
  };

  const deactivateVendor = async (v) => {
    if (!window.confirm(`Deactivate vendor "${v.name}"?`)) return;
    try { await api.patch(`/vendors/${v.id}`, { isActive: false }); load(); }
    catch (err) { alert(err.response?.data?.error || 'Failed'); }
  };

  const addSub = async () => {
    if (!subForm.name) { alert('Name is required'); return; }
    try {
      await api.post('/subcontractors', subForm);
      setSubForm({ name: '', trade: '', contactName: '', phone: '' });
      setShowSubForm(false);
      load();
    } catch (err) { alert(err.response?.data?.error || 'Failed'); }
  };

  const addInvoice = async () => {
    if (!invForm.subcontractorId || !invForm.amount) { alert('Subcontractor and amount are required'); return; }
    try {
      await api.post('/subcontractors/invoices', { ...invForm, siteId });
      setInvForm({ subcontractorId: '', invoiceNumber: '', description: '', amount: '', periodStart: '', periodEnd: '' });
      setShowInvForm(false);
      load();
    } catch (err) { alert(err.response?.data?.error || 'Failed'); }
  };

  const setStatus = async (inv, status) => {
    try {
      await api.patch(`/subcontractors/invoices/${inv.id}/status`, { status });
      load();
    } catch (err) { alert(err.response?.data?.error || 'Failed'); }
  };

  const exportWeekly = async () => {
    try {
      const res = await api.get(`/accounting/export?siteId=${siteId}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `weekly-costs-${siteId}.xlsx`;
      a.click();
    } catch (err) { alert('Export failed'); }
  };

  const unpaidTotal = invoices.filter(i => ['pending', 'approved'].includes(i.status)).reduce((s, i) => s + i.amount, 0);

  return (
    <div>
      <div style={styles.filterRow}>
        <select style={styles.input} value={siteId} onChange={e => setSiteId(e.target.value)}>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button style={styles.btn} onClick={exportWeekly}>⬇ Export Weekly Costs (Excel)</button>
        <span style={{ fontSize: 13, color: '#888' }}>Unpaid invoices: <strong style={{ color: '#e65100' }}>${unpaidTotal.toLocaleString()}</strong></span>
      </div>

      {/* Vendor registry */}
      <div style={{ ...styles.card, marginBottom: 16 }}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>Vendors ({vendors.length})</h3>
          <button style={styles.btn} onClick={() => setShowVendorForm(!showVendorForm)}>{showVendorForm ? 'Cancel' : '+ Add Vendor'}</button>
        </div>
        {showVendorForm && (
          <div style={styles.formRow}>
            <input style={styles.input} placeholder="Vendor name *" value={vendorForm.name} onChange={e => setVendorForm({ ...vendorForm, name: e.target.value })} />
            <select style={styles.input} value={vendorForm.category} onChange={e => setVendorForm({ ...vendorForm, category: e.target.value })}>
              <option value="materials">Materials</option>
              <option value="equipment_rental">Equipment Rental</option>
              <option value="fuel">Fuel</option>
              <option value="services">Services</option>
              <option value="other">Other</option>
            </select>
            <input style={styles.input} placeholder="Contact person" value={vendorForm.contactName} onChange={e => setVendorForm({ ...vendorForm, contactName: e.target.value })} />
            <input style={styles.input} placeholder="Phone" value={vendorForm.phone} onChange={e => setVendorForm({ ...vendorForm, phone: e.target.value })} />
            <input style={styles.input} placeholder="Terms (e.g. Net 30)" value={vendorForm.paymentTerms} onChange={e => setVendorForm({ ...vendorForm, paymentTerms: e.target.value })} />
            <button style={styles.btn} onClick={addVendor}>Save</button>
          </div>
        )}
        <table style={styles.table}>
          <thead><tr>{['Name', 'Category', 'Contact', 'Phone', 'Terms', ''].map((h, i) => <th key={i} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {vendors.map(v => (
              <tr key={v.id} style={styles.tr}>
                <td style={styles.td}><strong>{v.name}</strong></td>
                <td style={styles.td}>{(v.category || '-').replace('_', ' ')}</td>
                <td style={styles.td}>{v.contactName || '-'}</td>
                <td style={styles.td}>{v.phone || '-'}</td>
                <td style={styles.td}>{v.paymentTerms || '-'}</td>
                <td style={styles.td}>
                  <button style={{ ...styles.smallBtn, background: '#9e9e9e' }} onClick={() => deactivateVendor(v)}>Deactivate</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {vendors.length === 0 && <div style={styles.empty}>No vendors yet</div>}
      </div>

      {/* Subcontractor registry */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>Subcontractors ({subs.length})</h3>
          <button style={styles.btn} onClick={() => setShowSubForm(!showSubForm)}>{showSubForm ? 'Cancel' : '+ Add Subcontractor'}</button>
        </div>
        {showSubForm && (
          <div style={styles.formRow}>
            <input style={styles.input} placeholder="Company name *" value={subForm.name} onChange={e => setSubForm({ ...subForm, name: e.target.value })} />
            <input style={styles.input} placeholder="Trade (electrical, plumbing…)" value={subForm.trade} onChange={e => setSubForm({ ...subForm, trade: e.target.value })} />
            <input style={styles.input} placeholder="Contact person" value={subForm.contactName} onChange={e => setSubForm({ ...subForm, contactName: e.target.value })} />
            <input style={styles.input} placeholder="Phone" value={subForm.phone} onChange={e => setSubForm({ ...subForm, phone: e.target.value })} />
            <button style={styles.btn} onClick={addSub}>Save</button>
          </div>
        )}
        <table style={styles.table}>
          <thead><tr>{['Name', 'Trade', 'Contact', 'Phone'].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {subs.map(s => (
              <tr key={s.id} style={styles.tr}>
                <td style={styles.td}><strong>{s.name}</strong></td>
                <td style={styles.td}>{s.trade || '-'}</td>
                <td style={styles.td}>{s.contactName || '-'}</td>
                <td style={styles.td}>{s.phone || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {subs.length === 0 && <div style={styles.empty}>No subcontractors yet</div>}
      </div>

      {/* Invoices */}
      <div style={{ ...styles.card, marginTop: 16 }}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>Invoices — {sites.find(s => s.id === siteId)?.name || siteId}</h3>
          <button style={styles.btn} onClick={() => setShowInvForm(!showInvForm)}>{showInvForm ? 'Cancel' : '+ Record Invoice'}</button>
        </div>
        {showInvForm && (
          <div style={styles.formRow}>
            <select style={styles.input} value={invForm.subcontractorId} onChange={e => setInvForm({ ...invForm, subcontractorId: e.target.value })}>
              <option value="">Subcontractor *</option>
              {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input style={styles.input} placeholder="Invoice #" value={invForm.invoiceNumber} onChange={e => setInvForm({ ...invForm, invoiceNumber: e.target.value })} />
            <input style={styles.input} type="number" placeholder="Amount $ *" value={invForm.amount} onChange={e => setInvForm({ ...invForm, amount: e.target.value })} />
            <input style={styles.input} type="date" title="Period start" value={invForm.periodStart} onChange={e => setInvForm({ ...invForm, periodStart: e.target.value })} />
            <input style={styles.input} type="date" title="Period end" value={invForm.periodEnd} onChange={e => setInvForm({ ...invForm, periodEnd: e.target.value })} />
            <input style={styles.input} placeholder="Description" value={invForm.description} onChange={e => setInvForm({ ...invForm, description: e.target.value })} />
            <button style={styles.btn} onClick={addInvoice}>Save</button>
          </div>
        )}
        <table style={styles.table}>
          <thead><tr>{['Subcontractor', 'Invoice #', 'Period', 'Amount', 'Status', 'Actions'].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {invoices.map(inv => (
              <tr key={inv.id} style={styles.tr}>
                <td style={styles.td}>{inv.subcontractorName}</td>
                <td style={styles.td}>{inv.invoiceNumber || '-'}</td>
                <td style={styles.td}>{inv.periodStart} → {inv.periodEnd}</td>
                <td style={styles.td}><strong>${inv.amount.toLocaleString()}</strong></td>
                <td style={styles.td}>
                  <span style={{ color: STATUS_COLOR[inv.status], fontWeight: 'bold', fontSize: 12 }}>{inv.status.toUpperCase()}</span>
                </td>
                <td style={styles.td}>
                  {inv.status === 'pending' && (
                    <>
                      <button style={{ ...styles.smallBtn, background: '#1565c0' }} onClick={() => setStatus(inv, 'approved')}>Approve</button>
                      <button style={{ ...styles.smallBtn, background: '#b71c1c', marginLeft: 6 }} onClick={() => setStatus(inv, 'rejected')}>Reject</button>
                    </>
                  )}
                  {inv.status === 'approved' && (
                    <button style={{ ...styles.smallBtn, background: '#2e7d32' }} onClick={() => setStatus(inv, 'paid')}>Mark Paid</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {invoices.length === 0 && <div style={styles.empty}>No invoices for this site</div>}
      </div>
    </div>
  );
}

const styles = {
  filterRow: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' },
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 },
  cardTitle: { margin: 0, color: '#333', fontSize: 16 },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  smallBtn: { color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  input: { padding: '8px 10px', borderRadius: 8, border: '1px solid #c5cae9', fontSize: 13 },
  formRow: { display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '10px 12px', fontSize: 13, color: '#333' },
  empty: { textAlign: 'center', padding: 24, color: '#aaa', fontSize: 13 },
};
