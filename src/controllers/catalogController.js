const { getDatabase } = require('../database');

function getCategories() {
  const db = getDatabase();
  const categories = db.prepare(`
    SELECT c.*, COUNT(p.id) as product_count
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1
    GROUP BY c.id
    ORDER BY c.name ASC
  `).all();

  return { status: 200, data: { categories } };
}

function getProducts(query = {}) {
  const db = getDatabase();
  const page = Math.max(1, parseInt(query.page || '1', 10));
  const limit = Math.max(1, Math.min(100, parseInt(query.limit || '10', 10)));
  const offset = (page - 1) * limit;

  const categoryId = query.category_id ? parseInt(query.category_id, 10) : null;
  const categorySlug = query.category || null;
  const search = query.search ? `%${query.search.trim().toLowerCase()}%` : null;
  const sort = query.sort || 'newest'; // price_asc, price_desc, name_asc, name_desc, newest

  let whereClauses = ['p.is_active = 1'];
  let params = [];

  if (categoryId) {
    whereClauses.push('p.category_id = ?');
    params.push(categoryId);
  } else if (categorySlug) {
    whereClauses.push('c.slug = ?');
    params.push(categorySlug);
  }

  if (search) {
    whereClauses.push('(LOWER(p.name) LIKE ? OR LOWER(p.description) LIKE ? OR EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND (LOWER(pv.name) LIKE ? OR LOWER(pv.sku) LIKE ?)))');
    params.push(search, search, search, search);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Count total products matching filter
  const countSql = `
    SELECT COUNT(DISTINCT p.id) as total
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereSql}
  `;
  const totalRow = db.prepare(countSql).get(...params);
  const total = totalRow ? totalRow.total : 0;

  // Sorting logic based on minimum variant price or product fields
  let orderBy = 'p.created_at DESC';
  if (sort === 'price_asc') {
    orderBy = 'min_price ASC';
  } else if (sort === 'price_desc') {
    orderBy = 'max_price DESC';
  } else if (sort === 'name_asc') {
    orderBy = 'p.name ASC';
  } else if (sort === 'name_desc') {
    orderBy = 'p.name DESC';
  }

  const productsSql = `
    SELECT 
      p.id,
      p.name,
      p.description,
      p.category_id,
      p.max_purchase_limit,
      p.created_at,
      c.name as category_name,
      c.slug as category_slug,
      MIN(pv.price) as min_price,
      MAX(pv.price) as max_price
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN product_variants pv ON pv.product_id = p.id
    ${whereSql}
    GROUP BY p.id
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const productRows = db.prepare(productsSql).all(...params, limit, offset);

  // Fetch variants and warehouse stocks for these products
  const productIds = productRows.map(p => p.id);
  let variantsByProduct = {};

  if (productIds.length > 0) {
    const placeholders = productIds.map(() => '?').join(',');
    const variantsSql = `
      SELECT 
        pv.id,
        pv.product_id,
        pv.sku,
        pv.name,
        pv.price,
        COALESCE(SUM(ws.quantity), 0) as total_quantity,
        COALESCE(SUM(ws.reserved_quantity), 0) as total_reserved,
        MAX(0, COALESCE(SUM(ws.quantity), 0) - COALESCE(SUM(ws.reserved_quantity), 0)) as available_stock
      FROM product_variants pv
      LEFT JOIN warehouse_stocks ws ON ws.variant_id = pv.id
      WHERE pv.product_id IN (${placeholders})
      GROUP BY pv.id
      ORDER BY pv.price ASC
    `;
    const variantRows = db.prepare(variantsSql).all(...productIds);
    for (const v of variantRows) {
      if (!variantsByProduct[v.product_id]) {
        variantsByProduct[v.product_id] = [];
      }
      variantsByProduct[v.product_id].push({
        id: v.id,
        sku: v.sku,
        name: v.name,
        price: v.price,
        stock: {
          total_physical: v.total_quantity,
          reserved: v.total_reserved,
          available: v.available_stock
        }
      });
    }
  }

  const data = productRows.map(p => {
    const variants = variantsByProduct[p.id] || [];
    const totalAvailable = variants.reduce((sum, v) => sum + v.stock.available, 0);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category_name ? { id: p.category_id, name: p.category_name, slug: p.category_slug } : null,
      max_purchase_limit: p.max_purchase_limit, // Jonli himoyadagi o'zgarishlar
      price_range: {
        min: p.min_price || 0,
        max: p.max_price || 0
      },
      total_available_stock: totalAvailable,
      variants,
      created_at: p.created_at
    };
  });

  return {
    status: 200,
    data: {
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      products: data
    }
  };
}

function getProductById(productId) {
  const db = getDatabase();
  const id = parseInt(productId, 10);
  if (!id) {
    return { status: 400, data: { error: "Noto'g'ri mahsulot ID" } };
  }

  const product = db.prepare(`
    SELECT 
      p.*,
      c.name as category_name,
      c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = ? AND p.is_active = 1
  `).get(id);

  if (!product) {
    return { status: 404, data: { error: 'Mahsulot topilmadi' } };
  }

  const variants = db.prepare(`
    SELECT 
      pv.id,
      pv.sku,
      pv.name,
      pv.price,
      COALESCE(SUM(ws.quantity), 0) as total_quantity,
      COALESCE(SUM(ws.reserved_quantity), 0) as total_reserved,
      MAX(0, COALESCE(SUM(ws.quantity), 0) - COALESCE(SUM(ws.reserved_quantity), 0)) as available_stock
    FROM product_variants pv
    LEFT JOIN warehouse_stocks ws ON ws.variant_id = pv.id
    WHERE pv.product_id = ?
    GROUP BY pv.id
  `).all(id);

  // Get detailed per-warehouse stocks
  const variantIds = variants.map(v => v.id);
  let warehouseStockByVariant = {};
  if (variantIds.length > 0) {
    const placeholders = variantIds.map(() => '?').join(',');
    const stockRows = db.prepare(`
      SELECT 
        ws.variant_id,
        ws.warehouse_id,
        w.name as warehouse_name,
        w.location as warehouse_location,
        ws.quantity,
        ws.reserved_quantity,
        MAX(0, ws.quantity - ws.reserved_quantity) as available_stock
      FROM warehouse_stocks ws
      JOIN warehouses w ON w.id = ws.warehouse_id AND w.is_active = 1
      WHERE ws.variant_id IN (${placeholders})
    `).all(...variantIds);

    for (const s of stockRows) {
      if (!warehouseStockByVariant[s.variant_id]) {
        warehouseStockByVariant[s.variant_id] = [];
      }
      warehouseStockByVariant[s.variant_id].push({
        warehouse_id: s.warehouse_id,
        warehouse_name: s.warehouse_name,
        location: s.warehouse_location,
        quantity: s.quantity,
        reserved: s.reserved_quantity,
        available: s.available_stock
      });
    }
  }

  const formattedVariants = variants.map(v => ({
    id: v.id,
    sku: v.sku,
    name: v.name,
    price: v.price,
    stock: {
      total_physical: v.total_quantity,
      reserved: v.total_reserved,
      available: v.available_stock,
      by_warehouse: warehouseStockByVariant[v.id] || []
    }
  }));

  return {
    status: 200,
    data: {
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category_name ? { id: product.category_id, name: product.category_name, slug: product.category_slug } : null,
        max_purchase_limit: product.max_purchase_limit, // Jonli himoyadagi o'zgarishlar
        variants: formattedVariants,
        created_at: product.created_at
      }
    }
  };
}

module.exports = {
  getCategories,
  getProducts,
  getProductById
};
