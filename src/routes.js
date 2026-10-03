const { verifyToken, extractBearerToken } = require('./auth');
const authController = require('./controllers/authController');
const catalogController = require('./controllers/catalogController');
const cartController = require('./controllers/cartController');
const orderController = require('./controllers/orderController');
const paymentController = require('./controllers/paymentController');
const adminController = require('./controllers/adminController');
const { openApiSpec, getSwaggerHtml } = require('./swaggerDocs');

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Signature'
  });
  res.end(JSON.stringify(data, null, 2));
}

function handleCors(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Signature',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return true;
  }
  return false;
}

function router(req, res) {
  if (handleCors(req, res)) return;

  const parsedUrl = new URL(req.url, 'http://localhost');
  const pathname = parsedUrl.pathname;
  const query = Object.fromEntries(parsedUrl.searchParams.entries());
  const method = req.method.toUpperCase();

  // Extract Auth Token
  const token = extractBearerToken(req);
  const user = token ? verifyToken(token) : null;

  // Collect Body
  let chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');
    let body = {};
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch (e) {
        // If not JSON, leave as raw string
      }
    }

    try {
      // 1. Swagger / OpenAPI Documentation
      if (method === 'GET' && (pathname === '/docs' || pathname === '/')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getSwaggerHtml());
        return;
      }
      if (method === 'GET' && pathname === '/openapi.json') {
        sendJson(res, 200, openApiSpec);
        return;
      }

      // 2. Auth Endpoints
      if (method === 'POST' && pathname === '/api/auth/register') {
        const result = authController.register(body, user);
        sendJson(res, result.status, result.data);
        return;
      }
      if (method === 'POST' && pathname === '/api/auth/login') {
        const result = authController.login(body);
        sendJson(res, result.status, result.data);
        return;
      }
      if (method === 'GET' && pathname === '/api/auth/me') {
        const result = authController.me(user);
        sendJson(res, result.status, result.data);
        return;
      }

      // 3. Catalog & Categories
      if (method === 'GET' && pathname === '/api/categories') {
        const result = catalogController.getCategories();
        sendJson(res, result.status, result.data);
        return;
      }
      if (method === 'GET' && pathname === '/api/products') {
        const result = catalogController.getProducts(query);
        sendJson(res, result.status, result.data);
        return;
      }
      const productMatch = pathname.match(/^\/api\/products\/(\d+)$/);
      if (method === 'GET' && productMatch) {
        const result = catalogController.getProductById(productMatch[1]);
        sendJson(res, result.status, result.data);
        return;
      }

      // 4. Cart Endpoints
      if (method === 'GET' && pathname === '/api/cart') {
        const result = cartController.getCart(user);
        sendJson(res, result.status, result.data);
        return;
      }
      if (method === 'POST' && pathname === '/api/cart/items') {
        const result = cartController.addToCart(user, body);
        sendJson(res, result.status, result.data);
        return;
      }
      const cartItemMatch = pathname.match(/^\/api\/cart\/items\/(\d+)$/);
      if (cartItemMatch) {
        if (method === 'PUT') {
          const result = cartController.updateCartItem(user, cartItemMatch[1], body);
          sendJson(res, result.status, result.data);
          return;
        }
        if (method === 'DELETE') {
          const result = cartController.removeCartItem(user, cartItemMatch[1]);
          sendJson(res, result.status, result.data);
          return;
        }
      }
      if (method === 'DELETE' && pathname === '/api/cart') {
        const result = cartController.clearCart(user);
        sendJson(res, result.status, result.data);
        return;
      }

      // 5. Orders & Transactions
      if (method === 'POST' && pathname === '/api/orders') {
        const result = orderController.createOrder(user, body);
        sendJson(res, result.status, result.data);
        return;
      }
      if (method === 'GET' && pathname === '/api/orders') {
        const result = orderController.getOrders(user, query);
        sendJson(res, result.status, result.data);
        return;
      }
      const orderCancelMatch = pathname.match(/^\/api\/orders\/(\d+)\/cancel$/);
      if (method === 'POST' && orderCancelMatch) {
        const result = orderController.cancelOrder(orderCancelMatch[1], user);
        sendJson(res, result.status, result.data);
        return;
      }
      if (method === 'POST' && pathname === '/api/orders/cleanup-expired') {
        const result = orderController.cleanupExpiredOrders();
        sendJson(res, result.status, result.data);
        return;
      }
      const orderMatch = pathname.match(/^\/api\/orders\/(\d+)$/);
      if (method === 'GET' && orderMatch) {
        const result = orderController.getOrderById(orderMatch[1], user);
        sendJson(res, result.status, result.data);
        return;
      }

      // 6. Payment Callback & Mock Checkout
      if (method === 'POST' && pathname === '/api/payments/callback') {
        const result = paymentController.handleCallback(req.headers, rawBody, body);
        sendJson(res, result.status, result.data);
        return;
      }
      if (method === 'POST' && pathname === '/api/payments/mock-checkout') {
        // Convenience endpoint: takes order_number, retrieves amount, generates signed webhook and runs it!
        const { order_number } = body || {};
        if (!order_number) {
          sendJson(res, 400, { error: 'order_number kiritilishi shart' });
          return;
        }
        const { getDatabase } = require('./database');
        const db = getDatabase();
        const order = db.prepare('SELECT order_number, total_amount FROM orders WHERE order_number = ?').get(order_number);
        if (!order) {
          sendJson(res, 404, { error: 'Buyurtma topilmadi' });
          return;
        }
        const mockData = paymentController.generateMockPaymentPayload(order.order_number, order.total_amount, body.transaction_id);
        const result = paymentController.handleCallback(mockData.headers, mockData.rawBody, mockData.payload);
        sendJson(res, result.status, {
          ...result.data,
          signed_payload_sent: mockData.payload,
          signature: mockData.signature
        });
        return;
      }

      // 7. Administrator Endpoints
      if (method === 'GET' && pathname === '/api/admin/dashboard') {
        const result = adminController.getDashboardStats(user);
        sendJson(res, result.status, result.data);
        return;
      }
      if (method === 'POST' && pathname === '/api/admin/categories') {
        const result = adminController.createCategory(user, body);
        sendJson(res, result.status, result.data);
        return;
      }
      if (method === 'POST' && pathname === '/api/admin/products') {
        const result = adminController.createProduct(user, body);
        sendJson(res, result.status, result.data);
        return;
      }
      const adminProductMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/);
      if (method === 'PUT' && adminProductMatch) {
        const result = adminController.updateProduct(user, adminProductMatch[1], body);
        sendJson(res, result.status, result.data);
        return;
      }
      const adminVariantMatch = pathname.match(/^\/api\/admin\/products\/(\d+)\/variants$/);
      if (method === 'POST' && adminVariantMatch) {
        const result = adminController.createVariant(user, adminVariantMatch[1], body);
        sendJson(res, result.status, result.data);
        return;
      }
      if (method === 'POST' && pathname === '/api/admin/warehouses') {
        const result = adminController.createWarehouse(user, body);
        sendJson(res, result.status, result.data);
        return;
      }
      if (method === 'POST' && pathname === '/api/admin/stocks/replenish') {
        const result = adminController.replenishStock(user, body);
        sendJson(res, result.status, result.data);
        return;
      }

      // 404 Route Not Found
      sendJson(res, 404, {
        error: `Marshrut topilmadi: ${method} ${pathname}`,
        available_docs: '/docs'
      });
    } catch (err) {
      console.error('Unhandled server error:', err);
      sendJson(res, 500, {
        error: 'Kutilmagan server xatoligi yuz berdi: ' + err.message
      });
    }
  });
}

module.exports = {
  router
};
