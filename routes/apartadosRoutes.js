import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

// ==========================================
// GET /api/apartados - Obtener todos
// ==========================================
router.get('/', async (req, res) => {
  try {
    const { estado } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (estado) { where += ' AND a.estado = ?'; params.push(estado); }

    const [rows] = await pool.query(`
      SELECT 
        a.*,
        u.first_name, u.last_name, u.email, u.phone,
        p.nombre AS producto_nombre, p.imagen AS producto_imagen,
        p.sku AS producto_sku
      FROM apartados a
      JOIN users u ON a.id_usuario = u.id
      JOIN productos p ON a.id_producto = p.id_producto
      ${where}
      ORDER BY a.created_at DESC
    `, params);

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// GET /api/apartados/stats - Estadísticas
// ==========================================
router.get('/stats', async (req, res) => {
  try {
    const [stats] = await pool.query(`
      SELECT
        COUNT(CASE WHEN estado = 'activo' THEN 1 END) AS total_activos,
        COUNT(CASE WHEN estado = 'liquidado' THEN 1 END) AS total_liquidados,
        COUNT(CASE WHEN estado = 'vencido' THEN 1 END) AS total_vencidos,
        SUM(CASE WHEN estado = 'activo' THEN precio_total ELSE 0 END) AS total_en_apartados,
        SUM(CASE WHEN estado = 'activo' THEN total_abonado ELSE 0 END) AS total_anticipos,
        SUM(CASE WHEN estado = 'activo' THEN saldo_pendiente ELSE 0 END) AS total_por_cobrar
      FROM apartados
    `);
    res.json(stats[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// GET /api/apartados/:id - Obtener uno
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        a.*,
        u.first_name, u.last_name, u.email, u.phone,
        p.nombre AS producto_nombre, p.imagen AS producto_imagen,
        p.sku AS producto_sku, p.precio AS producto_precio
      FROM apartados a
      JOIN users u ON a.id_usuario = u.id
      JOIN productos p ON a.id_producto = p.id_producto
      WHERE a.id_apartado = ?
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Apartado no encontrado' });

    const [abonos] = await pool.query(`
      SELECT * FROM abonos WHERE id_apartado = ? ORDER BY fecha_abono DESC
    `, [req.params.id]);

    res.json({ ...rows[0], abonos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// POST /api/apartados - Crear apartado
// ==========================================
router.post('/', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { id_usuario, id_producto, precio_total, anticipo, fecha_limite, notas } = req.body;

    if (!id_usuario || !id_producto || !precio_total || !anticipo || !fecha_limite) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const minimoAnticipo = precio_total * 0.20;
    if (anticipo < minimoAnticipo) {
      return res.status(400).json({ error: `El anticipo mínimo es el 20% ($${minimoAnticipo.toFixed(2)})` });
    }

    const saldo_pendiente = precio_total - anticipo;
    const fecha_apartado = new Date();

    const [result] = await connection.query(`
      INSERT INTO apartados (id_usuario, id_producto, precio_total, anticipo, total_abonado, saldo_pendiente, fecha_apartado, fecha_limite, estado, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'activo', ?)
    `, [id_usuario, id_producto, precio_total, anticipo, anticipo, saldo_pendiente, fecha_apartado, fecha_limite, notas || '']);

    await connection.query(`
      INSERT INTO abonos (id_apartado, monto, fecha_abono, notas)
      VALUES (?, ?, ?, 'Anticipo inicial')
    `, [result.insertId, anticipo, fecha_apartado]);

    await connection.commit();
    res.status(201).json({ success: true, id_apartado: result.insertId });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// ==========================================
// POST /api/apartados/:id/abonar - Registrar abono
// ==========================================
router.post('/:id/abonar', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { monto, notas } = req.body;
    const id_apartado = req.params.id;

    const [apartado] = await connection.query(
      'SELECT * FROM apartados WHERE id_apartado = ?', [id_apartado]
    );

    if (!apartado.length) return res.status(404).json({ error: 'Apartado no encontrado' });
    if (apartado[0].estado !== 'activo') return res.status(400).json({ error: 'El apartado no está activo' });
    if (monto > apartado[0].saldo_pendiente) return res.status(400).json({ error: 'El monto excede el saldo pendiente' });

    const nuevo_abonado = parseFloat(apartado[0].total_abonado) + parseFloat(monto);
    const nuevo_saldo = parseFloat(apartado[0].saldo_pendiente) - parseFloat(monto);
    const nuevo_estado = nuevo_saldo <= 0 ? 'liquidado' : 'activo';

    await connection.query(`
      UPDATE apartados SET total_abonado = ?, saldo_pendiente = ?, estado = ? WHERE id_apartado = ?
    `, [nuevo_abonado, nuevo_saldo, nuevo_estado, id_apartado]);

    await connection.query(`
      INSERT INTO abonos (id_apartado, monto, fecha_abono, notas) VALUES (?, ?, ?, ?)
    `, [id_apartado, monto, new Date(), notas || '']);

    await connection.commit();
    res.json({ success: true, estado: nuevo_estado, saldo_pendiente: nuevo_saldo });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// ==========================================
// PUT /api/apartados/:id/cancelar
// ==========================================
router.put('/:id/cancelar', async (req, res) => {
  try {
    await pool.query(
      'UPDATE apartados SET estado = "cancelado" WHERE id_apartado = ?', [req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;