const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Create site (a site is one construction project — carries project-level fields)
router.post('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const {
      name, address, latitude, longitude, geofenceRadius, supervisorId,
      // project-level fields (SiteView technical guideline §4.1)
      ownerName, gcName, startDate, targetCompletionDate,
      budgetTotal, currentPhase, stakeholders, changeOrderThreshold,
    } = req.body;
    const siteId = uuidv4();

    const site = {
      id: siteId,
      name,
      address,
      latitude,
      longitude,
      geofenceRadius: geofenceRadius || 200, // meters
      supervisorId: supervisorId || null,
      ownerName: ownerName || '',
      gcName: gcName || '',
      startDate: startDate || null,
      targetCompletionDate: targetCompletionDate || null,
      budgetTotal: budgetTotal ? parseFloat(budgetTotal) : null,
      currentPhase: currentPhase || '',
      stakeholders: Array.isArray(stakeholders) ? stakeholders : [],  // {name, role, contact}
      changeOrderThreshold: changeOrderThreshold ? parseFloat(changeOrderThreshold) : 5000,
      createdAt: new Date().toISOString(),
      isActive: true,
    };

    await db.collection('sites').doc(siteId).set(site);
    res.status(201).json({ message: 'Site created', site });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all sites
router.get('/', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('sites').where('isActive', '==', true).get();
    const sites = snapshot.docs.map(doc => doc.data());
    res.json(sites);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single site
router.get('/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('sites').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Site not found' });
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update site
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    await db.collection('sites').doc(req.params.id).update(req.body);
    res.json({ message: 'Site updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
