const { db, messaging } = require('./firebase');
const { v4: uuidv4 } = require('uuid');

// Shared stock-take logic used by the inventory route and the maintenance
// supplies endpoint: decrements stock, logs an inventory_transactions entry,
// fires the low-stock alert, and writes the audit log.
// Throws errors carrying a .status for route handlers to map onto responses.

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function takeFromInventory({
  itemId,
  quantity,
  takenByUid,
  takenByName,
  purpose,
  authorizedBy,
  authorizedAt,
  equipmentId,
  equipmentName,
  maintenanceRecordId,
}) {
  const doc = await db.collection('inventory').doc(itemId).get();
  if (!doc.exists) throw httpError(404, 'Inventory item not found');

  const item = doc.data();
  const qty = parseFloat(quantity);
  if (isNaN(qty) || qty <= 0) throw httpError(400, 'quantity must be a positive number');

  if (item.currentQty < qty) {
    throw httpError(400, `Insufficient stock. Available: ${item.currentQty} ${item.unit}`);
  }

  const newQty = item.currentQty - qty;
  await db.collection('inventory').doc(itemId).update({ currentQty: newQty });

  const txId = uuidv4();
  const transaction = {
    id: txId,
    itemId,
    itemName: item.name,
    partNumber: item.partNumber,
    transactionType: 'take',
    quantity: qty,
    unit: item.unit,
    unitCost: item.unitCost,
    totalCost: qty * item.unitCost,
    previousQty: item.currentQty,
    newQty,
    purpose: purpose || '',
    takenBy: takenByUid,
    takenByName: takenByName || '',
    authorizedBy: authorizedBy || '',
    authorizedAt: authorizedAt || new Date().toISOString(),
    equipmentId: equipmentId || null,
    equipmentName: equipmentName || null,
    maintenanceRecordId: maintenanceRecordId || null,
    siteId: item.siteId,
    timestamp: new Date().toISOString(),
  };

  await db.collection('inventory_transactions').doc(txId).set(transaction);

  if (newQty <= item.minQty) {
    await notifyLowStock(item, newQty);
  }

  await db.collection('audit_logs').doc(uuidv4()).set({
    action: 'INVENTORY_TAKE',
    itemId,
    itemName: item.name,
    quantity: qty,
    newQty,
    performedBy: takenByUid,
    timestamp: new Date().toISOString(),
  });

  return { item, transaction, newQty };
}

async function notifyLowStock(item, currentQty) {
  try {
    const snapshot = await db.collection('users')
      .where('assignedSiteId', '==', item.siteId)
      .where('role', 'in', ['supervisor', 'admin'])
      .get();
    const tokens = snapshot.docs.map(d => d.data().fcmToken).filter(Boolean);
    if (tokens.length === 0) return;
    await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: '⚠️ Low Inventory Alert',
        body: `${item.name}: only ${currentQty} ${item.unit} remaining (min: ${item.minQty})`,
      },
    });
  } catch {}
}

module.exports = { takeFromInventory };
