// Creates the schema (idempotent) and loads the Kadak Thane menu if empty.
//   Local:      node db/seed.js
//   Production:  set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN, then node db/seed.js
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@libsql/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.TURSO_DATABASE_URL || 'file:local.db';
const authToken = process.env.TURSO_AUTH_TOKEN;
const client = createClient(authToken ? { url, authToken } : { url });

async function main() {
  console.log('→ DB:', url.startsWith('file:') ? 'local SQLite' : 'Turso');
  await client.executeMultiple(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
  console.log('✓ schema ready');

  const have = await client.execute('SELECT COUNT(*) AS n FROM menu_items');
  if (Number(have.rows[0].n) > 0) {
    console.log(`• already has ${have.rows[0].n} items — leaving data as is.`);
    return;
  }

  const seed = JSON.parse(readFileSync(join(__dirname, 'seed-data.json'), 'utf8'));
  const r = seed.restaurant;
  await client.execute({
    sql: 'INSERT INTO restaurants (id, name, logo_url, theme_color, qr_slug, address, hours, tax_percent) VALUES (?,?,?,?,?,?,?,?)',
    args: [r.id, r.name, r.logo_url, r.theme_color, r.qr_slug, r.address, r.hours, r.tax_percent],
  });
  for (const c of seed.categories) {
    await client.execute({
      sql: 'INSERT INTO categories (id, restaurant_id, name, slug, world, sec_desc, display_order) VALUES (?,?,?,?,?,?,?)',
      args: [c.id, r.id, c.name, c.slug, c.world, c.sec_desc, c.display_order],
    });
  }
  for (const it of seed.items) {
    await client.execute({
      sql: `INSERT INTO menu_items (id, category_id, name, description, price, image_url, icon, color, is_available, is_veg, is_bestseller, is_new, is_signature, display_order)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [it.id, it.category_id, it.name, it.description, it.price, it.image_url, it.icon, it.color,
        it.is_available, it.is_veg, it.is_bestseller, it.is_new, it.is_signature, it.display_order],
    });
  }
  for (const v of seed.variants) {
    await client.execute({
      sql: 'INSERT INTO variants (id, item_id, name, price, display_order) VALUES (?,?,?,?,?)',
      args: [v.id, v.item_id, v.name, v.price, v.display_order],
    });
  }
  console.log(`✓ seeded ${seed.categories.length} categories, ${seed.items.length} items, ${seed.variants.length} variants`);
}
main().catch((e) => { console.error('seed failed:', e); process.exit(1); });
