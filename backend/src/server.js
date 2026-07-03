require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const siteRoutes = require('./routes/sites');
const timesheetRoutes = require('./routes/timesheets');
const punchRoutes = require('./routes/punches');
const photoRoutes = require('./routes/photos');
const documentRoutes = require('./routes/documents');
const reportRoutes = require('./routes/reports');
const notificationRoutes = require('./routes/notifications');
const equipmentRoutes = require('./routes/equipment');

const app = express();

app.use(helmet());
// FRONTEND_URL supports a comma-separated list of allowed origins
app.use(cors({
  origin: process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map(o => o.trim())
    : '*',
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/sites', siteRoutes);
app.use('/api/timesheets', timesheetRoutes);
app.use('/api/punches', punchRoutes);
app.use('/api/photos', photoRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/repair-tickets', require('./routes/repairTickets'));
app.use('/api/maintenance-schedule', require('./routes/maintenanceSchedule'));
app.use('/api/inspections', require('./routes/inspections'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/machine-hours', require('./routes/machineHours'));
app.use('/api/technicians', require('./routes/technicians'));
app.use('/api/health', require('./routes/healthDashboard'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'SiteView by Build Chain' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`SiteView API running on port ${PORT}`);
});
