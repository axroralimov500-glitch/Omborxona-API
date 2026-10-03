const { getDatabase } = require('../database');

function createCategory(user, body) {
  if (!user || user.role !== 'ADMIN') {
    return { status: 403, data: { error: 'Faqat administratorlar kategoriya qo\'sha oladi' } };
  }

  const { name, slug } = body || {};
  if (!name) {
    return { status: 400, data: { error: 'Kategoriya nomi kiritilishi shart' } };
  }

  const cleanSlug = (slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const db = getDatabase();

  try {
    const result = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(name.trim(), cleanSlug);
    return {
      status: 201,
      data: {
        message: 'Kategoriya yaratildi',
        category: { id: Number(result.lastInsertRowid), name: name.trim(), slug: cleanSlug }
      }
    };
  } catch (err) {
    return { status: 409, data: { error: 'Bunday slug bilan kategoriya allaqachon mavjud' } };
  }
}

function createProduct(user, body) {
  if (!user || user.role !== 'ADMIN') {
    return { status: 403, data: { error: 'Faqat administratorlar mahsulot qo\'sha oladi' } };
  }

  const { category_id, name, description, max_purchase_limit = 5, is_active = 1 } = body || {};
  if (!name) {
    return { status: 400, data: { error: 'Mahsulot nomi kiritilishi shart' } };
  }

  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO products (category_id, name, description, max_purchase_limit, is_active)
    VALUES (?, ?, ?, ?, ?)
  `).run(category_id || null, name.trim(), description || '', parseInt(max_purchase_limit, 10), is_active ? 1 : 0);

  const productId = Number(result.lastInsertRowid);
  const newProduct = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);

  return {
    status: 201,
    data: {
      message: 'Mahsulot muvaffaqiyatli yaratildi',
      product: newProduct
    }
  };
}

function updateProduct(user, productId, body) {
  if (!user || user.role !== 'ADMIN') {
    return { status: 403, data: { error: 'Faqat administratorlar mahsulotni tahrirlashi mumkin' } };
  }

  const id = parseInt(productId, 10);
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) {
    return { status: 404, data: { error: 'Mahsulot topilmadi' } };
  }

  const name = body.name !== undefined ? body.name : existing.name;
  const description = body.description !== undefined ? body.description : existing.description;
  const category_id = body.category_id !== undefined ? body.category_id : existing.category_id;
  const max_purchase_limit = body.max_purchase_limit !== undefined ? parseInt(body.max_purchase_limit, 10) : existing.max_purchase_limit;
  const is_active = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;

  db.prepare(`
    UPDATE products
    SET name = ?, description = ?, category_id = ?, max_purchase_limit = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(name, description, category_id, max_purchase_limit, is_active, id);

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id);

  return {
    status: 200,
    data: {
      message: 'Mahsulot muvaffaqiyatli yangilandi',
      product: updated
    }
  };
}

function createVariant(user, productId, body) {
  if (!user || user.role !== 'ADMIN') {
    return { status: 403, data: { error: 'Faqat administratorlar variant qo\'sha oladi' } };
  }

  const pId = parseInt(productId, 10);
  const { sku, name, price } = body || {};

  if (!sku || !name || price === undefined) {
    return { status: 400, data: { error: 'sku, name va price kiritilishi shart' } };
  }

  const db = getDatabase();
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(pId);
  if (!product) {
    return { status: 404, data: { error: 'Mahsulot topilmadi' } };
  }

  try {
    const result = db.prepare(`
      INSERT INTO product_variants (product_id, sku, name, price)
      VALUES (?, ?, ?, ?)
    `).run(pId, sku.trim().toUpperCase(), name.trim(), parseFloat(price));

    return {
      status: 201,
      data: {
        message: 'Variant muvaffaqiyatli yaratildi',
        variant: { id: Number(result.lastInsertRowid), product_id: pId, sku, name, price }
      }
    };
  } catch (err) {
    return { status: 409, data: { error: 'Ushbu SKU bilan variant allaqachon mavjud' } };
  }
}

function createWarehouse(user, body) {
  if (!user || user.role !== 'ADMIN') {
    return { status: 403, data: { error: 'Faqat administratorlar ombor qo\'sha oladi' } };
  }

  const { name, location } = body || {};
  if (!name || !location) {
    return { status: 400, data: { error: 'Ombor nomi va manzili kiritilishi shart' } };
  }

  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO warehouses (name, location)
    VALUES (?, ?)
  `).run(name.trim(), location.trim());

  return {
    status: 201,
    data: {
      message: 'Ombor muvaffaqiyatli yaratildi',
      warehouse: { id: Number(result.lastInsertRowid), name, location }
    }
  };
}

function replenishStock(user, body) {
  if (!user || user.role !== 'ADMIN') {
    return { status: 403, data: { error: 'Faqat administratorlar qoldiqni to\'ldirishi mumkin' } };
  }

  const { warehouse_id, variant_id, quantity } = body || {};
  const warehouseId = parseInt(warehouse_id, 10);
  const variantId = parseInt(variant_id, 10);
  const qty = parseInt(quantity, 10);

  if (!warehouseId || !variantId || isNaN(qty) || qty <= 0) {
    return { status: 400, data: { error: 'warehouse_id, variant_id va musbat quantity kiritilishi shart' } };
  }

  const db = getDatabase();

  // Check warehouse and variant existence
  const wh = db.prepare('SELECT id, name FROM warehouses WHERE id = ?').get(warehouseId);
  if (!wh) return { status: 404, data: { error: 'Ombor topilmadi' } };

  const vr = db.prepare('SELECT id, name, sku FROM product_variants WHERE id = ?').get(variantId);
  if (!vr) return { status: 404, data: { error: 'Variant topilmadi' } };

  const existingStock = db.prepare(`
    SELECT id, quantity, reserved_quantity
    FROM warehouse_stocks
    WHERE warehouse_id = ? AND variant_id = ?
  `).get(warehouseId, variantId);

  if (existingStock) {
    db.prepare(`
      UPDATE warehouse_stocks
      SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(qty, existingStock.id);
  } else {
    db.prepare(`
      INSERT INTO warehouse_stocks (warehouse_id, variant_id, quantity, reserved_quantity)
      VALUES (?, ?, ?, 0)
    `).run(warehouseId, variantId, qty);
  }

  const updatedStock = db.prepare(`
    SELECT ws.*, w.name as warehouse_name, pv.name as variant_name
    FROM warehouse_stocks ws
    JOIN warehouses w ON w.id = ws.warehouse_id
    JOIN product_variants pv ON pv.id = ws.variant_id
    WHERE ws.warehouse_id = ? AND ws.variant_id = ?
  `).get(warehouseId, variantId);

  return {
    status: 200,
    data: {
      message: 'Ombor qoldig\'i muvaffaqiyatli to\'ldirildi',
      stock: {
        warehouse_id: updatedStock.warehouse_id,
        warehouse_name: updatedStock.warehouse_name,
        variant_id: updatedStock.variant_id,
        variant_name: updatedStock.variant_name,
        total_physical: updatedStock.quantity,
        reserved: updatedStock.reserved_quantity,
        available: updatedStock.quantity - updatedStock.reserved_quantity
      }
    }
  };
}

function getDashboardStats(user) {
  if (!user || user.role !== 'ADMIN') {
    return { status: 403, data: { error: 'Faqat administratorlar statistikalarni ko\'ra oladi' } };
  }

  const db = getDatabase();

  const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  const totalVariants = db.prepare('SELECT COUNT(*) as count FROM product_variants').get().count;
  const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  const paidOrders = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue FROM orders WHERE status = 'PAID'").get();
  const pendingOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'PENDING'").get().count;
  const cancelledOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'CANCELLED'").get().count;
  const expiredOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'EXPIRED'").get().count;

  const totalPhysicalStock = db.prepare('SELECT COALESCE(SUM(quantity), 0) as total, COALESCE(SUM(reserved_quantity), 0) as reserved FROM warehouse_stocks').get();

  return {
    status: 200,
    data: {
      overview: {
        products_count: totalProducts,
        variants_count: totalVariants,
        orders: {
          total: totalOrders,
          paid: paidOrders.count,
          pending: pendingOrders,
          cancelled: cancelledOrders,
          expired: expiredOrders,
          total_revenue: paidOrders.revenue,
          currency: 'UZS'
        },
        stock: {
          total_physical: totalPhysicalStock.total,
          total_reserved: totalPhysicalStock.reserved,
          total_available: totalPhysicalStock.total - totalPhysicalStock.reserved
        }
      }
    }
  };
}

module.exports = {
  createCategory,
  createProduct,
  updateProduct,
  createVariant,
  createWarehouse,
  replenishStock,
  getDashboardStats
};
