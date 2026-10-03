const crypto = require('node:crypto');
const { getDatabase, withTransaction } = require('../database');
const config = require('../config');

function generateOrderNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ORD-${dateStr}-${rand}`;
}

function createOrder(user, body) {
  if (!user) {
    return { status: 401, data: { error: 'Avtorizatsiyadan o\'tilmagan' } };
  }

  const { warehouse_id, items: customItems } = body || {};
  const warehouseId = parseInt(warehouse_id || '1', 10);

  const db = getDatabase();

  // Validate warehouse
  const warehouse = db.prepare('SELECT id, name, is_active FROM warehouses WHERE id = ?').get(warehouseId);
  if (!warehouse || !warehouse.is_active) {
    return { status: 400, data: { error: 'Ombor topilmadi yoki faol emas' } };
  }

  // Determine items to order (either from request body or from user cart)
  let itemsToOrder = [];
  if (Array.isArray(customItems) && customItems.length > 0) {
    itemsToOrder = customItems.map(i => ({
      variant_id: parseInt(i.variant_id, 10),
      quantity: parseInt(i.quantity, 10)
    }));
  } else {
    // Read from user cart
    const cart = db.prepare('SELECT id FROM carts WHERE user_id = ?').get(user.id);
    if (!cart) {
      return { status: 400, data: { error: 'Savat bo\'sh' } };
    }
    const cartItems = db.prepare('SELECT variant_id, quantity FROM cart_items WHERE cart_id = ?').all(cart.id);
    if (cartItems.length === 0) {
      return { status: 400, data: { error: 'Savat bo\'sh. Mahsulot qo\'shing yoki to\'g\'ridan-to\'g\'ri items yuboring' } };
    }
    itemsToOrder = cartItems;
  }

  // Validate item structure
  for (const item of itemsToOrder) {
    if (!item.variant_id || isNaN(item.quantity) || item.quantity <= 0) {
      return { status: 400, data: { error: 'Har bir element uchun variant_id va musbat quantity ko\'rsatilishi kerak' } };
    }
  }

  // ATOMIC TRANSACTION: Check stock, check max purchase limit, reserve stock, create order
  try {
    const newOrder = withTransaction((tx) => {
      // 1. Group items by product to enforce max_purchase_limit
      const productQtyMap = {};
      const variantDetails = [];

      for (const item of itemsToOrder) {
        const v = tx.prepare(`
          SELECT pv.id as variant_id, pv.product_id, pv.sku, pv.name as variant_name, pv.price,
                 p.name as product_name, p.max_purchase_limit, p.is_active
          FROM product_variants pv
          JOIN products p ON p.id = pv.product_id
          WHERE pv.id = ?
        `).get(item.variant_id);

        if (!v || !v.is_active) {
          throw { httpStatus: 404, message: `Variant #${item.variant_id} topilmadi yoki faol emas` };
        }

        productQtyMap[v.product_id] = (productQtyMap[v.product_id] || 0) + item.quantity;
        if (productQtyMap[v.product_id] > v.max_purchase_limit) {
          throw {
            httpStatus: 400,
            message: `Maksimal xarid miqdori oshib ketdi! "${v.product_name}" uchun cheklov: ${v.max_purchase_limit} dona. Buyurtma qilingan: ${productQtyMap[v.product_id]} dona.`
          };
        }

        variantDetails.push({
          ...v,
          requested_quantity: item.quantity
        });
      }

      // 2. Concurrency-safe Stock Verification and Reservation
      // Using SELECT ... for the target warehouse
      for (const item of variantDetails) {
        const stock = tx.prepare(`
          SELECT id, quantity, reserved_quantity
          FROM warehouse_stocks
          WHERE warehouse_id = ? AND variant_id = ?
        `).get(warehouseId, item.variant_id);

        const currentPhysical = stock ? stock.quantity : 0;
        const currentReserved = stock ? stock.reserved_quantity : 0;
        const availableStock = currentPhysical - currentReserved;

        if (availableStock < item.requested_quantity) {
          throw {
            httpStatus: 409, // Conflict: Concurrency stock exhaustion
            message: `Omborda yetarli mahsulot yo'q! Mahsulot: "${item.product_name} (${item.variant_name})", Mavjud qoldiq: ${Math.max(0, availableStock)}, So'ralgan: ${item.requested_quantity}`,
            variant_id: item.variant_id,
            available: Math.max(0, availableStock),
            requested: item.requested_quantity
          };
        }

        // Reserve the stock
        if (stock) {
          tx.prepare(`
            UPDATE warehouse_stocks
            SET reserved_quantity = reserved_quantity + ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(item.requested_quantity, stock.id);
        } else {
          // No stock row exists at all
          throw {
            httpStatus: 409,
            message: `Omborda mahsulot qoldig'i mavjud emas: ${item.variant_name}`
          };
        }
      }

      // 3. Calculate Total and Create Order
      let totalAmount = 0;
      for (const item of variantDetails) {
        totalAmount += item.price * item.requested_quantity;
      }

      const orderNumber = generateOrderNumber();
      const expiresAt = new Date(Date.now() + config.ORDER_RESERVATION_TTL_MINUTES * 60 * 1000).toISOString();

      const insertOrder = tx.prepare(`
        INSERT INTO orders (
          order_number, user_id, warehouse_id, status, total_amount, currency, reservation_expires_at
        ) VALUES (?, ?, ?, 'PENDING', ?, 'UZS', ?)
      `).run(orderNumber, user.id, warehouseId, totalAmount, expiresAt);

      const orderId = Number(insertOrder.lastInsertRowid);

      // 4. Save Order Items with Historical Price Snapshot (Narx nusxasi saqlansin)
      const insertOrderItem = tx.prepare(`
        INSERT INTO order_items (
          order_id, product_id, variant_id, product_name_snapshot, variant_name_snapshot,
          sku_snapshot, unit_price_snapshot, quantity, subtotal
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of variantDetails) {
        const subtotal = item.price * item.requested_quantity;
        insertOrderItem.run(
          orderId,
          item.product_id,
          item.variant_id,
          item.product_name,
          item.variant_name,
          item.sku,
          item.price, // Exact snapshot of price
          item.requested_quantity,
          subtotal
        );
      }

      // 5. Clear User Cart if items were ordered from cart
      const userCart = tx.prepare('SELECT id FROM carts WHERE user_id = ?').get(user.id);
      if (userCart) {
        tx.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(userCart.id);
      }

      return {
        id: orderId,
        order_number: orderNumber,
        status: 'PENDING',
        total_amount: totalAmount,
        currency: 'UZS',
        warehouse: { id: warehouse.id, name: warehouse.name },
        reservation_expires_at: expiresAt,
        items_count: variantDetails.length
      };
    });

    return {
      status: 201,
      data: {
        message: 'Buyurtma muvaffaqiyatli yaratildi va ombor qoldig\'i rezerv qilindi',
        order: newOrder
      }
    };
  } catch (error) {
    if (error && error.httpStatus) {
      return {
        status: error.httpStatus,
        data: {
          error: error.message,
          variant_id: error.variant_id,
          available: error.available,
          requested: error.requested
        }
      };
    }
    console.error('Order creation error:', error);
    return { status: 500, data: { error: 'Buyurtma yaratishda ichki xatolik yuz berdi: ' + error.message } };
  }
}

function getOrders(user, query = {}) {
  if (!user) {
    return { status: 401, data: { error: 'Avtorizatsiyadan o\'tilmagan' } };
  }

  const db = getDatabase();
  const page = Math.max(1, parseInt(query.page || '1', 10));
  const limit = Math.max(1, Math.min(100, parseInt(query.limit || '10', 10)));
  const offset = (page - 1) * limit;
  const statusFilter = query.status || null;

  let whereClauses = [];
  let params = [];

  // IDOR / Security check: Customers see ONLY their own orders
  if (user.role !== 'ADMIN') {
    whereClauses.push('o.user_id = ?');
    params.push(user.id);
  }

  if (statusFilter) {
    whereClauses.push('o.status = ?');
    params.push(statusFilter);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) as count FROM orders o ${whereSql}`).get(...params).count;

  const orders = db.prepare(`
    SELECT 
      o.id,
      o.order_number,
      o.user_id,
      u.full_name as customer_name,
      u.email as customer_email,
      o.warehouse_id,
      w.name as warehouse_name,
      o.status,
      o.total_amount,
      o.currency,
      o.reservation_expires_at,
      o.cancelled_at,
      o.paid_at,
      o.created_at
    FROM orders o
    JOIN users u ON u.id = o.user_id
    JOIN warehouses w ON w.id = o.warehouse_id
    ${whereSql}
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return {
    status: 200,
    data: {
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      orders
    }
  };
}

function getOrderById(orderId, user) {
  if (!user) {
    return { status: 401, data: { error: 'Avtorizatsiyadan o\'tilmagan' } };
  }

  const id = parseInt(orderId, 10);
  if (!id) {
    return { status: 400, data: { error: "Noto'g'ri buyurtma ID" } };
  }

  const db = getDatabase();
  const order = db.prepare(`
    SELECT 
      o.*,
      u.full_name as customer_name,
      u.email as customer_email,
      w.name as warehouse_name,
      w.location as warehouse_location
    FROM orders o
    JOIN users u ON u.id = o.user_id
    JOIN warehouses w ON w.id = o.warehouse_id
    WHERE o.id = ?
  `).get(id);

  if (!order) {
    return { status: 404, data: { error: 'Buyurtma topilmadi' } };
  }

  // IDOR PROTECTION: Boshqa buyurtmasi API orqali ochilmaydi
  if (order.user_id !== user.id && user.role !== 'ADMIN') {
    return {
      status: 403,
      data: { error: 'Ruxsat berilmagan! Boshqa mijozning buyurtmasini ko\'rish taqiqlanadi (IDOR himoyasi)' }
    };
  }

  // Fetch Order Items with Historical Price Snapshots
  const items = db.prepare(`
    SELECT 
      id,
      product_id,
      variant_id,
      product_name_snapshot,
      variant_name_snapshot,
      sku_snapshot,
      unit_price_snapshot,
      quantity,
      subtotal
    FROM order_items
    WHERE order_id = ?
  `).all(id);

  // Payment transactions
  const payments = db.prepare(`
    SELECT id, provider, transaction_id, amount, status, processed_at
    FROM payment_transactions
    WHERE order_id = ?
    ORDER BY processed_at DESC
  `).all(id);

  return {
    status: 200,
    data: {
      order: {
        ...order,
        items,
        payments
      }
    }
  };
}

// Single cancellation rule: "Faqat bir marta bekor qilish"
function cancelOrder(orderId, user) {
  if (!user) {
    return { status: 401, data: { error: 'Avtorizatsiyadan o\'tilmagan' } };
  }

  const id = parseInt(orderId, 10);
  if (!id) {
    return { status: 400, data: { error: "Noto'g'ri buyurtma ID" } };
  }

  const db = getDatabase();

  try {
    const updatedOrder = withTransaction((tx) => {
      const order = tx.prepare(`
        SELECT id, order_number, user_id, warehouse_id, status, reservation_expires_at
        FROM orders
        WHERE id = ?
      `).get(id);

      if (!order) {
        throw { httpStatus: 404, message: 'Buyurtma topilmadi' };
      }

      // Check ownership or admin
      if (order.user_id !== user.id && user.role !== 'ADMIN') {
        throw { httpStatus: 403, message: 'Faqat o\'z buyurtmangizni bekor qilishingiz mumkin' };
      }

      // RULE: Faqat bir marta bekor qilish (Single Cancellation Enforcement)
      if (order.status === 'CANCELLED') {
        throw {
          httpStatus: 400,
          message: 'Buyurtma allaqachon bekor qilingan! Faqat bir marta bekor qilish mumkin.'
        };
      }

      if (order.status === 'PAID') {
        throw {
          httpStatus: 400,
          message: 'To\'langan buyurtmani to\'g\'ridan-to\'g\'ri bekor qilib bo\'lmaydi (qaytarish tartibi talab etiladi).'
        };
      }

      if (order.status === 'EXPIRED') {
        throw {
          httpStatus: 400,
          message: 'Buyurtma to\'lov muddati o\'tib ketganligi sababli allaqachon bekor bo\'lgan.'
        };
      }

      // Status must be PENDING
      // Release reserved stock back to warehouse
      const items = tx.prepare('SELECT variant_id, quantity FROM order_items WHERE order_id = ?').all(id);

      for (const item of items) {
        tx.prepare(`
          UPDATE warehouse_stocks
          SET reserved_quantity = MAX(0, reserved_quantity - ?), updated_at = CURRENT_TIMESTAMP
          WHERE warehouse_id = ? AND variant_id = ?
        `).run(item.quantity, order.warehouse_id, item.variant_id);
      }

      // Mark order as CANCELLED with timestamp
      const now = new Date().toISOString();
      tx.prepare(`
        UPDATE orders
        SET status = 'CANCELLED', cancelled_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, id);

      return {
        id: order.id,
        order_number: order.order_number,
        status: 'CANCELLED',
        cancelled_at: now
      };
    });

    return {
      status: 200,
      data: {
        message: 'Buyurtma muvaffaqiyatli bekor qilindi va rezervdagi mahsulot omborga qaytarildi',
        order: updatedOrder
      }
    };
  } catch (error) {
    if (error && error.httpStatus) {
      return { status: error.httpStatus, data: { error: error.message } };
    }
    console.error('Cancel order error:', error);
    return { status: 500, data: { error: 'Buyurtmani bekor qilishda xatolik yuz berdi' } };
  }
}

// Background & On-Demand Order Expiry Cleaner
function cleanupExpiredOrders() {
  const db = getDatabase();
  const now = new Date().toISOString();

  let expiredCount = 0;

  try {
    withTransaction((tx) => {
      // Find all PENDING orders whose reservation has expired
      const expiredOrders = tx.prepare(`
        SELECT id, order_number, warehouse_id
        FROM orders
        WHERE status = 'PENDING' AND reservation_expires_at < ?
      `).all(now);

      for (const order of expiredOrders) {
        // Release reserved stock
        const items = tx.prepare('SELECT variant_id, quantity FROM order_items WHERE order_id = ?').all(order.id);
        for (const item of items) {
          tx.prepare(`
            UPDATE warehouse_stocks
            SET reserved_quantity = MAX(0, reserved_quantity - ?), updated_at = CURRENT_TIMESTAMP
            WHERE warehouse_id = ? AND variant_id = ?
          `).run(item.quantity, order.warehouse_id, item.variant_id);
        }

        // Update status to EXPIRED
        tx.prepare(`
          UPDATE orders
          SET status = 'EXPIRED', updated_at = ?
          WHERE id = ?
        `).run(now, order.id);

        expiredCount++;
      }
    });

    return {
      status: 200,
      data: {
        message: `${expiredCount} ta muddati tugagan buyurtma tozalandi va rezerv qoldiqlari qaytarildi`,
        expired_orders_count: expiredCount
      }
    };
  } catch (error) {
    console.error('Cleanup expired orders error:', error);
    return { status: 500, data: { error: 'Muddati tugagan buyurtmalarni tozalashda xatolik' } };
  }
}

module.exports = {
  createOrder,
  getOrders,
  getOrderById,
  cancelOrder,
  cleanupExpiredOrders
};
