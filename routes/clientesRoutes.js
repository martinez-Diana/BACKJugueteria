import express from "express";
import pool from "../config/db.js";
import logger from "../utils/logger.js";
const CTX = "ClientesService";

const router = express.Router();

// ==========================================
// 📋 RUTA 1: OBTENER TODOS LOS CLIENTES
// ==========================================
router.get("/", async (req, res) => {
  try {
    const { busqueda, role_id } = req.query;
    
    logger.info("Consultando lista de clientes", { context: CTX });

    let query = `
      SELECT 
        id,
        first_name,
        last_name,
        mother_lastname,
        email,
        phone,
        username,
        role_id,
        created_at
      FROM users 
      WHERE 1=1
    `;
    
    const params = [];

    // Filtro por búsqueda (nombre o email)
    if (busqueda) {
      query += ` AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)`;
      params.push(`%${busqueda}%`, `%${busqueda}%`, `%${busqueda}%`);
    }

    // Filtro por rol (si quieres filtrar solo clientes, role_id específico)
    if (role_id) {
      query += ` AND role_id = ?`;
      params.push(role_id);
    }

    query += ` ORDER BY created_at DESC`;

    const [clientes] = await pool.query(query, params);

    logger.info(`Se encontraron ${clientes.length} clientes`, { context: CTX });

    res.json(clientes);

  } catch (error) {
    logger.error("Error al obtener clientes", { context: CTX, error: error.message });
    res.status(500).json({ 
      error: "Error al obtener clientes", 
      details: error.message 
    });
  }
});

// ==========================================
// 🔍 RUTA 2: OBTENER UN CLIENTE POR ID
// ==========================================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    logger.info(`Buscando cliente con ID: ${id}`, { context: CTX, id });

    const query = `
      SELECT 
        id,
        first_name,
        last_name,
        mother_lastname,
        email,
        phone,
        username,
        role_id,
        created_at
      FROM users 
      WHERE id = ?
    `;
    
    const [clientes] = await pool.query(query, [id]);

    if (clientes.length === 0) {
  logger.warn(`Cliente no encontrado con ID: ${id}`, { context: CTX, id });
  return res.status(404).json({ 
    error: "Cliente no encontrado" 
  });
}

    logger.info(`Cliente encontrado: ${clientes[0].first_name} ${clientes[0].last_name}`, { context: CTX });

    res.json(clientes[0]);

  } catch (error) {
    logger.error("Error al obtener cliente", { context: CTX, error: error.message });
    res.status(500).json({ 
      error: "Error al obtener cliente", 
      details: error.message 
    });
  }
});

// ==========================================
// 🔄 RUTA 3: ACTUALIZAR CLIENTE
// ==========================================
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, mother_lastname, email, phone, role_id } = req.body;

    logger.info(`Iniciando actualización de cliente ID: ${id}`, { context: CTX, id });

    // Verificar que el cliente existe
    const [clienteExiste] = await pool.query(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );

    if (clienteExiste.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Verificar que el email no esté duplicado (excepto el mismo cliente)
    if (email) {
      const [emailDuplicado] = await pool.query(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [email, id]
      );

      if (emailDuplicado.length > 0) {
        return res.status(400).json({ 
          error: 'El email ya está en uso por otro usuario' 
        });
      }
    }

    // Actualizar cliente
    const query = `
      UPDATE users SET 
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        mother_lastname = COALESCE(?, mother_lastname),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        role_id = COALESCE(?, role_id)
      WHERE id = ?
    `;

    await pool.query(query, [
      first_name, last_name, mother_lastname, email, phone, role_id, id
    ]);

    logger.info(`Cliente actualizado exitosamente: ID ${id}`, { context: CTX, id });

    res.json({ 
      message: 'Cliente actualizado correctamente',
      id: id
    });

  } catch (error) {
    logger.error("Error al actualizar cliente", { context: CTX, error: error.message });
    res.status(500).json({ 
      error: 'Error al actualizar cliente', 
      details: error.message 
    });
  }
});

// ==========================================
// 🗑️ RUTA 4: ELIMINAR CLIENTE
// ==========================================
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    logger.info(`Iniciando eliminación de cliente ID: ${id}`, { context: CTX, id });

    const [clienteExiste] = await pool.query(
      'SELECT id, first_name, last_name FROM users WHERE id = ?',
      [id]
    );

    if (clienteExiste.length === 0) {
  logger.warn(`Cliente no encontrado al eliminar ID: ${id}`, { context: CTX, id });
  return res.status(404).json({ error: 'Cliente no encontrado' });
}

    await pool.query('DELETE FROM users WHERE id = ?', [id]);

    logger.info(`Cliente eliminado: ${clienteExiste[0].first_name} ${clienteExiste[0].last_name} (ID: ${id})`, { context: CTX, id });

    res.json({ 
      message: 'Cliente eliminado correctamente',
      nombre: `${clienteExiste[0].first_name} ${clienteExiste[0].last_name}`
    });

  } catch (error) {
    logger.error("Error al eliminar cliente", { context: CTX, error: error.message });
    res.status(500).json({ 
      error: 'Error al eliminar cliente', 
      details: error.message 
    });
  }
});

// ==========================================
// 📊 RUTA 5: ESTADÍSTICAS DE CLIENTES
// ==========================================
router.get("/stats/resumen", async (req, res) => {
  try {
    logger.info("Calculando estadísticas de clientes", { context: CTX });

    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total_clientes,
        COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN 1 END) as nuevos_hoy,
        COUNT(CASE WHEN YEARWEEK(created_at) = YEARWEEK(CURDATE()) THEN 1 END) as nuevos_semana,
        COUNT(CASE WHEN MONTH(created_at) = MONTH(CURDATE()) 
                   AND YEAR(created_at) = YEAR(CURDATE()) THEN 1 END) as nuevos_mes
      FROM users
    `);

    // Distribución por roles
    const [roles] = await pool.query(`
      SELECT 
        role_id,
        COUNT(*) as cantidad
      FROM users
      GROUP BY role_id
    `);

    logger.info("Estadísticas de clientes calculadas exitosamente", { context: CTX });

    res.json({
      resumen: stats[0],
      por_rol: roles
    });

  } catch (error) {
    logger.error("Error al obtener estadísticas de clientes", { context: CTX, error: error.message });
    res.status(500).json({ 
      error: "Error al obtener estadísticas", 
      details: error.message 
    });
  }
});

export default router;