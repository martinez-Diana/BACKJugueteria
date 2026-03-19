import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

const toCSV = (rows) => {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]).join(';');
  const lines = rows.map(row =>
    Object.values(row).map(val => {
      if (val === null || val === undefined) return '';
      const str = String(val).replace(/"/g, '""');
      return str.includes(';') || str.includes('\n') ? `"${str}"` : str;
    }).join(';')
  );
  return [headers, ...lines].join('\n');
};

function sendCSV(res, filename, rows) {
  const csv = toCSV(rows);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.send(csv);
}

function filtrarColumnas(rows, columnas) {
  if (!columnas) return rows;
  const cols = columnas.split(',').map(c => decodeURIComponent(c.trim().replace(/\+/g, ' ')));
  return rows.map(row => {
    const filtered = {};
    cols.forEach(col => { if (row[col] !== undefined) filtered[col] = row[col]; });
    return filtered;
  });
}

router.get('/productos', async (req, res) => {
  try {
    const { columnas } = req.query;
    const [rows] = await pool.query(`
      SELECT sku AS 'SKU', nombre AS 'Nombre', categoria AS 'Categoria',
             marca AS 'Marca', precio AS 'Precio Venta',
             precio_compra AS 'Precio Compra', cantidad AS 'Stock',
             stock_minimo AS 'Stock Minimo', edad_recomendada AS 'Edad Recomendada'
      FROM productos ORDER BY categoria, nombre
    `);
    const fecha = new Date().toISOString().slice(0, 10);
    sendCSV(res, `productos_${fecha}.csv`, filtrarColumnas(rows, columnas));
  } catch (error) {
    console.error('Error exportar productos:', error);
    res.status(500).json({ error: 'Error al exportar productos' });
  }
});

router.get('/inventario', async (req, res) => {
  try {
    const { columnas } = req.query;
    const [rows] = await pool.query(`
      SELECT sku AS 'SKU', nombre AS 'Producto', categoria AS 'Categoria',
             cantidad AS 'Stock Actual', stock_minimo AS 'Stock Minimo',
             CASE
               WHEN cantidad = 0 THEN 'Agotado'
               WHEN cantidad <= stock_minimo THEN 'Stock Bajo'
               ELSE 'Normal'
             END AS 'Estado',
             precio_compra AS 'Precio Compra',
             precio AS 'Precio Venta',
             (precio - precio_compra) AS 'Ganancia Unitaria',
             (precio_compra * cantidad) AS 'Valor en Inventario'
      FROM productos
      ORDER BY CASE WHEN cantidad = 0 THEN 0 WHEN cantidad <= stock_minimo THEN 1 ELSE 2 END, nombre
    `);
    const fecha = new Date().toISOString().slice(0, 10);
    sendCSV(res, `inventario_${fecha}.csv`, filtrarColumnas(rows, columnas));
  } catch (error) {
    console.error('Error exportar inventario:', error);
    res.status(500).json({ error: 'Error al exportar inventario' });
  }
});

router.get('/ventas', async (req, res) => {
  try {
    const { desde, hasta, estado, metodo_pago, columnas } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (desde) { where += ' AND DATE(v.fecha_venta) >= ?'; params.push(desde); }
    if (hasta) { where += ' AND DATE(v.fecha_venta) <= ?'; params.push(hasta); }
    if (estado) { where += ' AND v.estado = ?'; params.push(estado); }
    if (metodo_pago) { where += ' AND v.metodo_pago = ?'; params.push(metodo_pago); }

    const [rows] = await pool.query(`
      SELECT v.folio AS 'Folio',
             DATE_FORMAT(CONVERT_TZ(v.fecha_venta, '+00:00', '-06:00'), '%d/%m/%Y %H:%i') AS 'Fecha',
             CONCAT(u.first_name, ' ', u.last_name) AS 'Cliente',
             u.email AS 'Email',
             dv.nombre_producto AS 'Producto',
             dv.cantidad AS 'Cantidad',
             dv.precio_unitario AS 'Precio Unitario',
             dv.subtotal AS 'Subtotal',
             v.total AS 'Total',
             v.metodo_pago AS 'Metodo Pago',
             v.estado AS 'Estado'
      FROM ventas v
      JOIN detalle_venta dv ON v.id_venta = dv.id_venta
      JOIN users u ON v.id_usuario = u.id
      ${where}
      ORDER BY v.fecha_venta DESC
    `, params);

    const fecha = new Date().toISOString().slice(0, 10);
    sendCSV(res, `ventas_${fecha}.csv`, filtrarColumnas(rows, columnas));
  } catch (error) {
    console.error('Error exportar ventas:', error);
    res.status(500).json({ error: 'Error al exportar ventas' });
  }
});

router.get('/clientes', async (req, res) => {
  try {
    const { columnas } = req.query;
    const [rows] = await pool.query(`
      SELECT id AS 'ID', first_name AS 'Nombre', last_name AS 'Apellido Paterno',
             mother_lastname AS 'Apellido Materno', email AS 'Email',
             phone AS 'Telefono', username AS 'Usuario',
             STATUS AS 'Estado',
             DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '-06:00'), '%d/%m/%Y %H:%i') AS 'Fecha Registro'
      FROM users
      WHERE role_id = 3
      ORDER BY first_name
    `);
    const fecha = new Date().toISOString().slice(0, 10);
    sendCSV(res, `clientes_${fecha}.csv`, filtrarColumnas(rows, columnas));
  } catch (error) {
    console.error('Error exportar clientes:', error);
    res.status(500).json({ error: 'Error al exportar clientes' });
  }
});

export default router;