import express from "express";
import pool from "../config/db.js";
import logger from "../utils/logger.js";

const CTX = "ListaDeseosService";
const router = express.Router();

// ==========================================
// ❤️ RUTA 1: OBTENER LISTA DE DESEOS DEL USUARIO
// ==========================================
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    logger.info(`Obteniendo lista de deseos del usuario ${userId}`, { context: CTX });

    const [deseos] = await pool.query(`
      SELECT 
        ld.id,
        ld.id_producto,
        ld.created_at,
        p.nombre,
        p.precio,
        p.imagen,
        p.categoria,
        p.marca,
        p.cantidad as stock,
        p.descripcion,
        p.sku,
        p.edad_recomendada,
        p.genero,
        p.color,
        p.material
      FROM lista_deseos ld
      INNER JOIN productos p ON ld.id_producto = p.id_producto
      WHERE ld.id_usuario = ? AND p.estado = 'activo'
      ORDER BY ld.created_at DESC
    `, [userId]);

    res.json({ success: true, deseos, total: deseos.length });

  } catch (error) {
    logger.error("Error al obtener lista de deseos", { context: CTX, error: error.message });
    res.status(500).json({ success: false, error: "Error al obtener lista de deseos" });
  }
});

// ==========================================
// ❤️ RUTA 2: AGREGAR PRODUCTO A FAVORITOS
// ==========================================
router.post("/", async (req, res) => {
  try {
    const { id_usuario, id_producto } = req.body;

    if (!id_usuario || !id_producto) {
      return res.status(400).json({ success: false, error: "Faltan datos requeridos" });
    }

    // Verificar si ya existe
    const [existe] = await pool.query(
      "SELECT id FROM lista_deseos WHERE id_usuario = ? AND id_producto = ?",
      [id_usuario, id_producto]
    );

    if (existe.length > 0) {
      return res.status(400).json({ success: false, error: "El producto ya está en tu lista de deseos" });
    }

    await pool.query(
      "INSERT INTO lista_deseos (id_usuario, id_producto) VALUES (?, ?)",
      [id_usuario, id_producto]
    );

    logger.info(`Producto ${id_producto} agregado a favoritos del usuario ${id_usuario}`, { context: CTX });

    res.status(201).json({ success: true, message: "Producto agregado a favoritos ❤️" });

  } catch (error) {
    logger.error("Error al agregar a favoritos", { context: CTX, error: error.message });
    res.status(500).json({ success: false, error: "Error al agregar a favoritos" });
  }
});

// ==========================================
// 💔 RUTA 3: QUITAR PRODUCTO DE FAVORITOS
// ==========================================
router.delete("/:userId/:productoId", async (req, res) => {
  try {
    const { userId, productoId } = req.params;

    await pool.query(
      "DELETE FROM lista_deseos WHERE id_usuario = ? AND id_producto = ?",
      [userId, productoId]
    );

    logger.info(`Producto ${productoId} quitado de favoritos del usuario ${userId}`, { context: CTX });

    res.json({ success: true, message: "Producto eliminado de favoritos" });

  } catch (error) {
    logger.error("Error al quitar de favoritos", { context: CTX, error: error.message });
    res.status(500).json({ success: false, error: "Error al quitar de favoritos" });
  }
});

// ==========================================
// 🔍 RUTA 4: VERIFICAR SI UN PRODUCTO ESTÁ EN FAVORITOS
// ==========================================
router.get("/:userId/check/:productoId", async (req, res) => {
  try {
    const { userId, productoId } = req.params;

    const [rows] = await pool.query(
      "SELECT id FROM lista_deseos WHERE id_usuario = ? AND id_producto = ?",
      [userId, productoId]
    );

    res.json({ success: true, esFavorito: rows.length > 0 });

  } catch (error) {
    res.status(500).json({ success: false, error: "Error al verificar favorito" });
  }
});

export default router;