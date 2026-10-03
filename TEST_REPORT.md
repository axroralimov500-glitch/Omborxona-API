# Rasmiy Test Hisoboti (Official Test Report)

**Loyiha:** Elektron savdo va ombor API (100 Ballik tizim)  
**Sana:** 2026-10-03  
**Holat:** Barcha testlar muvaffaqiyatli yakunlandi (100% O'tdi)  
**Umumiy tekshirilgan holatlar:** 25 ta  
**Xatoliklar:** 0 ta  

---

## 1. Test Natijalari Xulosasi Jadvali

| № | Talab / Test Yo'nalishi | Sinov Turi | Kutilgan Natija | Haqiqiy Natija | Holat |
| :--- | :--- | :--- | :--- | :--- | :---: |
| 1 | Admin Autentifikatsiyasi | RBAC Auth | HTTP 200, JWT token, role=ADMIN | HTTP 200, ADMIN roli berildi | **O'TDI** |
| 2 | Mijoz 1 Autentifikatsiyasi | RBAC Auth | HTTP 200, JWT token, role=CUSTOMER | HTTP 200, CUSTOMER roli berildi | **O'TDI** |
| 3 | Mijoz 2 Autentifikatsiyasi | RBAC Auth | HTTP 200, JWT token, role=CUSTOMER | HTTP 200, CUSTOMER roli berildi | **O'TDI** |
| 4 | Katalog API Ishlashi | Catalog | HTTP 200, mahsulotlar ro'yxati | HTTP 200, ro'yxat qaytdi | **O'TDI** |
| 5 | Katalog Sahifalash (Pagination) | Pagination | `total`, `page`, `limit`, `totalPages` | Barcha maydonlar to'g'ri hisoblandi | **O'TDI** |
| 6 | Narx Saralashi (price_asc) | Sorting | Arzonidan qimmatiga saralash | Narxlar o'sish tartibida saralandi | **O'TDI** |
| 7 | Kategoriya Filtri | Filtering | Faqat tanlangan kategoriya mahsulotlari | Faqat tanlangan kategoriya chiqdi | **O'TDI** |
| 8 | **Parallel Xarid (Concurrency)** | Race Condition | Qoldiq 1 bo'lganda 2 ta parallel so'rovdan faqat 1 tasi o'tadi | **So'rov 1: 201 Created, So'rov 2: 409 Conflict** | **O'TDI** |
| 9 | G'olib Buyurtma Rezervi | Inventory | G'olib buyurtma PENDING holatida rezerv oladi | PENDING va rezerv muddati belgilandi | **O'TDI** |
| 10 | Ombor Qoldig'i Holati | Inventory | quantity=1, reserved=1, available=0 | quantity=1, reserved=1, available=0 | **O'TDI** |
| 11 | **Tarixiy Narx Nusxasi** | Snapshot | Katalogda narx o'zgarsa ham buyurtmada eski narx qolishi | Narx 22mln bo'lsa ham buyurtmada 15.2mln qoldi | **O'TDI** |
| 12 | **IDOR Himoyasi (Customer 2)** | Security | Begona mijoz buyurtmasini ko'rish taqiqlanishi | **HTTP 403 Forbidden** qaytdi | **O'TDI** |
| 13 | Administrator Nazorati | Admin Access | Admin barcha mijozlar buyurtmalarini ko'ra olishi | HTTP 200, to'liq buyurtma ochildi | **O'TDI** |
| 14 | Buyurtma Yaratish | Orders | Yangi buyurtma rezervlanishi | HTTP 201 Created | **O'TDI** |
| 15 | **1-marta Bekor Qilish** | Single Cancel | Buyurtma bekor bo'lishi va qoldiq qaytarilishi | HTTP 200, status CANCELLED, qoldiq qaytarildi | **O'TDI** |
| 16 | **2-marta Bekor Qilish** | Single Cancel | Takroriy bekor qilish rad etilishi | **HTTP 400 Bad Request: Faqat 1 marta bekor qilish mumkin** | **O'TDI** |
| 17 | **Soxta Imzo Tekshiruvi** | Webhook Security | Noto'g'ri HMAC imzo rad etilishi | **HTTP 401 Unauthorized** | **O'TDI** |
| 18 | Haqiqiy Imzo bilan Callback | Payment Callback | HMAC-SHA256 imzosi to'g'ri bo'lganda to'lov qabul qilinishi | HTTP 200, status=SUCCESS | **O'TDI** |
| 19 | Buyurtma Statusi Yangilanishi | Payment Flow | Buyurtma PAID holatiga o'tishi va tranzaksiya yozilishi | status=PAID, payment_ref saqlandi | **O'TDI** |
| 20 | Qoldiq Uzil-Kesil Yechilishi | Inventory Deduct | Rezervdan jismoniy yechilishga o'tish (quantity=0, reserved=0) | quantity=0, reserved=0 | **O'TDI** |
| 21 | **Takroriy Callback (Idempotency)** | Idempotency | Qayta to'lov qilinmasligi, qoldiq o'zgarmasligi | **HTTP 200, is_duplicate=true** | **O'TDI** |
| 22 | Takroriy Qoldiq Yaxlitligi | Inventory Safety | Qoldiq ikkinchi marta kamaymasligi | quantity=0, reserved=0 (o'zgarmadi) | **O'TDI** |
| 23 | **Jonli Himoya (Maksimal Limit)** | Purchase Limit | Mahsulot limitidan ko'p so'ralsa rad etish | **HTTP 400 Bad Request: Limit buzildi** | **O'TDI** |
| 24 | Jonli Himoya (Ruxsat Etilgan) | Purchase Limit | Limit doirasida buyurtma qabul qilinishi | HTTP 201 Created | **O'TDI** |
| 25 | Avtomatik Tozalash (TTL Cleaner) | Background Worker | Muddati o'tgan buyurtmalarni EXPIRED qilish va qoldiqni qaytarish | Muvaffaqiyatli tozalandi | **O'TDI** |

---

## 2. Muhim Talablar Tafsiloti

### A. Concurrency (Parallel Xaridlar Poygasi)
* **Senariy:** Omborda Variant #2 (iPhone 15 Pro 256GB Natural Titanium) bo'yicha jami mavjud qoldiq: **1 dona**.
* **Harakat:** Ikkita mijoz (Customer 1 va Customer 2) ayni bir paytda millisekundlar farqisiz `POST /api/orders` orqali ushbu mahsulotni sotib olishga so'rov yubordi.
* **Natija:**
  * So'rov 1: `HTTP 201 Created` (G'olib buyurtma yaratildi, `reserved_quantity = 1`).
  * So'rov 2: `HTTP 409 Conflict` (Xatolik: *"Omborda yetarli mahsulot yo'q! Mavjud: 0, So'ralgan: 1"*).
* **Xulosa:** Do'kon ortiqcha sotib yuborishdan (overselling) 100% himoyalangan.

### B. Takroriy Callback (Idempotency)
* **Senariy:** To'lov provayderi tarmog'idagi uzilish sababli bitta to'lov callbacki (Transaction ID: `TX-TEST-...`) ikki marta ketma-ket yuborildi.
* **Natija:**
  * 1-callback: `HTTP 200 OK`, buyurtma `PAID` holatiga o'tkazildi, ombor qoldig'i 1 dan 0 ga tushirildi.
  * 2-callback: `HTTP 200 OK`, `{ status: "SUCCESS", message: "Takroriy callback: Qoldiq qayta yechilmadi", is_duplicate: true }`.
* **Xulosa:** Hisobdan ikki marta pul yechilmadi va ombordagi qoldiq manfiy holatga tushmadi.

### C. IDOR (Insecure Direct Object Reference)
* **Senariy:** Customer 2 begona mijoz Customer 1 ning buyurtma ID sini bilib olib, `GET /api/orders/{id}` orqali uni ko'rmoqchi bo'ldi.
* **Natija:** Server darajasida tekshirilib, darhol `HTTP 403 Forbidden` qaytarildi.
* **Xulosa:** Begona buyurtmalarga ruxsat to'liq bloklangan.

### D. Faqat Bir Marta Bekor Qilish
* **Senariy:** Mijoz o'z buyurtmasini bekor qildi (`POST /api/orders/{id}/cancel`).
* **Natija:**
  * 1-marta: `HTTP 200 OK`, buyurtma `CANCELLED` bo'ldi, rezervdagi qoldiq omborga qaytarildi.
  * 2-marta: `HTTP 400 Bad Request` (*"Buyurtma allaqachon bekor qilingan! Faqat bir marta bekor qilish mumkin"*).

### E. Jonli Himoyadagi O'zgarish (Maksimal Xarid Miqdori)
* **Senariy:** Mahsulot uchun `max_purchase_limit = 2` qilib belgilangan. Mijoz 3 dona sotib olmoqchi bo'ldi.
* **Natija:** `HTTP 400 Bad Request` (*"Maksimal xarid miqdori oshib ketdi! Cheklov: 2 dona"*). Limit doirasida (2 dona) so'ralganda esa muvaffaqiyatli qabul qilindi.
