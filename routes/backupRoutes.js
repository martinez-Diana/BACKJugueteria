import { createClient } from '@supabase/supabase-js';
import pool from '../config/db.js';
import express from 'express';

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Todas las tablas disponibles del sistema
const TODAS_LAS_TABLAS = [
  'users', 'productos', 'ventas', 'detalle_venta',
  'apartados', 'abonos', 'ofertas', 'roles',
  'mensajes_contacto', 'historial_cambios', 'backups'
];

// ==========================================
// 📋 RUTA: OBTENER TABLAS DISPONIBLES
// ==========================================
router.get('/tablas', async (req, res) => {
  try {
    res.json({ tablas: TODAS_LAS_TABLAS });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener tablas' });
  }
});

// ==========================================
// 🗄️ RUTA: GENERAR RESPALDO
// Acepta { modo: 'completo' | 'especifico', tablas: [...] }
// ==========================================
router.post('/generar', async (req, res) => {
  try {
    const { modo = 'completo', tablas: tablasSeleccionadas } = req.body;

    // Determinar qué tablas respaldar
    const tablas = modo === 'completo'
      ? TODAS_LAS_TABLAS
      : (tablasSeleccionadas || TODAS_LAS_TABLAS);

    // Validar que las tablas sean válidas
    const tablasValidas = tablas.filter(t => TODAS_LAS_TABLAS.includes(t));
    if (tablasValidas.length === 0) {
      return res.status(400).json({ error: 'No se seleccionaron tablas válidas' });
    }

    let sqlContent = `-- Respaldo generado el ${new Date().toISOString()}\n`;
    sqlContent += `-- Modo: ${modo === 'completo' ? 'Base de datos completa' : 'Tablas específicas'}\n`;
    sqlContent += `-- Tablas incluidas: ${tablasValidas.join(', ')}\n\n`;

    for (const tabla of tablasValidas) {
      try {
        const [rows] = await pool.query(`SELECT * FROM ${tabla}`);
        sqlContent += `-- ==========================================\n`;
        sqlContent += `-- Tabla: ${tabla} (${rows.length} registros)\n`;
        sqlContent += `-- ==========================================\n`;

        if (rows.length > 0) {
          for (const row of rows) {
            const valores = Object.values(row).map(v =>
              v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
            ).join(', ');
            sqlContent += `INSERT INTO ${tabla} VALUES (${valores});\n`;
          }
        } else {
          sqlContent += `-- (tabla vacía)\n`;
        }
        sqlContent += '\n';
      } catch (err) {
        // Si la tabla no existe, la saltamos
        sqlContent += `-- ADVERTENCIA: No se pudo respaldar tabla "${tabla}": ${err.message}\n\n`;
      }
    }

    // Subir a Supabase Storage
    const fecha = new Date();
    const fechaMx = new Date(fecha.getTime() - 6 * 60 * 60 * 1000);
    const tipoLabel = modo === 'completo' ? 'completo' : 'parcial';
    const nombreArchivo = `respaldo_${tipoLabel}_${fechaMx.toISOString().slice(0, 19).replace(/:/g, '-')}.sql`;
    const buffer = Buffer.from(sqlContent, 'utf-8');

    const { error: uploadError } = await supabase.storage
      .from('backups')
      .upload(nombreArchivo, buffer, { contentType: 'text/plain' });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('backups')
      .getPublicUrl(nombreArchivo);

    const tamaño = `${(buffer.length / 1024).toFixed(1)} KB`;

    await pool.query(
      `INSERT INTO backups (nombre, fecha, hora, \`tamaño\`, url, tipo, estado) VALUES (?, ?, ?, ?, ?, 'manual', 'completado')`,
      [
        nombreArchivo,
        fechaMx.toISOString().slice(0, 10),
        fechaMx.toISOString().slice(11, 19),
        tamaño,
        urlData.publicUrl
      ]
    );

    res.json({
      success: true,
      mensaje: 'Respaldo creado exitosamente',
      archivo: nombreArchivo,
      tamaño,
      tablas_respaldadas: tablasValidas.length,
      modo
    });

  } catch (error) {
    console.error('Error al generar respaldo:', error);
    res.status(500).json({ error: 'Error al generar el respaldo', details: error.message });
  }
});

// ==========================================
// 📋 RUTA: HISTORIAL DE RESPALDOS
// ==========================================
router.get('/historial', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM backups ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// ==========================================
// 🗑️ RUTA: ELIMINAR RESPALDO
// ==========================================
router.delete('/eliminar/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query('SELECT nombre FROM backups WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Respaldo no encontrado' });

    const nombre = rows[0].nombre;

    await supabase.storage.from('backups').remove([nombre]);
    await pool.query('DELETE FROM backups WHERE id = ?', [id]);

    res.json({ success: true, mensaje: 'Respaldo eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar respaldo:', error);
    res.status(500).json({ error: 'Error al eliminar el respaldo' });
  }
});

export default router;