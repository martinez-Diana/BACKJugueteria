import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import pool from '../config/db.js';

const router = express.Router();

// Cliente de Google OAuth
const googleClient = process.env.GOOGLE_CLIENT_ID 
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

// ==========================================
// 🔑 LOGIN TRADICIONAL
// ==========================================
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

    // Buscar usuario por username o email
    // ⚠️ NOTA: Usar PASSWORD en mayúsculas
    const query = `
      SELECT id, first_name, last_name, mother_lastname, email, phone, 
             username, PASSWORD, google_id, profile_picture, birthdate, 
             role_id, STATUS, created_at, updated_at
      FROM users 
      WHERE username = ? OR email = ?
      LIMIT 1
    `;
    
    const [users] = await pool.query(query, [username, username]);

    if (users.length === 0) {
      console.log('❌ Usuario no encontrado:', username);
      return res.status(401).json({ 
        error: 'Usuario o contraseña incorrectos' 
      });
    }

    const user = users[0];
    console.log('✅ Usuario encontrado:', {
      username: user.username,
      email: user.email,
      hasPassword: !!user.PASSWORD, // ← Mayúsculas
      passwordLength: user.PASSWORD?.length
    });

    // Verificar que la contraseña existe
    if (!user.PASSWORD) {
      console.log('❌ Usuario sin contraseña en BD:', username);
      return res.status(500).json({ 
        error: 'Error de configuración. Contacta al administrador.' 
      });
    }

    // Verificar contraseña
    const validPassword = await bcrypt.compare(password, user.PASSWORD);

    if (!validPassword) {
      console.log('❌ Contraseña incorrecta para:', username);
      return res.status(401).json({ 
        error: 'Usuario o contraseña incorrectos' 
      });
    }

    // Generar token JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        role_id: user.role_id,
        username: user.username 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('✅ Login exitoso:', user.username);

    // Retornar datos (sin contraseña)
    res.json({
      message: 'Login exitoso',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        mother_lastname: user.mother_lastname,
        phone: user.phone,
        birthdate: user.birthdate,
        role_id: user.role_id,
        status: user.STATUS
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

// ==========================================
// 📝 REGISTRO
// ==========================================
router.post('/register', async (req, res) => {
  try {
    const { 
      username, 
      email, 
      password, 
      first_name, 
      last_name,
      mother_lastname,
      phone,
      birthdate 
    } = req.body;

    console.log('📝 Intento de registro:', { username, email });

    // Validar datos requeridos
    if (!username || !email || !password || !first_name) {
      return res.status(400).json({ 
        error: 'Usuario, email, contraseña y nombre son requeridos' 
      });
    }

    // Verificar si el usuario ya existe
    const [existingUsers] = await pool.query(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ 
        error: 'El usuario o email ya está registrado' 
      });
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insertar nuevo usuario (role_id = 3 para clientes)
    // ⚠️ NOTA: Usar PASSWORD en mayúsculas
    const [result] = await pool.query(
      `INSERT INTO users 
       (username, email, PASSWORD, first_name, last_name, mother_lastname, phone, birthdate, role_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 3)`,
      [
        username, 
        email, 
        hashedPassword, 
        first_name, 
        last_name || null, 
        mother_lastname || null,
        phone || null,
        birthdate || null
      ]
    );

    console.log('✅ Usuario registrado:', username);

    res.status(201).json({ 
      message: 'Usuario registrado exitosamente',
      userId: result.insertId 
    });

  } catch (error) {
    console.error('❌ Error en /api/register:', error);
    res.status(500).json({ 
      error: 'Error en el servidor',
      details: error.message 
    });
  }
});

// ==========================================
// 🔵 LOGIN CON GOOGLE
// ==========================================
router.post('/auth/google', async (req, res) => {
  if (!googleClient) {
    return res.status(503).json({ 
      error: 'Autenticación con Google no configurada' 
    });
  }

  try {
    const { credential } = req.body;

    // Verificar el token de Google
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { email, given_name, family_name, sub: googleId } = payload;

    console.log('🔵 Login con Google:', email);

    // Buscar usuario por email
    let [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

    let user;

    if (users.length === 0) {
      // Crear nuevo usuario
      const username = email.split('@')[0];
      
      // ⚠️ NOTA: PASSWORD puede ser NULL para usuarios de Google
      const [result] = await pool.query(
        `INSERT INTO users 
         (username, email, first_name, last_name, google_id, role_id) 
         VALUES (?, ?, ?, ?, ?, 3)`,
        [username, email, given_name, family_name, googleId]
      );

      user = {
        id: result.insertId,
        username,
        email,
        first_name: given_name,
        last_name: family_name,
        role_id: 3
      };

      console.log('✅ Usuario creado con Google:', email);
    } else {
      user = users[0];
      
      // Actualizar google_id si no existe
      if (!user.google_id) {
        await pool.query(
          'UPDATE users SET google_id = ? WHERE id = ?',
          [googleId, user.id]
        );
      }
      
      console.log('✅ Usuario existente con Google:', email);
    }

    // Generar token
    const token = jwt.sign(
      { id: user.id, role_id: user.role_id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login con Google exitoso',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        mother_lastname: user.mother_lastname,
        role_id: user.role_id
      }
    });

  } catch (error) {
    console.error('❌ Error en /api/auth/google:', error);
    res.status(500).json({ 
      error: 'Error al autenticar con Google',
      details: error.message 
    });
  }
});

// ==========================================
// 📧 SOLICITAR CÓDIGO POR EMAIL
// ==========================================
router.post('/auth/email/request-code', async (req, res) => {
  try {
    const { email } = req.body;

    console.log('📧 Solicitando código para:', email);

    // Verificar que el usuario existe
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

    if (users.length === 0) {
      return res.status(404).json({ error: 'Email no registrado' });
    }

    // Generar código de 6 dígitos
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    // Guardar código en la base de datos
    // ⚠️ NOTA: Usar CODE en mayúsculas
    await pool.query(
      `INSERT INTO verification_codes (email, CODE, expires_at) 
       VALUES (?, ?, ?)`,
      [email, code, expiresAt]
    );

    console.log('✅ Código generado:', code, 'para:', email);

    // TODO: Enviar email real con nodemailer
    // Por ahora solo devolvemos éxito
    res.json({ 
      message: 'Código enviado exitosamente',
      // SOLO PARA DESARROLLO - ELIMINAR EN PRODUCCIÓN:
      debug_code: process.env.NODE_ENV === 'development' ? code : undefined
    });

  } catch (error) {
    console.error('❌ Error al enviar código:', error);
    res.status(500).json({ 
      error: 'Error al enviar código',
      details: error.message 
    });
  }
});

// ==========================================
// ✅ VERIFICAR CÓDIGO
// ==========================================
router.post('/auth/email/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;

    console.log('🔍 Verificando código para:', email);

    // Buscar usuario
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

    if (users.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const user = users[0];

    // Verificar código
    // ⚠️ NOTA: Usar CODE en mayúsculas
    const [codes] = await pool.query(
      `SELECT * FROM verification_codes 
       WHERE email = ? AND CODE = ? AND expires_at > NOW() AND used = 0
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );

    if (codes.length === 0) {
      return res.status(401).json({ error: 'Código inválido o expirado' });
    }

    // Marcar código como usado
    await pool.query(
      'UPDATE verification_codes SET used = 1 WHERE id = ?',
      [codes[0].id]
    );

    // Generar token
    const token = jwt.sign(
      { id: user.id, role_id: user.role_id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('✅ Código verificado para:', email);

    res.json({
      message: 'Verificación exitosa',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        mother_lastname: user.mother_lastname,
        role_id: user.role_id
      }
    });

  } catch (error) {
    console.error('❌ Error al verificar código:', error);
    res.status(500).json({ 
      error: 'Error al verificar código',
      details: error.message 
    });
  }
});

// ==========================================
// 🔄 RECUPERAR CONTRASEÑA - Solicitar token
// ==========================================
router.post('/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    console.log('🔑 Solicitud de recuperación de contraseña:', email);

    // Verificar que el usuario existe
    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

    if (users.length === 0) {
      // Por seguridad, no revelar si el email existe
      return res.json({ 
        message: 'Si el email existe, recibirás instrucciones para recuperar tu contraseña' 
      });
    }

    // Generar token único
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    // Guardar token
    await pool.query(
      `INSERT INTO password_reset_tokens (email, token, expires_at) 
       VALUES (?, ?, ?)`,
      [email, token, expiresAt]
    );

    console.log('✅ Token de recuperación generado para:', email);

    // TODO: Enviar email con link de recuperación
    res.json({ 
      message: 'Si el email existe, recibirás instrucciones para recuperar tu contraseña',
      // SOLO PARA DESARROLLO:
      debug_token: process.env.NODE_ENV === 'development' ? token : undefined
    });

  } catch (error) {
    console.error('❌ Error en forgot-password:', error);
    res.status(500).json({ error: 'Error al procesar solicitud' });
  }
});

// ==========================================
// 🔄 RECUPERAR CONTRASEÑA - Resetear
// ==========================================
router.post('/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    console.log('🔑 Intento de reseteo de contraseña');

    // Verificar token
    const [tokens] = await pool.query(
      `SELECT * FROM password_reset_tokens 
       WHERE token = ? AND expires_at > NOW() AND used = 0
       LIMIT 1`,
      [token]
    );

    if (tokens.length === 0) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    const resetToken = tokens[0];

    // Hash de la nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Actualizar contraseña
    // ⚠️ NOTA: Usar PASSWORD en mayúsculas
    await pool.query(
      'UPDATE users SET PASSWORD = ? WHERE email = ?',
      [hashedPassword, resetToken.email]
    );

    // Marcar token como usado
    await pool.query(
      'UPDATE password_reset_tokens SET used = 1 WHERE id = ?',
      [resetToken.id]
    );

    console.log('✅ Contraseña actualizada para:', resetToken.email);

    res.json({ message: 'Contraseña actualizada exitosamente' });

  } catch (error) {
    console.error('❌ Error en reset-password:', error);
    res.status(500).json({ error: 'Error al resetear contraseña' });
  }
});

export default router;