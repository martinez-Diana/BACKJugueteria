import express from "express";
import pool from "../config/db.js";

const router = express.Router();

// Temporadas pico definidas (t = mes - 1, siendo enero = t=0)
const TEMPORADAS = [
  { nombre: "Día del Niño", mes: "Abril", t: 3 },
  { nombre: "Graduaciones", mes: "Junio", t: 5 },
  { nombre: "Navidad", mes: "Diciembre", t: 11 },
];

// GET /api/prediccion
router.get("/", async (req, res) => {
  try {
    // 1. Obtener todos los productos activos con su stock
    const [productos] = await pool.query(`
      SELECT id_producto, nombre, categoria, cantidad AS stock_actual, stock_minimo
      FROM productos
      WHERE estado = 'activo'
      ORDER BY categoria, nombre
    `);

    if (productos.length === 0) {
      return res.json({ predicciones: [] });
    }

    // 2. Obtener ventas por producto agrupadas por mes (últimos 12 meses)
    const [ventas] = await pool.query(`
      SELECT 
        dv.id_producto,
        YEAR(v.fecha_venta) AS anio,
        MONTH(v.fecha_venta) AS mes,
        SUM(dv.cantidad) AS total_vendido
      FROM detalle_venta dv
      INNER JOIN ventas v ON dv.id_venta = v.id_venta
      WHERE v.estado = 'completada'
        AND v.fecha_venta >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY dv.id_producto, anio, mes
      ORDER BY dv.id_producto, anio, mes
    `);

    // 3. Agrupar ventas por producto
    const ventasPorProducto = {};
    ventas.forEach((row) => {
      if (!ventasPorProducto[row.id_producto]) {
        ventasPorProducto[row.id_producto] = [];
      }
      ventasPorProducto[row.id_producto].push({
        anio: row.anio,
        mes: row.mes,
        total: row.total_vendido,
      });
    });

    // 4. Calcular predicción para cada producto
    const predicciones = productos.map((producto) => {
      const historial = ventasPorProducto[producto.id_producto] || [];

      // Necesitamos al menos 2 meses de datos para calcular k
      if (historial.length < 2) {
        return {
          id_producto: producto.id_producto,
          nombre: producto.nombre,
          categoria: producto.categoria,
          stock_actual: producto.stock_actual,
          stock_minimo: producto.stock_minimo,
          estado_prediccion: "sin_datos",
          mensaje: "Sin suficientes datos de ventas",
          proyecciones: [],
          mes_agotamiento: null,
        };
      }

      // Tomar los 2 meses más recientes para calcular P0 y k
      const ordenado = historial.sort((a, b) =>
        a.anio !== b.anio ? a.anio - b.anio : a.mes - b.mes
      );
      const P0 = ordenado[ordenado.length - 2].total; // penúltimo mes
      const P1 = ordenado[ordenado.length - 1].total; // último mes

      // Si P0 es 0 evitamos división por cero
      if (P0 === 0 || P1 === 0) {
        return {
          id_producto: producto.id_producto,
          nombre: producto.nombre,
          categoria: producto.categoria,
          stock_actual: producto.stock_actual,
          stock_minimo: producto.stock_minimo,
          estado_prediccion: "sin_datos",
          mensaje: "Ventas en cero en meses recientes",
          proyecciones: [],
          mes_agotamiento: null,
        };
      }

      // Calcular k: k = ln(P1/P0)
      const k = Math.log(P1 / P0);

      // Mes base = mes actual (t=0 relativo)
      const ahora = new Date();
      const mesActual = ahora.getMonth() + 1; // 1-12

      // Proyectar para cada temporada
      const proyecciones = TEMPORADAS.map((temporada) => {
        // Calcular t relativo al mes actual
        let tRelativo = temporada.t + 1 - mesActual; // +1 porque t=0 es enero (mes 1)
        if (tRelativo <= 0) tRelativo += 12; // si ya pasó, proyectar al siguiente año

        const ventasProyectadas = Math.round(P1 * Math.exp(k * tRelativo));
        const cubre = producto.stock_actual >= ventasProyectadas;
        const porcentajeCubierto =
          ventasProyectadas > 0
            ? Math.min(
                100,
                Math.round((producto.stock_actual / ventasProyectadas) * 100)
              )
            : 100;

        return {
          temporada: temporada.nombre,
          mes: temporada.mes,
          ventas_proyectadas: ventasProyectadas,
          cubre_demanda: cubre,
          porcentaje_cubierto: porcentajeCubierto,
        };
      });

      // Calcular mes estimado de agotamiento T*
      // S = P1 * e^(k*T*) => T* = ln(S/P1) / k
      let mesAgotamiento = null;
      if (k > 0 && producto.stock_actual > 0 && P1 > 0) {
        const tEstrella = Math.log(producto.stock_actual / P1) / k;
        if (tEstrella > 0) {
          const mesAgotamientoNum = ((mesActual - 1 + Math.ceil(tEstrella)) % 12) + 1;
          const nombresMeses = [
            "Enero","Febrero","Marzo","Abril","Mayo","Junio",
            "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
          ];
          mesAgotamiento = nombresMeses[mesAgotamientoNum - 1];
        }
      }

      // Determinar estado de predicción según la temporada más próxima
      const proximaTemporada = proyecciones[0]; // la más cercana cronológicamente
      let estado_prediccion;

      if (producto.stock_actual === 0) {
        estado_prediccion = "agotado";
      } else if (proximaTemporada.porcentaje_cubierto >= 75) {
        estado_prediccion = "disponible";
      } else if (proximaTemporada.porcentaje_cubierto >= 40) {
        estado_prediccion = "bajo_stock";
      } else if (proximaTemporada.porcentaje_cubierto >= 10) {
        estado_prediccion = "casi_agotado";
      } else {
        estado_prediccion = "agotado";
      }

      return {
        id_producto: producto.id_producto,
        nombre: producto.nombre,
        categoria: producto.categoria,
        stock_actual: producto.stock_actual,
        stock_minimo: producto.stock_minimo,
        k: parseFloat(k.toFixed(4)),
        P0,
        P1,
        estado_prediccion,
        proyecciones,
        mes_agotamiento: mesAgotamiento,
      };
    });

    res.json({ predicciones });
  } catch (error) {
    console.error("❌ Error en predicción:", error);
    res.status(500).json({ error: "Error al calcular predicciones" });
  }
});

export default router;