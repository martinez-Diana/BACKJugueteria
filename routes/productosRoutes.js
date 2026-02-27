import express from "express";
import pool from "../config/db.js";
import logger from "../utils/logger.js";
const CTX = "ProductosService";

const router = express.Router();

// ==========================================
// 📦 RUTA 1: OBTENER TODOS LOS PRODUCTOS
// ==========================================
router.get("/", async (req, res) => {
  try {
    logger.info("Consultando todos los productos", { context: CTX });

    const query = `
      SELECT * FROM productos 
      WHERE estado = 'activo' 
      ORDER BY fecha_registro DESC
    `;

    const [productos] = await pool.query(query);

    logger.info(`Se encontraron ${productos.length} productos`, { context: CTX });

    res.json(productos);

  } catch (error) {
    logger.error("Error al obtener productos", { context: CTX, error: error.message });
    res.status(500).json({ 
      error: "Error al obtener productos", 
      details: error.message 
    });
  }
});

// ==========================================
// 🔍 RUTA 2: OBTENER UN PRODUCTO POR ID
// ==========================================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    logger.info(`Buscando producto con ID: ${id}`, { context: CTX, id });

    const query = "SELECT * FROM productos WHERE id_producto = ?";
    const [productos] = await pool.query(query, [id]);

    if (productos.length === 0) {
  logger.warn(`Producto no encontrado con ID: ${id}`, { context: CTX, id });
  return res.status(404).json({ 
    error: "Producto no encontrado" 
  });
}

    logger.info(`Producto encontrado: ${productos[0].nombre}`, { context: CTX });

    res.json(productos[0]);

  } catch (error) {
    logger.error("Error al obtener producto", { context: CTX, error: error.message });
    res.status(500).json({ 
      error: "Error al obtener producto", 
      details: error.message 
    });
  }
});
// ==========================================
// ➕ RUTA 3: CREAR NUEVO PRODUCTO
// ==========================================
router.post("/", async (req, res) => {
  try {
    logger.info("Iniciando creación de nuevo producto", { context: CTX });
    logger.info("Datos recibidos", { context: CTX, datos: req.body });

    const {
      nombre, descripcion, categoria, marca, material,
      edad_recomendada, genero, color, dimensiones,
      tipo_juguete, proveedor, sku, imagen, cantidad,
      precio, precio_compra
    } = req.body;

    // ✅ Validaciones básicas
    if (!nombre || !sku || !categoria || !genero) {
  logger.warn("Faltan campos obligatorios al crear producto", { context: CTX });
  return res.status(400).json({
    error: "Faltan campos obligatorios",
    requeridos: ["nombre", "sku", "categoria", "genero"]
  });
}

    // ✅ Verificar que el SKU no exista
    const [skuExiste] = await pool.query(
      'SELECT id_producto FROM productos WHERE sku = ?',
      [sku]
    );

    if (skuExiste.length > 0) {
      return res.status(400).json({
        error: "El SKU ya existe en la base de datos"
      });
    }

    // ✅ Insertar producto
    const query = `
      INSERT INTO productos (
        nombre, descripcion, categoria, marca, material,
        edad_recomendada, genero, color, dimensiones, tipo_juguete,
        proveedor, sku, imagen, cantidad, precio, precio_compra
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const valores = [
      nombre,
      descripcion || null,
      categoria,
      marca || null,
      material || null,
      edad_recomendada || null,
      genero,
      color || null,
      dimensiones || null,
      tipo_juguete || null,
      proveedor || null,
      sku,
      imagen || null,
      cantidad || 0,
      precio || 0,
      precio_compra || 0
    ];

    const [result] = await pool.query(query, valores);

    logger.info(`Producto creado exitosamente: ${nombre}`, { context: CTX, id: result.insertId });

    res.status(201).json({
      message: "Producto creado exitosamente",
      id_producto: result.insertId,
      nombre: nombre
    });

  } catch (error) {
    logger.error("Error al crear producto", { context: CTX, error: error.message });
    res.status(500).json({
      error: "Error al crear producto",
      details: error.message
    });
  }
});

// ==========================================
// 📊 RUTA: ESTADÍSTICAS DE INVENTARIO
// ==========================================
router.get("/stats/inventario", async (req, res) => {
  try {
    console.log("📊 GET /api/productos/stats/inventario - Obteniendo estadísticas...");

    // Estadísticas generales
    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total_productos,
        SUM(cantidad) as total_unidades,
        SUM(cantidad * precio) as valor_inventario,
        COUNT(CASE WHEN cantidad <= stock_minimo THEN 1 END) as productos_stock_bajo,
        COUNT(CASE WHEN cantidad = 0 THEN 1 END) as productos_agotados
      FROM productos 
      WHERE estado = 'activo'
    `);

    // Distribución por categorías
    const [categorias] = await pool.query(`
      SELECT 
        categoria,
        COUNT(*) as cantidad_productos,
        SUM(cantidad) as unidades_totales
      FROM productos 
      WHERE estado = 'activo'
      GROUP BY categoria
      ORDER BY cantidad_productos DESC
    `);

    // Productos con stock bajo
    const [stockBajo] = await pool.query(`
      SELECT 
        id_producto,
        nombre,
        sku,
        categoria,
        cantidad,
        precio,
        imagen
      FROM productos
      WHERE estado = 'activo' AND cantidad <= stock_minimo
      ORDER BY cantidad ASC
      LIMIT 5
    `);

    console.log("✅ Estadísticas calculadas exitosamente");

    res.json({
      resumen: stats[0],
      por_categoria: categorias,
      stock_bajo: stockBajo
    });

  } catch (error) {
    console.error("❌ Error al obtener estadísticas:", error.message);
    res.status(500).json({ 
      error: "Error al obtener estadísticas", 
      details: error.message 
    });
  }
});

// ==================== PUT - ACTUALIZAR PRODUCTO COMPLETO ====================
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nombre, descripcion, categoria, marca, material,
      edad_recomendada, genero, color, dimensiones,
      tipo_juguete, proveedor, sku, cantidad, precio, 
      precio_compra, imagen
    } = req.body;

    logger.info(`Iniciando actualización de producto ID: ${id}`, { context: CTX, id });

    // Verificar que el producto existe
    const [productoExiste] = await pool.query(
      'SELECT * FROM productos WHERE id_producto = ?',
      [id]
    );

    if (productoExiste.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    // Verificar que el SKU no esté duplicado (excepto el mismo producto)
    if (sku) {
      const [skuDuplicado] = await pool.query(
        'SELECT id_producto FROM productos WHERE sku = ? AND id_producto != ?',
        [sku, id]
      );

      if (skuDuplicado.length > 0) {
        return res.status(400).json({ 
          error: 'El SKU ya existe en otro producto' 
        });
      }
    }

    // Actualizar producto
    await pool.query(
      `UPDATE productos SET 
        nombre = ?,
        descripcion = ?,
        categoria = ?,
        marca = ?,
        material = ?,
        edad_recomendada = ?,
        genero = ?,
        color = ?,
        dimensiones = ?,
        tipo_juguete = ?,
        proveedor = ?,
        sku = ?,
        cantidad = ?,
        precio = ?,
        precio_compra = ?,
        imagen = ?
      WHERE id_producto = ?`,
      [
        nombre, descripcion, categoria, marca, material,
        edad_recomendada, genero, color, dimensiones,
        tipo_juguete, proveedor, sku, cantidad, precio,
        precio_compra, imagen, id
      ]
    );

    logger.info(`Producto actualizado exitosamente: ID ${id}`, { context: CTX, id });

    res.json({ 
      message: 'Producto actualizado correctamente',
      id_producto: id
    });

  } catch (error) {
    logger.error("Error al actualizar producto", { context: CTX, id, error: error.message });
    res.status(500).json({ 
      error: 'Error al actualizar producto', 
      details: error.message 
    });
  }
});

// ==================== DELETE - DESACTIVAR PRODUCTO (SOFT DELETE) ====================
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    logger.info(`Iniciando desactivación de producto ID: ${id}`, { context: CTX, id });

    const [productoExiste] = await pool.query(
      'SELECT id_producto, nombre FROM productos WHERE id_producto = ?',
      [id]
    );

    if (productoExiste.length === 0) {
  logger.warn(`Producto no encontrado al eliminar ID: ${id}`, { context: CTX, id });
  return res.status(404).json({ error: 'Producto no encontrado' });
}

    await pool.query(
      'UPDATE productos SET estado = "inactivo" WHERE id_producto = ?',
      [id]
    );

    logger.info(`Producto desactivado: ${productoExiste[0].nombre} (ID: ${id})`, { context: CTX, id });

    res.json({ 
      message: 'Producto desactivado correctamente',
      nombre: productoExiste[0].nombre
    });

  } catch (error) {
    logger.error("Error al desactivar producto", { context: CTX, id, error: error.message });
    res.status(500).json({ 
      error: 'Error al desactivar producto', 
      details: error.message 
    });
  }
});

export default router;


