import express from "express";
import pool from "../config/db.js";

const router = express.Router();

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

  if (periodo === "year") {
    return { desde: `${now.getFullYear()}-01-01`, hasta: fmt(now) };
  }

  // default: mes actual
  return {
    desde: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
    hasta: fmt(now),
  };
}

// ─── Helper: formato de agrupación ───────────────────────────────────────────
function getGroupFormat(periodo, campo = "fecha_venta") {
  if (periodo === "year") {
    return {
      groupBy: `DATE_FORMAT(${campo}, '%Y-%m')`,
      label:   `DATE_FORMAT(${campo}, '%b %Y')`,
    };
  }
  return {
    groupBy: `DATE(${campo})`,
    label:   `DATE_FORMAT(${campo}, '%d %b')`,
  };
}

// ─── GET /api/reportes/ventas ─────────────────────────────────────────────────
// Tabla: ventas — fecha_venta, total, estado ('completada')
router.get("/ventas", async (req, res) => {
  try {
    const { desde, hasta } = getRango(req.query);
    const { groupBy, label } = getGroupFormat(req.query.periodo, "fecha_venta");

    const [serie] = await pool.query(
      `SELECT
        ${groupBy}               AS grp,
        ${label}                 AS etiqueta,
        COUNT(*)                 AS cantidad,
        COALESCE(SUM(total), 0)  AS total
       FROM ventas
       WHERE DATE(fecha_venta) BETWEEN ? AND ?
         AND estado = 'completada'
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
// Tablas: detalle_venta (id_venta, id_producto, cantidad, precio_unitario)
//         productos (id_producto, nombre, categoria)
//         ventas (id_venta, fecha_venta, estado)
router.get("/productos", async (req, res) => {
  try {
    const { desde, hasta } = getRango(req.query);

    const [productos] = await pool.query(
      `SELECT
        dv.nombre_producto          AS nombre,
        SUM(dv.cantidad)            AS cantidad,
        SUM(dv.subtotal)            AS ingresos
       FROM detalle_venta dv
       JOIN ventas v ON v.id_venta = dv.id_venta
       WHERE DATE(v.fecha_venta) BETWEEN ? AND ?
         AND v.estado = 'completada'
       GROUP BY dv.nombre_producto
       ORDER BY cantidad DESC
       LIMIT 10`,
      [desde, hasta]
    );

    const [categorias] = await pool.query(
      `SELECT
        p.categoria        AS nombre,
        SUM(dv.cantidad)   AS valor
       FROM detalle_venta dv
       JOIN productos p ON p.id_producto = dv.id_producto
       JOIN ventas    v ON v.id_venta    = dv.id_venta
       WHERE DATE(v.fecha_venta) BETWEEN ? AND ?
         AND v.estado = 'completada'
       GROUP BY p.categoria
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
// Tabla: users — rol = 3 para clientes, fecha_registro
router.get("/clientes", async (req, res) => {
  try {
    const { desde, hasta } = getRango(req.query);
    const { groupBy, label } = getGroupFormat(req.query.periodo, "fecha_registro");

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM usuarios WHERE rol = 3`
    );

    const [[{ nuevos }]] = await pool.query(
      `SELECT COUNT(*) AS nuevos FROM usuarios
       WHERE rol = 3 AND DATE(fecha_registro) BETWEEN ? AND ?`,
      [desde, hasta]
    );

    const [[{ recurrentes }]] = await pool.query(
      `SELECT COUNT(*) AS recurrentes FROM (
         SELECT id_usuario FROM ventas
         WHERE DATE(fecha_venta) BETWEEN ? AND ?
           AND estado = 'completada'
           AND id_usuario IS NOT NULL
         GROUP BY id_usuario HAVING COUNT(*) > 1
       ) t`,
      [desde, hasta]
    );

    const [serie] = await pool.query(
      `SELECT
        ${groupBy} AS grp,
        ${label}   AS etiqueta,
        COUNT(*)   AS nuevos
       FROM usuarios
       WHERE rol = 3
         AND DATE(fecha_registro) BETWEEN ? AND ?
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
// Tabla: productos — cantidad, precio, categoria, estado ('activo')
router.get("/inventario", async (req, res) => {
  try {
    const [[{ total_productos, valor_total }]] = await pool.query(
      `SELECT
        COUNT(*)               AS total_productos,
        SUM(cantidad * precio) AS valor_total
       FROM productos
       WHERE estado = 'activo'`
    );

    const [[{ count_bajo }]] = await pool.query(
      `SELECT COUNT(*) AS count_bajo
       FROM productos
       WHERE estado = 'activo' AND cantidad > 0 AND cantidad <= 5`
    );

    const [[{ count_agotado }]] = await pool.query(
      `SELECT COUNT(*) AS count_agotado
       FROM productos
       WHERE estado = 'activo' AND cantidad = 0`
    );

    const [categorias] = await pool.query(
      `SELECT
        categoria      AS nombre,
        SUM(cantidad)  AS stock
       FROM productos
       WHERE estado = 'activo'
       GROUP BY categoria
       ORDER BY stock DESC`
    );

    const [agotados] = await pool.query(
      `SELECT nombre FROM productos
       WHERE estado = 'activo' AND cantidad = 0
       LIMIT 20`
    );

    const [bajo_stock] = await pool.query(
      `SELECT nombre, cantidad AS stock
       FROM productos
       WHERE estado = 'activo' AND cantidad > 0 AND cantidad <= 5
       ORDER BY cantidad ASC
       LIMIT 20`
    );

    res.json({
      total_productos,
      valor_total,
      count_bajo,
      count_agotado,
      categorias,
      agotados,
      bajo_stock,
    });
  } catch (err) {
    console.error("reportes/inventario:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reportes/apartados ──────────────────────────────────────────────
// Tabla: apartados — fecha_apartado, estado ('activo','liquidado','cancelado')
//                    total_abonado, anticipo
router.get("/apartados", async (req, res) => {
  try {
    const { desde, hasta } = getRango(req.query);
    const { groupBy, label } = getGroupFormat(req.query.periodo, "fecha_apartado");

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM apartados
       WHERE DATE(fecha_apartado) BETWEEN ? AND ?`,
      [desde, hasta]
    );

    const [[{ completados }]] = await pool.query(
      `SELECT COUNT(*) AS completados FROM apartados
       WHERE estado = 'liquidado'
         AND DATE(fecha_apartado) BETWEEN ? AND ?`,
      [desde, hasta]
    );

    const [[{ pendientes }]] = await pool.query(
      `SELECT COUNT(*) AS pendientes FROM apartados
       WHERE estado = 'activo'
         AND DATE(fecha_apartado) BETWEEN ? AND ?`,
      [desde, hasta]
    );

    const [[{ ingresos }]] = await pool.query(
      `SELECT COALESCE(SUM(total_abonado), 0) AS ingresos
       FROM apartados
       WHERE DATE(fecha_apartado) BETWEEN ? AND ?`,
      [desde, hasta]
    );

    const [estados] = await pool.query(
      `SELECT estado AS nombre, COUNT(*) AS valor
       FROM apartados
       WHERE DATE(fecha_apartado) BETWEEN ? AND ?
       GROUP BY estado`,
      [desde, hasta]
    );

    // Serie de abonos por período usando total_abonado de apartados
    const [serie_abonos] = await pool.query(
      `SELECT
        ${groupBy} AS grp,
        ${label}   AS etiqueta,
        SUM(total_abonado) AS monto
       FROM apartados
       WHERE DATE(fecha_apartado) BETWEEN ? AND ?
       GROUP BY grp
       ORDER BY grp ASC`,
      [desde, hasta]
    );

    res.json({
      total,
      completados,
      pendientes,
      ingresos,
      estados,
      serie_abonos,
      desde,
      hasta,
    });
  } catch (err) {
    console.error("reportes/apartados:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;