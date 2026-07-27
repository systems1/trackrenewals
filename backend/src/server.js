require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const passport = require('passport');

const initDb = require('./init-db');
const authRoutes = require('./routes/auth');
const domainRoutes = require('./routes/domains');

const PORT = process.env.PORT || 3001;

async function main() {
  await initDb();

  const app = express();

  // CORS — allow frontend origin with credentials
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }));

  app.use(express.json());
  app.use(cookieParser());
  app.use(passport.initialize());

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/domains', domainRoutes);

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack || err.message || err);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
