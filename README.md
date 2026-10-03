# 📦 Elektron Savdo va Ombor API (100 Ball)

> **Muddat:** 8 kun | **Baholash:** Individual hisobga | **Maksimal to'p:** 100 ball  
> **Asosiy muammo va yechim:** Do'kon bir nechta mahsulotni bir vaqtda xarid qilganda ham ombor qoldig'ini poygasiz (race condition) to'g'ri saqlaydi.

---

## 🚀 1. Tezkor Ishga Tushirish (Quick Start)

### Usul 1: Standalone `.exe` Fayl orqali (Windows uchun eng osoni)
Loyiha papkasida tayyor pre-kompilyatsiya qilingan **`ecommerce-api.exe`** mavjud:
1. **`ecommerce-api.exe`** faylini ikki marta bosing (yoki PowerShell / CMD orqali ishga tushiring):
   ```powershell
   .\ecommerce-api.exe
   ```
2. Server avtomatik ravishda ma'lumotlar bazasini initsializatsiya qiladi, migratsiyalarni yurgazadi, demo ma'lumotlarni to'ldiradi va brauzeringizda interaktiv **Swagger UI** (`http://localhost:3000/docs`) sahifasini ochadi!

#### Barcha 25 ta rasmiy testlarni `.exe` orqali tekshirish:
```powershell
.\ecommerce-api.exe --test
```

---

### Usul 2: Node.js orqali Lokal Ishga Tushirish
Loyiha faqat Node.js ning o'rnatilgan standart kutubxonalari (`node:sqlite`, `node:crypto`, `node:http`) asosida qurilgan. Hech qanday tashqi og'ir paketlar yoki internetdan yuklab olish talab etilmaydi!

```bash
# Serverni ishga tushirish
npm start
# yoki
node src/server.js

# Barcha testlarni to'liq ishga tushirish
npm test
# yoki
node test-runner.js
```

---

## 🔑 2. Demo Akkauntlar

Tizimga quyidagi oldindan tayyorlangan demo akkauntlar orqali kirishingiz mumkin:

| Akkaunt Turi | Email | Parol | Roli | Huquqlari |
| :--- | :--- | :--- | :---: | :--- |
| **Bosh Administrator** | `admin@shop.uz` | `Admin123!` | `ADMIN` | Barcha mahsulotlar, omborlar, qoldiqlarni to'ldirish, barcha buyurtmalarni ko'rish va boshqarish |
| **Mijoz 1** | `customer1@shop.uz` | `Customer123!` | `CUSTOMER` | Katalog ko'rish, shaxsiy savat, buyurtma berish, o'z buyurtmasini ko'rish va bir marta bekor qilish |
| **Mijoz 2** | `customer2@shop.uz` | `Customer123!` | `CUSTOMER` | Katalog ko'rish, shaxsiy savat, buyurtma berish (IDOR va Concurrency testlari uchun) |

---

## 🏗️ 3. Ma'lumotlar Bazasi Modeli va Arxitekturasi

Tizim SQLite (WAL - Write-Ahead Logging rejimi va Foreign Keys yoqilgan) bazasidan foydalanadi.

### Asosiy Jadvallar:
1. **`users`**: Foydalanuvchilar (`id`, `email`, `password_hash`, `full_name`, `role: 'CUSTOMER' | 'ADMIN'`).
2. **`categories`**: Mahsulot kategoriyalari (`id`, `name`, `slug`).
3. **`products`**: Mahsulotlar (`id`, `category_id`, `name`, `description`, `is_active`, `max_purchase_limit`).
4. **`product_variants`**: Mahsulot variantlari (`id`, `product_id`, `sku`, `name`, `price`).
5. **`warehouses`**: Omborlar (`id`, `name`, `location`, `is_active`).
6. **`warehouse_stocks`**: Ombor qoldiqlari (`id`, `warehouse_id`, `variant_id`, `quantity`, `reserved_quantity`).
   * *Mavjud qoldiq:* `quantity - reserved_quantity`.
7. **`carts` & `cart_items`**: Foydalanuvchining shaxsiy savati va undagi mahsulotlar.
8. **`orders`**: Buyurtmalar (`id`, `order_number`, `user_id`, `warehouse_id`, `status: PENDING | PAID | CANCELLED | EXPIRED`, `total_amount`, `reservation_expires_at`, `cancelled_at`, `paid_at`, `payment_ref`).
9. **`order_items`**: Buyurtma tarkibi va **tarixiy narx nusxasi** (`unit_price_snapshot`, `product_name_snapshot`, `variant_name_snapshot`, `quantity`, `subtotal`).
10. **`payment_transactions`**: To'lov tranzaksiyalari tarixi va idempotentlik nazorati (`id`, `order_id`, `provider`, `transaction_id`, `amount`, `status`, `signature`, `raw_payload`).

---

## 🛡️ 4. Majburiy Biznes Qoidalari va Qabul Qilish Mezonlari

### 1. Parallel Xarid Concurrency Himoyasi (Race Condition)
* **Talab:** *"Qo'ldiq 1 bo'lganda ikki parallel xaridning faqat bittasi rezerv oladi."*
* **Yechim:** Buyurtma berish (`POST /api/orders`) `BEGIN IMMEDIATE` tranzaksiyasi ichida bajariladi. SQLite da bir vaqtning o'zida bir nechta so'rov kelsa ham, birinchi kirgan so'rov eksklyuziv yozish qulfiga ega bo'ladi.
  * 1-so'rov: `quantity - reserved_quantity = 1 - 0 = 1 >= 1` -> Mahsulot rezervlanadi (`reserved_quantity = 1`) va `HTTP 201 Created` qaytariladi.
  * 2-so'rov: Tranzaksiyaga kirganda `available = 1 - 1 = 0 < 1` ekanligini ko'radi -> Tranzaksiya bekor qilinadi (`ROLLBACK`) va darhol `HTTP 409 Conflict` qaytariladi.
  * Do'konda hech qachon ortiqcha sotib yuborish (overselling) yuz bermaydi.

### 2. Tarixiy Narx Nusxasi (Price Snapshot)
* **Talab:** *"Buyurtmada narx nusxasi saqlansin."*
* **Yechim:** Buyurtma yaratilgan lahzada mahsulot variantining joriy narxi `order_items.unit_price_snapshot` ustuniga muhrlanadi. Keyinchalik administrator narxni o'zgartirsa yoki oshirsa ham, buyurtmaning hisob-kitobi va chekdagi narxi o'zgarmas saqlanadi.

### 3. Soxta To'lov Callbacki, Imzo va Idempotentlik
* **Talab:** *"Soxta to'lov provayderi callbacki; imzo va takroriy callback rezerv muddati tugashi."*
* **Yechim:**
  * **HMAC-SHA256 Imzo Tekshiruvi:** `POST /api/payments/callback` har bir so'rovning `X-Signature` sarlavhasini maxfiy kalit (`PAYMENT_WEBHOOK_SECRET`) orqali xeshlangan ma'lumot bilan taqqoslaydi. Soxta yoki imzosiz so'rovlar `HTTP 401 Unauthorized` bilan qaytariladi.
  * **Idempotentlik:** Tarmoqdagi uzilish sababli to'lov provayderi bitta callbackni bir necha marta takroran yuborsa:
    * Tizim `payment_transactions` jadvalidan `transaction_id` ni yoki buyurtmaning `PAID` holatini tekshiradi.
    * Takroriy so'rovga `HTTP 200 OK` va `{ is_duplicate: true }` qaytariladi.
    * **Hech qanday holatda ombor qoldig'i ikkinchi marta yechilmaydi yoki hisob ikki marta yopilmaydi.**
  * **Rezerv Muddati (TTL):** Har bir buyurtmaga 15 daqiqalik rezerv muddati (`reservation_expires_at`) beriladi. Agar buyurtma muddati o'tib ketgan bo'lsa, to'lov rad etiladi va rezervdagi qoldiq avtomatik omborga qaytariladi.

### 4. Rollar, Huquqlar (RBAC) va IDOR Himoyasi
* **Talab:** *"Mijoz va administrator huquqlari; Boshqa buyurtmasi API orqali ochilmaydi."*
* **Yechim:**
  * Huquqlar server darajasida Bearer token orqali tekshiriladi (UI tugmasini yashirish bilan cheklanib qolmaydi).
  * `GET /api/orders/:id` so'rovida `order.user_id === req.user.id || req.user.role === 'ADMIN'` tekshiruvi mavjud. Agar oddiy mijoz begona buyurtma ID sini ochishga urinsa, server `HTTP 403 Forbidden` qaytaradi.

### 5. Faqat Bir Marta Bekor Qilish
* **Talab:** *"Faqat bir marta bekor qilish."*
* **Yechim:** `POST /api/orders/:id/cancel` buyurtma holatini tekshiradi:
  * Agar buyurtma `PENDING` bo'lsa: rezervdagi qoldiq omborga qaytariladi, status `CANCELLED` ga o'tkaziladi (`HTTP 200 OK`).
  * Agar mijoz allaqachon bekor qilingan buyurtmani yana bekor qilmoqchi bo'lsa: `HTTP 400 Bad Request` (*"Buyurtma allaqachon bekor qilingan! Faqat bir marta bekor qilish mumkin"*).

### 6. Jonli Himoyadagi O'zgarishlar (Maksimal Xarid Miqdori)
* **Talab:** *"Bir mahsulotga maksimal xarid miqdorini qo'shing."*
* **Yechim:** `products` jadvaliga `max_purchase_limit` ustuni kiritildi.
  * Savatga qo'shishda (`POST /api/cart/items`), savatdagi miqdorni yangilashda (`PUT /api/cart/items/:id`) va to'g'ridan-to'g'ri buyurtma yaratishda (`POST /api/orders`) jami miqdor tekshiriladi.
  * Cheklovdan oshib ketilsa, server `HTTP 400 Bad Request` (*"Maksimal xarid miqdori oshib ketdi! Cheklov: X dona"*) qaytaradi.

---

## 📋 5. API Hujjatlari (OpenAPI / Swagger)

Server ishga tushgandan so'ng brauzer orqali quyidagi havolalarga kirishingiz mumkin:
* **Interaktiv Swagger UI:** [http://localhost:3000/docs](http://localhost:3000/docs)
* **OpenAPI 3.0 JSON Sxemasi:** [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json)

---

## 🧪 6. Sinov Adapteri va Testlar

Loyiha ichida quyidagi test vositalari mavjud:
1. **`test-runner.js`:** 25 ta avtomatlashtirilgan test (Concurrency, IDOR, Idempotentlik, Price snapshot, Max limit).
2. **`postman-collection.json`:** Postman va Insomnia uchun tayyor REST API sinov to'plami.
3. **`ADAPTER_LIMITS.md`:** Tashqi foydalanish uchun sinov adapterlari va ularning texnik chegaralari bayoni.
4. **`TEST_REPORT.md`:** Barcha 25 ta testning batafsil o'tish hisoboti.

---

## 📁 7. Fayllar Tuzilmasi

```
ecommerce-warehouse-api/
├── ecommerce-api.exe       # Standalone Windows ishga tushiruvchi dastur (.exe)
├── Program.cs              # C# manba kodi (csc.exe orqali kompilyatsiya qilingan)
├── build-exe.bat           # .exe ni qayta kompilyatsiya qiluvchi skript
├── start.bat               # Tezkor ishga tushiruvchi batch fayl
├── package.json            # Node.js loyiha konfiguratsiyasi
├── .env.example            # Konfiguratsiya shabloni
├── .env                    # Faol konfiguratsiya fayli
├── migrations.sql          # Ma'lumotlar bazasi jadvallari sxemasi
├── seed.sql                # Boshlang'ich demo ma'lumotlar
├── test-runner.js          # Rasmiy avtomatlashtirilgan test moduli (25 ta test)
├── postman-collection.json # Tashqi sinov adapteri (Postman)
├── ADAPTER_LIMITS.md       # Sinov adapterlari chegaralari hujjati
├── TEST_REPORT.md          # 100% test hisoboti
├── README.md               # Ushbu to'liq qo'llanma
└── src/
    ├── config.js           # Muhit o'zgaruvchilari sozlamalari
    ├── database.js         # SQLite WAL ulanishi va atomik tranzaksiya yordamchisi
    ├── auth.js             # PBKDF2 xeshlash va JWT token generatori
    ├── swaggerDocs.js      # OpenAPI 3.0 sxemasi va Swagger UI sahifasi
    ├── routes.js           # REST API routeri va so'rovlar nazorati
    ├── server.js           # Asosiy HTTP server va foniy tozalovchi (TTL cleaner)
    └── controllers/
        ├── authController.js     # Ro'yxatdan o'tish, kirish, profil
        ├── catalogController.js  # Filtrlar, narx saralash, sahifalash, qoldiqlar
        ├── cartController.js     # Savat va maksimal xarid limiti tekshiruvi
        ├── orderController.js    # Tranzaksiyali rezerv, narx nusxasi, IDOR, bekor qilish
        ├── paymentController.js  # HMAC imzo, takroriy callback, idempotentlik
        └── adminController.js    # Boshqaruv paneli, tovarlar, omborlar, kirim
```
