// Manager API — all routes require the Bearer password (except /login).
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { buildMenu } from '../menu.js';
import { checkPassword, requireManager } from '../auth.js';
import { uploadBuffer, isCloudinaryConfigured } from '../cloudinary.js';

const router = Router();
const RID = 1;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });

const COLORS = ['yellow', 'orange', 'red', 'green', 'blue'];
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// POST /api/manager/login { password } -> { token }
router.post('/login', (req, res) => {
  const pw = req.body && req.body.password;
  if (!checkPassword(pw)) return res.status(401).json({ error: 'Wrong password' });
  res.json({ token: pw }); // token IS the password (stateless MVP)
});

// Everything below requires auth
router.use(requireManager);

// GET /api/manager/menu — full menu incl. sold-out
router.get('/menu', async (_req, res) => {
  try { res.json(await buildMenu({ includeUnavailable: true })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- Categories ---- */
router.post('/categories', async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const world = b.world === 'drinks' ? 'drinks' : 'food';
    const slug = String(b.slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || ('cat' + Date.now());
    const ord = Number.isFinite(Number(b.display_order)) ? Number(b.display_order)
      : Number((await db().execute('SELECT COALESCE(MAX(display_order),0)+1 AS n FROM categories')).rows[0].n);
    const r = await db().execute({
      sql: 'INSERT INTO categories (restaurant_id, name, slug, world, sec_desc, display_order) VALUES (?,?,?,?,?,?)',
      args: [RID, name, slug, world, String(b.sec_desc || ''), ord],
    });
    res.json({ id: Number(r.lastInsertRowid), created: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch('/categories/:id', async (req, res) => {
  try {
    const id = Number(req.params.id); const b = req.body || {};
    const sets = [], args = [];
    if (b.name != null) { sets.push('name = ?'); args.push(String(b.name).trim()); }
    if (b.world != null) { sets.push('world = ?'); args.push(b.world === 'drinks' ? 'drinks' : 'food'); }
    if (b.sec_desc != null) { sets.push('sec_desc = ?'); args.push(String(b.sec_desc)); }
    if (b.display_order != null) { sets.push('display_order = ?'); args.push(Number(b.display_order) || 0); }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    args.push(id);
    const r = await db().execute({ sql: `UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, args });
    if (!r.rowsAffected) return res.status(404).json({ error: 'not found' });
    res.json({ id, updated: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db().execute({ sql: 'DELETE FROM categories WHERE id = ?', args: [id] });
    res.json({ id, deleted: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---- Items ---- */
async function replaceVariants(itemId, variants) {
  const client = db();
  await client.execute({ sql: 'DELETE FROM variants WHERE item_id = ?', args: [itemId] });
  const list = Array.isArray(variants) ? variants : [];
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    const name = String(v.name || '').trim();
    const price = Math.round(Number(v.price));
    if (!name || !Number.isFinite(price)) continue;
    await client.execute({
      sql: 'INSERT INTO variants (item_id, name, price, display_order) VALUES (?,?,?,?)',
      args: [itemId, name, price, i + 1],
    });
  }
}

router.post('/items', async (req, res) => {
  try {
    const b = req.body || {};
    const category_id = Number(b.category_id);
    const name = String(b.name || '').trim();
    if (!Number.isInteger(category_id)) return res.status(400).json({ error: 'category_id required' });
    if (!name) return res.status(400).json({ error: 'name required' });
    const hasVariants = Array.isArray(b.variants) && b.variants.length;
    const price = hasVariants ? null : Math.round(Number(b.price));
    if (!hasVariants && (!Number.isFinite(price) || price < 0)) return res.status(400).json({ error: 'valid price or variants required' });
    const color = COLORS.includes(b.color) ? b.color : 'yellow';
    const ord = Number((await db().execute({ sql: 'SELECT COALESCE(MAX(display_order),0)+1 AS n FROM menu_items WHERE category_id = ?', args: [category_id] })).rows[0].n);
    const r = await db().execute({
      sql: `INSERT INTO menu_items (category_id, name, description, price, image_url, icon, color, is_available, is_veg, is_bestseller, is_new, is_signature, display_order)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [category_id, name, String(b.description || ''), price, b.image_url || null,
        String(b.icon || 'plate'), color,
        b.is_available === false ? 0 : 1,
        b.is_veg === true ? 1 : b.is_veg === false ? 0 : null,
        b.is_bestseller ? 1 : 0, b.is_new ? 1 : 0, b.is_signature ? 1 : 0, ord],
    });
    const id = Number(r.lastInsertRowid);
    if (hasVariants) await replaceVariants(id, b.variants);
    res.json({ id, created: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch('/items/:id', async (req, res) => {
  try {
    const id = Number(req.params.id); const b = req.body || {};
    const sets = [], args = [];
    const put = (c, v) => { sets.push(`${c} = ?`); args.push(v); };
    if (b.name != null) put('name', String(b.name).trim());
    if (b.description != null) put('description', String(b.description));
    if (b.category_id != null) put('category_id', Number(b.category_id));
    if (b.image_url !== undefined) put('image_url', b.image_url || null);
    if (b.icon != null) put('icon', String(b.icon));
    if (b.color != null) put('color', COLORS.includes(b.color) ? b.color : 'yellow');
    if (typeof b.is_available === 'boolean') put('is_available', b.is_available ? 1 : 0);
    if (b.is_veg !== undefined) put('is_veg', b.is_veg === true ? 1 : b.is_veg === false ? 0 : null);
    if (b.is_bestseller !== undefined) put('is_bestseller', b.is_bestseller ? 1 : 0);
    if (b.is_new !== undefined) put('is_new', b.is_new ? 1 : 0);
    if (b.is_signature !== undefined) put('is_signature', b.is_signature ? 1 : 0);
    if (b.display_order != null) put('display_order', Number(b.display_order) || 0);
    // price / variants
    if (Array.isArray(b.variants)) {
      await replaceVariants(id, b.variants);
      if (b.variants.length) put('price', null);
    }
    if (b.price !== undefined && !(Array.isArray(b.variants) && b.variants.length)) {
      const price = b.price === null ? null : Math.round(Number(b.price));
      put('price', price);
    }
    put('updated_at', now());
    args.push(id);
    const r = await db().execute({ sql: `UPDATE menu_items SET ${sets.join(', ')} WHERE id = ?`, args });
    if (!r.rowsAffected) return res.status(404).json({ error: 'not found' });
    res.json({ id, updated: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/items/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db().execute({ sql: 'DELETE FROM menu_items WHERE id = ?', args: [id] });
    res.json({ id, deleted: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---- Image upload (Cloudinary) ---- */
router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!isCloudinaryConfigured()) return res.status(503).json({ error: 'Cloudinary not configured. Set CLOUDINARY_* env vars.' });
    if (!req.file) return res.status(400).json({ error: 'no image file' });
    const url = await uploadBuffer(req.file.buffer);
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- Analytics ---- */
// GET /api/manager/analytics/top?period=today|7d|all
router.get('/analytics/top', async (req, res) => {
  try {
    const period = req.query.period || 'today';
    let where = '';
    if (period === 'today') where = "WHERE date(v.ts) = date('now')";
    else if (period === '7d') where = "WHERE v.ts >= datetime('now','-7 days')";
    const r = await db().execute(
      `SELECT v.item_id, m.name, COUNT(*) AS views
       FROM view_logs v JOIN menu_items m ON m.id = v.item_id
       ${where}
       GROUP BY v.item_id ORDER BY views DESC LIMIT 10`
    );
    const totalRow = await db().execute(
      period === 'today'
        ? "SELECT COUNT(*) AS n FROM view_logs WHERE date(ts)=date('now')"
        : period === '7d'
          ? "SELECT COUNT(*) AS n FROM view_logs WHERE ts >= datetime('now','-7 days')"
          : 'SELECT COUNT(*) AS n FROM view_logs'
    );
    res.json({ period, total_views: Number(totalRow.rows[0].n), top: r.rows.map((x) => ({ item_id: x.item_id, name: x.name, views: Number(x.views) })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
