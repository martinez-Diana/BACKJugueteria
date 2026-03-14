import express from "express";
import pool from "../config/db.js";
import logger from "../utils/logger.js";
const CTX = "VentasService";

const router = express.Router();

// ==========================================
// 📋 RUTA 1: OBTENER TODAS LAS VENTAS
// ==========================================
router.get("/", async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, estado, metodo_pago } = req.query;
    
    logger.info("Consultando lista de ventas", { context: CTX });

    let query = `
      SELECT 
        v.id_venta,
        v.folio,
        v.fecha_venta,
        v.subtotal,
        v.descuento,
        v.total,
        v.metodo_pago,
        v.estado,
        v.notas,
        u.first_name,
        u.last_name,
        u.email,
        (SELECT COUNT(*) FROM detalle_venta WHERE id_venta = v.id_venta) as total_productos
      FROM ventas v
      LEFT JOIN users u ON v.id_usuario = u.id
      WHERE 1=1
    `;
    
    const params = [];

    // Filtros
    if (fecha_inicio) {
      query += ` AND DATE(v.fecha_venta) >= ?`;
      params.push(fecha_inicio);
    }

    if (fecha_fin) {
      query += ` AND DATE(v.fecha_venta) <= ?`;
      params.push(fecha_fin);
    }

    if (estado) {
      query += ` AND v.estado = ?`;
      params.push(estado);
    }

    if (metodo_pago) {
      query += ` AND v.metodo_pago = ?`;
      params.push(metodo_pago);
    }

    query += ` ORDER BY v.fecha_venta DESC`;

    const [ventas] = await pool.query(query, params);

    logger.info(`Se encontraron ${ventas.length} ventas`, { context: CTX });

    res.json(ventas);

  } catch (error) {
    logger.error("Error al obtener ventas", { context: CTX, error: error.message });
    res.status(500).json({ 
      error: "Error al obtener ventas", 
      details: error.message 
    });
  }
});

// ==========================================
// 🔍 RUTA 2: OBTENER UNA VENTA POR ID
// ==========================================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    logger.info(`Buscando venta con ID: ${id}`, { context: CTX, id });

    // Obtener datos de la venta
    const [ventas] = await pool.query(`
      SELECT 
        v.*,
        u.first_name,
        u.last_name,
        u.email,
        u.phone
      FROM ventas v
      LEFT JOIN users u ON v.id_usuario = u.id
      WHERE v.id_venta = ?
    `, [id]);

    if (ventas.length === 0) {
  logger.warn(`Venta no encontrada con ID: ${id}`, { context: CTX, id });
  return res.status(404).json({ 
    error: "Venta no encontrada" 
  });
}

    // Obtener detalles de la venta
    const [detalles] = await pool.query(`
      SELECT 
        dv.*,
        p.imagen,
        p.sku
      FROM detalle_venta dv
      LEFT JOIN productos p ON dv.id_producto = p.id_producto
      WHERE dv.id_venta = ?
    `, [id]);

    const venta = {
      ...ventas[0],
      productos: detalles
    };

    logger.info(`Venta encontrada: ${venta.folio}`, { context: CTX, id });

    res.json(venta);

  } catch (error) {
    logger.error("Error al obtener venta", { context: CTX, error: error.message });
    res.status(500).json({ 
      error: "Error al obtener venta", 
      details: error.message 
    });
  }
});

// ==========================================
// ➕ RUTA 3: CREAR NUEVA VENTA
// ==========================================
router.post("/", async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const {
      id_usuario,
      productos, // Array de {id_producto, cantidad, precio_unitario}
      metodo_pago,
      descuento = 0,
      notas = ''
    } = req.body;

    logger.info("Iniciando proceso de registro de venta", { context: CTX });

    // Validaciones
    if (!productos || productos.length === 0) {
  logger.warn("Intento de crear venta sin productos", { context: CTX });
  return res.status(400).json({
    error: "Debe incluir al menos un producto"
  });
}

    // Generar folio único
let folio;
let folioUnico = false;
let intentos = 0;
const maxIntentos = 10;

// Obtener el último folio
const [lastVenta] = await connection.query(
  'SELECT folio FROM ventas ORDER BY id_venta DESC LIMIT 1'
);

let nuevoNumero = 1;
if (lastVenta.length > 0) {
  const ultimoNumero = parseInt(lastVenta[0].folio.split('-')[1]);
  nuevoNumero = ultimoNumero + 1;
}

// Intentar generar un folio único
while (!folioUnico && intentos < maxIntentos) {
  folio = `VTA-${nuevoNumero.toString().padStart(4, '0')}`;

  // Verificar que el folio no exista
  const [folioExiste] = await connection.query(
    'SELECT id_venta FROM ventas WHERE folio = ?',
    [folio]
  );

  if (folioExiste.length === 0) {
    folioUnico = true;
  } else {
    // Si existe, incrementar y reintentar
    nuevoNumero++;
    intentos++;
  }
}

if (!folioUnico) {
  throw new Error('No se pudo generar un folio único después de varios intentos');
}

    // Calcular totales
    let subtotal = 0;
    const productosConInfo = [];

    for (const item of productos) {
      // Obtener info del producto
      const [producto] = await connection.query(
        'SELECT id_producto, nombre, precio, cantidad FROM productos WHERE id_producto = ?',
        [item.id_producto]
      );

      if (producto.length === 0) {
        throw new Error(`Producto con ID ${item.id_producto} no encontrado`);
      }

      if (producto[0].cantidad < item.cantidad) {
        throw new Error(`Stock insuficiente para ${producto[0].nombre}. Disponible: ${producto[0].cantidad}`);
      }

      const precio = item.precio_unitario || producto[0].precio;
      const subtotalProducto = precio * item.cantidad;
      subtotal += subtotalProducto;

      productosConInfo.push({
        id_producto: producto[0].id_producto,
        nombre: producto[0].nombre,
        cantidad: item.cantidad,
        precio_unitario: precio,
        subtotal: subtotalProducto
      });
    }

    const total = subtotal - descuento;

        // Obtener fecha actual en zona horaria de México
    const fechaActual = new Date();
    const fechaMexico = new Date(fechaActual.getTime() - (6 * 60 * 60 * 1000));

    // Insertar venta
    const [resultVenta] = await connection.query(
    `INSERT INTO ventas (id_usuario, folio, subtotal, descuento, total, metodo_pago, estado, notas, fecha_venta)
    VALUES (?, ?, ?, ?, ?, ?, 'completada', ?, ?)`,
    [id_usuario, folio, subtotal, descuento, total, metodo_pago, notas, fechaMexico]
    );

    const id_venta = resultVenta.insertId;

    // Insertar detalles y actualizar inventario
    for (const producto of productosConInfo) {
      // Insertar detalle
      await connection.query(
        `INSERT INTO detalle_venta (id_venta, id_producto, nombre_producto, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id_venta, producto.id_producto, producto.nombre, producto.cantidad, producto.precio_unitario, producto.subtotal]
      );

      // Actualizar inventario
      await connection.query(
        'UPDATE productos SET cantidad = cantidad - ? WHERE id_producto = ?',
        [producto.cantidad, producto.id_producto]
      );
    }

    await connection.commit();

    logger.info(`Venta registrada exitosamente: ${folio} - Total: $${total}`, { context: CTX, folio, total });

    res.status(201).json({
      message: "Venta creada exitosamente",
      id_venta,
      folio,
      total
    });

  } catch (error) {
    await connection.rollback();
    logger.error("Error al registrar venta", { context: CTX, error: error.message });
    res.status(500).json({
      error: "Error al crear venta",
      details: error.message
    });
  } finally {
    connection.release();
  }
});

// ==========================================
// 📊 RUTA 4: ESTADÍSTICAS DE VENTAS
// ==========================================
router.get("/stats/resumen", async (req, res) => {
  try {
    logger.info("Calculando estadísticas de ventas", { context: CTX });

    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total_ventas,
        SUM(CASE WHEN estado = 'completada' THEN total ELSE 0 END) as ventas_totales,
        COUNT(CASE WHEN estado = 'completada' THEN 1 END) as ventas_completadas,
        COUNT(CASE WHEN estado = 'pendiente' THEN 1 END) as ventas_pendientes,
        COUNT(CASE WHEN estado = 'cancelada' THEN 1 END) as ventas_canceladas,
        AVG(CASE WHEN estado = 'completada' THEN total END) as ticket_promedio
      FROM ventas
    `);

    // Ventas por método de pago
    const [metodosPago] = await pool.query(`
      SELECT 
        metodo_pago,
        COUNT(*) as cantidad,
        SUM(total) as total
      FROM ventas
      WHERE estado = 'completada'
      GROUP BY metodo_pago
    `);

    // Productos más vendidos
    const [productosMasVendidos] = await pool.query(`
      SELECT 
        dv.id_producto,
        dv.nombre_producto,
        SUM(dv.cantidad) as total_vendido,
        SUM(dv.subtotal) as ingresos_totales
      FROM detalle_venta dv
      INNER JOIN ventas v ON dv.id_venta = v.id_venta
      WHERE v.estado = 'completada'
      GROUP BY dv.id_producto, dv.nombre_producto
      ORDER BY total_vendido DESC
      LIMIT 5
    `);

    logger.info("Estadísticas de ventas calculadas exitosamente", { context: CTX });

    res.json({
      resumen: stats[0],
      metodos_pago: metodosPago,
      productos_mas_vendidos: productosMasVendidos
    });

  } catch (error) {
    logger.error("Error al obtener estadísticas de ventas", { context: CTX, error: error.message });
    res.status(500).json({ 
      error: "Error al obtener estadísticas", 
      details: error.message 
    });
  }
});

// 📋 Obtener compras de un cliente específico (para su perfil)
router.get('/mis-compras/:clienteId', async (req, res) => {
  try {
    const { clienteId } = req.params;

    // Obtener ventas del cliente
    const [ventas] = await db.query(`
      SELECT 
        v.id,
        v.folio,
        v.fecha_venta,
        v.total,
        v.descuento,
        v.subtotal,
        v.metodo_pago,
        v.notas,
        c.nombre as cliente_nombre,
        c.email as cliente_email,
        u.username as vendedor
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      LEFT JOIN users u ON v.usuario_id = u.id
      WHERE v.cliente_id = ?
      ORDER BY v.fecha_venta DESC
    `, [clienteId]);

    // Para cada venta, obtener sus detalles
    for (let venta of ventas) {
      const [detalles] = await db.query(`
        SELECT 
          dv.id,
          dv.cantidad,
          dv.precio_unitario,
          dv.subtotal,
          p.nombre as producto_nombre,
          p.descripcion as producto_descripcion,
          p.imagen as producto_imagen
        FROM detalle_venta dv
        LEFT JOIN productos p ON dv.producto_id = p.id
        WHERE dv.venta_id = ?
      `, [venta.id]);
      
      venta.productos = detalles;
    }

    res.json({
      success: true,
      ventas,
      total: ventas.length
    });

  } catch (error) {
    console.error('❌ Error al obtener compras del cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener historial de compras',
      error: error.message
    });
  }
});

// 📋 Obtener compras de un cliente específico (para su perfil)
router.get('/mis-compras/:clienteId', async (req, res) => {
  try {
    const { clienteId } = req.params;

    // Obtener ventas del cliente (usando tabla users en lugar de clientes)
    const [ventas] = await db.query(`
      SELECT 
        v.id,
        v.folio,
        v.fecha_venta,
        v.total,
        v.descuento,
        v.subtotal,
        v.metodo_pago,
        v.notas,
        u.username as cliente_nombre,
        u.email as cliente_email
      FROM ventas v
      LEFT JOIN users u ON v.usuario_id = u.id
      WHERE v.usuario_id = ?
      ORDER BY v.fecha_venta DESC
    `, [clienteId]);

    // Para cada venta, obtener sus detalles
    for (let venta of ventas) {
      const [detalles] = await db.query(`
        SELECT 
          dv.id,
          dv.cantidad,
          dv.precio_unitario,
          dv.subtotal,
          p.nombre as producto_nombre,
          p.descripcion as producto_descripcion,
          p.imagen as producto_imagen
        FROM detalle_venta dv
        LEFT JOIN productos p ON dv.producto_id = p.id
        WHERE dv.venta_id = ?
      `, [venta.id]);
      
      venta.productos = detalles;
    }

    res.json({
      success: true,
      ventas,
      total: ventas.length
    });

  } catch (error) {
    console.error('❌ Error al obtener compras del cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener historial de compras',
      error: error.message
    });
  }
});

export default router;