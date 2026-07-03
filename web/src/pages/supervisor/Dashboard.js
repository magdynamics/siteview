import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import MaintenanceView from './MaintenanceView';
import HealthDashboard from './HealthDashboard';
import EquipmentView from './EquipmentView';
import InventoryView from './InventoryView';
import MaterialsView from './MaterialsView';
import TasksView from './TasksView';
import PlansView from './PlansView';
import ChangeOrdersView from './ChangeOrdersView';

const STATUS_COLOR = { on_site: '#2e7d32', left: '#b71c1c', on_break: '#e65100', absent: '#888' };
const STATUS_LABEL = { on_site: 'On Site', left: 'Left', on_break: 'On Break', absent: 'Absent' };

export default function SupervisorDashboard() {
  const { profile, logout } = useAuth();
  const [sites, setSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState(null);
  const [liveStatus, setLiveStatus] = useState({});
  const [employees, setEmployees] = useState([]);
  const [timesheets, setTimesheets] = useState([]);
  const [activeTab, setActiveTab] = useState('live');

  useEffect(() => {
    loadSites();
  }, []);

  useEffect(() => {
    if (selectedSite) {
      loadLiveStatus();
      loadEmployees();
      const interval = setInterval(loadLiveStatus, 30000); // refresh every 30s
      return () => clearInterval(interval);
    }
  }, [selectedSite]);

  const loadSites = async () => {
    const res = await api.get('/sites');
    setSites(res.data);
    if (res.data.length > 0) setSelectedSite(res.data[0].id);
  };

  const loadLiveStatus = async () => {
    if (!selectedSite) return;
    const res = await api.get(`/punches/site/${selectedSite}/live`);
    setLiveStatus(res.data);
  };

  const loadEmployees = async () => {
    const res = await api.get(`/employees?siteId=${selectedSite}`);
    setEmployees(res.data);
  };

  const generateTimesheets = async () => {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const res = await api.get(`/timesheets/generate?startDate=${weekAgo}&endDate=${today}&siteId=${selectedSite}`);
    setTimesheets(res.data);
    setActiveTab('timesheets');
  };

  const manualPunch = async (employeeId, type) => {
    const note = prompt(`Reason for manual ${type}:`);
    if (!note) return;
    try {
      if (type === 'in') {
        await api.post('/punches/in', { siteId: selectedSite, employeeId, isManual: true, note });
      } else {
        await api.post('/punches/out', { siteId: selectedSite, employeeId, isManual: true, note });
      }
      await loadLiveStatus();
      alert(`Manual ${type} recorded successfully`);
    } catch (err) {
      alert(err.response?.data?.error || 'Error recording punch');
    }
  };

  const approveTimesheet = async (timesheetId) => {
    const note = prompt('Approval note (optional):') || '';
    await api.post(`/timesheets/${timesheetId}/approve`, { note });
    alert('Timesheet approved!');
    await generateTimesheets();
  };

  const onSiteCount = Object.values(liveStatus).filter(s => s.status === 'on_site').length;
  const onBreakCount = Object.values(liveStatus).filter(s => s.status === 'on_break').length;

  return (
    <div style={styles.container}>
      {/* Sidebar */}
      <div style={styles.sidebar}>
        <div style={styles.logo}>
          <div style={styles.logoTitle}>BUILD CHAIN</div>
          <div style={styles.logoSub}>SITE VIEW</div>
        </div>
        <nav>
          {[
            ['live', '👥 Live Site'],
            ['tasks', '📌 Tasks'],
            ['timesheets', '📋 Timesheets'],
            ['equipment', '🔧 Equipment'],
            ['maintenance', '🔖 Maintenance'],
            ['health', '❤️ Fleet Health'],
            ['materials', '🧱 Materials'],
            ['inventory', '📦 Inventory'],
            ['plans', '📐 Plans'],
            ['change-orders', '📝 Change Orders'],
          ].map(([tab, label]) => (
            <div
              key={tab}
              style={{ ...styles.navItem, ...(activeTab === tab ? styles.navItemActive : {}) }}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </div>
          ))}
        </nav>
        <div style={styles.sidebarBottom}>
          <div style={styles.userName}>{profile?.name}</div>
          <div style={styles.userRole}>Supervisor</div>
          <button style={styles.logoutBtn} onClick={logout}>Logout</button>
        </div>
      </div>

      {/* Main */}
      <div style={styles.main}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h2 style={styles.pageTitle}>
              {{
                live: 'Live Site Status', tasks: 'Task Dispatch', timesheets: 'Timesheets', equipment: 'Equipment',
                maintenance: 'Maintenance', health: 'Fleet Health', materials: 'Materials', inventory: 'Inventory',
                plans: 'Plan Library', 'change-orders': 'Change Orders',
              }[activeTab]}
            </h2>
          </div>
          <select
            style={styles.siteSelect}
            value={selectedSite || ''}
            onChange={e => setSelectedSite(e.target.value)}
          >
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Stats */}
        {activeTab === 'live' && (
          <>
            <div style={styles.statsRow}>
              <StatCard label="On Site" value={onSiteCount} color="#2e7d32" />
              <StatCard label="On Break" value={onBreakCount} color="#e65100" />
              <StatCard label="Total Employees" value={employees.length} color="#1a237e" />
            </div>

            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <h3 style={styles.cardTitle}>Employee Status</h3>
                <button style={styles.btn} onClick={generateTimesheets}>Generate Timesheets</button>
              </div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['Name', 'Status', 'Last Action', 'Manual Punch'].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => {
                    const s = liveStatus[emp.uid] || { status: 'absent' };
                    return (
                      <tr key={emp.uid} style={styles.tr}>
                        <td style={styles.td}>{emp.name}</td>
                        <td style={styles.td}>
                          <span style={{ ...styles.badge, background: STATUS_COLOR[s.status] || '#888' }}>
                            {STATUS_LABEL[s.status] || 'Absent'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          {s.lastPunch ? new Date(s.lastPunch.timestamp).toLocaleTimeString() : '-'}
                          {s.lastPunch?.isManual && <span style={styles.manualTag}> MANUAL</span>}
                        </td>
                        <td style={styles.td}>
                          <button style={{ ...styles.smallBtn, background: '#2e7d32' }} onClick={() => manualPunch(emp.uid, 'in')}>In</button>
                          <button style={{ ...styles.smallBtn, background: '#b71c1c', marginLeft: 6 }} onClick={() => manualPunch(emp.uid, 'out')}>Out</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'timesheets' && (
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <h3 style={styles.cardTitle}>Pending Timesheets</h3>
              <button style={styles.btn} onClick={generateTimesheets}>Refresh</button>
            </div>
            {timesheets.length === 0 ? (
              <p style={{ color: '#888', textAlign: 'center', padding: 32 }}>
                Click "Generate Timesheets" to load weekly data
              </p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['Employee', 'Payment', 'Total Hrs', 'Break Hrs', 'Billable Hrs', 'Pay ($)', 'Status', 'Actions'].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {timesheets.map((ts, i) => (
                    <tr key={i} style={styles.tr}>
                      <td style={styles.td}>{ts.employeeName}</td>
                      <td style={styles.td}>{ts.paymentType}</td>
                      <td style={styles.td}>{ts.totalHours}h</td>
                      <td style={styles.td}>{ts.breakHours}h</td>
                      <td style={styles.td}><strong>{ts.billableHours}h</strong></td>
                      <td style={styles.td}>${ts.payAmount}</td>
                      <td style={styles.td}>
                        <span style={{ ...styles.badge, background: ts.status === 'approved' ? '#2e7d32' : '#e65100' }}>
                          {ts.status?.toUpperCase()}
                        </span>
                      </td>
                      <td style={styles.td}>
                        {ts.status !== 'approved' && (
                          <button style={{ ...styles.smallBtn, background: '#2e7d32' }} onClick={() => approveTimesheet(ts.id)}>
                            Approve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'tasks' && <TasksView siteId={selectedSite} />}
        {activeTab === 'equipment' && <EquipmentView siteId={selectedSite} />}
        {activeTab === 'maintenance' && <MaintenanceView siteId={selectedSite} />}
        {activeTab === 'health' && <HealthDashboard siteId={selectedSite} />}
        {activeTab === 'materials' && <MaterialsView siteId={selectedSite} />}
        {activeTab === 'inventory' && <InventoryView siteId={selectedSite} />}
        {activeTab === 'plans' && <PlansView siteId={selectedSite} />}
        {activeTab === 'change-orders' && <ChangeOrdersView siteId={selectedSite} />}
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
  sidebar: {
    width: 220, background: '#1a237e', color: '#fff', display: 'flex',
    flexDirection: 'column', padding: '24px 0',
  },
  logo: { padding: '0 20px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)' },
  logoTitle: { fontSize: 18, fontWeight: 'bold', letterSpacing: 2 },
  logoSub: { fontSize: 11, color: '#aab2e8', letterSpacing: 4, marginTop: 2 },
  navItem: {
    padding: '14px 20px', cursor: 'pointer', fontSize: 14,
    color: '#aab2e8', transition: 'all 0.2s',
  },
  navItemActive: { background: 'rgba(255,255,255,0.15)', color: '#fff', borderLeft: '3px solid #fff' },
  sidebarBottom: { marginTop: 'auto', padding: '0 20px' },
  userName: { fontSize: 14, fontWeight: 'bold', color: '#fff' },
  userRole: { fontSize: 12, color: '#aab2e8', marginBottom: 12 },
  logoutBtn: {
    background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none',
    padding: '8px 16px', borderRadius: 6, cursor: 'pointer', width: '100%',
  },
  main: { flex: 1, padding: 24 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  pageTitle: { margin: 0, color: '#1a237e', fontSize: 22 },
  siteSelect: { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14 },
  statsRow: { display: 'flex', gap: 16, marginBottom: 24 },
  statCard: {
    flex: 1, background: '#fff', borderRadius: 12, padding: 20,
    borderTop: '4px solid', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  statValue: { fontSize: 36, fontWeight: 'bold' },
  statLabel: { fontSize: 13, color: '#888', marginTop: 4 },
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  cardTitle: { margin: 0, color: '#333', fontSize: 16 },
  btn: {
    background: '#1a237e', color: '#fff', border: 'none',
    padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '12px', fontSize: 14, color: '#333' },
  badge: { color: '#fff', padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 'bold' },
  manualTag: { color: '#e65100', fontSize: 11, fontWeight: 'bold' },
  smallBtn: {
    color: '#fff', border: 'none', padding: '5px 10px',
    borderRadius: 6, cursor: 'pointer', fontSize: 12,
  },
};
