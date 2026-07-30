import React, { useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import BudgetView from './BudgetView';
import SubcontractorsView from './SubcontractorsView';
import PaymentsView from './PaymentsView';
import TMInvoicesView from './TMInvoicesView';

export default function AccountantDashboard() {
  const { profile, logout } = useAuth();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [siteId, setSiteId] = useState('');
  const [timesheets, setTimesheets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('timesheets');

  const loadTimesheets = async () => {
    if (!startDate || !endDate) { alert('Please select a date range'); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      if (siteId) params.append('siteId', siteId);
      const res = await api.get(`/timesheets/generate?${params}`);
      setTimesheets(res.data.filter(ts => ts.status === 'approved'));
    } catch {
      alert('Error loading timesheets');
    } finally {
      setLoading(false);
    }
  };

  const exportPDF = async (timesheetId) => {
    const res = await api.get(`/timesheets/${timesheetId}/export/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheet-${timesheetId}.pdf`;
    a.click();
  };

  const exportExcel = async (timesheetId) => {
    const res = await api.get(`/timesheets/${timesheetId}/export/excel`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheet-${timesheetId}.xlsx`;
    a.click();
  };

  const totalPay = timesheets.reduce((sum, ts) => sum + (ts.payAmount || 0), 0);
  const totalHours = timesheets.reduce((sum, ts) => sum + (ts.billableHours || 0), 0);

  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <div style={styles.logo}>
          <div style={styles.logoTitle}>BUILD CHAIN</div>
          <div style={styles.logoSub}>SITE VIEW</div>
        </div>
        <nav>
          {['budget', 'timesheets', 'tm-invoices', 'subcontractors', 'payments', 'documents', 'audit'].map(tab => (
            <div
              key={tab}
              style={{ ...styles.navItem, ...(activeTab === tab ? styles.navItemActive : {}) }}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'budget' ? '💰 Budget & Cash' : tab === 'timesheets' ? '📋 Timesheets' : tab === 'tm-invoices' ? '🧾 T&M Invoices' : tab === 'subcontractors' ? '🏗 Vendors & Subs' : tab === 'payments' ? '💸 Payments' : tab === 'documents' ? '📄 Documents' : '🔍 Audit Log'}
            </div>
          ))}
        </nav>
        <div style={styles.sidebarBottom}>
          {profile?.role === 'admin' && (
            <a href="/admin" style={{ display: 'block', color: '#aab2e8', fontSize: 13, textDecoration: 'none', marginBottom: 10 }}>⚙ Admin Panel</a>
          )}
          <div style={styles.userName}>{profile?.name}</div>
          <div style={styles.userRole}>{profile?.role === 'admin' ? 'Admin' : 'Accountant'}</div>
          <button style={styles.logoutBtn} onClick={logout}>Logout</button>
        </div>
      </div>

      <div style={styles.main}>
        <h2 style={styles.pageTitle}>
          {activeTab === 'budget' ? 'Budget & Cash Forecast' : activeTab === 'timesheets' ? 'Approved Timesheets & Invoices' : activeTab === 'tm-invoices' ? 'T&M Invoices' : activeTab === 'subcontractors' ? 'Vendors, Subcontractors & Invoices' : activeTab === 'payments' ? 'Payment Ledger' : activeTab === 'documents' ? 'Documents' : 'Audit Log'}
        </h2>

        {activeTab === 'budget' && <BudgetView />}
        {activeTab === 'tm-invoices' && <TMInvoicesView />}
        {activeTab === 'subcontractors' && <SubcontractorsView />}
        {activeTab === 'payments' && <PaymentsView />}

        {activeTab === 'timesheets' && (
          <>
            {/* Filters */}
            <div style={styles.filterCard}>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={styles.input} />
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={styles.input} />
              <input placeholder="Site ID (optional)" value={siteId} onChange={e => setSiteId(e.target.value)} style={styles.input} />
              <button style={styles.btn} onClick={loadTimesheets} disabled={loading}>
                {loading ? 'Loading...' : 'Generate Report'}
              </button>
            </div>

            {/* Summary */}
            {timesheets.length > 0 && (
              <>
                <div style={styles.statsRow}>
                  <StatCard label="Total Employees" value={timesheets.length} color="#1a237e" />
                  <StatCard label="Total Billable Hours" value={`${totalHours.toFixed(1)}h`} color="#2e7d32" />
                  <StatCard label="Total Payroll" value={`$${totalPay.toFixed(2)}`} color="#e65100" />
                </div>

                <div style={styles.card}>
                  <div style={styles.cardHeader}>
                    <h3 style={styles.cardTitle}>Approved Timesheets</h3>
                    <span style={{ fontSize: 13, color: '#888' }}>Only approved timesheets are shown</span>
                  </div>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        {['Employee', 'Site', 'Payment Type', 'Billable Hrs', 'Total Pay', 'Export PDF', 'Export Excel'].map(h => (
                          <th key={h} style={styles.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {timesheets.map((ts, i) => (
                        <tr key={i} style={styles.tr}>
                          <td style={styles.td}>{ts.employeeName}</td>
                          <td style={styles.td}>{ts.siteId}</td>
                          <td style={styles.td}>{ts.paymentType}</td>
                          <td style={styles.td}><strong>{ts.billableHours}h</strong></td>
                          <td style={styles.td}><strong style={{ color: '#2e7d32' }}>${ts.payAmount}</strong></td>
                          <td style={styles.td}>
                            <button style={{ ...styles.smallBtn, background: '#c62828' }} onClick={() => exportPDF(ts.id)}>
                              PDF
                            </button>
                          </td>
                          <td style={styles.td}>
                            <button style={{ ...styles.smallBtn, background: '#2e7d32' }} onClick={() => exportExcel(ts.id)}>
                              Excel
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {activeTab === 'documents' && <DocumentsView />}
        {activeTab === 'audit' && <AuditView />}
      </div>
    </div>
  );
}

function DocumentsView() {
  const [docs, setDocs] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const load = async () => {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    const res = await api.get(`/documents?${params}`);
    setDocs(res.data);
  };

  return (
    <div>
      <div style={styles.filterCard}>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={styles.input} />
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={styles.input} />
        <button style={styles.btn} onClick={load}>Load Documents</button>
      </div>
      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Date', 'Type', 'Vendor', 'Amount', 'Description', 'View'].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {docs.map((doc, i) => (
              <tr key={i} style={styles.tr}>
                <td style={styles.td}>{new Date(doc.timestamp).toLocaleDateString()}</td>
                <td style={styles.td}>{doc.documentType}</td>
                <td style={styles.td}>{doc.vendorName || '-'}</td>
                <td style={styles.td}>{doc.amount ? `$${doc.amount}` : '-'}</td>
                <td style={styles.td}>{doc.description || '-'}</td>
                <td style={styles.td}>
                  <a href={doc.url} target="_blank" rel="noreferrer" style={{ color: '#1a237e' }}>View</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditView() {
  const [logs, setLogs] = useState([]);

  const load = async () => {
    const res = await api.get('/reports/audit');
    setLogs(res.data);
  };

  return (
    <div>
      <div style={styles.filterCard}>
        <button style={styles.btn} onClick={load}>Load Audit Log</button>
      </div>
      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Timestamp', 'Action', 'Employee', 'Performed By', 'Manual', 'Note'].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => (
              <tr key={i} style={styles.tr}>
                <td style={styles.td}>{new Date(log.timestamp).toLocaleString()}</td>
                <td style={styles.td}><strong>{log.action}</strong></td>
                <td style={styles.td}>{log.employeeId}</td>
                <td style={styles.td}>{log.performedBy || '-'}</td>
                <td style={styles.td}>{log.isManual ? <span style={{ color: '#e65100', fontWeight: 'bold' }}>YES</span> : 'No'}</td>
                <td style={styles.td}>{log.note || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const StatCard = ({ label, value, color }) => (
  <div style={{ ...styles.statCard, borderTopColor: color }}>
    <div style={{ ...styles.statValue, color }}>{value}</div>
    <div style={styles.statLabel}>{label}</div>
  </div>
);

const styles = {
  container: { display: 'flex', minHeight: '100vh', background: '#f5f5f5', fontFamily: 'sans-serif' },
  sidebar: { width: 220, background: '#1a237e', color: '#fff', display: 'flex', flexDirection: 'column', padding: '24px 0' },
  logo: { padding: '0 20px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)' },
  logoTitle: { fontSize: 18, fontWeight: 'bold', letterSpacing: 2 },
  logoSub: { fontSize: 11, color: '#aab2e8', letterSpacing: 4, marginTop: 2 },
  navItem: { padding: '14px 20px', cursor: 'pointer', fontSize: 14, color: '#aab2e8' },
  navItemActive: { background: 'rgba(255,255,255,0.15)', color: '#fff', borderLeft: '3px solid #fff' },
  sidebarBottom: { marginTop: 'auto', padding: '0 20px' },
  userName: { fontSize: 14, fontWeight: 'bold', color: '#fff' },
  userRole: { fontSize: 12, color: '#aab2e8', marginBottom: 12 },
  logoutBtn: { background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', width: '100%' },
  main: { flex: 1, padding: 24 },
  pageTitle: { margin: '0 0 24px', color: '#1a237e', fontSize: 22 },
  filterCard: { display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  statsRow: { display: 'flex', gap: 16, marginBottom: 24 },
  statCard: { flex: 1, background: '#fff', borderRadius: 12, padding: 20, borderTop: '4px solid', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  statValue: { fontSize: 28, fontWeight: 'bold' },
  statLabel: { fontSize: 13, color: '#888', marginTop: 4 },
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  cardTitle: { margin: 0, color: '#333', fontSize: 16 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '12px', fontSize: 14, color: '#333' },
  smallBtn: { color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
};
