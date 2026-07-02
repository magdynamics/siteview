const { db } = require('./firebase');
const { v4: uuidv4 } = require('uuid');

// Shared writer for maintenance_records so schedule completion, repair-ticket
// completion, and the manual endpoint all produce the same document shape.

const num = v => (v === undefined || v === null || v === '' ? null : parseFloat(v));

async function createMaintenanceRecord(data, createdByUid) {
  const id = uuidv4();
  const nowIso = new Date().toISOString();

  const record = {
    id,
    equipmentId: data.equipmentId,
    equipmentName: data.equipmentName || '',
    siteId: data.siteId || null,
    performedBy: data.performedBy || null,
    authorizedBy: data.authorizedBy || null,
    authorizedAt: data.authorizedAt || nowIso,
    maintenanceDate: data.maintenanceDate,
    maintenanceType: data.maintenanceType,
    description: data.description || '',
    hoursAtService: num(data.hoursAtService),
    odometerAtService: num(data.odometerAtService),
    laborHours: num(data.laborHours),
    laborCost: num(data.laborCost),
    partsCost: num(data.partsCost),
    totalCost: num(data.totalCost),
    nextServiceHours: num(data.nextServiceHours),
    nextServiceDate: data.nextServiceDate || null,
    notes: data.notes || '',
    scheduleId: data.scheduleId || null,
    repairTicketId: data.repairTicketId || null,
    createdBy: createdByUid,
    createdAt: nowIso,
    photos: [],
    suppliesUsed: [],
    status: data.status || 'open',
  };

  if (record.status === 'completed') {
    record.completedAt = nowIso;
    record.completedBy = createdByUid;
    record.finalNotes = data.finalNotes || '';
  }

  await db.collection('maintenance_records').doc(id).set(record);

  await db.collection('equipment').doc(record.equipmentId).update({
    lastMaintenanceDate: record.maintenanceDate,
    lastMaintenanceId: id,
  });

  await db.collection('audit_logs').doc(uuidv4()).set({
    action: 'MAINTENANCE_CREATED',
    equipmentId: record.equipmentId,
    maintenanceId: id,
    performedBy: createdByUid,
    timestamp: nowIso,
  });

  return record;
}

module.exports = { createMaintenanceRecord };
