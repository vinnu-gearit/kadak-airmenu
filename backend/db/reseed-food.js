// Replace the FOOD side of the menu with the current seed-data.json, leaving
// DRINKS completely untouched. Safe to run against a live Turso DB.
//
//   Local:      node db/reseed-food.js
//   Production: export TURSO_DATABASE_URL + TURSO_AUTH_TOKEN, then node db/reseed-food.js
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
  // make sure schema exists (no-op if already there)
  await client.executeMultiple(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));

  const seed = JSON.parse(readFileSync(join(__dirname, 'seed-data.json'), 'utf8'));
  const foodCats = seed.categories.filter((c) => c.world === 'food');
  const foodCatIds = new Set(foodCats.map((c) => c.id));
  const foodItems = seed.items.filter((it) => foodCatIds.has(it.category_id));
  const foodItemIds = new Set(foodItems.map((it) => it.id));
  const foodVars = seed.variants.filter((v) => foodItemIds.has(v.item_id));

  const before = await client.execute("SELECT (SELECT COUNT(*) FROM menu_items) AS items, (SELECT COUNT(*) FROM categories WHERE world='drinks') AS drink_cats");
  const drinkCatsBefore = Number(before.rows[0].drink_cats);

  // 1) delete ONLY existing food (variants → items → categories). Drinks are never referenced.
  await client.execute("DELETE FROM variants WHERE item_id IN (SELECT id FROM menu_items WHERE category_id IN (SELECT id FROM categories WHERE world='food'))");
  await client.execute("DELETE FROM menu_items WHERE category_id IN (SELECT id FROM categories WHERE world='food')");
  await client.execute("DELETE FROM categories WHERE world='food'");
  console.log('✓ old food cleared (drinks left untouched)');

  // 2) insert the new food from seed-data.json
  for (const c of foodCats) {
    await client.execute({
      sql: 'INSERT INTO categories (id, restaurant_id, name, slug, world, sec_desc, display_order) VALUES (?,?,?,?,?,?,?)',
      args: [c.id, 1, c.name, c.slug, c.world, c.sec_desc, c.display_order],
    });
  }
  for (const it of foodItems) {
    await client.execute({
      sql: `INSERT INTO menu_items (id, category_id, name, description, price, image_url, icon, color, is_available, is_veg, is_bestseller, is_new, is_signature, display_order)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [it.id, it.category_id, it.name, it.description, it.price, it.image_url, it.icon, it.color,
        it.is_available, it.is_veg, it.is_bestseller, it.is_new, it.is_signature, it.display_order],
    });
  }
  for (const v of foodVars) {
    await client.execute({
      sql: 'INSERT INTO variants (id, item_id, name, price, display_order) VALUES (?,?,?,?,?)',
      args: [v.id, v.item_id, v.name, v.price, v.display_order],
    });
  }

  const after = await client.execute("SELECT (SELECT COUNT(*) FROM categories WHERE world='drinks') AS drink_cats, (SELECT COUNT(*) FROM menu_items mi JOIN categories c ON c.id=mi.category_id WHERE c.world='drinks') AS drink_items");
  console.log(`✓ new food: ${foodCats.length} categories, ${foodItems.length} items, ${foodVars.length} variants`);
  console.log(`✓ drinks untouched: ${after.rows[0].drink_cats} categories (was ${drinkCatsBefore}), ${after.rows[0].drink_items} items`);
}
main().catch((e) => { console.error('reseed-food failed:', e); process.exit(1); });
