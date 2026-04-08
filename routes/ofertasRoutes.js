import express from "express";
import pool from "../config/db.js";
import logger from "../utils/logger.js";

const CTX = "OfertasService";
const router = express.Router();

// ==========================================
// 📋 RUTA 1: OBTENER TODAS LAS OFERTAS ACTIVAS
// (Para el catálogo del cliente)
// ==========================================
router.get("/", async (req, res) => {
  try {
    logger.info("Consultando ofertas activas", { context: CTX });

    const [ofertas] = await pool.query(`
      SELECT 
        o.*,
        p.nombre as producto_nombre,
        p.imagen as producto_imagen,
        p.precio as precio_original
      FROM ofertas o
      LEFT JOIN productos p ON o.id_producto = p.id_producto
      WHERE o.activa = true
        AND NOW() BETWEEN o.fecha_inicio AND o.fecha_fin
      ORDER BY o.created_at DESC
    `);

    logger.info(`Se encontraron ${ofertas.length} ofertas activas`, { context: CTX });
    res.json(ofertas);

  } catch (error) {
    logger.error("Error al obtener ofertas", { context: CTX, error: error.message });
    res.status(500).json({ error: "Error al obtener ofertas", details: error.message });
  }
});

// ==========================================
// 📋 RUTA 2: OBTENER TODAS LAS OFERTAS (ADMIN)
// Incluye activas, inactivas y expiradas
// ==========================================
router.get("/admin/todas", async (req, res) => {
  try {
    logger.info("Admin consultando todas las ofertas", { context: CTX });

    const [ofertas] = await pool.query(`
      SELECT 
        o.*,
        p.nombre as producto_nombre,
        p.imagen as producto_imagen,
        p.precio as precio_original,
        CASE 
          WHEN NOW() BETWEEN o.fecha_inicio AND o.fecha_fin AND o.activa = true THEN 'vigente'
          WHEN NOW() > o.fecha_fin THEN 'expirada'
          WHEN o.activa = false THEN 'inactiva'
          ELSE 'programada'
        END as estado_actual
      FROM ofertas o
      LEFT JOIN productos p ON o.id_producto = p.id_producto
      ORDER BY o.created_at DESC
    `);

    res.json(ofertas);

  } catch (error) {
    logger.error("Error al obtener todas las ofertas", { context: CTX, error: error.message });
    res.status(500).json({ error: "Error al obtener ofertas", details: error.message });
  }
});

// ==========================================
// 🔍 RUTA 3: OBTENER OFERTAS POR CATEGORÍA
// (Para el catálogo — filtrar por categoría)
// ==========================================
router.get("/categoria/:categoria", async (req, res) => {
  try {
    const { categoria } = req.params;

    logger.info(`Consultando ofertas para categoría: ${categoria}`, { context: CTX });

    const [ofertas] = await pool.query(`
      SELECT o.*, p.nombre as producto_nombre, p.imagen as producto_imagen, p.precio as precio_original
      FROM ofertas o
      LEFT JOIN productos p ON o.id_producto = p.id_producto
      WHERE o.activa = true
        AND NOW() BETWEEN o.fecha_inicio AND o.fecha_fin
        AND (o.categoria = ? OR (o.tipo = 'producto' AND p.categoria = ?))
      ORDER BY o.descuento_porcentaje DESC
    `, [categoria, categoria]);

    res.json(ofertas);

  } catch (error) {
    logger.error("Error al obtener ofertas por categoría", { context: CTX, error: error.message });
    res.status(500).json({ error: "Error al obtener ofertas", details: error.message });
  }
});

// ==========================================
// 🔍 RUTA 4: OBTENER OFERTA POR ID
// ==========================================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [ofertas] = await pool.query(`
      SELECT 
        o.*,
        p.nombre as producto_nombre,
        p.imagen as producto_imagen,
        p.precio as precio_original
      FROM ofertas o
      LEFT JOIN productos p ON o.id_producto = p.id_producto
      WHERE o.id_oferta = ?
    `, [id]);

    if (ofertas.length === 0) {
      return res.status(404).json({ error: "Oferta no encontrada" });
    }

    res.json(ofertas[0]);

  } catch (error) {
    logger.error("Error al obtener oferta", { context: CTX, error: error.message });
    res.status(500).json({ error: "Error al obtener oferta", details: error.message });
  }
});

// ==========================================
// ➕ RUTA 5: CREAR NUEVA OFERTA (ADMIN)
// ==========================================
router.post("/", async (req, res) => {
  try {
    const {
      nombre,
      descripcion,
      tipo,           // 'producto' | 'categoria'
      id_producto,
      categoria,
      descuento_porcentaje,
      fecha_inicio,
      fecha_fin,
      activa = true
    } = req.body;

    logger.info("Creando nueva oferta", { context: CTX, nombre });

    // Validaciones
    if (!nombre || !tipo || !descuento_porcentaje || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        error: "Faltan campos obligatorios",
        requeridos: ["nombre", "tipo", "descuento_porcentaje", "fecha_inicio", "fecha_fin"]
      });
    }

    if (tipo === "producto" && !id_producto) {
      return res.status(400).json({ error: "Debes especificar un id_producto para ofertas de tipo 'producto'" });
    }

    if (tipo === "categoria" && !categoria) {
      return res.status(400).json({ error: "Debes especificar una categoría para ofertas de tipo 'categoria'" });
    }

    if (descuento_porcentaje <= 0 || descuento_porcentaje > 100) {
      return res.status(400).json({ error: "El descuento debe ser entre 1 y 100" });
    }

    if (new Date(fecha_fin) <= new Date(fecha_inicio)) {
      return res.status(400).json({ error: "La fecha de fin debe ser posterior a la fecha de inicio" });
    }

    const [result] = await pool.query(`
      INSERT INTO ofertas (nombre, descripcion, tipo, id_producto, categoria, descuento_porcentaje, fecha_inicio, fecha_fin, activa)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      nombre,
      descripcion || null,
      tipo,
      tipo === "producto" ? id_producto : null,
      tipo === "categoria" ? categoria : null,
      descuento_porcentaje,
      fecha_inicio,
      fecha_fin,
      activa
    ]);

    logger.info(`Oferta creada: ${nombre} (ID: ${result.insertId})`, { context: CTX });

    res.status(201).json({
      message: "Oferta creada exitosamente",
      id_oferta: result.insertId,
      nombre
    });

  } catch (error) {
    logger.error("Error al crear oferta", { context: CTX, error: error.message });
    res.status(500).json({ error: "Error al crear oferta", details: error.message });
  }
});

// ==========================================
// ✏️ RUTA 6: ACTUALIZAR OFERTA (ADMIN)
// ==========================================
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nombre,
      descripcion,
      tipo,
      id_producto,
      categoria,
      descuento_porcentaje,
      fecha_inicio,
      fecha_fin,
      activa
    } = req.body;

    logger.info(`Actualizando oferta ID: ${id}`, { context: CTX });

    const [existe] = await pool.query("SELECT id_oferta FROM ofertas WHERE id_oferta = ?", [id]);
    if (existe.length === 0) {
      return res.status(404).json({ error: "Oferta no encontrada" });
    }

    await pool.query(`
      UPDATE ofertas SET
        nombre = ?,
        descripcion = ?,
        tipo = ?,
        id_producto = ?,
        categoria = ?,
        descuento_porcentaje = ?,
        fecha_inicio = ?,
        fecha_fin = ?,
        activa = ?
      WHERE id_oferta = ?
    `, [
      nombre,
      descripcion || null,
      tipo,
      tipo === "producto" ? id_producto : null,
      tipo === "categoria" ? categoria : null,
      descuento_porcentaje,
      fecha_inicio,
      fecha_fin,
      activa,
      id
    ]);

    logger.info(`Oferta actualizada: ID ${id}`, { context: CTX });
    res.json({ message: "Oferta actualizada correctamente", id_oferta: id });

  } catch (error) {
    logger.error("Error al actualizar oferta", { context: CTX, error: error.message });
    res.status(500).json({ error: "Error al actualizar oferta", details: error.message });
  }
});

// ==========================================
// 🔄 RUTA 7: ACTIVAR / DESACTIVAR OFERTA
// ==========================================
router.patch("/:id/toggle", async (req, res) => {
  try {
    const { id } = req.params;

    const [oferta] = await pool.query("SELECT id_oferta, activa, nombre FROM ofertas WHERE id_oferta = ?", [id]);
    if (oferta.length === 0) {
      return res.status(404).json({ error: "Oferta no encontrada" });
    }

    const nuevoEstado = !oferta[0].activa;
    await pool.query("UPDATE ofertas SET activa = ? WHERE id_oferta = ?", [nuevoEstado, id]);

    logger.info(`Oferta "${oferta[0].nombre}" ${nuevoEstado ? "activada" : "desactivada"}`, { context: CTX });

    res.json({
      message: `Oferta ${nuevoEstado ? "activada" : "desactivada"} correctamente`,
      activa: nuevoEstado
    });

  } catch (error) {
    logger.error("Error al cambiar estado de oferta", { context: CTX, error: error.message });
    res.status(500).json({ error: "Error al cambiar estado", details: error.message });
  }
});

// ==========================================
// 🗑️ RUTA 8: ELIMINAR OFERTA (ADMIN)
// ==========================================
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [oferta] = await pool.query("SELECT id_oferta, nombre FROM ofertas WHERE id_oferta = ?", [id]);
    if (oferta.length === 0) {
      return res.status(404).json({ error: "Oferta no encontrada" });
    }

    await pool.query("DELETE FROM ofertas WHERE id_oferta = ?", [id]);

    logger.info(`Oferta eliminada: ${oferta[0].nombre} (ID: ${id})`, { context: CTX });

    res.json({ message: "Oferta eliminada correctamente", nombre: oferta[0].nombre });

  } catch (error) {
    logger.error("Error al eliminar oferta", { context: CTX, error: error.message });
    res.status(500).json({ error: "Error al eliminar oferta", details: error.message });
  }
});

export default router;