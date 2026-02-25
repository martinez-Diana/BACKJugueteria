import express from 'express';
import db from '../config/db.js';

const router = express.Router();

// 📧 Crear nuevo mensaje de contacto
router.post('/', async (req, res) => {
  try {
    const { nombre, email, telefono, asunto, mensaje } = req.body;

    // Validación
    if (!nombre || !email || !mensaje) {
      return res.status(400).json({
        success: false,
        message: 'Nombre, email y mensaje son obligatorios'
      });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Email inválido'
      });
    }

    // Insertar mensaje
    const query = `
      INSERT INTO mensajes_contacto (nombre, email, telefono, asunto, mensaje)
      VALUES (?, ?, ?, ?, ?)
    `;

    const [result] = await db.query(query, [
      nombre,
      email,
      telefono || null,
      asunto || null,
      mensaje
    ]);

    console.log('✅ Mensaje de contacto guardado:', result.insertId);

    res.status(201).json({
      success: true,
      message: 'Mensaje enviado correctamente',
      mensajeId: result.insertId
    });

  } catch (error) {
    console.error('❌ Error al guardar mensaje:', error);
    res.status(500).json({
      success: false,
      message: 'Error al enviar mensaje',
      error: error.message
    });
  }
});

// 📋 Obtener todos los mensajes (ADMIN)
router.get('/', async (req, res) => {
  try {
    const { leido, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM mensajes_contacto';
    const params = [];

    if (leido !== undefined) {
      query += ' WHERE leido = ?';
      params.push(leido === 'true' ? 1 : 0);
    }

    query += ' ORDER BY fecha_envio DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [mensajes] = await db.query(query, params);

    // Contar total de mensajes
    let countQuery = 'SELECT COUNT(*) as total FROM mensajes_contacto';
    if (leido !== undefined) {
      countQuery += ' WHERE leido = ?';
    }
    const [countResult] = await db.query(
      countQuery,
      leido !== undefined ? [leido === 'true' ? 1 : 0] : []
    );

    res.json({
      success: true,
      mensajes,
      total: countResult[0].total,
      page: Math.floor(offset / limit) + 1,
      totalPages: Math.ceil(countResult[0].total / limit)
    });

  } catch (error) {
    console.error('❌ Error al obtener mensajes:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener mensajes',
      error: error.message
    });
  }
});

// 📖 Obtener un mensaje por ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [mensajes] = await db.query(
      'SELECT * FROM mensajes_contacto WHERE id = ?',
      [id]
    );

    if (mensajes.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Mensaje no encontrado'
      });
    }

    res.json({
      success: true,
      mensaje: mensajes[0]
    });

  } catch (error) {
    console.error('❌ Error al obtener mensaje:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener mensaje',
      error: error.message
    });
  }
});

// ✅ Marcar mensaje como leído
router.patch('/:id/leer', async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      'UPDATE mensajes_contacto SET leido = TRUE WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Mensaje no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Mensaje marcado como leído'
    });

  } catch (error) {
    console.error('❌ Error al marcar mensaje:', error);
    res.status(500).json({
      success: false,
      message: 'Error al marcar mensaje',
      error: error.message
    });
  }
});

// 🗑️ Eliminar mensaje
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      'DELETE FROM mensajes_contacto WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Mensaje no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Mensaje eliminado correctamente'
    });

  } catch (error) {
    console.error('❌ Error al eliminar mensaje:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar mensaje',
      error: error.message
    });
  }
});

// 📊 Estadísticas de mensajes
router.get('/stats/resumen', async (req, res) => {
  try {
    const [stats] = await db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN leido = TRUE THEN 1 ELSE 0 END) as leidos,
        SUM(CASE WHEN leido = FALSE THEN 1 ELSE 0 END) as no_leidos,
        COUNT(DISTINCT DATE(fecha_envio)) as dias_con_mensajes
      FROM mensajes_contacto
    `);

    // Mensajes por día (últimos 7 días)
    const [mensajesPorDia] = await db.query(`
      SELECT 
        DATE(fecha_envio) as fecha,
        COUNT(*) as cantidad
      FROM mensajes_contacto
      WHERE fecha_envio >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(fecha_envio)
      ORDER BY fecha DESC
    `);

    res.json({
      success: true,
      estadisticas: {
        ...stats[0],
        mensajesPorDia
      }
    });

  } catch (error) {
    console.error('❌ Error al obtener estadísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener estadísticas',
      error: error.message
    });
  }
});

export default router;