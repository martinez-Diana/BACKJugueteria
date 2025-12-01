import jwt from "jsonwebtoken";
import pool from "../config/db.js";

export const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    // ✅ Verificar si el token está en la blacklist
    const [blacklisted] = await pool.query(
      "SELECT id FROM token_blacklist WHERE token = ?",
      [token]
    );

    if (blacklisted.length > 0) {
      return res.status(401).json({ 
        error: "Tu sesión ha sido cerrada",
        revoked: true 
      });
    }

    // ✅ Verificar validez del token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: "Tu sesión ha expirado",
        expired: true 
      });
    }
    return res.status(401).json({ error: "Token inválido" });
  }
};