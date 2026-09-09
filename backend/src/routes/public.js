// Public (guest) API — no auth.
import { Router } from 'express';
import { db } from '../db.js';
import { buildMenu, getRestaurant } from '../menu.js';

const router = Router();
const RID = 1;

// GET /api/restaurant
router.get('/restaurant', async (_req, res) => {
  try { res.json({ restaurant: await getRestaurant() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/menu — full menu incl. sold-out (guest greys them out)
router.get('/menu', async (_req, res) => {
  try { res.json(await buildMenu({ includeUnavailable: true })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/track { item_id } — log a view for analytics
router.post('/track', async (req, res) => {
  try {
    const itemId = Number(req.body && req.body.item_id);
    if (!Number.isInteger(itemId)) return res.status(400).json({ error: 'item_id required' });
    await db().execute({ sql: 'INSERT INTO view_logs (restaurant_id, item_id) VALUES (?, ?)', args: [RID, itemId] });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
