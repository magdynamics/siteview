import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';

const METHOD_LABEL = { check: 'Check', ach: 'ACH', wire: 'Wire', cash: 'Cash', card: 'Card', other: 'Other' };

// Payment ledger: to whom, why, how much, method + reference, with proof scans.
export default function PaymentsView() {
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [payments, setPayments] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [subs, setSubs] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [unpaidInvoices, setUnpaidInvoices] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    payeeType: 'vendor', payeeId: '', payeeName: '',
    amount: '', method: 'check', reference: '', reason: '',
    relatedInvoiceId: '', paidDate: new Date().toISOString().split('T')[0],
  });
  const fileInputRef = useRef(null);
  const [proofTarget, setProofTarget] = useState(null);

  useEffect(() => {
    api.get('/sites').then(r => { setSites(r.data); if (r.data[0]) setSiteId(r.data[0].id); }).catch(() => {});
    api.get('/vendors').then(r => setVendors(r.data)).catch(() => {});
    api.get('/subcontractors').then(r => setSubs(r.data)).catch(() => {});
    api.get('/employees').then(r => setEmployees(r.data)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const [p, inv] = await Promise.all([
        api.get(`/payments?siteId=${siteId}`),
        api.get(`/subcontractors/invoices?siteId=${siteId}`),
      ]);
      setPayments(p.data);
      setUnpaidInvoices(inv.data.filter(i => ['pending', 'approved'].includes(i.status)));
    } catch (err) { console.error('Payments load failed:', err.response?.data?.error || err.message); }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const payeeOptions =
    form.payeeType === 'vendor' ? vendors :
    form.payeeType === 'subcontractor' ? subs :
    form.payeeType === 'employee' ? employees.map(e => ({ id: e.uid, name: e.name })) : [];

  const submit = async () => {
    if (!form.amount || !form.reason) { alert('Amount and reason are required'); return; }
    if (!form.payeeId && !form.payeeName) { alert('Choose a payee or type a name'); return; }
    try {
      await api.post('/payments', { ...form, siteId, relatedInvoiceId: form.relatedInvoiceId || undefined });
      setForm({ payeeType: 'vendor', payeeId: '', payeeName: '', amount: '', method: 'check', reference: '', reason: '', relatedInvoiceId: '', paidDate: new Date().toISOString().split('T')[0] });
      setShowForm(false);
      load();
      alert('Payment recorded — attach proof from the table');
    } catch (err) { alert(err.response?.data?.error || 'Failed to record payment'); }
  };

  const pickProof = (payment) => {
    setProofTarget(payment.id);
    fileInputRef.current?.click();
  };

  const uploadProof = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !proofTarget) return;
    try {
      const formData = new FormData();
      formData.append('proof', file);
      await api.post(`/payments/${proofTarget}/proof`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      load();
      alert('Proof attached');
    } catch (err) { alert(err.response?.data?.error || 'Upload failed'); }
    setProofTarget(null);
  };

  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

  return (
    <div>
      <input ref={fileInputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={uploadProof} />
      <div style={styles.filterRow}>
        <select style={styles.input} value={siteId} onChange={e => setSiteId(e.target.value)}>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button style={styles.btn} onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ Record Payment'}</button>
        <span style={{ fontSize: 13, color: '#888' }}>Total recorded: <strong style={{ color: '#2e7d32' }}>${totalPaid.toLocaleString()}</strong> ({payments.length} payments)</span>
      </div>

      {showForm && (
        <div style={styles.card}>
          <h3 style={{ ...styles.cardTitle, marginBottom: 12 }}>Record Payment</h3>
          <div style={styles.formRow}>
            <select style={styles.input} value={form.payeeType} onChange={e => setForm({ ...form, payeeType: e.target.value, payeeId: '', payeeName: '', relatedInvoiceId: '' })}>
              <option value="vendor">Vendor</option>
              <option value="subcontractor">Subcontractor</option>
              <option value="employee">Employee</option>
              <option value="other">Other</option>
            </select>
            {form.payeeType !== 'other' ? (
              <select style={styles.input} value={form.payeeId} onChange={e => setForm({ ...form, payeeId: e.target.value })}>
                <option value="">Select {form.payeeType} *</option>
                {payeeOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            ) : (
              <input style={styles.input} placeholder="Payee name *" value={form.payeeName} onChange={e => setForm({ ...form, payeeName: e.target.value })} />
            )}
            <input style={styles.input} type="number" placeholder="Amount $ *" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
            <input style={styles.input} type="date" value={form.paidDate} onChange={e => setForm({ ...form, paidDate: e.target.value })} />
          </div>
          <div style={styles.formRow}>
            <select style={styles.input} value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}>
              {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input style={styles.input} placeholder="Reference (check #, confirmation…)" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} />
            <input style={{ ...styles.input, flex: 2 }} placeholder="Reason — what is this payment for? *" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
          </div>
          {form.payeeType === 'subcontractor' && unpaidInvoices.filter(i => i.subcontractorId === form.payeeId).length > 0 && (
            <div style={styles.formRow}>
              <select style={{ ...styles.input, flex: 1 }} value={form.relatedInvoiceId} onChange={e => setForm({ ...form, relatedInvoiceId: e.target.value })}>
                <option value="">Link to unpaid invoice (marks it paid)…</option>
                {unpaidInvoices.filter(i => i.subcontractorId === form.payeeId).map(i => (
                  <option key={i.id} value={i.id}>{i.invoiceNumber || i.id.slice(0, 8)} — ${i.amount.toLocaleString()} ({i.status})</option>
                ))}
              </select>
            </div>
          )}
          <button style={styles.btn} onClick={submit}>Save Payment</button>
        </div>
      )}

      <div style={{ ...styles.card, marginTop: 16 }}>
        <h3 style={styles.cardTitle}>Payment Ledger — {sites.find(s => s.id === siteId)?.name || siteId}</h3>
        <table style={styles.table}>
          <thead><tr>{['Date', 'Paid To', 'Reason', 'Method', 'Reference', 'Amount', 'Proof'].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id} style={styles.tr}>
                <td style={styles.td}>{p.paidDate}</td>
                <td style={styles.td}><strong>{p.payeeName}</strong><div style={styles.dim}>{p.payeeType}</div></td>
                <td style={styles.td}>{p.reason}</td>
                <td style={styles.td}>{METHOD_LABEL[p.method] || p.method}</td>
                <td style={styles.td}>{p.reference || '-'}</td>
                <td style={styles.td}><strong style={{ color: '#2e7d32' }}>${p.amount.toLocaleString()}</strong></td>
                <td style={styles.td}>
                  {(p.proofUrls || []).map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" style={{ marginRight: 6, fontSize: 12, color: '#1a237e' }}>📎 {i + 1}</a>
                  ))}
                  <button style={styles.smallBtn} onClick={() => pickProof(p)}>+ Attach</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {payments.length === 0 && <div style={styles.empty}>No payments recorded for this site</div>}
      </div>
    </div>
  );
}

const styles = {
  filterRow: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' },
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardTitle: { margin: 0, color: '#333', fontSize: 16 },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  smallBtn: { background: '#455a64', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11 },
  input: { padding: '8px 10px', borderRadius: 8, border: '1px solid #c5cae9', fontSize: 13, flex: 1 },
  formRow: { display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 12 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '10px 12px', fontSize: 13, color: '#333' },
  dim: { color: '#999', fontSize: 11 },
  empty: { textAlign: 'center', padding: 24, color: '#aaa', fontSize: 13 },
};
