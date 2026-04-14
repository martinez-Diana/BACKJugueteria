import express from "express";
import pool from "../config/db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { generateVerificationCode, sendVerificationEmail, sendPasswordResetEmail } from "../services/emailService.js";

const router = express.Router();

// Configurar Google OAuth Client
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ========================================
// 🔐 REGISTRO TRADICIONAL
// ========================================
router.post("/register", async (req, res) => {
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

    // Validación
    if (!first_name || !last_name || !email || !password || !username) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
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
      (first_name, last_name, mother_lastname, email, phone, birthdate, username, password, role_id, is_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)
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
      role_id
    ];

    await pool.query(sql, values);

    // 🆕 GENERAR Y ENVIAR CÓDIGO DE VERIFICACIÓN
    const verificationCode = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

    // Eliminar códigos anteriores del mismo email
    await pool.query(
      "DELETE FROM verification_codes WHERE email = ?",
      [email]
    );

    // Guardar nuevo código
    await pool.query(
      "INSERT INTO verification_codes (email, code, expires_at, used) VALUES (?, ?, ?, FALSE)",
      [email, verificationCode, expiresAt]
    );

    // Enviar email con código
    const emailSent = await sendVerificationEmail(email, verificationCode);

    if (!emailSent) {
      console.error("⚠️ No se pudo enviar el email de verificación");
      // Aún así permitir el registro
    }

    res.json({ 
      success: true, 
      message: "Usuario registrado correctamente. Revisa tu correo para verificar tu cuenta.",
      email: email // Para pasarlo al componente de verificación
    });

  } catch (error) {
    console.error("Error en /register:", error.message);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// ========================================
// 🔑 LOGIN TRADICIONAL (Usuario/Contraseña)
// ========================================
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    console.log('📝 Intento de login:', { username });

    // Validar datos
    if (!username || !password) {
      return res.status(400).json({ 
        error: 'Usuario y contraseña son requeridos' 
      });
    }

    // Buscar usuario - CORRECCIÓN: escapar `password` con backticks
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
    
    // DEBUG: Ver qué hay en la base de datos
    console.log('🔍 Usuario encontrado:', {
      id: user.id,
      username: user.username,
      email: user.email,
      hasPassword: !!user.password,
      passwordLength: user.password?.length,
      passwordPreview: user.password?.substring(0, 10) + '...'
    });

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
    const token = jwt.sign(
  { id: user.id, role_id: user.role_id, username: user.username },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);

    console.log('✅ Login exitoso:', user.username);
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

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
});

// ========================================
// 📧 SOLICITAR CÓDIGO DE VERIFICACIÓN POR EMAIL
// ========================================
router.post("/auth/email/request-code", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "El correo electrónico es requerido" });
    }

    // Verificar si el usuario existe
    const [users] = await pool.query(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: "No existe una cuenta con este correo electrónico" });
    }

    // Generar código de 6 dígitos
    const code = generateVerificationCode();

    // Calcular fecha de expiración (10 minutos)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Eliminar códigos anteriores del mismo email
    await pool.query(
      "DELETE FROM verification_codes WHERE email = ?",
      [email]
    );

    // Guardar nuevo código en la BD
    await pool.query(
      "INSERT INTO verification_codes (email, code, expires_at) VALUES (?, ?, ?)",
      [email, code, expiresAt]
    );

    // Enviar código por correo
    const emailSent = await sendVerificationEmail(email, code);

    if (!emailSent) {
      return res.status(500).json({ error: "Error al enviar el correo electrónico" });
    }

    res.json({
      success: true,
      message: "Código de verificación enviado a tu correo electrónico"
    });

  } catch (error) {
    console.error("Error en /auth/email/request-code:", error.message);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// ========================================
// ✅ VERIFICAR CÓDIGO Y HACER LOGIN
// ========================================
router.post("/auth/email/verify-code", async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: "Email y código son requeridos" });
    }

    // Buscar código en la BD
    const [codes] = await pool.query(
      "SELECT * FROM verification_codes WHERE email = ? AND code = ? AND used = FALSE",
      [email, code]
    );

    if (codes.length === 0) {
      return res.status(401).json({ error: "Código inválido o ya utilizado" });
    }

    const verificationCode = codes[0];

    // Verificar si el código ha expirado
    if (new Date() > new Date(verificationCode.expires_at)) {
      return res.status(401).json({ error: "El código ha expirado. Solicita uno nuevo" });
    }

    // Marcar código como usado
    await pool.query(
      "UPDATE verification_codes SET used = TRUE WHERE id = ?",
      [verificationCode.id]
    );

    // Obtener datos del usuario
    const [users] = await pool.query(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    const user = users[0];

    // Generar JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        email: user.email,
        role_id: user.role_id 
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Responder con datos del usuario
    res.json({
      success: true,
      message: "Inicio de sesión exitoso",
      token,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        username: user.username,
        role_id: user.role_id,
        profile_picture: user.profile_picture
      }
    });

  } catch (error) {
    console.error("Error en /auth/email/verify-code:", error.message);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// ========================================
// 🔵 LOGIN CON GOOGLE
// ========================================
router.post("/auth/google", async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: "Token de Google no proporcionado" });
    }

    // Verificar el token de Google
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const firstName = payload.given_name;
    const lastName = payload.family_name;
    const profilePicture = payload.picture;

    // Verificar si el usuario ya existe (por google_id o email)
    const [existingUsers] = await pool.query(
      "SELECT * FROM users WHERE google_id = ? OR email = ?",
      [googleId, email]
    );

    let user;

    if (existingUsers.length > 0) {
      // Usuario existente - actualizar google_id si no lo tiene
      user = existingUsers[0];
      
      if (!user.google_id) {
        await pool.query(
          "UPDATE users SET google_id = ?, profile_picture = ? WHERE id = ?",
          [googleId, profilePicture, user.id]
        );
      }
    } else {
      // Nuevo usuario - crear cuenta con Google
      const username = email.split("@")[0]; // Usar parte del email como username
      
      // Generar contraseña aleatoria (no se usará, pero el campo es NOT NULL)
      const randomPassword = await bcrypt.hash(Math.random().toString(36), 10);

      const sql = `
        INSERT INTO users 
        (first_name, last_name, email, username, password, google_id, profile_picture, role_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const [result] = await pool.query(sql, [
        firstName,
        lastName || "",
        email,
        username,
        randomPassword,
        googleId,
        profilePicture,
        3 // role_id = 3 (Cliente por defecto)
      ]);

      // Obtener el usuario recién creado
      const [newUser] = await pool.query("SELECT * FROM users WHERE id = ?", [result.insertId]);
      user = newUser[0];
    }

    // Generar JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        email: user.email,
        role_id: user.role_id 
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Responder con datos del usuario
    res.json({
      success: true,
      message: "Inicio de sesión con Google exitoso",
      token,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        username: user.username,
        role_id: user.role_id,
        profile_picture: user.profile_picture || profilePicture
      }
    });

  } catch (error) {
    console.error("Error en /auth/google:", error.message);
    res.status(500).json({ error: "Error al autenticar con Google" });
  }
});

// ========================================
// 🔍 VERIFICAR TOKEN (Opcional - para rutas protegidas)
// ========================================
router.get("/verify", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Obtener datos actualizados del usuario
    const [users] = await pool.query("SELECT * FROM users WHERE id = ?", [decoded.id]);

    if (users.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const user = users[0];

    res.json({
      success: true,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        username: user.username,
        role_id: user.role_id,
        profile_picture: user.profile_picture
      }
    });

  } catch (error) {
    console.error("Error en /verify:", error.message);
    res.status(401).json({ error: "Token inválido o expirado" });
  }
});

// ========================================
// 🔐 SOLICITAR RECUPERACIÓN DE CONTRASEÑA
// ========================================
// ========================================
// 🔐 SOLICITAR RECUPERACIÓN DE CONTRASEÑA
// ========================================
router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "El correo electrónico es requerido" });
    }

    // 🛡️ SEGURIDAD: SIEMPRE devolver el mismo mensaje
    // Esto previene la enumeración de usuarios
    const genericResponse = {
      success: true,
      message: "Si el correo existe en nuestro sistema, recibirás un enlace de recuperación"
    };

    // Verificar si el usuario existe
    const [users] = await pool.query(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    // 👇 IMPORTANTE: Si NO existe el email, devolver mensaje genérico SIN enviar correo
    if (users.length === 0) {
      console.log(`⚠️ Intento de recuperación con email inexistente: ${email}`);
      return res.json(genericResponse); // ✅ Mismo mensaje que si existiera
    }

    // El usuario SÍ existe, proceder normalmente
    const crypto = await import("crypto");
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    // Eliminar tokens anteriores
    await pool.query(
      "DELETE FROM password_reset_tokens WHERE email = ?",
      [email]
    );

    // Guardar nuevo token
    await pool.query(
      "INSERT INTO password_reset_tokens (email, token, expires_at) VALUES (?, ?, ?)",
      [email, token, expiresAt]
    );

    // Enviar correo
    const emailSent = await sendPasswordResetEmail(email, token);

    if (!emailSent) {
      console.error(`❌ Error al enviar email a: ${email}`);
      // 🛡️ SEGURIDAD: Aún así devolver mensaje genérico
      return res.json(genericResponse);
    }

    console.log(`✅ Email de recuperación enviado a: ${email}`);

    // Devolver el mismo mensaje genérico
    res.json(genericResponse);

  } catch (error) {
    console.error("Error en /auth/forgot-password:", error.message);
    
    // 🛡️ SEGURIDAD: Incluso en error, devolver mensaje genérico
    res.json({
      success: true,
      message: "Si el correo existe en nuestro sistema, recibirás un enlace de recuperación"
    });
  }
});

// ========================================
// ✅ RESTABLECER CONTRASEÑA CON TOKEN
// ========================================
router.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token y nueva contraseña son requeridos" });
    }

    // Buscar token en la BD
    const [tokens] = await pool.query(
      "SELECT * FROM password_reset_tokens WHERE token = ? AND used = FALSE",
      [token]
    );

    if (tokens.length === 0) {
      return res.status(401).json({ error: "Token inválido o ya utilizado" });
    }

    const resetToken = tokens[0];

    // Verificar si el token ha expirado
    if (new Date() > new Date(resetToken.expires_at)) {
      return res.status(401).json({ error: "El enlace ha expirado. Solicita uno nuevo" });
    }

    // Hash de la nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Actualizar contraseña del usuario
    await pool.query(
      "UPDATE users SET password = ? WHERE email = ?",
      [hashedPassword, resetToken.email]
    );

    // Marcar token como usado
    await pool.query(
      "UPDATE password_reset_tokens SET used = TRUE WHERE id = ?",
      [resetToken.id]
    );

    res.json({
      success: true,
      message: "Contraseña actualizada correctamente"
    });

  } catch (error) {
    console.error("Error en /auth/reset-password:", error.message);
    res.status(500).json({ error: "Error en el servidor" });
  }
  
});
// ========================================
// ✅ VERIFICAR EMAIL DESPUÉS DEL REGISTRO
// ========================================
router.post("/verify-email", async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: "Email y código son requeridos" });
    }

    // Buscar código en la BD
    const [codes] = await pool.query(
      "SELECT * FROM verification_codes WHERE email = ? AND code = ? AND used = FALSE",
      [email, code]
    );

    if (codes.length === 0) {
      return res.status(401).json({ error: "Código inválido o ya utilizado" });
    }

    const verificationCode = codes[0];

    // Verificar si el código ha expirado
    if (new Date() > new Date(verificationCode.expires_at)) {
      return res.status(401).json({ error: "El código ha expirado. Solicita uno nuevo" });
    }

    // Marcar código como usado
    await pool.query(
      "UPDATE verification_codes SET used = TRUE WHERE id = ?",
      [verificationCode.id]
    );

    // Marcar usuario como verificado
    await pool.query(
      "UPDATE users SET is_verified = TRUE WHERE email = ?",
      [email]
    );

    res.json({ 
      success: true, 
      message: "Correo verificado exitosamente" 
    });

  } catch (error) {
    console.error("Error en /verify-email:", error.message);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// ========================================
// 🔄 REENVIAR CÓDIGO DE VERIFICACIÓN
// ========================================
router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "El correo electrónico es requerido" });
    }

    // Verificar que el usuario existe
    const [users] = await pool.query(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // Generar nuevo código
    const newCode = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Eliminar códigos anteriores
    await pool.query(
      "DELETE FROM verification_codes WHERE email = ?",
      [email]
    );

    // Guardar nuevo código
    await pool.query(
      "INSERT INTO verification_codes (email, code, expires_at, used) VALUES (?, ?, ?, FALSE)",
      [email, newCode, expiresAt]
    );

    // Enviar email
    const emailSent = await sendVerificationEmail(email, newCode);

    if (!emailSent) {
      return res.status(500).json({ error: "Error al enviar el correo" });
    }

    res.json({ 
      success: true, 
      message: "Código reenviado exitosamente" 
    });

  } catch (error) {
    console.error("Error en /resend-verification:", error.message);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// ========================================
// 🔒 CAMBIAR CONTRASEÑA DESDE EL PERFIL
// ========================================
router.post("/auth/change-password", async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;

    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ error: "Faltan campos requeridos" });
    }

    // Obtener usuario
    const [users] = await pool.query(
      "SELECT id, `password` FROM users WHERE id = ?",
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // Verificar contraseña actual
    const valid = await bcrypt.compare(currentPassword, users[0].password);
    if (!valid) {
      return res.status(401).json({ error: "La contraseña actual es incorrecta" });
    }

    // Actualizar contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      "UPDATE users SET `password` = ? WHERE id = ?",
      [hashedPassword, userId]
    );

    res.json({ success: true, message: "Contraseña actualizada correctamente" });

  } catch (error) {
    console.error("Error en /auth/change-password:", error.message);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

export default router;