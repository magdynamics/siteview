import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

export default function AdminDashboard() {
  const { profile, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('employees');
  const [employees, setEmployees] = useState([]);
  const [sites, setSites] = useState([]);
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [showAddSite, setShowAddSite] = useState(false);
  const [showAddEquipType, setShowAddEquipType] = useState(false);
  const [showAddEquip, setShowAddEquip] = useState(false);
  const [newEmployee, setNewEmployee] = useState({
    name: '', email: '', phone: '', role: 'employee',
    assignedSiteId: '', paymentType: 'hourly',
    hourlyRate: '', dailyRate: '', contractAmount: '', language: 'en',
  });
  const [newSite, setNewSite] = useState({
    name: '', address: '', latitude: '', longitude: '',
    geofenceRadius: 200, supervisorId: '',
  });
  const [newEquipType, setNewEquipType] = useState({ name: '', icon: '🔧' });
  const [newEquip, setNewEquip] = useState({
    name: '', typeId: '', typeName: '', make: '', model: '',
    serialNumber: '', licensePlate: '', siteId: '', notes: '',
  });

  useEffect(() => {
    loadEmployees();
    loadSites();
    loadEquipmentTypes();
    loadEquipment();
  }, []);

  const loadEmployees = async () => {
    const res = await api.get('/employees');
    setEmployees(res.data);
  };

  const loadSites = async () => {
    const res = await api.get('/sites');
    setSites(res.data);
  };

  const loadEquipmentTypes = async () => {
    const res = await api.get('/equipment/types');
    setEquipmentTypes(res.data);
  };

  const loadEquipment = async () => {
    const res = await api.get('/equipment');
    setEquipment(res.data);
  };

  const addEquipmentType = async () => {
    try {
      await api.post('/equipment/types', newEquipType);
      alert('Equipment type added');
      setShowAddEquipType(false);
      setNewEquipType({ name: '', icon: '🔧' });
      loadEquipmentTypes();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const deleteEquipmentType = async (id) => {
    if (!window.confirm('Delete this equipment type?')) return;
    await api.delete(`/equipment/types/${id}`);
    loadEquipmentTypes();
  };

  const addEquipment = async () => {
    try {
      const type = equipmentTypes.find(t => t.id === newEquip.typeId);
      await api.post('/equipment', { ...newEquip, typeName: type?.name || newEquip.typeId });
      alert('Equipment added');
      setShowAddEquip(false);
      setNewEquip({ name: '', typeId: '', typeName: '', make: '', model: '', serialNumber: '', licensePlate: '', siteId: '', notes: '' });
      loadEquipment();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const deactivateEquipment = async (id) => {
    if (!window.confirm('Deactivate this equipment?')) return;
    await api.delete(`/equipment/${id}`);
    loadEquipment();
  };

  const addEmployee = async () => {
    try {
      const res = await api.post('/employees', newEmployee);
      const tempPw = res.data.temporaryPassword;
      alert(tempPw
        ? `Employee created.\n\nTemporary password: ${tempPw}\n\nShare it with the employee now — it won't be shown again.`
        : 'Employee created successfully');
      setShowAddEmployee(false);
      setNewEmployee({ name: '', email: '', phone: '', role: 'employee', assignedSiteId: '', paymentType: 'hourly', hourlyRate: '', dailyRate: '', contractAmount: '', language: 'en' });
      loadEmployees();
    } catch (err) {
      alert(err.response?.data?.error || 'Error creating employee');
    }
  };

  const addSite = async () => {
    try {
      await api.post('/sites', newSite);
      alert('Site created successfully');
      setShowAddSite(false);
      loadSites();
    } catch (err) {
      alert(err.response?.data?.error || 'Error creating site');
    }
  };

  const deactivateEmployee = async (id) => {
    if (!window.confirm('Deactivate this employee?')) return;
    await api.delete(`/employees/${id}`);
    loadEmployees();
  };

  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <div style={styles.logo}>
          <div style={styles.logoTitle}>BUILD CHAIN</div>
          <div style={styles.logoSub}>SITE VIEW</div>
        </div>
        <nav>
          {['employees', 'sites', 'equipment', 'equip-types'].map(tab => (
            <div
              key={tab}
              style={{ ...styles.navItem, ...(activeTab === tab ? styles.navItemActive : {}) }}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'employees' ? '👷 Employees' : tab === 'sites' ? '🏗 Sites' : tab === 'equipment' ? '🔧 Equipment' : '📋 Equip Types'}
            </div>
          ))}
        </nav>
        <div style={styles.sidebarBottom}>
          <div style={styles.userName}>{profile?.name}</div>
          <div style={styles.userRole}>Admin</div>
          <button style={styles.logoutBtn} onClick={logout}>Logout</button>
        </div>
      </div>

      <div style={styles.main}>
        {activeTab === 'employees' && (
          <>
            <div style={styles.header}>
              <h2 style={styles.pageTitle}>Employees ({employees.length})</h2>
              <button style={styles.btn} onClick={() => setShowAddEmployee(true)}>+ Add Employee</button>
            </div>

            <div style={styles.card}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['Name', 'Email', 'Role', 'Site', 'Payment', 'Language', 'Status', 'Actions'].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp.uid} style={styles.tr}>
                      <td style={styles.td}>{emp.name}</td>
                      <td style={styles.td}>{emp.email}</td>
                      <td style={styles.td}>{emp.role}</td>
                      <td style={styles.td}>{emp.assignedSiteId}</td>
                      <td style={styles.td}>{emp.paymentType}</td>
                      <td style={styles.td}>{emp.language === 'es' ? '🇪🇸 ES' : '🇺🇸 EN'}</td>
                      <td style={styles.td}>
                        <span style={{ ...styles.badge, background: emp.isActive ? '#2e7d32' : '#888' }}>
                          {emp.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <button style={{ ...styles.smallBtn, background: '#b71c1c' }} onClick={() => deactivateEmployee(emp.uid)}>
                          Deactivate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {showAddEmployee && (
              <Modal title="Add Employee" onClose={() => setShowAddEmployee(false)} onSubmit={addEmployee}>
                <FormField label="Full Name" value={newEmployee.name} onChange={v => setNewEmployee({ ...newEmployee, name: v })} />
                <FormField label="Email" value={newEmployee.email} onChange={v => setNewEmployee({ ...newEmployee, email: v })} type="email" />
                <FormField label="Phone" value={newEmployee.phone} onChange={v => setNewEmployee({ ...newEmployee, phone: v })} />
                <FormSelect label="Role" value={newEmployee.role} onChange={v => setNewEmployee({ ...newEmployee, role: v })}
                  options={[{ value: 'employee', label: 'Employee' }, { value: 'supervisor', label: 'Supervisor' }, { value: 'accountant', label: 'Accountant' }, { value: 'manager', label: 'Project Manager' }]} />
                <FormSelect label="Assigned Site" value={newEmployee.assignedSiteId} onChange={v => setNewEmployee({ ...newEmployee, assignedSiteId: v })}
                  options={sites.map(s => ({ value: s.id, label: s.name }))} />
                <FormSelect label="Payment Type" value={newEmployee.paymentType} onChange={v => setNewEmployee({ ...newEmployee, paymentType: v })}
                  options={[{ value: 'hourly', label: 'Hourly' }, { value: 'daily', label: 'Daily' }, { value: 'contract', label: 'Per Contract' }]} />
                {newEmployee.paymentType === 'hourly' && <FormField label="Hourly Rate ($)" value={newEmployee.hourlyRate} onChange={v => setNewEmployee({ ...newEmployee, hourlyRate: v })} type="number" />}
                {newEmployee.paymentType === 'daily' && <FormField label="Daily Rate ($)" value={newEmployee.dailyRate} onChange={v => setNewEmployee({ ...newEmployee, dailyRate: v })} type="number" />}
                {newEmployee.paymentType === 'contract' && <FormField label="Contract Amount ($)" value={newEmployee.contractAmount} onChange={v => setNewEmployee({ ...newEmployee, contractAmount: v })} type="number" />}
                <FormSelect label="Language" value={newEmployee.language} onChange={v => setNewEmployee({ ...newEmployee, language: v })}
                  options={[{ value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }]} />
              </Modal>
            )}
          </>
        )}

        {activeTab === 'equipment' && (
          <>
            <div style={styles.header}>
              <h2 style={styles.pageTitle}>Equipment ({equipment.length})</h2>
              <button style={styles.btn} onClick={() => setShowAddEquip(true)}>+ Add Equipment</button>
            </div>
            <div style={styles.card}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['Name', 'Type', 'Make/Model', 'Serial #', 'Plate', 'Site', 'Status', 'Actions'].map(h => (
                      <th key={h} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {equipment.map(eq => (
                    <tr key={eq.id} style={styles.tr}>
                      <td style={styles.td}><strong>{eq.name}</strong></td>
                      <td style={styles.td}>{eq.typeName}</td>
                      <td style={styles.td}>{eq.make} {eq.model}</td>
                      <td style={styles.td}>{eq.serialNumber || '-'}</td>
                      <td style={styles.td}>{eq.licensePlate || '-'}</td>
                      <td style={styles.td}>{eq.siteId || '-'}</td>
                      <td style={styles.td}>
                        <span style={{ ...styles.badge, background: { available: '#2e7d32', in_use: '#1565c0', maintenance: '#e65100', out_of_service: '#b71c1c' }[eq.status] || '#888' }}>
                          {eq.status?.replace('_', ' ')}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <button style={{ ...styles.smallBtn, background: '#b71c1c' }} onClick={() => deactivateEquipment(eq.id)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {showAddEquip && (
              <Modal title="Add Equipment" onClose={() => setShowAddEquip(false)} onSubmit={addEquipment}>
                <FormField label="Equipment Name (e.g. Bobcat #1)" value={newEquip.name} onChange={v => setNewEquip({ ...newEquip, name: v })} />
                <FormSelect label="Equipment Type" value={newEquip.typeId} onChange={v => setNewEquip({ ...newEquip, typeId: v })}
                  options={equipmentTypes.map(t => ({ value: t.id, label: `${t.icon} ${t.name}` }))} />
                <FormField label="Make (e.g. Caterpillar)" value={newEquip.make} onChange={v => setNewEquip({ ...newEquip, make: v })} />
                <FormField label="Model (e.g. S650)" value={newEquip.model} onChange={v => setNewEquip({ ...newEquip, model: v })} />
                <FormField label="Serial Number" value={newEquip.serialNumber} onChange={v => setNewEquip({ ...newEquip, serialNumber: v })} />
                <FormField label="License Plate (vehicles)" value={newEquip.licensePlate} onChange={v => setNewEquip({ ...newEquip, licensePlate: v })} />
                <FormSelect label="Assigned Site" value={newEquip.siteId} onChange={v => setNewEquip({ ...newEquip, siteId: v })}
                  options={sites.map(s => ({ value: s.id, label: s.name }))} />
                <FormField label="Notes" value={newEquip.notes} onChange={v => setNewEquip({ ...newEquip, notes: v })} />
              </Modal>
            )}
          </>
        )}

        {activeTab === 'equip-types' && (
          <>
            <div style={styles.header}>
              <h2 style={styles.pageTitle}>Equipment Types</h2>
              <button style={styles.btn} onClick={() => setShowAddEquipType(true)}>+ Add Type</button>
            </div>
            <div style={styles.grid}>
              {equipmentTypes.map(t => (
                <div key={t.id} style={styles.siteCard}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>{t.icon}</div>
                  <h3 style={styles.siteName}>{t.name}</h3>
                  <p style={styles.siteDetail}>Used by {equipment.filter(e => e.typeId === t.id).length} units</p>
                  <button style={{ ...styles.smallBtn, background: '#b71c1c', marginTop: 8 }} onClick={() => deleteEquipmentType(t.id)}>Delete</button>
                </div>
              ))}
            </div>
            {showAddEquipType && (
              <Modal title="Add Equipment Type" onClose={() => setShowAddEquipType(false)} onSubmit={addEquipmentType}>
                <FormField label="Type Name (e.g. Bobcat, Crane, Lift, Vehicle)" value={newEquipType.name} onChange={v => setNewEquipType({ ...newEquipType, name: v })} />
                <FormField label="Icon (emoji)" value={newEquipType.icon} onChange={v => setNewEquipType({ ...newEquipType, icon: v })} />
                <p style={{ fontSize: 12, color: '#888' }}>Common icons: 🚛 🏗 🔧 🚜 🚧 🪜 🔩 ⚙️</p>
              </Modal>
            )}
          </>
        )}

        {activeTab === 'sites' && (
          <>
            <div style={styles.header}>
              <h2 style={styles.pageTitle}>Sites ({sites.length})</h2>
              <button style={styles.btn} onClick={() => setShowAddSite(true)}>+ Add Site</button>
            </div>

            <div style={styles.grid}>
              {sites.map(site => (
                <div key={site.id} style={styles.siteCard}>
                  <h3 style={styles.siteName}>{site.name}</h3>
                  <p style={styles.siteDetail}>{site.address}</p>
                  <p style={styles.siteDetail}>GPS: {site.latitude}, {site.longitude}</p>
                  <p style={styles.siteDetail}>Geofence: {site.geofenceRadius}m radius</p>
                  <span style={{ ...styles.badge, background: site.isActive ? '#2e7d32' : '#888' }}>
                    {site.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))}
            </div>

            {showAddSite && (
              <Modal title="Add Site" onClose={() => setShowAddSite(false)} onSubmit={addSite}>
                <FormField label="Site Name" value={newSite.name} onChange={v => setNewSite({ ...newSite, name: v })} />
                <FormField label="Address" value={newSite.address} onChange={v => setNewSite({ ...newSite, address: v })} />
                <FormField label="Latitude" value={newSite.latitude} onChange={v => setNewSite({ ...newSite, latitude: v })} type="number" />
                <FormField label="Longitude" value={newSite.longitude} onChange={v => setNewSite({ ...newSite, longitude: v })} type="number" />
                <FormField label="Geofence Radius (meters)" value={newSite.geofenceRadius} onChange={v => setNewSite({ ...newSite, geofenceRadius: v })} type="number" />
                <FormSelect label="Supervisor" value={newSite.supervisorId} onChange={v => setNewSite({ ...newSite, supervisorId: v })}
                  options={employees.filter(e => e.role === 'supervisor').map(e => ({ value: e.uid, label: e.name }))} />
              </Modal>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const Modal = ({ title, children, onClose, onSubmit }) => (
  <div style={styles.modalOverlay}>
    <div style={styles.modal}>
      <div style={styles.modalHeader}>
        <h3 style={styles.modalTitle}>{title}</h3>
        <button onClick={onClose} style={styles.closeBtn}>✕</button>
      </div>
      <div style={styles.modalBody}>{children}</div>
      <div style={styles.modalFooter}>
        <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
        <button style={styles.btn} onClick={onSubmit}>Save</button>
      </div>
    </div>
  </div>
);

const FormField = ({ label, value, onChange, type = 'text' }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={styles.formLabel}>{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)} style={styles.formInput} />
  </div>
);

const FormSelect = ({ label, value, onChange, options }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={styles.formLabel}>{label}</label>
    <select value={value} onChange={e => onChange(e.target.value)} style={styles.formInput}>
      <option value="">Select...</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
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
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  pageTitle: { margin: 0, color: '#1a237e', fontSize: 22 },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '12px', fontSize: 14, color: '#333' },
  badge: { color: '#fff', padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 'bold' },
  smallBtn: { color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 },
  siteCard: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  siteName: { margin: '0 0 8px', color: '#1a237e' },
  siteDetail: { margin: '4px 0', fontSize: 13, color: '#666' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 16, padding: 0, width: 480, maxHeight: '90vh', overflow: 'auto' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #f0f0f0' },
  modalTitle: { margin: 0, color: '#1a237e' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#888' },
  modalBody: { padding: 24 },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '16px 24px', borderTop: '1px solid #f0f0f0' },
  cancelBtn: { background: '#f5f5f5', color: '#333', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer' },
  formLabel: { display: 'block', fontSize: 13, color: '#666', marginBottom: 6 },
  formInput: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' },
};
