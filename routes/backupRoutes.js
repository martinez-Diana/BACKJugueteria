import { createClient } from '@supabase/supabase-js';
import pool from '../config/db.js';
import express from 'express';

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TODAS_LAS_TABLAS = [
  'users', 'productos', 'ventas', 'detalle_venta',
  'apartados', 'abonos', 'ofertas', 'roles',
  'mensajes_contacto', 'historial_cambios', 'backups'
];

// ==========================================
// 🔧 FUNCIÓN REUTILIZABLE: GENERAR RESPALDO
// ==========================================
const generarRespaldo = async (modo, tablasSeleccionadas, tipoRespaldo = 'manual') => {
  const tablas = modo === 'completo' ? TODAS_LAS_TABLAS : (tablasSeleccionadas || TODAS_LAS_TABLAS);
  const tablasValidas = tablas.filter(t => TODAS_LAS_TABLAS.includes(t));

  if (tablasValidas.length === 0) throw new Error('No se seleccionaron tablas válidas');

  let sqlContent = `-- Respaldo generado el ${new Date().toISOString()}\n`;
  sqlContent += `-- Tipo: ${tipoRespaldo}\n`;
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
      sqlContent += `-- ADVERTENCIA: No se pudo respaldar tabla "${tabla}": ${err.message}\n\n`;
    }
  }

  const fecha = new Date();
  const fechaMx = new Date(fecha.getTime() - 6 * 60 * 60 * 1000);
  const tipoLabel = modo === 'completo' ? 'completo' : 'parcial';
  const nombreArchivo = `respaldo_${tipoLabel}_${tipoRespaldo}_${fechaMx.toISOString().slice(0, 19).replace(/:/g, '-')}.sql`;
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
    `INSERT INTO backups (nombre, fecha, hora, \`tamaño\`, url, tipo, estado) VALUES (?, ?, ?, ?, ?, ?, 'completado')`,
    [
      nombreArchivo,
      fechaMx.toISOString().slice(0, 10),
      fechaMx.toISOString().slice(11, 19),
      tamaño,
      urlData.publicUrl,
      tipoRespaldo
    ]
  );

  // Actualizar ultimo_respaldo en configuracion
  await pool.query(
    `UPDATE configuracion_respaldo SET ultimo_respaldo = NOW() WHERE id = 1`
  );

  return { nombreArchivo, tamaño, tablasRespaldadas: tablasValidas.length };
};

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
// ⚙️ RUTA: OBTENER CONFIGURACIÓN DEL CRON
// ==========================================
router.get('/configuracion', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM configuracion_respaldo WHERE id = 1');
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Configuración no encontrada' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

// ==========================================
// ⚙️ RUTA: ACTUALIZAR CONFIGURACIÓN DEL CRON
// ==========================================
router.put('/configuracion', async (req, res) => {
  try {
    const { activo, modo, tablas } = req.body;

    await pool.query(
      `UPDATE configuracion_respaldo SET activo = ?, modo = ?, tablas = ? WHERE id = 1`,
      [activo, modo, tablas ? JSON.stringify(tablas) : null]
    );

    res.json({ success: true, mensaje: 'Configuración actualizada correctamente' });
  } catch (error) {
    console.error('Error al actualizar configuración:', error);
    res.status(500).json({ error: 'Error al actualizar configuración' });
  }
});

// ==========================================
// 🤖 RUTA: RESPALDO AUTOMÁTICO (Vercel Cron)
// Vercel llama a este endpoint cada 24 horas
// ==========================================
router.get('/auto', async (req, res) => {
  try {
    console.log('🤖 Cron ejecutado:', new Date().toISOString());

    // Verificar si el respaldo automático está activo
    const [config] = await pool.query('SELECT * FROM configuracion_respaldo WHERE id = 1');

    if (!config.length || !config[0].activo) {
      console.log('⏸ Respaldo automático desactivado, omitiendo...');
      return res.json({ success: true, mensaje: 'Respaldo automático desactivado, omitiendo.' });
    }

    const { modo, tablas } = config[0];
    const tablasSeleccionadas = tablas ? JSON.parse(tablas) : TODAS_LAS_TABLAS;

    const resultado = await generarRespaldo(modo, tablasSeleccionadas, 'automatico');

    console.log('✅ Respaldo automático completado:', resultado.nombreArchivo);

    res.json({
      success: true,
      mensaje: 'Respaldo automático completado',
      ...resultado
    });

  } catch (error) {
    console.error('❌ Error en respaldo automático:', error);
    res.status(500).json({ error: 'Error en respaldo automático', details: error.message });
  }
});

// ==========================================
// 🗄️ RUTA: GENERAR RESPALDO MANUAL
// ==========================================
router.post('/generar', async (req, res) => {
  try {
    const { modo = 'completo', tablas: tablasSeleccionadas } = req.body;

    if (modo === 'especifico' && (!tablasSeleccionadas || tablasSeleccionadas.length === 0)) {
      return res.status(400).json({ error: 'No se seleccionaron tablas válidas' });
    }

    const resultado = await generarRespaldo(modo, tablasSeleccionadas, 'manual');

    res.json({
      success: true,
      mensaje: 'Respaldo creado exitosamente',
      archivo: resultado.nombreArchivo,
      tamaño: resultado.tamaño,
      tablas_respaldadas: resultado.tablasRespaldadas,
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
    const [rows] = await pool.query('SELECT * FROM backups ORDER BY fecha DESC, hora DESC');
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

    await supabase.storage.from('backups').remove([rows[0].nombre]);
    await pool.query('DELETE FROM backups WHERE id = ?', [id]);

    res.json({ success: true, mensaje: 'Respaldo eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar respaldo:', error);
    res.status(500).json({ error: 'Error al eliminar el respaldo' });
  }
});

export default router;