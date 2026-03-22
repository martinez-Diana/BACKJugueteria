// routes/reportes.js
// Agregar en tu index.js/app.js:  app.use('/api/reportes', require('./routes/reportes'));

const express = require("express");
const router = express.Router();
const db = require("../db"); // ajusta según tu conexión MySQL (pool.promise())
const { verifyToken } = require("../middleware/auth"); // ajusta según tu middleware

// ─── Helper: calcular rango de fechas ────────────────────────────────────────
function getRango(query) {
  const { periodo, desde, hasta } = query;

  if (periodo === "custom" && desde && hasta) {
    return { desde, hasta };
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (periodo === "semana") {
    const day = now.getDay() || 7;
    const from = new Date(now);
    from.setDate(now.getDate() - day + 1);
    return { desde: fmt(from), hasta: fmt(now) };
  }

  if (periodo === "mes") {
    return {
      desde: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
      hasta: fmt(now),
    };
  }

  if (periodo === "year") {
    return { desde: `${now.getFullYear()}-01-01`, hasta: fmt(now) };
  }

  // fallback: mes actual
  return {
    desde: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
    hasta: fmt(now),
  };
}

// ─── Helper: etiqueta por período ────────────────────────────────────────────
function getGroupFormat(periodo) {
  if (periodo === "year") return { groupBy: "DATE_FORMAT(fecha, '%Y-%m')", label: "DATE_FORMAT(fecha, '%b %Y')" };
  if (periodo === "semana") return { groupBy: "DATE(fecha)", label: "DATE_FORMAT(fecha, '%d %b')" };
  return { groupBy: "DATE(fecha)", label: "DATE_FORMAT(fecha, '%d %b')" };
}

// ─── GET /api/reportes/ventas ─────────────────────────────────────────────────
// Query params: periodo (semana|mes|year|custom), desde, hasta
router.get("/ventas", verifyToken, async (req, res) => {
  try {
    const { desde, hasta } = getRango(req.query);
    const { groupBy, label } = getGroupFormat(req.query.periodo);

    // Serie temporal de ventas
    const [serie] = await db.query(
      `SELECT
        ${groupBy}            AS grp,
        ${label}              AS etiqueta,
        COUNT(*)              AS cantidad,
        COALESCE(SUM(total), 0) AS total
       FROM ventas
       WHERE DATE(fecha) BETWEEN ? AND ?
         AND estado != 'cancelada'
       GROUP BY grp
       ORDER BY grp ASC`,
      [desde, hasta]
    );

    res.json({ serie, desde, hasta });
  } catch (err) {
    console.error("reportes/ventas:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reportes/productos ──────────────────────────────────────────────
router.get("/productos", verifyToken, async (req, res) => {
  try {
    const { desde, hasta } = getRango(req.query);

    // Top 10 productos más vendidos
    const [productos] = await db.query(
      `SELECT
        p.nombre,
        SUM(dv.cantidad)          AS cantidad,
        SUM(dv.cantidad * dv.precio_unitario) AS ingresos
       FROM detalle_ventas dv
       JOIN productos p ON p.id_producto = dv.id_producto
       JOIN ventas v    ON v.id_venta = dv.id_venta
       WHERE DATE(v.fecha) BETWEEN ? AND ?
         AND v.estado != 'cancelada'
       GROUP BY dv.id_producto, p.nombre
       ORDER BY cantidad DESC
       LIMIT 10`,
      [desde, hasta]
    );

    // Ventas agrupadas por categoría
    const [categorias] = await db.query(
      `SELECT
        c.nombre_categoria AS nombre,
        SUM(dv.cantidad)   AS valor
       FROM detalle_ventas dv
       JOIN productos  p ON p.id_producto = dv.id_producto
       JOIN categorias c ON c.id_categoria = p.id_categoria
       JOIN ventas     v ON v.id_venta = dv.id_venta
       WHERE DATE(v.fecha) BETWEEN ? AND ?
         AND v.estado != 'cancelada'
       GROUP BY c.id_categoria, c.nombre_categoria
       ORDER BY valor DESC`,
      [desde, hasta]
    );

    res.json({ productos, categorias, desde, hasta });
  } catch (err) {
    console.error("reportes/productos:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reportes/clientes ───────────────────────────────────────────────
router.get("/clientes", verifyToken, async (req, res) => {
  try {
    const { desde, hasta } = getRango(req.query);
    const { groupBy, label } = getGroupFormat(req.query.periodo);

    // Totales
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM clientes WHERE activo = 1`
    );

    const [[{ nuevos }]] = await db.query(
      `SELECT COUNT(*) AS nuevos FROM clientes
       WHERE DATE(fecha_registro) BETWEEN ? AND ?`,
      [desde, hasta]
    );

    // Clientes que compraron más de una vez en el período
    const [[{ recurrentes }]] = await db.query(
      `SELECT COUNT(*) AS recurrentes FROM (
         SELECT id_cliente FROM ventas
         WHERE DATE(fecha) BETWEEN ? AND ? AND estado != 'cancelada'
           AND id_cliente IS NOT NULL
         GROUP BY id_cliente HAVING COUNT(*) > 1
       ) t`,
      [desde, hasta]
    );

    // Serie nuevos clientes
    const [serie] = await db.query(
      `SELECT
        ${groupBy.replace(/fecha/g, "fecha_registro")} AS grp,
        ${label.replace(/fecha/g, "fecha_registro")}   AS etiqueta,
        COUNT(*) AS nuevos
       FROM clientes
       WHERE DATE(fecha_registro) BETWEEN ? AND ?
       GROUP BY grp
       ORDER BY grp ASC`,
      [desde, hasta]
    );

    res.json({ total, nuevos, recurrentes, serie, desde, hasta });
  } catch (err) {
    console.error("reportes/clientes:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reportes/inventario ─────────────────────────────────────────────
router.get("/inventario", verifyToken, async (req, res) => {
  try {
    // Totales globales
    const [[{ total_productos, valor_total }]] = await db.query(
      `SELECT
        COUNT(*)                        AS total_productos,
        SUM(stock * precio_venta)       AS valor_total
       FROM productos
       WHERE activo = 1`
    );

    const [[{ count_bajo }]] = await db.query(
      `SELECT COUNT(*) AS count_bajo FROM productos WHERE activo = 1 AND stock > 0 AND stock <= 5`
    );

    const [[{ count_agotado }]] = await db.query(
      `SELECT COUNT(*) AS count_agotado FROM productos WHERE activo = 1 AND stock = 0`
    );

    // Stock por categoría
    const [categorias] = await db.query(
      `SELECT
        c.nombre_categoria AS nombre,
        SUM(p.stock)       AS stock
       FROM productos p
       JOIN categorias c ON c.id_categoria = p.id_categoria
       WHERE p.activo = 1
       GROUP BY c.id_categoria, c.nombre_categoria
       ORDER BY stock DESC`
    );

    // Productos agotados
    const [agotados] = await db.query(
      `SELECT nombre FROM productos WHERE activo = 1 AND stock = 0 LIMIT 20`
    );

    // Productos con stock bajo (1-5)
    const [bajo_stock] = await db.query(
      `SELECT nombre, stock FROM productos
       WHERE activo = 1 AND stock > 0 AND stock <= 5
       ORDER BY stock ASC LIMIT 20`
    );

    res.json({
      total_productos, valor_total, count_bajo, count_agotado,
      categorias, agotados, bajo_stock
    });
  } catch (err) {
    console.error("reportes/inventario:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reportes/apartados ──────────────────────────────────────────────
router.get("/apartados", verifyToken, async (req, res) => {
  try {
    const { desde, hasta } = getRango(req.query);
    const { groupBy, label } = getGroupFormat(req.query.periodo);

    // Totales
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM apartados
       WHERE DATE(fecha_creacion) BETWEEN ? AND ?`,
      [desde, hasta]
    );

    const [[{ completados }]] = await db.query(
      `SELECT COUNT(*) AS completados FROM apartados
       WHERE estado = 'completado' AND DATE(fecha_creacion) BETWEEN ? AND ?`,
      [desde, hasta]
    );

    const [[{ pendientes }]] = await db.query(
      `SELECT COUNT(*) AS pendientes FROM apartados
       WHERE estado IN ('activo','pendiente') AND DATE(fecha_creacion) BETWEEN ? AND ?`,
      [desde, hasta]
    );

    const [[{ ingresos }]] = await db.query(
      `SELECT COALESCE(SUM(monto), 0) AS ingresos FROM abonos_apartado
       WHERE DATE(fecha_abono) BETWEEN ? AND ?`,
      [desde, hasta]
    );

    // Distribución por estado
    const [estados] = await db.query(
      `SELECT estado AS nombre, COUNT(*) AS valor
       FROM apartados
       WHERE DATE(fecha_creacion) BETWEEN ? AND ?
       GROUP BY estado`,
      [desde, hasta]
    );

    // Serie de abonos por período
    const [serie_abonos] = await db.query(
      `SELECT
        ${groupBy.replace(/fecha/g, "fecha_abono")} AS grp,
        ${label.replace(/fecha/g, "fecha_abono")}   AS etiqueta,
        SUM(monto) AS monto
       FROM abonos_apartado
       WHERE DATE(fecha_abono) BETWEEN ? AND ?
       GROUP BY grp
       ORDER BY grp ASC`,
      [desde, hasta]
    );

    res.json({ total, completados, pendientes, ingresos, estados, serie_abonos, desde, hasta });
  } catch (err) {
    console.error("reportes/apartados:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;