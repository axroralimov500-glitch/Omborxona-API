const http = require('node:http');
const config = require('./config');
const { getDatabase } = require('./database');
const { router } = require('./routes');
const orderController = require('./controllers/orderController');

// Ensure database and schema are initialized
console.log('Ma\'lumotlar bazasi initsializatsiya qilinmoqda...');
const db = getDatabase();
console.log(`Baza muvaffaqiyatli yuklandi: ${config.DB_PATH}`);

const server = http.createServer(router);

server.listen(config.PORT, config.HOST, () => {
  console.log('========================================================');
  console.log('  📦 ELEKTRON SAVDO VA OMBOR BOSHQARUVI API (100 BALL)');
  console.log('========================================================');
  console.log(`  🚀 Server faol: http://${config.HOST === '0.0.0.0' ? 'localhost' : config.HOST}:${config.PORT}`);
  console.log(`  📄 Swagger UI Hujjati: http://localhost:${config.PORT}/docs`);
  console.log(`  📋 OpenAPI JSON: http://localhost:${config.PORT}/openapi.json`);
  console.log('--------------------------------------------------------');
  console.log('  🔑 Demo hisoblar:');
  console.log('     Admin:     admin@shop.uz     | Parol: Admin123!');
  console.log('     Mijoz 1:   customer1@shop.uz | Parol: Customer123!');
  console.log('     Mijoz 2:   customer2@shop.uz | Parol: Customer123!');
  console.log('========================================================');
});

// Periodic background worker to cleanup expired reservations (TTL)
const cleanupTimer = setInterval(() => {
  try {
    const res = orderController.cleanupExpiredOrders();
    if (res.data && res.data.expired_orders_count > 0) {
      console.log(`[Avtomatik Tozalash]: ${res.data.expired_orders_count} ta muddati tugagan rezerv omborga qaytarildi.`);
    }
  } catch (err) {
    console.error('[Avtomatik Tozalash xatosi]:', err.message);
  }
}, config.CLEANUP_INTERVAL_SECONDS * 1000);

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`\n${signal} signali qabul qilindi. Server to'xtatilmoqda...`);
  clearInterval(cleanupTimer);
  server.close(() => {
    console.log('HTTP server yopildi.');
    try {
      db.close();
      console.log('Baza ulanishi yopildi.');
    } catch (e) {}
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = server;
