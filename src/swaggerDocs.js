const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Elektron Savdo va Ombor API (E-Commerce & Warehouse Concurrency Management)",
    version: "1.0.0",
    description: `
**Maksimal to'p: 100 balllik baholash tizimi bo'yicha to'liq ishlab chiqilgan API.**

### Asosiy xususiyatlar:
1. **Parallel Xarid Concurrency Himoyasi:** Omborda qoldiq 1 dona bo'lganda, bir vaqtda kelgan parallel so'rovlardan faqat bittasi buyurtma va rezerv oladi (\`BEGIN IMMEDIATE\` ACID tranzaksiyasi).
2. **Narx Nusxasi (Price Snapshot):** Mahsulot narxi keyinchalik o'zgarsa ham, buyurtma qilingan paytdagi tarixiy narx o'zgarmas saqlanadi.
3. **Soxta To'lov Provayderi Callbacki:** HMAC-SHA256 imzosi tekshiriladi (\`X-Signature\`). Takroriy (idempotent) callbacklar hisobni ikki marta yechmaydi yoki qoldiqni o'zgartirmaydi.
4. **Rezerv Muddati (TTL):** To'lanmagan buyurtmalar muddati tugagach, rezerv qoldig'i avtomatik omborga qaytariladi.
5. **Rollar va Huquqlar (RBAC):** Mijoz (Customer) va Administrator huquqlari server darajasida tekshiriladi. Boshqa mijozning buyurtmasi IDOR himoyasi tufayli ochilmaydi (\`403 Forbidden\`).
6. **Bir Martalik Bekor Qilish:** Buyurtma faqat bir marta bekor qilinadi. Qayta bekor qilishga ruxsat berilmaydi.
7. **Jonli himoyadagi o'zgarishlar:** Har bir mahsulot bo'yicha maksimal xarid miqdori (\`max_purchase_limit\`) joriy etilgan.

### Demo Hisoblar:
* **Admin:** \`admin@shop.uz\` / \`Admin123!\`
* **Mijoz 1:** \`customer1@shop.uz\` / \`Customer123!\`
* **Mijoz 2:** \`customer2@shop.uz\` / \`Customer123!\`
    `
  },
  servers: [
    { url: "http://localhost:3000", description: "Lokal server" }
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Tizimga kirishdan keyin olingan Bearer token"
      }
    }
  },
  paths: {
    "/api/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Yangi mijozni ro'yxatdan o'tkazish",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password", "full_name"],
                properties: {
                  email: { type: "string", example: "yangi_mijoz@shop.uz" },
                  password: { type: "string", example: "Parol123!" },
                  full_name: { type: "string", example: "Sardor Rahimov" }
                }
              }
            }
          }
        },
        responses: { 201: { description: "Ro'yxatdan o'tildi" } }
      }
    },
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Tizimga kirish va token olish",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", example: "customer1@shop.uz" },
                  password: { type: "string", example: "Customer123!" }
                }
              }
            }
          }
        },
        responses: { 200: { description: "Muvaffaqiyatli kirildi" } }
      }
    },
    "/api/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Joriy foydalanuvchi ma'lumotlari",
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: "Profil" } }
      }
    },
    "/api/categories": {
      get: {
        tags: ["Katalog"],
        summary: "Kategoriyalar ro'yxatini olish",
        responses: { 200: { description: "Kategoriyalar" } }
      }
    },
    "/api/products": {
      get: {
        tags: ["Katalog"],
        summary: "Mahsulotlar katalogi (filtrlash, saralash, sahifalash va qoldiq hisobi)",
        parameters: [
          { name: "category_id", in: "query", schema: { type: "integer" }, description: "Kategoriya ID bo'yicha filtr" },
          { name: "category", in: "query", schema: { type: "string" }, description: "Kategoriya slug bo'yicha filtr" },
          { name: "sort", in: "query", schema: { type: "string", enum: ["price_asc", "price_desc", "name_asc", "newest"] }, description: "Saralash tartibi" },
          { name: "search", in: "query", schema: { type: "string" }, description: "Nom yoki SKU bo'yicha qidiruv" },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } }
        ],
        responses: { 200: { description: "Mahsulotlar ro'yxati va ombor qoldig'i hisobi" } }
      }
    },
    "/api/products/{id}": {
      get: {
        tags: ["Katalog"],
        summary: "Mahsulot batafsil ma'lumoti va omborlar kesimidagi qoldiqlar",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } }
        ],
        responses: { 200: { description: "Mahsulot tafsiloti" } }
      }
    },
    "/api/cart": {
      get: {
        tags: ["Savat"],
        summary: "Foydalanuvchi savatini ko'rish",
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: "Savat ma'lumotlari" } }
      },
      delete: {
        tags: ["Savat"],
        summary: "Savatni tozalash",
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: "Savat tozalandi" } }
      }
    },
    "/api/cart/items": {
      post: {
        tags: ["Savat"],
        summary: "Savatga mahsulot qo'shish (Maksimal xarid miqdori tekshiriladi)",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["variant_id", "quantity"],
                properties: {
                  variant_id: { type: "integer", example: 1 },
                  quantity: { type: "integer", example: 1 }
                }
              }
            }
          }
        },
        responses: {
          200: { description: "Qo'shildi" },
          400: { description: "Maksimal xarid miqdori cheklovi buzildi" }
        }
      }
    },
    "/api/cart/items/{id}": {
      put: {
        tags: ["Savat"],
        summary: "Savatdagi mahsulot miqdorini o'zgartirish",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["quantity"],
                properties: { quantity: { type: "integer", example: 2 } }
              }
            }
          }
        },
        responses: { 200: { description: "Yangilandi" } }
      },
      delete: {
        tags: ["Savat"],
        summary: "Savatdan elementni o'chirish",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "O'chirildi" } }
      }
    },
    "/api/orders": {
      post: {
        tags: ["Buyurtma va Tranzaksiya"],
        summary: "Buyurtma yaratish va qoldiqni atomik tranzaksiya orqali rezerv qilish",
        description: "BEGIN IMMEDIATE orqali tranzaksiya ochiladi. Narx nusxasi (Price snapshot) olinadi. Omborda qoldiq 1 dona bo'lganda bir vaqtning o'zida kelgan parallel so'rovlardan faqat 1 tasi o'tadi.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["warehouse_id"],
                properties: {
                  warehouse_id: { type: "integer", example: 1 },
                  items: {
                    type: "array",
                    description: "Agar kiritilmasa, savatdagi mahsulotlardan olinadi",
                    items: {
                      type: "object",
                      properties: {
                        variant_id: { type: "integer", example: 1 },
                        quantity: { type: "integer", example: 1 }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        responses: {
          201: { description: "Buyurtma yaratildi va rezervlandi" },
          409: { description: "Omborda yetarli qoldiq mavjud emas (Concurrency safe)" }
        }
      },
      get: {
        tags: ["Buyurtma va Tranzaksiya"],
        summary: "Buyurtmalar ro'yxati (Mijoz faqat o'zinikini, Admin barchasini ko'radi)",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["PENDING", "PAID", "CANCELLED", "EXPIRED"] } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } }
        ],
        responses: { 200: { description: "Buyurtmalar ro'yxati" } }
      }
    },
    "/api/orders/{id}": {
      get: {
        tags: ["Buyurtma va Tranzaksiya"],
        summary: "Buyurtmani batafsil ko'rish (IDOR himoyasi bilan)",
        description: "Boshqa mijozning buyurtmasini ochishga urinilganda 403 Forbidden qaytariladi.",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: { description: "Buyurtma ma'lumotlari" },
          403: { description: "Boshqa buyurtmasi ochilmaydi (IDOR himoyasi)" }
        }
      }
    },
    "/api/orders/{id}/cancel": {
      post: {
        tags: ["Buyurtma va Tranzaksiya"],
        summary: "Buyurtmani bekor qilish (Faqat bir marta bekor qilish qoidasi)",
        description: "Bekor qilinganda rezervdagi mahsulot avtomatik omborga qaytariladi. Agar buyurtma allaqachon bekor qilingan, to'langan yoki muddati o'tgan bo'lsa, xatolik qaytariladi.",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: { description: "Bekor qilindi va rezerv qaytarildi" },
          400: { description: "Allaqachon bekor qilingan yoki bekor qilib bo'lmaydi" }
        }
      }
    },
    "/api/orders/cleanup-expired": {
      post: {
        tags: ["Buyurtma va Tranzaksiya"],
        summary: "Muddati o'tgan rezervlarni tozalash (Background/Manual cleaner)",
        description: "Rezerv vaqti o'tib ketgan PENDING buyurtmalarni EXPIRED holatga o'tkazadi va mahsulotni omborga qaytaradi.",
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: "Tozalandi" } }
      }
    },
    "/api/payments/callback": {
      post: {
        tags: ["To'lov Callback Provayderi"],
        summary: "Soxta to'lov provayderi webhook callbacki (HMAC imzo & Idempotentlik)",
        description: "X-Signature sarlavhasida HMAC-SHA256 imzosi tekshiriladi. Takroriy callback kelsa, to'lovni yoki qoldiqni qayta yechmaydi.",
        parameters: [
          { name: "X-Signature", in: "header", required: true, schema: { type: "string" }, description: "HMAC-SHA256 hesh imzosi" }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["order_number", "transaction_id", "amount"],
                properties: {
                  order_number: { type: "string", example: "ORD-20261003-ABC" },
                  transaction_id: { type: "string", example: "TX-10029384" },
                  amount: { type: "number", example: 15200000 },
                  status: { type: "string", example: "SUCCESS" }
                }
              }
            }
          }
        },
        responses: {
          200: { description: "To'lov qabul qilindi yoki takroriy callback deb tan olindi" },
          401: { description: "Noto'g'ri raqamli imzo" },
          400: { description: "Rezerv muddati tugagan yoki xatolik" }
        }
      }
    },
    "/api/payments/mock-checkout": {
      post: {
        tags: ["To'lov Callback Provayderi"],
        summary: "Sinov uchun to'lov simulyatori (Avtomatik imzo hisoblab callback yuboradi)",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["order_number"],
                properties: {
                  order_number: { type: "string", example: "ORD-..." },
                  transaction_id: { type: "string", example: "TX-TEST-001" }
                }
              }
            }
          }
        },
        responses: { 200: { description: "To'lov simulyatsiyasi bajarildi" } }
      }
    },
    "/api/admin/dashboard": {
      get: {
        tags: ["Administrator"],
        summary: "Boshqaruv paneli statistikasi (Admin huquqi talab etiladi)",
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: "Dashboard ko'rsatkichlari" }, 403: { description: "Ruxsat yo'q" } }
      }
    },
    "/api/admin/products": {
      post: {
        tags: ["Administrator"],
        summary: "Yangi mahsulot qo'shish (max_purchase_limit bilan)",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  category_id: { type: "integer", example: 1 },
                  name: { type: "string", example: "iPad Pro M4" },
                  description: { type: "string", example: "Ultra Retina XDR displey" },
                  max_purchase_limit: { type: "integer", example: 3, description: "Jonli himoyadagi o'zgarishlar" }
                }
              }
            }
          }
        },
        responses: { 201: { description: "Yaratildi" } }
      }
    },
    "/api/admin/products/{id}": {
      put: {
        tags: ["Administrator"],
        summary: "Mahsulotni tahrirlash (max_purchase_limit ni o'zgartirish)",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  max_purchase_limit: { type: "integer", example: 4 }
                }
              }
            }
          }
        },
        responses: { 200: { description: "Yangilandi" } }
      }
    },
    "/api/admin/products/{id}/variants": {
      post: {
        tags: ["Administrator"],
        summary: "Mahsulotga yangi variant qo'shish",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["sku", "name", "price"],
                properties: {
                  sku: { type: "string", example: "IPAD-M4-256" },
                  name: { type: "string", example: "256GB Space Black" },
                  price: { type: "number", example: 14000000 }
                }
              }
            }
          }
        },
        responses: { 201: { description: "Variant qo'shildi" } }
      }
    },
    "/api/admin/warehouses": {
      post: {
        tags: ["Administrator"],
        summary: "Yangi ombor qo'shish",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "location"],
                properties: {
                  name: { type: "string", example: "Farg'ona Filiali Ombori" },
                  location: { type: "string", example: "Farg'ona shahri, Al-Farg'oniy 10" }
                }
              }
            }
          }
        },
        responses: { 201: { description: "Ombor yaratildi" } }
      }
    },
    "/api/admin/stocks/replenish": {
      post: {
        tags: ["Administrator"],
        summary: "Ombor qoldig'ini to'ldirish (Kirim qilish)",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["warehouse_id", "variant_id", "quantity"],
                properties: {
                  warehouse_id: { type: "integer", example: 1 },
                  variant_id: { type: "integer", example: 2 },
                  quantity: { type: "integer", example: 10 }
                }
              }
            }
          }
        },
        responses: { 200: { description: "Qoldiq to'ldirildi" } }
      }
    }
  }
};

function getSwaggerHtml() {
  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <title>Elektron Savdo va Ombor API - Hujjatlar</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <link rel="icon" type="image/png" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.11.0/favicon-32x32.png" />
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .top-banner { background: #1e293b; color: white; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; }
    .top-banner h1 { margin: 0; font-size: 1.2rem; font-weight: 600; }
    .top-banner a { color: #38bdf8; text-decoration: none; font-weight: 500; font-size: 0.9rem; }
    .badge { background: #10b981; color: white; padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; margin-left: 8px; }
  </style>
</head>
<body>
  <div class="top-banner">
    <div>
      <span>📦 Elektron Savdo va Ombor Boshqaruvi API</span>
      <span class="badge">100 Ballik Loyiha</span>
    </div>
    <div>
      <a href="/openapi.json" target="_blank">📄 OpenAPI JSON</a>
    </div>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
}

module.exports = {
  openApiSpec,
  getSwaggerHtml
};
