import express from "express";
import pool from "../config/db.js";

const router = express.Router();

// ==========================================
// 📋 RUTA 1: OBTENER TODOS LOS CLIENTES
// ==========================================
router.get("/", async (req, res) => {
  try {
    const { busqueda, role_id } = req.query;
    
    console.log("📋 GET /api/clientes - Obteniendo clientes...");

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

    console.log(`✅ Se encontraron ${clientes.length} clientes`);

    res.json(clientes);

  } catch (error) {
    console.error("❌ Error al obtener clientes:", error.message);
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

    console.log(`🔍 GET /api/clientes/${id} - Buscando cliente...`);

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
      return res.status(404).json({ 
        error: "Cliente no encontrado" 
      });
    }

    console.log(`✅ Cliente encontrado: ${clientes[0].first_name} ${clientes[0].last_name}`);

    res.json(clientes[0]);

  } catch (error) {
    console.error("❌ Error al obtener cliente:", error.message);
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

    console.log(`🔄 PUT /api/clientes/${id} - Actualizando cliente...`);

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

    console.log(`✅ Cliente ${id} actualizado correctamente`);

    res.json({ 
      message: 'Cliente actualizado correctamente',
      id: id
    });

  } catch (error) {
    console.error('❌ Error al actualizar cliente:', error.message);
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

    console.log(`🗑️ DELETE /api/clientes/${id} - Eliminando cliente...`);

    const [clienteExiste] = await pool.query(
      'SELECT id, first_name, last_name FROM users WHERE id = ?',
      [id]
    );

    if (clienteExiste.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    await pool.query('DELETE FROM users WHERE id = ?', [id]);

    console.log(`✅ Cliente ${id} eliminado: ${clienteExiste[0].first_name} ${clienteExiste[0].last_name}`);

    res.json({ 
      message: 'Cliente eliminado correctamente',
      nombre: `${clienteExiste[0].first_name} ${clienteExiste[0].last_name}`
    });

  } catch (error) {
    console.error('❌ Error al eliminar cliente:', error.message);
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
    console.log("📊 GET /api/clientes/stats/resumen - Obteniendo estadísticas...");

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

    console.log("✅ Estadísticas calculadas exitosamente");

    res.json({
      resumen: stats[0],
      por_rol: roles
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