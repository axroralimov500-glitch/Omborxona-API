const http = require('node:http');
const server = require('./src/server');
const config = require('./src/config');
const { getDatabase } = require('./src/database');
const paymentController = require('./src/controllers/paymentController');

// Test helper: HTTP request client
function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    if (payload) {
      defaultHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port: config.PORT,
      path,
      method,
      headers: defaultHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json
        });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m"
};

async function runTests() {
  console.log(`\n${colors.bold}${colors.cyan}================================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}   ELEKTRON SAVDO VA OMBOR API: RASMIY TEST TEKSHIRUV SINOVI    ${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}================================================================${colors.reset}\n`);

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  ${colors.green}✔ [O'TDI]${colors.reset} ${testName}`);
      passedCount++;
    } else {
      console.log(`  ${colors.red}✖ [XATO]${colors.reset} ${testName} ${details ? '- ' + details : ''}`);
      failedCount++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1: Authentication & RBAC Login
    // -------------------------------------------------------------
    console.log(`\n${colors.bold}1. AUTENTIFIKATSIYA VA ROLLAR (RBAC) SINOVI${colors.reset}`);
    
    // Admin login
    const adminLoginRes = await request('POST', '/api/auth/login', {
      email: 'admin@shop.uz',
      password: 'Admin123!'
    });
    assert(adminLoginRes.status === 200 && adminLoginRes.data.user.role === 'ADMIN', 'Admin tizimga kirdi va ADMIN roli tasdiqlandi');
    const adminToken = adminLoginRes.data.token;

    // Customer 1 login
    const cust1LoginRes = await request('POST', '/api/auth/login', {
      email: 'customer1@shop.uz',
      password: 'Customer123!'
    });
    assert(cust1LoginRes.status === 200 && cust1LoginRes.data.user.role === 'CUSTOMER', 'Customer 1 tizimga kirdi va CUSTOMER roli tasdiqlandi');
    const cust1Token = cust1LoginRes.data.token;

    // Customer 2 login
    const cust2LoginRes = await request('POST', '/api/auth/login', {
      email: 'customer2@shop.uz',
      password: 'Customer123!'
    });
    assert(cust2LoginRes.status === 200 && cust2LoginRes.data.user.role === 'CUSTOMER', 'Customer 2 tizimga kirdi va CUSTOMER roli tasdiqlandi');
    const cust2Token = cust2LoginRes.data.token;

    // -------------------------------------------------------------
    // Test 2: Catalog Filtering, Pagination, Sorting & Inventory Counts
    // -------------------------------------------------------------
    console.log(`\n${colors.bold}2. KATALOG, FILTRLAR, SARALASH VA QOLDIQ HISOBI SINOVI${colors.reset}`);
    
    const catalogRes = await request('GET', '/api/products?sort=price_asc&limit=5');
    assert(catalogRes.status === 200, 'Katalog API 200 OK qaytardi');
    assert(catalogRes.data.products.length > 0, 'Katalogda mahsulotlar mavjud');
    assert(catalogRes.data.pagination && catalogRes.data.pagination.total > 0, 'Sahifalash (pagination) metama\'lumotlari to\'g\'ri qaytdi');
    
    // Price sorting check
    const products = catalogRes.data.products;
    let isSortedAsc = true;
    for (let i = 0; i < products.length - 1; i++) {
      if (products[i].price_range.min > products[i + 1].price_range.min) {
        isSortedAsc = false;
        break;
      }
    }
    assert(isSortedAsc, 'Mahsulotlar narx bo\'yicha o\'sish tartibida saralangan (sort=price_asc)');

    // Category filter check
    const filterRes = await request('GET', '/api/products?category_id=1');
    assert(filterRes.status === 200 && filterRes.data.products.every(p => p.category && p.category.id === 1), 'Kategoriya bo\'yicha filtrlash to\'g\'ri ishladi');

    // -------------------------------------------------------------
    // Test 3: Concurrency Race Condition Test
    // Requirement: "Qo'ldiq 1 bo'lganda ikki parallel xaridning faqat bittasi rezerv oladi."
    // -------------------------------------------------------------
    console.log(`\n${colors.bold}3. PARALLEL XARID (CONCURRENCY RACE CONDITION) SINOVI${colors.reset}`);
    console.log(`  ${colors.yellow}ℹ Qoldig'i 1 ga teng bo'lgan Variant #2 uchun 2 ta parallel buyurtma so'rovi yuborilmoqda...${colors.reset}`);

    // Ensure Variant 2 has exactly quantity=1, reserved_quantity=0 in warehouse 1
    const db = getDatabase();
    db.prepare('UPDATE warehouse_stocks SET quantity = 1, reserved_quantity = 0 WHERE warehouse_id = 1 AND variant_id = 2').run();

    // Fire 2 parallel order creation requests simultaneously
    const orderPayload = {
      warehouse_id: 1,
      items: [{ variant_id: 2, quantity: 1 }]
    };

    const [res1, res2] = await Promise.all([
      request('POST', '/api/orders', orderPayload, { Authorization: `Bearer ${cust1Token}` }),
      request('POST', '/api/orders', orderPayload, { Authorization: `Bearer ${cust2Token}` })
    ]);

    const statuses = [res1.status, res2.status].sort();
    console.log(`  Parallel so'rov 1 natijasi: HTTP ${res1.status}`);
    console.log(`  Parallel so'rov 2 natijasi: HTTP ${res2.status}`);

    const hasOneSuccess = (res1.status === 201 && res2.status === 409) || (res1.status === 409 && res2.status === 201);
    assert(hasOneSuccess, 'Talab bajarildi: Ikki parallel xariddan FAQAT BITTASI 201 Created oldi, ikkinchisi 409 Conflict oldi');

    const winningOrder = res1.status === 201 ? res1.data.order : res2.data.order;
    assert(winningOrder && winningOrder.status === 'PENDING', 'G\'olib buyurtma PENDING holatida rezerv qilindi');

    // Check database stock state: physical quantity remains 1, reserved_quantity is 1, available = 0
    const stockAfterRace = db.prepare('SELECT quantity, reserved_quantity FROM warehouse_stocks WHERE warehouse_id = 1 AND variant_id = 2').get();
    assert(stockAfterRace.quantity === 1 && stockAfterRace.reserved_quantity === 1, 'Ombor qoldig\'i to\'g\'ri saqlandi: quantity=1, reserved=1, available=0');

    // -------------------------------------------------------------
    // Test 4: Price Snapshot Verification
    // Requirement: "Buyurtmada narx nusxasi saqlansin"
    // -------------------------------------------------------------
    console.log(`\n${colors.bold}4. TARIXIY NARX NUSXASI (PRICE SNAPSHOT) SINOVI${colors.reset}`);
    
    // Change variant price in admin catalog
    const originalPrice = 15200000;
    const alteredPrice = 22000000;
    db.prepare('UPDATE product_variants SET price = ? WHERE id = 2').run(alteredPrice);

    // Fetch winning order details
    const orderDetailRes = await request('GET', `/api/orders/${winningOrder.id}`, null, {
      Authorization: `Bearer ${res1.status === 201 ? cust1Token : cust2Token}`
    });
    
    const orderItem = orderDetailRes.data.order.items[0];
    assert(orderItem.unit_price_snapshot === originalPrice, `Mahsulot narxi o'zgarsa ham (${alteredPrice}), buyurtmadagi narx nusxasi (${orderItem.unit_price_snapshot}) o'zgarmas saqlandi`);

    // Restore original price
    db.prepare('UPDATE product_variants SET price = ? WHERE id = 2').run(originalPrice);

    // -------------------------------------------------------------
    // Test 5: IDOR Protection (Boshqa buyurtmasi ochilmaydi)
    // Requirement: "Boshqa buyurtmasi API orqali ochilmaydi."
    // -------------------------------------------------------------
    console.log(`\n${colors.bold}5. IDOR XAVFSIZLIGI SINOVI (Boshqa mijoz buyurtmasini ko'rish taqiqlanishi)${colors.reset}`);
    
    const ownerToken = res1.status === 201 ? cust1Token : cust2Token;
    const intruderToken = res1.status === 201 ? cust2Token : cust1Token;

    const idorRes = await request('GET', `/api/orders/${winningOrder.id}`, null, {
      Authorization: `Bearer ${intruderToken}`
    });
    assert(idorRes.status === 403, 'Boshqa mijoz buyurtmasini ochishga urinilganda HTTP 403 Forbidden qaytarildi');

    // Admin CAN view any order
    const adminViewRes = await request('GET', `/api/orders/${winningOrder.id}`, null, {
      Authorization: `Bearer ${adminToken}`
    });
    assert(adminViewRes.status === 200, 'Administrator barcha mijozlar buyurtmalarini ko\'ra oladi');

    // -------------------------------------------------------------
    // Test 6: Single Cancellation Rule ("Faqat bir marta bekor qilish")
    // Requirement: "Mijoz va administrator huquqlari; Faqat bir marta bekor qilish."
    // -------------------------------------------------------------
    console.log(`\n${colors.bold}6. BIR MARTALIK BEKOR QILISH SINOVI (Faqat bir marta bekor qilish)${colors.reset}`);

    // Create a new order to test cancellation
    const cancelTestOrderRes = await request('POST', '/api/orders', {
      warehouse_id: 1,
      items: [{ variant_id: 1, quantity: 1 }]
    }, { Authorization: `Bearer ${cust1Token}` });
    assert(cancelTestOrderRes.status === 201, 'Bekor qilish testi uchun buyurtma yaratildi');
    const cancelOrderId = cancelTestOrderRes.data.order.id;

    // First cancellation: Must SUCCEED (200 OK)
    const firstCancelRes = await request('POST', `/api/orders/${cancelOrderId}/cancel`, null, {
      Authorization: `Bearer ${cust1Token}`
    });
    assert(firstCancelRes.status === 200 && firstCancelRes.data.order.status === 'CANCELLED', '1-marta bekor qilish muvaffaqiyatli bajarildi va status CANCELLED bo\'ldi');

    // Second cancellation attempt: Must FAIL (400 Bad Request)
    const secondCancelRes = await request('POST', `/api/orders/${cancelOrderId}/cancel`, null, {
      Authorization: `Bearer ${cust1Token}`
    });
    assert(secondCancelRes.status === 400, '2-marta bekor qilish rad etildi (HTTP 400: Faqat bir marta bekor qilish mumkin)');

    // -------------------------------------------------------------
    // Test 7: Mock Payment Provider Callback, Signature & Idempotency
    // Requirement: "Soxta to'lov provayderi callbacki; imzo va takroriy callback rezerv muddati tugashi."
    // Requirement: "Takroriy callback to'lov yoki qoldiq o'chirishni yaratmaydi."
    // -------------------------------------------------------------
    console.log(`\n${colors.bold}7. SOXTA TO'LOV CALLBACKI, IMZO VA IDEMPOTENTLIK SINOVI${colors.reset}`);

    const txId = `TX-TEST-${Date.now()}`;
    const validCallbackData = paymentController.generateMockPaymentPayload(
      winningOrder.order_number,
      winningOrder.total_amount,
      txId
    );

    // 7.1: Invalid signature test (must return 401 Unauthorized)
    const invalidSigRes = await request('POST', '/api/payments/callback', validCallbackData.payload, {
      'X-Signature': 'invalid_forged_signature_hash_1234567890'
    });
    assert(invalidSigRes.status === 401, 'Soxta yoki noto\'g\'ri imzo bilan kelgan callback rad etildi (HTTP 401)');

    // 7.2: First valid callback (must return 200 and set order to PAID)
    const firstCallbackRes = await request('POST', '/api/payments/callback', validCallbackData.payload, {
      'X-Signature': validCallbackData.signature
    });
    assert(firstCallbackRes.status === 200 && firstCallbackRes.data.status === 'SUCCESS', 'Haqiqiy imzo bilan 1-callback muvaffaqiyatli qabul qilindi');

    // Check order status is now PAID
    const orderPaidCheck = db.prepare('SELECT status, payment_ref FROM orders WHERE id = ?').get(winningOrder.id);
    assert(orderPaidCheck.status === 'PAID' && orderPaidCheck.payment_ref === txId, 'Buyurtma statusi PAID ga o\'tdi va tranzaksiya raqami biriktirildi');

    // Stock check after successful payment: quantity decremented to 0, reserved cleared to 0
    const stockAfterPaid = db.prepare('SELECT quantity, reserved_quantity FROM warehouse_stocks WHERE warehouse_id = 1 AND variant_id = 2').get();
    assert(stockAfterPaid.quantity === 0 && stockAfterPaid.reserved_quantity === 0, 'To\'lovdan keyin ombor qoldig\'i uzil-kesil yechildi (quantity=0, reserved=0)');

    // 7.3: Duplicate callback test (Idempotency)
    // Requirement: "Takroriy callback to'lov yoki qoldiq o'chirishni yaratmaydi."
    const duplicateCallbackRes = await request('POST', '/api/payments/callback', validCallbackData.payload, {
      'X-Signature': validCallbackData.signature
    });
    assert(duplicateCallbackRes.status === 200 && duplicateCallbackRes.data.is_duplicate === true, 'Takroriy callback qabul qilindi va is_duplicate=true deb qaytdi');

    // Stock check after duplicate callback: MUST STILL BE quantity=0, reserved=0 (NO double deduction!)
    const stockAfterDup = db.prepare('SELECT quantity, reserved_quantity FROM warehouse_stocks WHERE warehouse_id = 1 AND variant_id = 2').get();
    assert(stockAfterDup.quantity === 0 && stockAfterDup.reserved_quantity === 0, 'Takroriy callback ombor qoldig\'ini qayta yechmadi (Idempotentlik himoyalangan)');

    // -------------------------------------------------------------
    // Test 8: Live Defense Requirement - Maximum Purchase Limit
    // Requirement: "Bir mahsulotga maksimal xarid miqdorini qo'shing."
    // -------------------------------------------------------------
    console.log(`\n${colors.bold}8. JONLI HIMOYADAGI O'ZGARISHLAR: MAKSIMAL XARID MIQDORI SINOVI${colors.reset}`);
    
    // Product 1 (iPhone 15 Pro) has max_purchase_limit = 2
    // Customer attempts to order 3 units -> Must be REJECTED (HTTP 400)
    const exceedLimitRes = await request('POST', '/api/orders', {
      warehouse_id: 1,
      items: [{ variant_id: 1, quantity: 3 }] // limit is 2
    }, { Authorization: `Bearer ${cust1Token}` });
    assert(exceedLimitRes.status === 400, 'Maksimal xarid miqdori oshirilganda (limit=2, so\'ralgan=3) buyurtma rad etildi (HTTP 400)');

    // Customer attempts to order 2 units -> Must be ACCEPTED (HTTP 201)
    const validLimitRes = await request('POST', '/api/orders', {
      warehouse_id: 1,
      items: [{ variant_id: 1, quantity: 2 }]
    }, { Authorization: `Bearer ${cust1Token}` });
    assert(validLimitRes.status === 201, 'Maksimal xarid miqdori doirasida (limit=2, so\'ralgan=2) buyurtma muvaffaqiyatli qabul qilindi (HTTP 201)');

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log(`\n${colors.bold}================================================================${colors.reset}`);
    console.log(`${colors.bold}TEST NATIJALARI YAKUNI:${colors.reset}`);
    console.log(`  O'tgan testlar soni:  ${colors.green}${passedCount}${colors.reset}`);
    console.log(`  Xato testlar soni:    ${failedCount === 0 ? colors.green : colors.red}${failedCount}${colors.reset}`);
    console.log(`  Muvaffaqiyat darajasi: ${colors.bold}${Math.round((passedCount / (passedCount + failedCount)) * 100)}%${colors.reset}`);
    console.log(`${colors.bold}================================================================${colors.reset}\n`);

    if (failedCount === 0) {
      console.log(`${colors.bold}${colors.green}🎉 BARCHA MAJBURIY TALABLAR 100% TO'LIQ VA MUOFFAQIYATLI BAJARILDI!${colors.reset}\n`);
    }

  } catch (err) {
    console.error('Test execution error:', err);
    failedCount++;
  } finally {
    // Terminate server after tests
    process.exit(failedCount > 0 ? 1 : 0);
  }
}

// Give server 500ms to bind port then run
setTimeout(runTests, 500);
