import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const STATUS_COLOR = { draft: '#888', sent: '#1565c0', paid: '#2e7d32' };

// T&M-to-invoice automation: rolls up actual labor (punches), equipment
// hours, and consumed materials for a period into one billable draft.
export default function TMInvoicesView() {
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [invoices, setInvoices] = useState([]);
  const [showGen, setShowGen] = useState(false);
  const [genForm, setGenForm] = useState({ title: '', periodStart: '', periodEnd: '', markupPercent: '' });
  const [busy, setBusy] = useState(false);
  const [openInvoice, setOpenInvoice] = useState(null);

  useEffect(() => {
    api.get('/sites').then(r => { setSites(r.data); if (r.data[0]) setSiteId(r.data[0].id); }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const res = await api.get(`/tm-invoices?siteId=${siteId}`);
      setInvoices(res.data);
    } catch (err) { console.error('T&M invoices load failed:', err.response?.data?.error || err.message); }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (!genForm.periodStart || !genForm.periodEnd) { alert('Period start and end are required'); return; }
    setBusy(true);
    try {
      const res = await api.post('/tm-invoices/generate', { ...genForm, siteId });
      setShowGen(false);
      setGenForm({ title: '', periodStart: '', periodEnd: '', markupPercent: '' });
      setOpenInvoice(res.data.invoice);
      load();
    } catch (err) { alert(err.response?.data?.error || 'Generation failed'); }
    finally { setBusy(false); }
  };

  const setStatus = async (inv, status) => {
    try {
      await api.patch(`/tm-invoices/${inv.id}/status`, { status });
      load();
      if (openInvoice?.id === inv.id) setOpenInvoice({ ...openInvoice, status });
    } catch (err) { alert(err.response?.data?.error || 'Failed'); }
  };

  const downloadPDF = async (inv) => {
    try {
      const res = await api.get(`/tm-invoices/${inv.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `tm-invoice-${inv.id}.pdf`;
      a.click();
    } catch (err) { alert('PDF download failed'); }
  };

  return (
    <div>
      <div style={styles.filterRow}>
        <select style={styles.input} value={siteId} onChange={e => setSiteId(e.target.value)}>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button style={styles.btn} onClick={() => setShowGen(!showGen)}>{showGen ? 'Cancel' : '+ Generate T&M Invoice'}</button>
      </div>

      {showGen && (
        <div style={{ ...styles.card, marginBottom: 16 }}>
          <div style={styles.formRow}>
            <input style={styles.input} placeholder="Invoice title (optional)" value={genForm.title} onChange={e => setGenForm({ ...genForm, title: e.target.value })} />
            <input style={styles.input} type="date" title="Period start" value={genForm.periodStart} onChange={e => setGenForm({ ...genForm, periodStart: e.target.value })} />
            <input style={styles.input} type="date" title="Period end" value={genForm.periodEnd} onChange={e => setGenForm({ ...genForm, periodEnd: e.target.value })} />
            <input style={styles.input} type="number" placeholder="Markup %" value={genForm.markupPercent} onChange={e => setGenForm({ ...genForm, markupPercent: e.target.value })} />
            <button style={styles.btn} disabled={busy} onClick={generate}>{busy ? 'Generating…' : 'Generate'}</button>
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>Pulls actual punches, equipment hours, and consumed materials for this site and period into one draft — nothing is billed until you mark it sent.</div>
        </div>
      )}

      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h3 style={styles.cardTitle}>T&M Invoices — {sites.find(s => s.id === siteId)?.name || siteId}</h3>
        </div>
        <table style={styles.table}>
          <thead><tr>{['Title', 'Period', 'Total', 'Status', 'Actions'].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {invoices.map(inv => (
              <tr key={inv.id} style={styles.tr}>
                <td style={styles.td}><a href="#invoice" onClick={e => { e.preventDefault(); setOpenInvoice(inv); }} style={{ color: '#1a237e', cursor: 'pointer' }}>{inv.title}</a></td>
                <td style={styles.td}>{inv.periodStart} → {inv.periodEnd}</td>
                <td style={styles.td}><strong>${inv.total.toLocaleString()}</strong></td>
                <td style={styles.td}><span style={{ color: STATUS_COLOR[inv.status], fontWeight: 'bold', fontSize: 12 }}>{inv.status.toUpperCase()}</span></td>
                <td style={styles.td}>
                  <button style={{ ...styles.smallBtn, background: '#455a64' }} onClick={() => downloadPDF(inv)}>PDF</button>
                  {inv.status === 'draft' && <button style={{ ...styles.smallBtn, background: '#1565c0', marginLeft: 6 }} onClick={() => setStatus(inv, 'sent')}>Mark Sent</button>}
                  {inv.status === 'sent' && <button style={{ ...styles.smallBtn, background: '#2e7d32', marginLeft: 6 }} onClick={() => setStatus(inv, 'paid')}>Mark Paid</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {invoices.length === 0 && <div style={styles.empty}>No T&M invoices for this site yet</div>}
      </div>

      {openInvoice && <InvoiceDetailModal invoice={openInvoice} onClose={() => setOpenInvoice(null)} onDownload={() => downloadPDF(openInvoice)} />}
    </div>
  );
}

function InvoiceDetailModal({ invoice, onClose, onDownload }) {
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', color: '#1a237e' }}>{invoice.title}</h3>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>{invoice.periodStart} → {invoice.periodEnd} · <span style={{ color: STATUS_COLOR[invoice.status], fontWeight: 'bold' }}>{invoice.status.toUpperCase()}</span></div>

        {invoice.lineItems.labor.length > 0 && (
          <LineSection title="Labor" rows={invoice.lineItems.labor.map(l => [l.employeeName, `${l.hours} hrs @ $${l.rate}/hr`, `$${l.cost}`])} />
        )}
        {invoice.lineItems.equipment.length > 0 && (
          <LineSection title="Equipment" rows={invoice.lineItems.equipment.map(l => [l.equipmentName, `${l.hours} hrs @ $${l.rate}/hr`, `$${l.cost}`])} />
        )}
        {invoice.lineItems.materials.length > 0 && (
          <LineSection title="Materials" rows={invoice.lineItems.materials.map(l => [l.description, `${l.qty} ${l.unit} @ $${l.unitCost}`, `$${l.cost}`])} />
        )}

        <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 8, paddingTop: 10, fontSize: 13 }}>
          <Row label="Labor Subtotal" value={`$${invoice.subtotals.labor}`} />
          <Row label="Equipment Subtotal" value={`$${invoice.subtotals.equipment}`} />
          <Row label="Materials Subtotal" value={`$${invoice.subtotals.materials}`} />
          {invoice.markupPercent > 0 && <Row label={`Markup (${invoice.markupPercent}%)`} value={`$${invoice.markupAmount}`} />}
          <Row label="Total Due" value={`$${invoice.total}`} bold />
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button style={styles.cancelBtn} onClick={onClose}>Close</button>
          <button style={styles.btn} onClick={onDownload}>Download PDF</button>
        </div>
      </div>
    </div>
  );
}

const LineSection = ({ title, rows }) => (
  <div style={{ marginBottom: 12 }}>
    <div style={{ fontSize: 12, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{title}</div>
    {rows.map((r, i) => (
      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', color: '#333' }}>
        <span>{r[0]}</span><span style={{ color: '#888' }}>{r[1]}</span><span>{r[2]}</span>
      </div>
    ))}
  </div>
);

const Row = ({ label, value, bold }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontWeight: bold ? 700 : 400, color: bold ? '#1a237e' : '#333', fontSize: bold ? 15 : 13 }}>
    <span>{label}</span><span>{value}</span>
  </div>
);

const styles = {
  filterRow: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' },
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 },
  cardTitle: { margin: 0, color: '#333', fontSize: 16 },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  cancelBtn: { background: '#f5f5f5', color: '#333', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer' },
  smallBtn: { color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  input: { padding: '8px 10px', borderRadius: 8, border: '1px solid #c5cae9', fontSize: 13 },
  formRow: { display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '10px 12px', fontSize: 13, color: '#333' },
  empty: { textAlign: 'center', padding: 24, color: '#aaa', fontSize: 13 },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 16, padding: 28, width: 520, maxHeight: '90vh', overflow: 'auto' },
};
