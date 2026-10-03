const crypto = require('node:crypto');
const { getDatabase, withTransaction } = require('../database');
const config = require('../config');

// Helper to compute HMAC-SHA256 signature
function computeSignature(payloadString, secret) {
  return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}

function handleCallback(headers, rawBody, body) {
  const signature = headers['x-signature'] || headers['X-Signature'];
  if (!signature) {
    return {
      status: 401,
      data: { error: 'Raqamli imzo (X-Signature sarlavhasi) kiritilmagan' }
    };
  }

  // 1. Verify HMAC-SHA256 Signature
  const expectedSignature = computeSignature(rawBody, config.PAYMENT_WEBHOOK_SECRET);
  const isValidSignature = (signature.length === expectedSignature.length) &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

  if (!isValidSignature) {
    return {
      status: 401,
      data: { error: 'Noto\'g\'ri raqamli imzo (Invalid webhook signature)' }
    };
  }

  const { order_number, transaction_id, amount, status: paymentStatus = 'SUCCESS' } = body || {};

  if (!order_number || !transaction_id || amount === undefined) {
    return {
      status: 400,
      data: { error: 'order_number, transaction_id va amount ko\'rsatilishi shart' }
    };
  }

  const db = getDatabase();

  // 2. IDEMPOTENCY CHECK: Check if this transaction_id was already processed
  const existingTransaction = db.prepare('SELECT id, order_id, status FROM payment_transactions WHERE transaction_id = ?').get(transaction_id);
  if (existingTransaction) {
    return {
      status: 200,
      data: {
        status: 'SUCCESS',
        message: 'Takroriy callback qabul qilindi. Ushbu tranzaksiya allaqachon muvaffaqiyatli qayta ishlangan.',
        is_duplicate: true,
        transaction_id
      }
    };
  }

  // 3. Process Payment and Order inside Transaction
  try {
    const result = withTransaction((tx) => {
      const order = tx.prepare(`
        SELECT id, order_number, warehouse_id, status, total_amount, reservation_expires_at
        FROM orders
        WHERE order_number = ?
      `).get(order_number);

      if (!order) {
        throw { httpStatus: 404, message: `Buyurtma topilmadi: ${order_number}` };
      }

      // 4. DUPLICATE ORDER STATUS CHECK: If already PAID
      if (order.status === 'PAID') {
        // Record duplicate attempt without affecting inventory or status
        tx.prepare(`
          INSERT INTO payment_transactions (order_id, provider, transaction_id, amount, status, signature, raw_payload)
          VALUES (?, 'MockPay', ?, ?, 'DUPLICATE_IGNORED', ?, ?)
        `).run(order.id, transaction_id, amount, signature, rawBody);

        return {
          status: 'SUCCESS',
          message: 'Buyurtma allaqachon to\'langan. Qoldiq qayta yechilmadi.',
          is_duplicate: true,
          order_number: order.order_number
        };
      }

      // 5. EXPIRED OR CANCELLED CHECK: Check reservation validity
      const now = new Date().toISOString();
      if (order.status === 'CANCELLED') {
        tx.prepare(`
          INSERT INTO payment_transactions (order_id, provider, transaction_id, amount, status, signature, raw_payload)
          VALUES (?, 'MockPay', ?, ?, 'FAILED', ?, ?)
        `).run(order.id, transaction_id, amount, signature, rawBody);

        throw {
          httpStatus: 400,
          message: 'To\'lov rad etildi: Buyurtma bekor qilingan.'
        };
      }

      if (order.status === 'EXPIRED' || (order.status === 'PENDING' && order.reservation_expires_at < now)) {
        // If it was pending but expired, release reserved stock and mark EXPIRED
        if (order.status === 'PENDING') {
          const items = tx.prepare('SELECT variant_id, quantity FROM order_items WHERE order_id = ?').all(order.id);
          for (const item of items) {
            tx.prepare(`
              UPDATE warehouse_stocks
              SET reserved_quantity = MAX(0, reserved_quantity - ?), updated_at = CURRENT_TIMESTAMP
              WHERE warehouse_id = ? AND variant_id = ?
            `).run(item.quantity, order.warehouse_id, item.variant_id);
          }
          tx.prepare('UPDATE orders SET status = "EXPIRED", updated_at = ? WHERE id = ?').run(now, order.id);
        }

        tx.prepare(`
          INSERT INTO payment_transactions (order_id, provider, transaction_id, amount, status, signature, raw_payload)
          VALUES (?, 'MockPay', ?, ?, 'FAILED', ?, ?)
        `).run(order.id, transaction_id, amount, signature, rawBody);

        throw {
          httpStatus: 400,
          message: 'To\'lov rad etildi: Rezerv muddati tugagan va mahsulot omborga qaytarilgan.'
        };
      }

      // 6. Check payment amount matches order total
      if (parseFloat(amount) < order.total_amount) {
        throw {
          httpStatus: 400,
          message: `To'lov summasi yetarli emas. Talab qilinadi: ${order.total_amount}, keldi: ${amount}`
        };
      }

      // 7. SUCCESSFUL PAYMENT:
      // Permanently deduct stock and clear reservation:
      // quantity = quantity - ordered_qty
      // reserved_quantity = reserved_quantity - ordered_qty
      const items = tx.prepare('SELECT variant_id, quantity FROM order_items WHERE order_id = ?').all(order.id);
      for (const item of items) {
        tx.prepare(`
          UPDATE warehouse_stocks
          SET 
            quantity = MAX(0, quantity - ?),
            reserved_quantity = MAX(0, reserved_quantity - ?),
            updated_at = CURRENT_TIMESTAMP
          WHERE warehouse_id = ? AND variant_id = ?
        `).run(item.quantity, item.quantity, order.warehouse_id, item.variant_id);
      }

      // Update Order to PAID
      tx.prepare(`
        UPDATE orders
        SET status = 'PAID', paid_at = ?, payment_ref = ?, updated_at = ?
        WHERE id = ?
      `).run(now, transaction_id, now, order.id);

      // Record successful payment transaction
      tx.prepare(`
        INSERT INTO payment_transactions (order_id, provider, transaction_id, amount, status, signature, raw_payload)
        VALUES (?, 'MockPay', ?, ?, 'SUCCESS', ?, ?)
      `).run(order.id, transaction_id, amount, signature, rawBody);

      return {
        status: 'SUCCESS',
        message: 'To\'lov muvaffaqiyatli qabul qilindi va ombor qoldig\'i uzil-kesil yangilandi',
        order_number: order.order_number,
        transaction_id,
        amount
      };
    });

    return { status: 200, data: result };
  } catch (error) {
    if (error && error.httpStatus) {
      return { status: error.httpStatus, data: { error: error.message } };
    }
    console.error('Payment callback error:', error);
    return { status: 500, data: { error: 'To\'lovni qayta ishlashda xatolik: ' + error.message } };
  }
}

// Helper to generate signed payload for testing/mocking
function generateMockPaymentPayload(orderNumber, amount, transactionId = null) {
  const txId = transactionId || `TX-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const payload = {
    order_number: orderNumber,
    transaction_id: txId,
    amount: amount,
    status: 'SUCCESS',
    timestamp: new Date().toISOString()
  };
  const rawBody = JSON.stringify(payload);
  const signature = computeSignature(rawBody, config.PAYMENT_WEBHOOK_SECRET);

  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': signature
    },
    rawBody,
    payload,
    signature
  };
}

module.exports = {
  handleCallback,
  computeSignature,
  generateMockPaymentPayload
};
