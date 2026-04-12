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

  return {
    desde: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
    hasta: fmt(now),
  };
}

// ─── Helper: formato de agrupación ───────────────────────────────────────────
function getGroupFormat(periodo, campo = "fecha_venta") {
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  if (periodo === "year") {
    return {
      groupBy: `DATE_FORMAT(${campo}, '%Y-%m')`,
      label:   `CONCAT(MONTHNAME(${campo}), ' ', YEAR(${campo}))`,
    };
  }
  return {
    groupBy: `DATE(${campo})`,
    label:   `DATE_FORMAT(${campo}, '%d/%m')`,
  };
}

// ─── GET /api/reportes/ventas ─────────────────────────────────────────────────
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
       GROUP BY grp, etiqueta
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
router.get("/productos", async (req, res) => {
  try {
    const { desde, hasta } = getRango(req.query);

    const [productos] = await pool.query(
      `SELECT
        dv.nombre_producto       AS nombre,
        SUM(dv.cantidad)         AS cantidad,
        SUM(dv.subtotal)         AS ingresos
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
router.get("/clientes", async (req, res) => {
  try {
    const { desde, hasta } = getRango(req.query);
    const { groupBy, label } = getGroupFormat(req.query.periodo, "created_at");

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM users WHERE role_id = 3`
    );

    const [[{ nuevos }]] = await pool.query(
      `SELECT COUNT(*) AS nuevos FROM users
       WHERE role_id = 3 AND DATE(created_at) BETWEEN ? AND ?`,
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
       FROM users
       WHERE role_id = 3
         AND DATE(created_at) BETWEEN ? AND ?
       GROUP BY grp, etiqueta
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

    const [serie_abonos] = await pool.query(
      `SELECT
        ${groupBy}         AS grp,
        ${label}           AS etiqueta,
        SUM(total_abonado) AS monto
       FROM apartados
       WHERE DATE(fecha_apartado) BETWEEN ? AND ?
       GROUP BY grp, etiqueta
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


// ─── GET /api/reportes/predictivo ─────────────────────────────────────────────
// Calcula para cada producto:
//   - promedio de ventas por mes (últimos 3 meses)
//   - meses de stock restante
//   - estado predictivo
//   - alerta de temporada
router.get("/predictivo", async (req, res) => {
  try {
    // 1. Obtener ventas por producto en los últimos 3 meses
    const [ventas] = await pool.query(`
      SELECT
        dv.id_producto,
        SUM(dv.cantidad) AS total_vendido,
        COUNT(DISTINCT DATE_FORMAT(v.fecha_venta, '%Y-%m')) AS meses_con_ventas
      FROM detalle_venta dv
      INNER JOIN ventas v ON dv.id_venta = v.id_venta
      WHERE v.fecha_venta >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
        AND v.estado = 'completada'
      GROUP BY dv.id_producto
    `);

    // 2. Obtener todos los productos activos
    const [productos] = await pool.query(`
      SELECT
        id_producto,
        nombre,
        categoria,
        cantidad AS stock_actual,
        precio,
        stock_minimo
      FROM productos
      WHERE estado = 'activo'
      ORDER BY nombre ASC
    `);

    // 3. Temporadas de alta demanda
    const hoy = new Date();
    const temporadas = [
      {
        nombre: "Día del Niño",
        emoji: "🎈",
        fecha: new Date(hoy.getFullYear(), 3, 30), // Abril 30
        color: "#f97316"
      },
      {
        nombre: "Graduaciones",
        emoji: "🎓",
        fecha: new Date(hoy.getFullYear(), 6, 1), // Julio
        color: "#8b5cf6"
      },
      {
        nombre: "Navidad",
        emoji: "🎄",
        fecha: new Date(hoy.getFullYear(), 11, 25), // Diciembre 25
        color: "#10b981"
      }
    ];

    // Calcular días restantes para cada temporada
    const temporadasConDias = temporadas.map(t => {
      let fecha = new Date(t.fecha);
      // Si ya pasó este año, calcular para el siguiente
      if (fecha < hoy) {
        fecha = new Date(t.fecha.getFullYear() + 1, t.fecha.getMonth(), t.fecha.getDate());
      }
      const diasRestantes = Math.ceil((fecha - hoy) / (1000 * 60 * 60 * 24));
      return { ...t, diasRestantes, fecha: fecha.toISOString().split('T')[0] };
    }).sort((a, b) => a.diasRestantes - b.diasRestantes);

    // 4. Mapear ventas por producto
    const ventasMapa = {};
    ventas.forEach(v => {
      ventasMapa[v.id_producto] = {
        total_vendido: v.total_vendido,
        meses_con_ventas: v.meses_con_ventas
      };
    });

    // 5. Calcular predicción para cada producto
    const resultado = productos.map(p => {
      const ventaInfo = ventasMapa[p.id_producto];
      const totalVendido = ventaInfo?.total_vendido || 0;
      const mesesConVentas = ventaInfo?.meses_con_ventas || 3;

      // Promedio de ventas por mes
      const promedioMensual = mesesConVentas > 0
        ? parseFloat((totalVendido / mesesConVentas).toFixed(2))
        : 0;

      // Meses de stock restante
      const mesesRestantes = promedioMensual > 0
        ? parseFloat((p.stock_actual / promedioMensual).toFixed(1))
        : null; // null = sin movimiento

      // Determinar estado
      let estado, color, prioridad;
      if (p.stock_actual === 0) {
        estado = "Agotado";
        color = "#ef4444";
        prioridad = 4;
      } else if (promedioMensual === 0) {
        estado = "Sin movimiento";
        color = "#9ca3af";
        prioridad = 0;
      } else if (mesesRestantes <= 1) {
        estado = "Casi agotado";
        color = "#f97316";
        prioridad = 3;
      } else if (mesesRestantes <= 2) {
        estado = "Stock bajo";
        color = "#eab308";
        prioridad = 2;
      } else {
        estado = "Disponible";
        color = "#10b981";
        prioridad = 1;
      }

      // Alertas de temporada — si el stock no alcanzará para la próxima temporada
      const alertasTemporada = temporadasConDias
        .filter(t => {
          if (promedioMensual === 0 || p.stock_actual === 0) return false;
          const mesesParaTemporada = t.diasRestantes / 30;
          const stockNecesario = promedioMensual * mesesParaTemporada * 1.5; // +50% por demanda extra
          return p.stock_actual < stockNecesario && t.diasRestantes <= 90;
        })
        .map(t => t.nombre);

      return {
        id_producto: p.id_producto,
        nombre: p.nombre,
        categoria: p.categoria,
        stock_actual: p.stock_actual,
        stock_minimo: p.stock_minimo,
        total_vendido_3meses: totalVendido,
        promedio_mensual: promedioMensual,
        meses_restantes: mesesRestantes,
        estado,
        color,
        prioridad,
        alertas_temporada: alertasTemporada
      };
    });

    // Ordenar por prioridad (más críticos primero)
    resultado.sort((a, b) => b.prioridad - a.prioridad);

    // 6. Resumen
    const resumen = {
      total_productos: resultado.length,
      agotados: resultado.filter(p => p.estado === "Agotado").length,
      casi_agotados: resultado.filter(p => p.estado === "Casi agotado").length,
      stock_bajo: resultado.filter(p => p.estado === "Stock bajo").length,
      disponibles: resultado.filter(p => p.estado === "Disponible").length,
      sin_movimiento: resultado.filter(p => p.estado === "Sin movimiento").length,
    };

    res.json({
      productos: resultado,
      temporadas: temporadasConDias,
      resumen
    });

  } catch (err) {
    console.error("reportes/predictivo:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;