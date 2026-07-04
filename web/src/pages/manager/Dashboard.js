import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import FleetReports from './FleetReports';
import ChangeOrdersView from '../supervisor/ChangeOrdersView';
import ExecutiveView from './ExecutiveView';

export default function ManagerDashboard() {
  const { profile, logout } = useAuth();
  const [report, setReport] = useState(null);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('overview');

  useEffect(() => {
    loadSites();
    loadWeeklyReport();
  }, []);

  const loadSites = async () => {
    const res = await api.get('/sites');
    setSites(res.data);
  };

  const loadWeeklyReport = async () => {
    setLoading(true);
    try {
      const res = await api.get('/reports/weekly');
      setReport(res.data);
    } catch {}
    finally { setLoading(false); }
  };

  const totalEmployees = report?.sites?.reduce((s, r) => s + r.totalEmployeesWorked, 0) || 0;
  const totalManual = report?.sites?.reduce((s, r) => s + r.manualEntries, 0) || 0;

  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <div style={styles.logo}>
          <div style={styles.logoTitle}>BUILD CHAIN</div>
          <div style={styles.logoSub}>SITE VIEW</div>
        </div>
        <nav>
          {[['overview', '📊 Overview'], ['executive', '🏛 Executive'], ['fleet', '🚜 Fleet Reports'], ['change-orders', '📝 Change Orders']].map(([key, label]) => (
            <div key={key}
              style={{ ...styles.navItem, ...(view === key ? styles.navItemActive : {}) }}
              onClick={() => setView(key)}>
              {label}
            </div>
          ))}
        </nav>
        <div style={styles.sidebarBottom}>
          <div style={styles.userName}>{profile?.name}</div>
          <div style={styles.userRole}>Project Manager</div>
          <button style={styles.logoutBtn} onClick={logout}>Logout</button>
        </div>
      </div>

      <div style={styles.main}>
        {view === 'fleet' && (
          <>
            <div style={styles.header}>
              <h2 style={styles.pageTitle}>Fleet Reports</h2>
            </div>
            <FleetReports />
          </>
        )}

        {view === 'executive' && (
          <>
            <div style={styles.header}>
              <h2 style={styles.pageTitle}>Executive Dashboard</h2>
            </div>
            <ExecutiveView />
          </>
        )}

        {view === 'change-orders' && (
          <>
            <div style={styles.header}>
              <h2 style={styles.pageTitle}>Change Orders</h2>
            </div>
            <ChangeOrdersView />
          </>
        )}

        {view === 'overview' && (
        <>
        <div style={styles.header}>
          <h2 style={styles.pageTitle}>Project Overview</h2>
          <button style={styles.btn} onClick={loadWeeklyReport}>Refresh</button>
        </div>

        {report && (
          <>
            <p style={styles.period}>
              Week: {report.period?.start} — {report.period?.end}
            </p>

            <div style={styles.statsRow}>
              <StatCard label="Active Sites" value={sites.length} color="#1a237e" />
              <StatCard label="Employees This Week" value={totalEmployees} color="#2e7d32" />
              <StatCard label="Manual Entries" value={totalManual} color={totalManual > 0 ? '#e65100' : '#2e7d32'} />
            </div>

            <div style={styles.grid}>
              {report.sites?.map((site, i) => (
                <div key={i} style={styles.siteCard}>
                  <div style={styles.siteHeader}>
                    <h3 style={styles.siteName}>{site.siteName}</h3>
                    <span style={styles.siteId}>{site.siteId}</span>
                  </div>
                  <div style={styles.siteStats}>
                    <div style={styles.siteStat}>
                      <div style={styles.siteStatValue}>{site.totalEmployeesWorked}</div>
                      <div style={styles.siteStatLabel}>Employees</div>
                    </div>
                    <div style={styles.siteStat}>
                      <div style={styles.siteStatValue}>{site.totalPunches}</div>
                      <div style={styles.siteStatLabel}>Punches</div>
                    </div>
                    <div style={styles.siteStat}>
                      <div style={{ ...styles.siteStatValue, color: site.manualEntries > 0 ? '#e65100' : '#2e7d32' }}>
                        {site.manualEntries}
                      </div>
                      <div style={styles.siteStatLabel}>Manual</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {loading && <p style={{ textAlign: 'center', color: '#888' }}>Loading report...</p>}
        </>
        )}
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
  navItem: { padding: '12px 20px', cursor: 'pointer', fontSize: 14, color: '#aab2e8' },
  navItemActive: { background: 'rgba(255,255,255,0.1)', color: '#fff', borderLeft: '3px solid #fff' },
  sidebarBottom: { marginTop: 'auto', padding: '0 20px' },
  userName: { fontSize: 14, fontWeight: 'bold', color: '#fff' },
  userRole: { fontSize: 12, color: '#aab2e8', marginBottom: 12 },
  logoutBtn: { background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', width: '100%' },
  main: { flex: 1, padding: 24 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  pageTitle: { margin: 0, color: '#1a237e', fontSize: 22 },
  period: { color: '#888', fontSize: 13, marginBottom: 24 },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer' },
  statsRow: { display: 'flex', gap: 16, marginBottom: 24 },
  statCard: { flex: 1, background: '#fff', borderRadius: 12, padding: 20, borderTop: '4px solid', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  statValue: { fontSize: 36, fontWeight: 'bold' },
  statLabel: { fontSize: 13, color: '#888', marginTop: 4 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 },
  siteCard: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  siteHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  siteName: { margin: 0, fontSize: 16, color: '#1a237e' },
  siteId: { fontSize: 11, color: '#aaa', background: '#f5f5f5', padding: '2px 8px', borderRadius: 10 },
  siteStats: { display: 'flex', gap: 16 },
  siteStat: { textAlign: 'center' },
  siteStatValue: { fontSize: 28, fontWeight: 'bold', color: '#333' },
  siteStatLabel: { fontSize: 12, color: '#888', marginTop: 2 },
};
