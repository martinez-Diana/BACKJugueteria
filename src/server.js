import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js"; // Rutas de autenticación
import pool from "./config/db.js"; // Conexión a la BD

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// RUTAS
app.use("/api", authRoutes);

// Servidor
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor backend en http://localhost:${PORT}`);
});
