import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import dashboardRoutes from './routes/dashboard.routes';
import resourcesRoutes from './routes/resources.routes';
import timetableRoutes from './routes/timetable.routes';
import bookingsRoutes from './routes/bookings.routes';
import approvalsRoutes from './routes/approvals.routes';
import checkinRoutes from './routes/checkin.routes';
import analyticsRoutes from './routes/analytics.routes';
import adminRoutes from './routes/admin.routes';
import notificationsRoutes from './routes/notifications.routes';
import { startAutoReleaseScheduler } from './services/autoReleaseService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(
  cors({
    origin: '*', // Allow both Next.js (:3000) and React+Vite (:5173) frontends
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json());

// Request logging in development
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  }
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    service: 'LPU Campus Resource Booking API',
    version: '1.0.0',
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/resources', resourcesRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/approvals', approvalsRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationsRoutes);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 LPU Campus Backend API server running on http://localhost:${PORT}`);
  // Start background auto-release service
  startAutoReleaseScheduler(Number(process.env.AUTO_RELEASE_CHECK_INTERVAL_MS) || 30000);
});
