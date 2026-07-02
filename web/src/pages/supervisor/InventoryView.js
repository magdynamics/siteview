import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const CATEGORIES = ['oil', 'filter', 'hydraulic', 'tires', 'belts', 'tools', 'other'];
const UNITS = ['each', 'liter', 'gallon', 'kg', 'box', 'set'];

export default function InventoryView({ siteId }) {
  const [items, setItems] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [reorderRequests, setReorderRequests] = useState([]);
  const [activeTab, setActiveTab] = useState('stock');
  const [showAddItem, setShowAddItem] = useState(false);
  const [showTake, setShowTake] = useState(null);
  const [showRestock, setShowRestock] = useState(null);
  const [newItem, setNewItem] = useState({ name: '', partNumber: '', category: 'oil', unit: 'liter', currentQty: '', minQty: '', maxQty: '', unitCost: '', supplier: '', location: '', notes: '' });
  const [takeForm, setTakeForm] = useState({ quantity: '', purpose: '', authorizedBy: '', equipmentId: '' });
  const [restockForm, setRestockForm] = useState({ quantity: '', unitCost: '', supplier: '', invoiceNumber: '' });

  useEffect(() => {
    if (siteId) { loadItems(); loadReorderRequests(); }
  }, [siteId]);

  const loadItems = async () => {
    const res = await api.get(`/inventory?siteId=${siteId}`);
    setItems(res.data);
  };
  const loadTransactions = async () => {
    const res = await api.get(`/inventory/transactions?siteId=${siteId}`);
    setTransactions(res.data);
  };
  const loadReorderRequests = async () => {
    const res = await api.get(`/inventory/reorder-requests?siteId=${siteId}`);
    setReorderRequests(res.data);
  };

  const addItem = async () => {
    await api.post('/inventory', { ...newItem, siteId });
    setShowAddItem(false);
    setNewItem({ name: '', partNumber: '', category: 'oil', unit: 'liter', currentQty: '', minQty: '', maxQty: '', unitCost: '', supplier: '', location: '', notes: '' });
    loadItems();
  };

  const takeItem = async (itemId) => {
    try {
      await api.post(`/inventory/${itemId}/take`, { ...takeForm, siteId });
      setShowTake(null);
      setTakeForm({ quantity: '', purpose: '', authorizedBy: '', equipmentId: '' });
      loadItems();
      alert('Items taken from inventory');
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const restockItem = async (itemId) => {
    await api.post(`/inventory/${itemId}/restock`, restockForm);
    setShowRestock(null);
    setRestockForm({ quantity: '', unitCost: '', supplier: '', invoiceNumber: '' });
    loadItems();
    alert('Inventory restocked');
  };

  const approveReorder = async (id) => {
    await api.post(`/inventory/reorder-requests/${id}/approve`);
    loadReorderRequests();
  };

  const lowStockItems = items.filter(i => i.currentQty <= i.minQty);

  return (
    <div>
      {/* Low Stock Alert */}
      {lowStockItems.length > 0 && (
        <div style={styles.alertBanner}>
          ⚠️ {lowStockItems.length} item(s) are below minimum stock level:
          {lowStockItems.map(i => ` ${i.name} (${i.currentQty} ${i.unit})`).join(',')}
        </div>
      )}

      {/* Tabs */}
      <div style={styles.tabs}>
        {['stock', 'transactions', 'reorders'].map(tab => (
          <div key={tab}
            style={{ ...styles.tab, ...(activeTab === tab ? styles.tabActive : {}) }}
            onClick={() => { setActiveTab(tab); if (tab === 'transactions') loadTransactions(); }}>
            {tab === 'stock' ? `📦 Stock (${items.length})` : tab === 'transactions' ? '📋 Transactions' : `🔄 Reorder Requests (${reorderRequests.filter(r => r.status === 'pending').length})`}
          </div>
        ))}
      </div>

      {activeTab === 'stock' && (
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h3 style={styles.cardTitle}>Parts & Supplies Inventory</h3>
            <button style={styles.btn} onClick={() => setShowAddItem(true)}>+ Add Item</button>
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Item', 'Part #', 'Category', 'Stock', 'Min', 'Unit Cost', 'Value', 'Location', 'Status', 'Actions'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const isLow = item.currentQty <= item.minQty;
                return (
                  <tr key={item.id} style={{ ...styles.tr, background: isLow ? '#fff8f0' : 'transparent' }}>
                    <td style={styles.td}><strong>{item.name}</strong></td>
                    <td style={styles.td}>{item.partNumber || '-'}</td>
                    <td style={styles.td}>{item.category}</td>
                    <td style={styles.td}>
                      <span style={{ fontSize: 16, fontWeight: 'bold', color: isLow ? '#b71c1c' : '#2e7d32' }}>
                        {item.currentQty}
                      </span> {item.unit}
                    </td>
                    <td style={styles.td}>{item.minQty} {item.unit}</td>
                    <td style={styles.td}>${item.unitCost}</td>
                    <td style={styles.td}>${(item.currentQty * item.unitCost).toFixed(2)}</td>
                    <td style={styles.td}>{item.location || '-'}</td>
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, background: isLow ? '#b71c1c' : '#2e7d32' }}>
                        {isLow ? 'LOW' : 'OK'}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <button style={{ ...styles.smallBtn, background: '#e65100', marginRight: 4 }} onClick={() => setShowTake(item)}>Take</button>
                      <button style={{ ...styles.smallBtn, background: '#2e7d32', marginRight: 4 }} onClick={() => setShowRestock(item)}>Restock</button>
                      {isLow && <button style={{ ...styles.smallBtn, background: '#1565c0' }} onClick={() => api.post(`/inventory/${item.id}/reorder`, { quantityNeeded: item.maxQty - item.currentQty, urgency: 'normal' }).then(loadReorderRequests)}>Request Reorder</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'transactions' && (
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Date/Time', 'Item', 'Type', 'Qty', 'Cost', 'Taken By', 'Authorized By', 'Purpose / Supplier'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx, i) => (
                <tr key={i} style={styles.tr}>
                  <td style={styles.td}>{new Date(tx.timestamp).toLocaleString()}</td>
                  <td style={styles.td}><strong>{tx.itemName}</strong></td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, background: tx.transactionType === 'take' ? '#e65100' : '#2e7d32' }}>
                      {tx.transactionType.toUpperCase()}
                    </span>
                  </td>
                  <td style={styles.td}>{tx.transactionType === 'take' ? '-' : '+'}{tx.quantity} {tx.unit}</td>
                  <td style={styles.td}>${tx.totalCost?.toFixed(2)}</td>
                  <td style={styles.td}>{tx.takenBy || tx.restockedBy || '-'}</td>
                  <td style={styles.td}>{tx.authorizedBy || '-'}</td>
                  <td style={styles.td}>{tx.purpose || tx.supplier || '-'}</td>
                </tr>
              ))}
              {transactions.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: '#aaa' }}>No transactions yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'reorders' && (
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Item', 'Current Stock', 'Qty Needed', 'Est. Cost', 'Urgency', 'Requested By', 'Status', 'Actions'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reorderRequests.map((r, i) => (
                <tr key={i} style={styles.tr}>
                  <td style={styles.td}><strong>{r.itemName}</strong><br /><span style={{ fontSize: 11, color: '#aaa' }}>{r.partNumber}</span></td>
                  <td style={styles.td}>{r.currentQty}</td>
                  <td style={styles.td}>{r.quantityNeeded}</td>
                  <td style={styles.td}>${r.estimatedCost?.toFixed(2)}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, background: r.urgency === 'urgent' ? '#b71c1c' : r.urgency === 'normal' ? '#f57c00' : '#2e7d32' }}>
                      {r.urgency?.toUpperCase()}
                    </span>
                  </td>
                  <td style={styles.td}>{r.requestedBy}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, background: r.status === 'approved' ? '#2e7d32' : '#888' }}>
                      {r.status?.toUpperCase()}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {r.status === 'pending' && <button style={{ ...styles.smallBtn, background: '#2e7d32' }} onClick={() => approveReorder(r.id)}>Approve</button>}
                  </td>
                </tr>
              ))}
              {reorderRequests.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: '#aaa' }}>No reorder requests</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Item Modal */}
      {showAddItem && (
        <Modal title="Add Inventory Item" onClose={() => setShowAddItem(false)} onSave={addItem}>
          <Row><Field label="Item Name *" value={newItem.name} onChange={v => setNewItem({ ...newItem, name: v })} /></Row>
          <Row>
            <Field label="Part Number" value={newItem.partNumber} onChange={v => setNewItem({ ...newItem, partNumber: v })} />
            <Select label="Category" value={newItem.category} onChange={v => setNewItem({ ...newItem, category: v })} options={CATEGORIES} />
          </Row>
          <Row>
            <Field label="Current Qty *" value={newItem.currentQty} onChange={v => setNewItem({ ...newItem, currentQty: v })} type="number" />
            <Field label="Min Qty (alert level)" value={newItem.minQty} onChange={v => setNewItem({ ...newItem, minQty: v })} type="number" />
            <Select label="Unit" value={newItem.unit} onChange={v => setNewItem({ ...newItem, unit: v })} options={UNITS} />
          </Row>
          <Row>
            <Field label="Unit Cost ($)" value={newItem.unitCost} onChange={v => setNewItem({ ...newItem, unitCost: v })} type="number" />
            <Field label="Supplier" value={newItem.supplier} onChange={v => setNewItem({ ...newItem, supplier: v })} />
          </Row>
          <Field label="Storage Location (e.g. Site A Shed, Shelf 3)" value={newItem.location} onChange={v => setNewItem({ ...newItem, location: v })} />
        </Modal>
      )}

      {/* Take Modal */}
      {showTake && (
        <Modal title={`Take from Inventory: ${showTake.name}`} onClose={() => setShowTake(null)} onSave={() => takeItem(showTake.id)}>
          <p style={{ color: '#888', margin: '0 0 12px' }}>Available: <strong>{showTake.currentQty} {showTake.unit}</strong></p>
          <Field label="Quantity to Take *" value={takeForm.quantity} onChange={v => setTakeForm({ ...takeForm, quantity: v })} type="number" />
          <Field label="Purpose / Reason" value={takeForm.purpose} onChange={v => setTakeForm({ ...takeForm, purpose: v })} />
          <Field label="Authorized By" value={takeForm.authorizedBy} onChange={v => setTakeForm({ ...takeForm, authorizedBy: v })} />
          <Field label="Equipment (if for maintenance)" value={takeForm.equipmentId} onChange={v => setTakeForm({ ...takeForm, equipmentId: v })} />
        </Modal>
      )}

      {/* Restock Modal */}
      {showRestock && (
        <Modal title={`Restock: ${showRestock.name}`} onClose={() => setShowRestock(null)} onSave={() => restockItem(showRestock.id)}>
          <Field label="Quantity to Add *" value={restockForm.quantity} onChange={v => setRestockForm({ ...restockForm, quantity: v })} type="number" />
          <Field label="Unit Cost ($)" value={restockForm.unitCost} onChange={v => setRestockForm({ ...restockForm, unitCost: v })} type="number" />
          <Field label="Supplier" value={restockForm.supplier} onChange={v => setRestockForm({ ...restockForm, supplier: v })} />
          <Field label="Invoice Number" value={restockForm.invoiceNumber} onChange={v => setRestockForm({ ...restockForm, invoiceNumber: v })} />
        </Modal>
      )}
    </div>
  );
}

const Modal = ({ title, children, onClose, onSave }) => (
  <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ background: '#fff', borderRadius: 16, padding: 0, width: 520, maxHeight: '90vh', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #f0f0f0' }}>
        <h3 style={{ margin: 0, color: '#1a237e' }}>{title}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ padding: 24 }}>{children}</div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', padding: '16px 24px', borderTop: '1px solid #f0f0f0' }}>
        <button onClick={onClose} style={{ background: '#f5f5f5', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
        <button onClick={onSave} style={{ background: '#1a237e', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer' }}>Save</button>
      </div>
    </div>
  </div>
);

const Row = ({ children }) => <div style={{ display: 'flex', gap: 12 }}>{children}</div>;
const Field = ({ label, value, onChange, type = 'text' }) => (
  <div style={{ flex: 1, marginBottom: 12 }}>
    <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' }} />
  </div>
);
const Select = ({ label, value, onChange, options }) => (
  <div style={{ flex: 1, marginBottom: 12 }}>
    <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</label>
    <select value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

const styles = {
  alertBanner: { background: '#fff3e0', border: '1px solid #e65100', borderRadius: 10, padding: '12px 16px', marginBottom: 16, color: '#e65100', fontWeight: '600', fontSize: 13 },
  tabs: { display: 'flex', background: '#fff', borderRadius: '12px 12px 0 0', overflow: 'hidden', marginBottom: 1 },
  tab: { flex: 1, padding: '14px', textAlign: 'center', cursor: 'pointer', fontSize: 14, color: '#888', borderBottom: '3px solid transparent' },
  tabActive: { color: '#1a237e', fontWeight: 'bold', borderBottomColor: '#1a237e', background: '#f8f9ff' },
  card: { background: '#fff', borderRadius: '0 0 12px 12px', padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflowX: 'auto' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  cardTitle: { margin: 0, fontSize: 16, color: '#333' },
  btn: { background: '#1a237e', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 900 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: '#888', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #f9f9f9' },
  td: { padding: '11px 12px', fontSize: 13, color: '#333' },
  badge: { color: '#fff', padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap' },
  smallBtn: { color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
};
