-- ========================================================
-- Elektron savdo va ombor API: Database Seed Data
-- ========================================================

-- Demo Users
INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role) VALUES
(1, 'admin@shop.uz', 'salt1234567890ab:c45bd76af88935e132f6e41739bd4f46ba9c4cc2cd9a3f6f2ca163345276c9e5', 'Bosh Administrator', 'ADMIN'),
(2, 'customer1@shop.uz', 'salt1234567890ab:b7a60d49a585d518ebda5aa8c7380fd7f53c47c52ed14c56a1767c60d77aa497', 'Ali Valiyev', 'CUSTOMER'),
(3, 'customer2@shop.uz', 'salt1234567890ab:b7a60d49a585d518ebda5aa8c7380fd7f53c47c52ed14c56a1767c60d77aa497', 'Olim Qodirov', 'CUSTOMER');

-- Categories
INSERT OR IGNORE INTO categories (id, name, slug) VALUES
(1, 'Smartfonlar', 'smartfonlar'),
(2, 'Noutbuklar', 'noutbuklar'),
(3, 'Audio va Quloqchinlar', 'audio-va-quloqchinlar');

-- Products (with max_purchase_limit)
INSERT OR IGNORE INTO products (id, category_id, name, description, is_active, max_purchase_limit) VALUES
(1, 1, 'iPhone 15 Pro', 'Apple kompaniyasining titanium korpusli flagman smartfoni', 1, 2),
(2, 2, 'MacBook Air M3', 'Yupqa, yengil va baquvvat M3 chipiga ega noutbuk', 1, 3),
(3, 3, 'Sony WH-1000XM5', 'Eng ilg''or shovqin pasaytirish texnologiyasiga ega quloqchin', 1, 5),
(4, 1, 'Samsung Galaxy S24 Ultra', 'AI imkoniyatlariga va S-Pen qalamiga ega flagman smartfon', 1, 2);

-- Product Variants
INSERT OR IGNORE INTO product_variants (id, product_id, sku, name, price) VALUES
-- iPhone 15 Pro variants
(1, 1, 'IPH-15P-128-BLK', '128GB Black Titanium', 13500000),
(2, 1, 'IPH-15P-256-NAT', '256GB Natural Titanium (Faqat 1 dona qoldiq)', 15200000),
-- MacBook Air M3 variants
(3, 2, 'MBA-M3-8-256', '8GB RAM / 256GB SSD Midnight', 14800000),
(4, 2, 'MBA-M3-16-512', '16GB RAM / 512GB SSD Space Gray', 18900000),
-- Sony WH-1000XM5 variants
(5, 3, 'SONY-XM5-BLK', 'Black Matte', 4200000),
(6, 3, 'SONY-XM5-SLV', 'Silver White', 4200000),
-- Samsung Galaxy S24 Ultra variant
(7, 4, 'SAM-S24U-256-GRY', '256GB Titanium Gray', 14100000);

-- Warehouses
INSERT OR IGNORE INTO warehouses (id, name, location, is_active) VALUES
(1, 'Markaziy Ombor - Toshkent', 'Toshkent shahri, Chilonzor tumani, Bunyodkor ko''chasi 45', 1),
(2, 'Mintaqaviy Ombor - Samarqand', 'Samarqand shahri, Gagarin ko''chasi 12', 1);

-- Warehouse Stocks
-- NOTE: Variant 2 (IPH-15P-256-NAT) has quantity = 1, reserved = 0 (Ready for parallel concurrency test!)
INSERT OR IGNORE INTO warehouse_stocks (id, warehouse_id, variant_id, quantity, reserved_quantity) VALUES
(1, 1, 1, 10, 0),
(2, 1, 2, 1, 0),   -- Concurrency test target: Exactly 1 in stock!
(3, 1, 3, 5, 0),
(4, 1, 4, 3, 0),
(5, 1, 5, 15, 0),
(6, 1, 6, 8, 0),
(7, 1, 7, 7, 0),
(8, 2, 1, 5, 0),
(9, 2, 5, 10, 0);

-- Initial Carts for Customers
INSERT OR IGNORE INTO carts (id, user_id) VALUES
(1, 2),
(2, 3);
