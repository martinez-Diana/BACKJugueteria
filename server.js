import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";
import pool from "./config/db.js";

dotenv.config();

const app = express();

// CORS CORRECTO PARA FRONT-END EN RAILWAY
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://jmfrontend-production.up.railway.app"
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.use(express.json());

// RUTAS ACTIVAS
app.use("/api", authRoutes);

// PUERTO DINÁMICO PARA RAILWAY
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor backend en puerto ${PORT}`);
});
