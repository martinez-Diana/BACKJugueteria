import { createClient } from '@supabase/supabase-js';
import pool from '../config/db.js';
import express from 'express';

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Generar respaldo manual
router.post('/generar', async (req, res) => {
  try {
    // Obtener todas las tablas
    const tablas = ['users', 'productos', 'ventas', 'detalle_venta', 'backups'];
    let sqlContent = `-- Respaldo generado el ${new Date().toISOString()}\n\n`;

    for (const tabla of tablas) {
      const [rows] = await pool.query(`SELECT * FROM ${tabla}`);
      if (rows.length > 0) {
        sqlContent += `-- Tabla: ${tabla}\n`;
        for (const row of rows) {
          const valores = Object.values(row).map(v =>
            v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
          ).join(', ');
          sqlContent += `INSERT INTO ${tabla} VALUES (${valores});\n`;
        }
        sqlContent += '\n';
      }
    }

    // Subir a Supabase Storage
    const fecha = new Date();
    const nombreArchivo = `respaldo_${fecha.toISOString().slice(0,19).replace(/:/g,'-')}.sql`;
    const buffer = Buffer.from(sqlContent, 'utf-8');

    const { error: uploadError } = await supabase.storage
      .from('backups')
      .upload(nombreArchivo, buffer, { contentType: 'text/plain' });

    if (uploadError) throw uploadError;

    // Obtener URL del archivo
    const { data: urlData } = supabase.storage
      .from('backups')
      .getPublicUrl(nombreArchivo);

    // Guardar registro en la tabla backups de Aiven
    const tamaño = `${(buffer.length / 1024).toFixed(1)} KB`;
    await pool.query(
      `INSERT INTO backups (nombre, fecha, hora, tamaño, url, tipo, estado) VALUES (?, ?, ?, ?, ?, 'manual', 'completado')`,
      [nombreArchivo, fecha.toISOString().slice(0,10), fecha.toTimeString().slice(0,8), tamaño, urlData.publicUrl]
    );

    res.json({ success: true, mensaje: 'Respaldo creado exitosamente', archivo: nombreArchivo, tamaño });
  } catch (error) {
    console.error('Error al generar respaldo:', error);
    res.status(500).json({ error: 'Error al generar el respaldo' });
  }
});

// Obtener historial de respaldos
router.get('/historial', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM backups ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// Eliminar respaldo
router.delete('/eliminar/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener nombre del archivo
    const [rows] = await pool.query('SELECT nombre FROM backups WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Respaldo no encontrado' });

    const nombre = rows[0].nombre;

    // Eliminar de Supabase Storage
    await supabase.storage.from('backups').remove([nombre]);

    // Eliminar de la tabla
    await pool.query('DELETE FROM backups WHERE id = ?', [id]);

    res.json({ success: true, mensaje: 'Respaldo eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar respaldo:', error);
    res.status(500).json({ error: 'Error al eliminar el respaldo' });
  }
});
export default router;