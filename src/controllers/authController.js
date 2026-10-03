const { getDatabase } = require('../database');
const { hashPassword, verifyPassword, generateToken } = require('../auth');

function register(body, user) {
  const { email, password, full_name, role = 'CUSTOMER' } = body || {};

  if (!email || !password || !full_name) {
    return { status: 400, data: { error: "Email, parol va to'liq ism kiritilishi shart" } };
  }

  // Only existing admins can create ADMIN users; otherwise role is CUSTOMER
  let assignedRole = 'CUSTOMER';
  if (role === 'ADMIN' && user && user.role === 'ADMIN') {
    assignedRole = 'ADMIN';
  }

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) {
    return { status: 409, data: { error: 'Ushbu email bilan foydalanuvchi allaqachon mavjud' } };
  }

  const passwordHash = hashPassword(password);
  const insertUser = db.prepare(`
    INSERT INTO users (email, password_hash, full_name, role)
    VALUES (?, ?, ?, ?)
  `);

  const result = insertUser.run(email.toLowerCase().trim(), passwordHash, full_name.trim(), assignedRole);
  const userId = Number(result.lastInsertRowid);

  // Initialize cart for customer
  db.prepare('INSERT OR IGNORE INTO carts (user_id) VALUES (?)').run(userId);

  const payload = {
    id: userId,
    email: email.toLowerCase().trim(),
    full_name: full_name.trim(),
    role: assignedRole
  };

  const token = generateToken(payload);

  return {
    status: 201,
    data: {
      message: "Foydalanuvchi muvaffaqiyatli ro'yxatdan o'tdi",
      user: payload,
      token
    }
  };
}

function login(body) {
  const { email, password } = body || {};

  if (!email || !password) {
    return { status: 400, data: { error: 'Email va parol kiritilishi shart' } };
  }

  const db = getDatabase();
  const user = db.prepare('SELECT id, email, password_hash, full_name, role FROM users WHERE email = ?').get(email.toLowerCase().trim());

  if (!user || !verifyPassword(password, user.password_hash)) {
    return { status: 401, data: { error: "Email yoki parol noto'g'ri" } };
  }

  const payload = {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role
  };

  const token = generateToken(payload);

  return {
    status: 200,
    data: {
      message: 'Tizimga muvaffaqiyatli kirildi',
      user: payload,
      token
    }
  };
}

function me(user) {
  if (!user) {
    return { status: 401, data: { error: 'Avtorizatsiyadan o\'tilmagan' } };
  }

  const db = getDatabase();
  const userData = db.prepare('SELECT id, email, full_name, role, created_at FROM users WHERE id = ?').get(user.id);
  if (!userData) {
    return { status: 404, data: { error: 'Foydalanuvchi topilmadi' } };
  }

  return { status: 200, data: { user: userData } };
}

module.exports = {
  register,
  login,
  me
};
