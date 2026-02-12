import express from "express";
import pool from "../config/db.js";

const router = express.Router();

// ==========================================
// 📦 RUTA 1: OBTENER TODOS LOS PRODUCTOS
// ==========================================
router.get("/", async (req, res) => {
  try {
    console.log("📦 GET /api/productos - Obteniendo productos...");

    const query = `
      SELECT * FROM productos 
      WHERE estado = 'activo' 
      ORDER BY fecha_registro DESC
    `;

    const [productos] = await pool.query(query);

    console.log(`✅ Se encontraron ${productos.length} productos`);

    res.json(productos);

  } catch (error) {
    console.error("❌ Error al obtener productos:", error.message);
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

    console.log(`🔍 GET /api/productos/${id} - Buscando producto...`);

    const query = "SELECT * FROM productos WHERE id_producto = ?";
    const [productos] = await pool.query(query, [id]);

    if (productos.length === 0) {
      return res.status(404).json({ 
        error: "Producto no encontrado" 
      });
    }

    console.log(`✅ Producto encontrado: ${productos[0].nombre}`);

    res.json(productos[0]);

  } catch (error) {
    console.error("❌ Error al obtener producto:", error.message);
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
    console.log("➕ POST /api/productos - Creando producto...");
    console.log("📦 Datos recibidos:", req.body);

    const {
      nombre, descripcion, categoria, marca, material,
      edad_recomendada, genero, color, dimensiones,
      tipo_juguete, proveedor, sku, imagen, cantidad,
      precio, precio_compra
    } = req.body;

    // ✅ Validaciones básicas
    if (!nombre || !sku || !categoria || !genero) {
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

    console.log(`✅ Producto creado con ID: ${result.insertId}`);

    res.status(201).json({
      message: "Producto creado exitosamente",
      id_producto: result.insertId,
      nombre: nombre
    });

  } catch (error) {
    console.error("❌ Error al crear producto:", error.message);
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
        COUNT(CASE WHEN cantidad < 10 THEN 1 END) as productos_stock_bajo,
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
      WHERE estado = 'activo' AND cantidad < 10
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

export default router;
