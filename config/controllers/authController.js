import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import pool from "../config/db.js"; // ← CAMBIAR: tu pool está en config/db.js

dotenv.config();

// 📦 Almacenamiento temporal de códigos SMS
const codes = new Map();

// 🔐 Generar token JWT
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email, role_id: user.role_id },
    process.env.JWT_SECRET,
    { expiresIn: "24h" }
  );
};

// ✅ REGISTRO
export const registerUser = async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      mother_lastname,
      email,
      phone,
      birthdate,
      username,
      password,
      role_id
    } = req.body;

    // Validación de campos obligatorios
    if (!first_name || !last_name || !email || !password || !username) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }

    // Validar contraseña fuerte
    const strongPassword = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+={}\[\]:;"'<>,.?/~`-]).{8,}$/;
    if (!strongPassword.test(password)) {
      return res.status(400).json({
        error: "La contraseña debe tener al menos 8 caracteres, una mayúscula, un número y un símbolo",
      });
    }

    // Verificar si el email ya existe
    const [existingEmail] = await pool.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existingEmail.length > 0) {
      return res.status(400).json({ error: "El correo electrónico ya está registrado" });
    }

    // Verificar si el username ya existe
    const [existingUsername] = await pool.query(
      "SELECT id FROM users WHERE username = ?",
      [username]
    );

    if (existingUsername.length > 0) {
      return res.status(400).json({ error: "El nombre de usuario ya está en uso" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = `
      INSERT INTO users 
      (first_name, last_name, mother_lastname, email, phone, birthdate, username, password, role_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      first_name,
      last_name,
      mother_lastname,
      email,
      phone,
      birthdate,
      username,
      hashedPassword,
      role_id || 3 // Por defecto Cliente
    ];

    await pool.query(sql, values);

    res.json({ success: true, message: "Usuario registrado correctamente" });

  } catch (error) {
    console.error("Error en /register:", error.message);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

// ✅ LOGIN (1° paso)
export const loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;

    console.log('📝 Intento de login:', { username });

    if (!username || !password) {
      return res.status(400).json({ 
        error: 'Usuario y contraseña son requeridos' 
      });
    }

    // Buscar usuario
    const query = `
      SELECT 
        id, 
        username, 
        email, 
        \`password\`,
        first_name,
        last_name,
        role_id,
        status
      FROM users 
      WHERE username = ? OR email = ? 
      LIMIT 1
    `;
    const [users] = await pool.query(query, [username, username]);

    if (users.length === 0) {
      console.log('❌ Usuario no encontrado:', username);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const user = users[0];

    // Verificar que la contraseña existe
    if (!user.password) {
      console.log('❌ Usuario sin contraseña en BD:', username);
      return res.status(500).json({ 
        error: 'Error de configuración. Contacta al administrador.' 
      });
    }

    // Verificar contraseña
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      console.log('❌ Contraseña incorrecta para:', username);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    // Generar token
    const token = generateToken(user);

    console.log('✅ Login exitoso:', user.username);

    res.json({
      message: 'Login exitoso',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role_id: user.role_id
      }
    });

  } catch (error) {
    console.error('❌ Error en /api/login:', error);
    res.status(500).json({ 
      error: 'Error en el servidor',
      details: error.message 
    });
  }
};

// ✅ VERIFICAR CÓDIGO (2° paso) - Si usas SMS
export const verifyCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    const savedCode = codes.get(email);
    if (!savedCode || savedCode != code)
      return res.status(400).json({ msg: "Código incorrecto o expirado" });

    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (rows.length === 0)
      return res.status(404).json({ msg: "Usuario no encontrado" });

    const user = rows[0];
    const token = generateToken(user);

    // Eliminar el código ya usado
    codes.delete(email);

    res.json({ msg: "Código verificado correctamente", token });
  } catch (error) {
    console.error("Error en verificación:", error);
    res.status(500).json({ msg: "Error en el servidor" });
  }
};