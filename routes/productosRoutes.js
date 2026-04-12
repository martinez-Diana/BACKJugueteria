import express from "express";
import pool from "../config/db.js";
import logger from "../utils/logger.js";
import multer from "multer";
import csv from "csv-parser";
import { PassThrough } from "stream";

const CTX = "ProductosService";
const router = express.Router();

// Manejar preflight OPTIONS para CORS
router.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', 'https://starlit-gumdrop-ac85c8.netlify.app');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});

// Multer en memoria (compatible con Vercel)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos CSV"));
    }
  },
});

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

    if (!nombre || !sku || !categoria || !genero) {
      logger.warn("Faltan campos obligatorios al crear producto", { context: CTX });
      return res.status(400).json({
        error: "Faltan campos obligatorios",
        requeridos: ["nombre", "sku", "categoria", "genero"]
      });
    }

    const [skuExiste] = await pool.query(
      'SELECT id_producto FROM productos WHERE sku = ?',
      [sku]
    );

    if (skuExiste.length > 0) {
      return res.status(400).json({
        error: "El SKU ya existe en la base de datos"
      });
    }

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

// ==========================================
// ✏️ RUTA: ACTUALIZAR PRODUCTO
// ==========================================
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

    const [productoExiste] = await pool.query(
      'SELECT * FROM productos WHERE id_producto = ?',
      [id]
    );

    if (productoExiste.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

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

// ==========================================
// 🗑️ RUTA: DESACTIVAR PRODUCTO (SOFT DELETE)
// ==========================================
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
      'UPDATE productos SET estado = ? WHERE id_producto = ?',
      ['inactivo', id]
    );

    logger.info(`Producto desactivado: ${productoExiste[0].nombre} (ID: ${id})`, { context: CTX, id });

    res.json({ 
      message: 'Producto desactivado correctamente',
      nombre: productoExiste[0].nombre
    });

  } catch (error) {
    logger.error("Error al desactivar producto", { context: CTX, id: req.params.id, error: error.message });
    res.status(500).json({ 
      error: 'Error al desactivar producto', 
      details: error.message 
    });
  }
});

// ==========================================
// 📂 RUTA: IMPORTAR PRODUCTOS DESDE CSV
// ==========================================
// Columnas esperadas:
//   nombre, categoria, precio_compra, precio, cantidad,
//   descripcion (opcional), marca (opcional), sku (opcional), genero (opcional)
//
// - Si el SKU ya existe  → actualiza el producto
// - Si no existe         → inserta nuevo
// ==========================================
router.post("/importar", upload.single("archivo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se recibió ningún archivo CSV" });
  }

  const filas = [];
  const errores = [];

  try {
    await new Promise((resolve, reject) => {
      const bufferStream = new PassThrough();
      bufferStream.end(req.file.buffer);
      bufferStream
        .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase() }))
        .on("data", (row) => filas.push(row))
        .on("end", resolve)
        .on("error", reject);
    });

    if (filas.length === 0) {
      return res.status(400).json({ error: "El CSV está vacío o sin formato correcto" });
    }

    let insertados = 0;
    let actualizados = 0;

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const numFila = i + 2;

      try {
        const nombre       = fila["nombre"]?.trim();
        const categoria    = fila["categoria"]?.trim() || null;
        const precio       = parseFloat(fila["precio"]);
        const precioCompra = parseFloat(fila["precio_compra"]) || 0;
        const cantidad     = parseInt(fila["cantidad"], 10);
        const descripcion  = fila["descripcion"]?.trim() || null;
        const marca        = fila["marca"]?.trim() || null;
        const skuCSV       = fila["sku"]?.trim() || null;
        const genero       = fila["genero"]?.trim() || "Unisex";

        if (!nombre) {
          errores.push({ fila: numFila, error: 'El campo "nombre" es obligatorio' });
          continue;
        }
        if (isNaN(precio) || precio < 0) {
          errores.push({ fila: numFila, nombre, error: '"precio" inválido' });
          continue;
        }
        if (isNaN(cantidad) || cantidad < 0) {
          errores.push({ fila: numFila, nombre, error: '"cantidad" inválido' });
          continue;
        }

        // Buscar si ya existe por SKU o por nombre
        let existe = null;

        if (skuCSV) {
          const [porSku] = await pool.query(
            "SELECT id_producto FROM productos WHERE sku = ? LIMIT 1",
            [skuCSV]
          );
          if (porSku.length > 0) existe = porSku[0];
        }

        if (!existe) {
          const [porNombre] = await pool.query(
            "SELECT id_producto FROM productos WHERE LOWER(nombre) = LOWER(?) LIMIT 1",
            [nombre]
          );
          if (porNombre.length > 0) existe = porNombre[0];
        }

        if (existe) {
          await pool.query(
            `UPDATE productos SET
               categoria     = COALESCE(?, categoria),
               precio        = ?,
               precio_compra = ?,
               cantidad      = ?,
               descripcion   = COALESCE(?, descripcion),
               marca         = COALESCE(?, marca),
               genero        = ?
             WHERE id_producto = ?`,
            [categoria, precio, precioCompra, cantidad, descripcion, marca, genero, existe.id_producto]
          );
          actualizados++;
        } else {
          const skuFinal = skuCSV || `IMP-${Date.now()}-${i}`;
          await pool.query(
            `INSERT INTO productos
               (nombre, descripcion, categoria, marca, genero,
                sku, cantidad, precio, precio_compra, estado)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'activo')`,
            [nombre, descripcion, categoria, marca, genero,
             skuFinal, cantidad, precio, precioCompra]
          );
          insertados++;
        }

      } catch (err) {
        errores.push({ fila: numFila, nombre: fila["nombre"] || "?", error: err.message });
      }
    }

    res.json({
      ok: true,
      total:         filas.length,
      insertados,
      actualizados,
      errores_count: errores.length,
      errores,
    });

  } catch (err) {
    logger.error("Error al importar productos CSV", { context: CTX, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 📦 RUTA: IMPORTAR INVENTARIO DESDE CSV
// ==========================================
router.post("/importar-inventario", upload.single("archivo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo CSV" });

  const filas = [];
  const errores = [];

  try {
    await new Promise((resolve, reject) => {
      const bufferStream = new PassThrough();
      bufferStream.end(req.file.buffer);
      bufferStream
        .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase() }))
        .on("data", (row) => filas.push(row))
        .on("end", resolve)
        .on("error", reject);
    });

    if (filas.length === 0) return res.status(400).json({ error: "El CSV está vacío" });

    let actualizados = 0;
    let noEncontrados = 0;

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const numFila = i + 2;
      try {
        const sku      = fila["sku"]?.trim();
        const cantidad = parseInt(fila["cantidad"], 10);

        if (!sku) { errores.push({ fila: numFila, error: 'El campo "sku" es obligatorio' }); continue; }
        if (isNaN(cantidad) || cantidad < 0) { errores.push({ fila: numFila, sku, error: '"cantidad" inválida' }); continue; }

        const [rows] = await pool.query("SELECT id_producto FROM productos WHERE sku = ? LIMIT 1", [sku]);

        if (rows.length === 0) {
          errores.push({ fila: numFila, sku, error: `SKU "${sku}" no encontrado` });
          noEncontrados++;
          continue;
        }

        await pool.query("UPDATE productos SET cantidad = ? WHERE sku = ?", [cantidad, sku]);
        actualizados++;
      } catch (err) {
        errores.push({ fila: numFila, sku: fila["sku"] || "?", error: err.message });
      }
    }

    res.json({ ok: true, total: filas.length, actualizados, no_encontrados: noEncontrados, errores_count: errores.length, errores });
  } catch (err) {
    logger.error("Error al importar inventario CSV", { context: CTX, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;