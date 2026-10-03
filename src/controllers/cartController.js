const { getDatabase } = require('../database');

function getOrCreateUserCart(db, userId) {
  let cart = db.prepare('SELECT id FROM carts WHERE user_id = ?').get(userId);
  if (!cart) {
    const result = db.prepare('INSERT INTO carts (user_id) VALUES (?)').run(userId);
    cart = { id: Number(result.lastInsertRowid) };
  }
  return cart.id;
}

function getCart(user) {
  if (!user) {
    return { status: 401, data: { error: 'Avtorizatsiyadan o\'tilmagan' } };
  }

  const db = getDatabase();
  const cartId = getOrCreateUserCart(db, user.id);

  const items = db.prepare(`
    SELECT 
      ci.id as cart_item_id,
      ci.quantity,
      ci.variant_id,
      pv.sku,
      pv.name as variant_name,
      pv.price as unit_price,
      p.id as product_id,
      p.name as product_name,
      p.max_purchase_limit,
      (ci.quantity * pv.price) as subtotal
    FROM cart_items ci
    JOIN product_variants pv ON pv.id = ci.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE ci.cart_id = ?
    ORDER BY ci.created_at DESC
  `).all(cartId);

  const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
  const totalItemsCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    status: 200,
    data: {
      cart_id: cartId,
      items_count: totalItemsCount,
      total_amount: totalAmount,
      currency: 'UZS',
      items
    }
  };
}

function addToCart(user, body) {
  if (!user) {
    return { status: 401, data: { error: 'Avtorizatsiyadan o\'tilmagan' } };
  }

  const { variant_id, quantity = 1 } = body || {};
  const qty = parseInt(quantity, 10);
  const variantId = parseInt(variant_id, 10);

  if (!variantId || isNaN(qty) || qty <= 0) {
    return { status: 400, data: { error: "Noto'g'ri variant yoki miqdor (musbat son bo'lishi kerak)" } };
  }

  const db = getDatabase();

  // Validate variant and product
  const variant = db.prepare(`
    SELECT pv.id, pv.name, pv.price, p.id as product_id, p.name as product_name, p.max_purchase_limit, p.is_active
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = ?
  `).get(variantId);

  if (!variant || !variant.is_active) {
    return { status: 404, data: { error: 'Mahsulot varianti topilmadi yoki faol emas' } };
  }

  const cartId = getOrCreateUserCart(db, user.id);

  // Check existing quantity of this product across all its variants in the cart
  const existingCartProducts = db.prepare(`
    SELECT COALESCE(SUM(ci.quantity), 0) as current_qty
    FROM cart_items ci
    JOIN product_variants pv ON pv.id = ci.variant_id
    WHERE ci.cart_id = ? AND pv.product_id = ?
  `).get(cartId, variant.product_id);

  const currentProductQtyInCart = existingCartProducts ? existingCartProducts.current_qty : 0;
  const newTotalQtyForProduct = currentProductQtyInCart + qty;

  // Enforce Max Purchase Limit (Jonli himoyadagi o'zgarishlar)
  if (newTotalQtyForProduct > variant.max_purchase_limit) {
    return {
      status: 400,
      data: {
        error: `Maksimal xarid miqdori cheklovi buzildi! "${variant.product_name}" mahsuloti uchun ruxsat etilgan maksimal miqdor: ${variant.max_purchase_limit} dona. Savatdagi: ${currentProductQtyInCart}, qo'shilayotgan: ${qty}.`,
        max_purchase_limit: variant.max_purchase_limit,
        current_in_cart: currentProductQtyInCart
      }
    };
  }

  // Insert or update cart item
  const existingItem = db.prepare('SELECT id, quantity FROM cart_items WHERE cart_id = ? AND variant_id = ?').get(cartId, variantId);

  if (existingItem) {
    db.prepare('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?').run(qty, existingItem.id);
  } else {
    db.prepare('INSERT INTO cart_items (cart_id, variant_id, quantity) VALUES (?, ?, ?)').run(cartId, variantId, qty);
  }

  return {
    status: 200,
    data: {
      message: 'Mahsulot savatga muvaffaqiyatli qo\'shildi',
      cart: getCart(user).data
    }
  };
}

function updateCartItem(user, cartItemId, body) {
  if (!user) {
    return { status: 401, data: { error: 'Avtorizatsiyadan o\'tilmagan' } };
  }

  const itemId = parseInt(cartItemId, 10);
  const qty = parseInt(body?.quantity, 10);

  if (!itemId || isNaN(qty) || qty <= 0) {
    return { status: 400, data: { error: "Noto'g'ri element ID yoki miqdor (kamida 1 dona bo'lishi kerak)" } };
  }

  const db = getDatabase();
  const cartId = getOrCreateUserCart(db, user.id);

  const cartItem = db.prepare(`
    SELECT ci.id, ci.quantity, ci.variant_id, pv.product_id, p.name as product_name, p.max_purchase_limit
    FROM cart_items ci
    JOIN product_variants pv ON pv.id = ci.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE ci.id = ? AND ci.cart_id = ?
  `).get(itemId, cartId);

  if (!cartItem) {
    return { status: 404, data: { error: 'Savatdagi mahsulot topilmadi' } };
  }

  // Calculate new total product qty in cart
  const otherVariantsQty = db.prepare(`
    SELECT COALESCE(SUM(ci.quantity), 0) as other_qty
    FROM cart_items ci
    JOIN product_variants pv ON pv.id = ci.variant_id
    WHERE ci.cart_id = ? AND pv.product_id = ? AND ci.id != ?
  `).get(cartId, cartItem.product_id, itemId);

  const newTotalProductQty = (otherVariantsQty ? otherVariantsQty.other_qty : 0) + qty;
  if (newTotalProductQty > cartItem.max_purchase_limit) {
    return {
      status: 400,
      data: {
        error: `Maksimal xarid miqdori cheklovi buzildi! "${cartItem.product_name}" uchun limit: ${cartItem.max_purchase_limit} dona.`,
        max_purchase_limit: cartItem.max_purchase_limit
      }
    };
  }

  db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(qty, itemId);

  return {
    status: 200,
    data: {
      message: 'Savat yangilandi',
      cart: getCart(user).data
    }
  };
}

function removeCartItem(user, cartItemId) {
  if (!user) {
    return { status: 401, data: { error: 'Avtorizatsiyadan o\'tilmagan' } };
  }

  const itemId = parseInt(cartItemId, 10);
  const db = getDatabase();
  const cartId = getOrCreateUserCart(db, user.id);

  const result = db.prepare('DELETE FROM cart_items WHERE id = ? AND cart_id = ?').run(itemId, cartId);
  if (result.changes === 0) {
    return { status: 404, data: { error: 'Savatdagi element topilmadi' } };
  }

  return {
    status: 200,
    data: {
      message: 'Mahsulot savatdan o\'chirildi',
      cart: getCart(user).data
    }
  };
}

function clearCart(user) {
  if (!user) {
    return { status: 401, data: { error: 'Avtorizatsiyadan o\'tilmagan' } };
  }

  const db = getDatabase();
  const cartId = getOrCreateUserCart(db, user.id);
  db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cartId);

  return {
    status: 200,
    data: {
      message: 'Savat tozalandi',
      cart: getCart(user).data
    }
  };
}

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart
};
