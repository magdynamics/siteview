import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

// Weekly budget vs. live actuals + cash forecast (technical guideline §4.7/§4.8)
export default function BudgetView() {
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [budget, setBudget] = useState(null);
  const [history, setHistory] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [showPlan, setShowPlan] = useState(false);

  useEffect(() => {
    api.get('/sites').then(r => { setSites(r.data); if (r.data[0]) setSiteId(r.data[0].id); }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const [b, h, f] = await Promise.all([
        api.get(`/budget/weekly?siteId=${siteId}`),
        api.get(`/budget/weekly/history?siteId=${siteId}&weeks=4`),
        api.get(`/accounting/cash-forecast?siteId=${siteId}`),
      ]);
      setBudget(b.data);
      setHistory(h.data);
      setForecast(f.data.snapshot);
    } catch (err) { alert(err.response?.data?.error || 'Failed to load budget'); }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const generateForecast = async () => {
    try {
      const res = await api.post('/accounting/cash-forecast/generate', { siteId });
      setForecast(res.data.snapshot);
    } catch (err) { alert(err.response?.data?.error || 'Failed to generate forecast'); }
  };

  const maxTotal = Math.max(...history.map(w => Math.max(w.actualTotal, w.plannedTotal)), 1);

  return (
    <div>
      <div style={styles.filterRow}>
        <select style={styles.select} value={siteId} onChange={e => setSiteId(e.target.value)}>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {budget && <span style={styles.dim}>Week {budget.weekStartDate} — {budget.weekEndDate}</span>}
        <button style={styles.btn} onClick={() => setShowPlan(true)}>Set Weekly Plan</button>
        <button style={{ ...styles.btn, background: '#2e7d32' }} onClick={generateForecast}>Generate Cash Forecast</button>
      </div>

      {budget && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          {/* This week by category */}
          <div style={{ ...styles.card, flex: 2, minWidth: 380 }}>
            <h3 style={styles.cardTitle}>This Week — Actual vs Planned</h3>
            {[
              ['Labor', budget.actualLaborCost, budget.plannedLaborCost],
              ['Equipment', budget.actualEquipmentCost, budget.plannedEquipmentCost],
              ['Materials', budget.actualMaterialCost, budget.plannedMaterialCost],
              ['TOTAL', budget.actualTotal, budget.plannedTotal],
            ].map(([label, actual, planned]) => {
              const over = planned > 0 && actual > planned;
              const pct = planned > 0 ? Math.min(100, (actual / planned) * 100) : (actual > 0 ? 100 : 0);
              return (
                <div key={label} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <strong>{label}</strong>
                    <span>
                      <span style={{ color: over ? '#b71c1c' : '#2e7d32', fontWeight: 'bold' }}>${(actual || 0).toLocaleString()}</span>
                      <span style={styles.dim}> / ${(planned || 0).toLocaleString()} planned</span>
                    </span>
                  </div>
                  <div style={styles.barWrap}>
                    <div style={{ ...styles.bar, width: `${pct}%`, background: over ? '#b71c1c' : '#1a237e' }} />
                  </div>
                </div>
              );
            })}
            {!budget.hasPlan && <div style={{ ...styles.dim, marginTop: 8 }}>No plan set for this week — actuals shown against zero.</div>}
            <div style={{ ...styles.dim, marginTop: 8 }}>Labor hours captured: {budget.actualLaborHours}</div>
          </div>

          {/* Cash forecast */}
          <div style={{ ...styles.card, flex: 1.4, minWidth: 320, borderTop: forecast?.flaggedShortfall ? '4px solid #b71c1c' : '4px solid #2e7d32' }}>
            <h3 style={styles.cardTitle}>💰 Cash Forecast {forecast?.flaggedShortfall && <span style={{ color: '#b71c1c' }}>— SHORTFALL</span>}</h3>
            {!forecast ? <div style={styles.dim}>No forecast yet — click "Generate Cash Forecast".</div> : (
              <>
                <div style={styles.kvRow}><span>Week actual to date</span><strong>${forecast.weekActualToDate?.toLocaleString()}</strong></div>
                <div style={styles.kvRow}><span>Payroll due (captured labor)</span><strong>${forecast.payrollDueAmount?.toLocaleString()}</strong></div>
                <div style={styles.kvRow}><span>PO obligations</span><strong>${forecast.obligationsTotal?.toLocaleString()}</strong></div>
                <div style={{ ...styles.kvRow, borderTop: '2px solid #f0f0f0', fontSize: 15 }}>
                  <span><strong>Projected spend</strong></span>
                  <strong style={{ color: forecast.flaggedShortfall ? '#b71c1c' : '#2e7d32' }}>${forecast.projectedSpendTotal?.toLocaleString()}</strong>
                </div>
                {forecast.obligationsDue?.map((o, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#555', marginTop: 6 }}>📄 {o.vendor} — {o.poReference}: ${o.amount.toLocaleString()}</div>
                ))}
                {forecast.notes && <div style={{ fontSize: 12, color: '#b71c1c', marginTop: 10 }}>{forecast.notes}</div>}
                <div style={{ ...styles.dim, marginTop: 10 }}>Generated {new Date(forecast.generatedAt).toLocaleString()} · auto-runs Thursdays</div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 4-week trend */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>4-Week Trend</h3>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', height: 140, padding: '0 8px' }}>
          {history.map(w => (
            <div key={w.weekStartDate} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', justifyContent: 'center', height: 100 }}>
                <div title={`Actual $${w.actualTotal}`} style={{ width: 26, borderRadius: 4, background: w.plannedTotal > 0 && w.actualTotal > w.plannedTotal ? '#b71c1c' : '#1a237e', height: `${(w.actualTotal / maxTotal) * 100}%`, minHeight: w.actualTotal > 0 ? 6 : 0 }} />
                <div title={`Planned $${w.plannedTotal}`} style={{ width: 26, borderRadius: 4, background: '#c5cae9', height: `${(w.plannedTotal / maxTotal) * 100}%`, minHeight: w.plannedTotal > 0 ? 6 : 0 }} />
              </div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>{w.weekStartDate.slice(5)}</div>
              <div style={{ fontSize: 11, fontWeight: 'bold' }}>${w.actualTotal.toLocaleString()}</div>
            </div>
          ))}
        </div>
        <div style={{ ...styles.dim, marginTop: 8 }}>■ dark = actual · ■ light = planned</div>
      </div>

      {showPlan && budget && <PlanModal budget={budget} onClose={() => setShowPlan(false)} onSave={async (form) => {
        try {
          await api.put('/budget/weekly/plan', { siteId, weekStartDate: budget.weekStartDate, ...form });
          setShowPlan(false);
          load();
        } catch (err) { alert(err.response?.data?.error || 'Failed to save plan'); }
      }} />}
    </div>
  );
}

function PlanModal({ budget, onClose, onSave }) {
  const [form, setForm] = useState({
    plannedLaborCost: budget.plannedLaborCost || '',
    plannedEquipmentCost: budget.plannedEquipmentCost || '',
    plannedMaterialCost: budget.plannedMaterialCost || '',
  });
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ margin: '0 0 4px', color: '#1a237e' }}>Weekly Plan</h3>
        <div style={{ ...styles.dim, marginBottom: 14 }}>Week of {budget.weekStartDate}</div>
        {[['plannedLaborCost', 'Labor budget ($)'], ['plannedEquipmentCost', 'Equipment budget ($)'], ['plannedMaterialCost', 'Materials budget ($)']].map(([k, label]) => (
          <div key={k}>
            <label style={styles.label}>{label}</label>
            <input style={styles.input} type="number" value={form[k]} onChange={e => update(k, e.target.value)} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.btn} onClick={() => onSave(form)}>Save Plan</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  filterRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
  select: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, background: '#fff' },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  cancelBtn: { background: '#f5f5f5', color: '#333', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer' },
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 16 },
  cardTitle: { margin: '0 0 14px', color: '#1a237e', fontSize: 15 },
  dim: { color: '#999', fontSize: 12 },
  barWrap: { background: '#f0f0f0', borderRadius: 4, height: 10 },
  bar: { height: 10, borderRadius: 4 },
  kvRow: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13 },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 16, padding: 28, width: 400 },
  input: { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' },
  label: { display: 'block', fontSize: 12, color: '#888', marginBottom: 4 },
};
