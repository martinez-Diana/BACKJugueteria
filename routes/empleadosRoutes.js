import express from 'express';
import pool from '../config/db.js';
import bcrypt from 'bcryptjs';

const router = express.Router();

// GET /api/empleados - Obtener todos
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, u.mother_lastname,
             u.email, u.phone, u.username, u.status, u.created_at,
             u.last_login, r.name AS rol
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.role_id = 2
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/empleados - Crear empleado
router.post('/', async (req, res) => {
  try {
    const { first_name, last_name, mother_lastname, email, phone, username, password } = req.body;

    if (!first_name || !last_name || !email || !username || !password) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const [existe] = await pool.query(
      'SELECT id FROM users WHERE email = ? OR username = ?', [email, username]
    );
    if (existe.length) {
      return res.status(400).json({ error: 'El email o usuario ya existe' });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(`
      INSERT INTO users (first_name, last_name, mother_lastname, email, phone, username, password, role_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 2, 'active')
    `, [first_name, last_name, mother_lastname || '', email, phone || '', username, hash]);

    res.status(201).json({ success: true, id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/empleados/:id - Editar empleado
router.put('/:id', async (req, res) => {
  try {
    const { first_name, last_name, mother_lastname, email, phone, username } = req.body;
    await pool.query(`
      UPDATE users SET first_name=?, last_name=?, mother_lastname=?, email=?, phone=?, username=?
      WHERE id=? AND role_id=2
    `, [first_name, last_name, mother_lastname || '', email, phone || '', username, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/empleados/:id/estado - Cambiar estado
router.put('/:id/estado', async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query(
      'UPDATE users SET status=? WHERE id=? AND role_id=2', [status, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// GET /api/empleados/:id/ventas - Historial de ventas del empleado
router.get('/:id/ventas', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        v.folio, v.fecha_venta, v.total, v.metodo_pago, v.estado,
        CONCAT(u.first_name, ' ', u.last_name) AS cliente
      FROM ventas v
      JOIN users u ON v.id_usuario = u.id
      WHERE v.id_empleado = ? OR v.creado_por = ?
      ORDER BY v.fecha_venta DESC
      LIMIT 20
    `, [req.params.id, req.params.id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/empleados/:id/reset-password
router.put('/:id/reset-password', async (req, res) => {
  try {
    const { nueva_password } = req.body;
    if (!nueva_password || nueva_password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    const hash = await bcrypt.hash(nueva_password, 10);
    await pool.query(
      'UPDATE users SET password = ? WHERE id = ? AND role_id = 2',
      [hash, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;