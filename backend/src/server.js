import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import publicRoutes from './routes/public.js';
import managerRoutes from './routes/manager.js';
import { initCloudinary } from './cloudinary.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
initCloudinary();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', publicRoutes);
app.use('/api/manager', managerRoutes);

// Serve the built React app (frontend/dist) and let client-side routing handle /manager.
const dist = join(__dirname, '..', '..', 'frontend', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(join(dist, 'index.html'));
  });
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Kadak AirMenu API on :${PORT}`));
