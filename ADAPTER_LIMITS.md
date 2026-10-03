# Tashqi Sinov Adapteri va Uning Chegaralari (Test Adapters & Limitations)

Loyiha doirasida API bilan ishlash, qabul qilish mezonlarini tekshirish va tashqi tizimlar bilan integratsiyani osonlashtirish uchun ikkita asosiy sinov adapteri taqdim etiladi:
1. **Dasturiy Sinov Adapteri (`test-runner.js` / `ecommerce-api.exe --test`)**
2. **Postman / REST API To'plami (`postman-collection.json`)**
3. **Interaktiv Swagger UI Web Adapteri (`http://localhost:3000/docs`)**

---

## 1. Adapterlarning maqsadi va imkoniyatlari

### A. Dasturiy Sinov Adapteri (`test-runner.js`)
* **Vazifasi:** Tizimning barcha 25 ta biznes talablari va xavfsizlik qoidalarini avtomatlashtirilgan tarzda sinovdan o'tkazadi.
* **Qamrovi:**
  * Rollar va huquqlar (RBAC)
  * Katalog, ko'p parametrli filtrlash, narx saralashi va sahifalash
  * Parallel xaridlar poygasi (Race condition / Concurrency)
  * Tarixiy narx nusxasi (Price snapshot)
  * IDOR (Insecure Direct Object Reference) xavfsizlik tekshiruvi
  * Faqat bir marta bekor qilish (Single Cancellation) qoidasi
  * Soxta to'lov provayderi HMAC-SHA256 raqamli imzosi tekshiruvi
  * Takroriy (Idempotent) callbacklarda qoldiq va hisob yaxlitligi
  * Jonli himoyadagi talab: mahsulot bo'yicha maksimal xarid miqdori (`max_purchase_limit`).

### B. Postman To'plami (`postman-collection.json`)
* **Vazifasi:** Qo'lda sinov o'tkazuvchi mutaxassislar (QA) va uchinchi tomon integratsiyachilari uchun tayyor HTTP so'rovlar to'plami.
* **Avtomatizatsiya:** Admin va Mijoz tokenlarini avtomatik global o'zgaruvchilarga saqlash scriptlari (`pm.collectionVariables.set`) mavjud.

### C. Interaktiv Swagger UI (`/docs`)
* **Vazifasi:** Brauzer orqali har qanday API marshrutiga parametr kiritish, sinab ko'rish va JSON sxemalarini o'rganish.

---

## 2. Sinov Adapterlarining Chegaralari (Limitations & Constraints)

Har bir sinov adapteri o'zining texnik chegaralariga ega:

| Adapter | Imkoniyati | Mavjud Chegarasi (Limitations) | Yechim / Tavsiya |
| :--- | :--- | :--- | :--- |
| **`test-runner.js`** | Haqiqiy parallel `Promise.all` orqali millisekund darajasida poyga hosil qiladi. | Bitta mashina (lokal xost) doirasida ishlaydi; xalqaro tarmoqdagi (geo-distributed) kechikishlarni (latency) modellashtirmaydi. | Haqiqiy tarmoq sinovi uchun k6 yoki JMeter vositalaridan foydalanish mumkin. |
| **`postman-collection.json`** | So'rovlarni ketma-ket yuborish va test natijalarini ko'rish. | Postman GUI bevosita parallel (bir vaqtda bitta millisekundda) so'rovlarni osonlikcha yubora olmaydi (ketma-ket yuboradi). Concurrency sinovi uchun Newman parallel workerlari yoki `test-runner.js` talab etiladi. | Concurrency sinovini `node test-runner.js` yoki `ecommerce-api.exe --test` orqali tekshirish lozim. |
| **HMAC Webhook Callback** | Kriptografik imzoni to'liq tekshiradi. | Postman orqali to'lov callbacki yuborilganda `X-Signature` sarlavhasini HMAC-SHA256 bilan oldindan hisoblab qo'yish kerak yoki tizimdagi maxsus sinov endpointi `POST /api/payments/mock-checkout` dan foydalanish talab etiladi. | Sinov uchun qulaylik yaratish maqsadida `POST /api/payments/mock-checkout` marshruti kiritilgan bo'lib, u so'rovni avtomatik imzolab to'lov callbackini ishga tushiradi. |
| **Lokal SQLite Baza** | `BEGIN IMMEDIATE` orqali yuqori darajada xavfsiz va poygasiz tranzaksiyalar ta'minlaydi. | Bir vaqtda yozuvchi faqat 1 ta jarayon bo'lishi mumkin (fayl qulflanishi). Agar millionlab klasterli serverlar talab etilsa, PostgreSQL / MySQL ga o'tish lozim. | Hozirgi arxitektura WAL (Write-Ahead Logging) rejimida soniyasiga minglab o'qish va yuzlab yozishlarni muammosiz qondiradi. |
