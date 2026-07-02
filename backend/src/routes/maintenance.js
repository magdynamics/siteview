const express = require('express');
const router = express.Router();
const multer = require('multer');
const { db, storage } = require('../services/firebase');
const { takeFromInventory } = require('../services/inventoryStock');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ─── CREATE MAINTENANCE RECORD ────────────────────────────────────────────────
router.post('/', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const {
      equipmentId,
      equipmentName,
      siteId,
      performedBy,         // who did the work (name or employee ID)
      authorizedBy,        // who authorized it
      authorizedAt,        // when authorized
      maintenanceDate,     // date performed
      maintenanceType,     // 'routine' | 'repair' | 'inspection' | 'emergency'
      description,         // what was done
      hoursAtService,      // machine hours reading (e.g. 1250 hrs)
      odometerAtService,   // odometer reading (vehicles)
      laborHours,          // hours of labor
      laborCost,           // cost of labor
      partsCost,           // cost of parts
      totalCost,           // total cost
      nextServiceHours,    // next service due at X hours
      nextServiceDate,     // next service due date
      notes,
    } = req.body;

    if (!equipmentId) return res.status(400).json({ error: 'equipmentId is required' });
    if (!maintenanceType) return res.status(400).json({ error: 'maintenanceType is required' });
    if (!maintenanceDate) return res.status(400).json({ error: 'maintenanceDate is required' });

    const equipDoc = await db.collection('equipment').doc(equipmentId).get();
    if (!equipDoc.exists) return res.status(404).json({ error: 'Equipment not found' });

    const id = uuidv4();
    const record = {
      id,
      equipmentId,
      equipmentName,
      siteId,
      performedBy,
      authorizedBy,
      authorizedAt: authorizedAt || new Date().toISOString(),
      maintenanceDate,
      maintenanceType,
      description,
      hoursAtService: hoursAtService ? parseFloat(hoursAtService) : null,
      odometerAtService: odometerAtService ? parseFloat(odometerAtService) : null,
      laborHours: laborHours ? parseFloat(laborHours) : null,
      laborCost: laborCost ? parseFloat(laborCost) : null,
      partsCost: partsCost ? parseFloat(partsCost) : null,
      totalCost: totalCost ? parseFloat(totalCost) : null,
      nextServiceHours: nextServiceHours ? parseFloat(nextServiceHours) : null,
      nextServiceDate: nextServiceDate || null,
      notes: notes || '',
      createdBy: req.user.uid,
      createdAt: new Date().toISOString(),
      photos: [],        // filled in by photo upload endpoint
      suppliesUsed: [],  // filled in by supplies endpoint
      status: 'open',   // 'open' | 'completed'
    };

    await db.collection('maintenance_records').doc(id).set(record);

    await db.collection('audit_logs').doc(uuidv4()).set({
      action: 'MAINTENANCE_CREATED',
      equipmentId,
      maintenanceId: id,
      performedBy: req.user.uid,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({ message: 'Maintenance record created', record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET MAINTENANCE HISTORY ──────────────────────────────────────────────────
router.get('/', authenticate, authorize('supervisor', 'accountant', 'manager', 'admin'), async (req, res) => {
  try {
    const { equipmentId, siteId, startDate, endDate, maintenanceType } = req.query;
    let query = db.collection('maintenance_records');

    if (equipmentId) query = query.where('equipmentId', '==', equipmentId);
    if (siteId) query = query.where('siteId', '==', siteId);
    if (maintenanceType) query = query.where('maintenanceType', '==', maintenanceType);
    if (startDate) query = query.where('maintenanceDate', '>=', startDate);
    if (endDate) query = query.where('maintenanceDate', '<=', endDate);

    const snapshot = await query.orderBy('maintenanceDate', 'desc').get();
    const records = snapshot.docs.map(doc => doc.data());
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET SINGLE RECORD ────────────────────────────────────────────────────────
router.get('/:id', authenticate, authorize('supervisor', 'accountant', 'manager', 'admin'), async (req, res) => {
  try {
    const doc = await db.collection('maintenance_records').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Record not found' });
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── UPLOAD MAINTENANCE PHOTOS ────────────────────────────────────────────────
router.post('/:id/photos', authenticate, authorize('supervisor', 'admin'), upload.single('photo'), async (req, res) => {
  try {
    const { photoType } = req.body;
    if (!req.file) return res.status(400).json({ error: 'photo file is required' });
    if (!['before', 'after', 'parts_used'].includes(photoType)) {
      return res.status(400).json({ error: "photoType must be 'before', 'after', or 'parts_used'" });
    }

    const maintenanceId = req.params.id;
    const recordDoc = await db.collection('maintenance_records').doc(maintenanceId).get();
    if (!recordDoc.exists) return res.status(404).json({ error: 'Record not found' });

    const photoId = uuidv4();
    const ext = 'jpg';
    const fileName = `maintenance/${maintenanceId}/${photoType}_${photoId}.${ext}`;

    // Tokenized download URL instead of a world-readable public file
    const downloadToken = uuidv4();
    const bucket = storage.bucket();
    const file = bucket.file(fileName);
    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media&token=${downloadToken}`;

    const photo = {
      id: photoId,
      photoType,
      url,
      uploadedBy: req.user.uid,
      uploadedAt: new Date().toISOString(),
    };

    // Append to maintenance record photos array
    const existing = recordDoc.data().photos || [];
    await db.collection('maintenance_records').doc(maintenanceId).update({
      photos: [...existing, photo],
    });

    res.status(201).json({ message: 'Photo uploaded', photo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADD SUPPLIES / PARTS USED ────────────────────────────────────────────────
router.post('/:id/supplies', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const {
      itemName,         // name of supply/part
      partNumber,       // part number
      quantity,         // how many taken
      unitCost,         // cost per unit
      totalItemCost,    // quantity * unitCost
      takenBy,          // employee who took it
      authorizedBy,     // who authorized
      authorizedAt,     // when authorized
      fromInventory,    // taken from inventory? true/false
      inventoryItemId,  // inventory doc id (required when fromInventory)
      supplier,         // supplier name if purchased
      receiptUrl,       // scanned receipt URL
    } = req.body;

    if (!itemName && !(fromInventory && inventoryItemId)) {
      return res.status(400).json({ error: 'itemName is required' });
    }
    const parsedQuantity = parseFloat(quantity);
    if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number' });
    }

    const doc = await db.collection('maintenance_records').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Record not found' });
    const record = doc.data();

    // Pull stock so parts usage and inventory counts stay in sync
    let inventoryItem = null;
    let inventoryTx = null;
    if (fromInventory) {
      if (!inventoryItemId) {
        return res.status(400).json({ error: 'inventoryItemId is required when fromInventory is true' });
      }
      const result = await takeFromInventory({
        itemId: inventoryItemId,
        quantity: parsedQuantity,
        takenByUid: req.user.uid,
        takenByName: req.user.name || '',
        purpose: `Maintenance: ${record.description || record.maintenanceType || record.id}`,
        authorizedBy,
        authorizedAt,
        equipmentId: record.equipmentId,
        equipmentName: record.equipmentName,
        maintenanceRecordId: req.params.id,
      });
      inventoryItem = result.item;
      inventoryTx = result.transaction;
    }

    const effectiveUnitCost = unitCost !== undefined && unitCost !== null && unitCost !== ''
      ? parseFloat(unitCost)
      : (inventoryItem ? inventoryItem.unitCost : 0);

    const supplyId = uuidv4();
    const supply = {
      id: supplyId,
      itemName: itemName || inventoryItem.name,  // guarded: inventoryItem is set whenever itemName is absent
      partNumber: partNumber || (inventoryItem ? inventoryItem.partNumber : '') || '',
      quantity: parsedQuantity,
      unitCost: effectiveUnitCost,
      totalItemCost: totalItemCost ? parseFloat(totalItemCost) : +(parsedQuantity * effectiveUnitCost).toFixed(2),
      takenBy: takenBy || req.user.name || req.user.uid,
      authorizedBy: authorizedBy || null,
      authorizedAt: authorizedAt || new Date().toISOString(),
      fromInventory: !!fromInventory,
      inventoryItemId: inventoryItemId || null,
      inventoryTransactionId: inventoryTx ? inventoryTx.id : null,
      supplier: supplier || '',
      receiptUrl: receiptUrl || null,
      addedBy: req.user.uid,
      addedAt: new Date().toISOString(),
    };

    const existingSupplies = record.suppliesUsed || [];
    const existingPartsCost = record.partsCost || 0;
    const newPartsCost = existingPartsCost + supply.totalItemCost;
    const laborCost = record.laborCost || 0;

    await db.collection('maintenance_records').doc(req.params.id).update({
      suppliesUsed: [...existingSupplies, supply],
      partsCost: newPartsCost,
      totalCost: laborCost + newPartsCost,
    });

    res.status(201).json({ message: 'Supply added', supply });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── COMPLETE MAINTENANCE RECORD ─────────────────────────────────────────────
router.post('/:id/complete', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const { finalNotes } = req.body;
    const doc = await db.collection('maintenance_records').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Record not found' });
    const record = doc.data();

    await db.collection('maintenance_records').doc(req.params.id).update({
      status: 'completed',
      completedAt: new Date().toISOString(),
      completedBy: req.user.uid,
      finalNotes: finalNotes || '',
    });

    // Stamp equipment; release it only if no open repair tickets remain,
    // and never lift out_of_service here (the ticket flow owns that state)
    const equipDoc = await db.collection('equipment').doc(record.equipmentId).get();
    if (equipDoc.exists) {
      const equipUpdates = {
        lastMaintenanceDate: record.maintenanceDate,
        lastMaintenanceId: record.id,
      };
      if (equipDoc.data().status === 'maintenance') {
        const openTickets = await db.collection('repair_tickets')
          .where('equipmentId', '==', record.equipmentId)
          .where('status', 'in', ['pending', 'approved', 'in_progress'])
          .get();
        if (openTickets.empty) equipUpdates.status = 'available';
      }
      await db.collection('equipment').doc(record.equipmentId).update(equipUpdates);
    }

    res.json({ message: 'Maintenance record completed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MAINTENANCE COST SUMMARY ─────────────────────────────────────────────────
router.get('/summary/costs', authenticate, authorize('supervisor', 'accountant', 'manager', 'admin'), async (req, res) => {
  try {
    const { equipmentId, siteId, startDate, endDate } = req.query;
    let query = db.collection('maintenance_records').where('status', '==', 'completed');

    if (equipmentId) query = query.where('equipmentId', '==', equipmentId);
    if (siteId) query = query.where('siteId', '==', siteId);

    const snapshot = await query.get();
    const records = snapshot.docs.map(doc => doc.data());

    const summary = records.reduce((acc, r) => ({
      totalRecords: acc.totalRecords + 1,
      totalLaborCost: acc.totalLaborCost + (r.laborCost || 0),
      totalPartsCost: acc.totalPartsCost + (r.partsCost || 0),
      totalCost: acc.totalCost + (r.totalCost || 0),
    }), { totalRecords: 0, totalLaborCost: 0, totalPartsCost: 0, totalCost: 0 });

    res.json({ summary, records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
