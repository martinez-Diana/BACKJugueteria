import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";
import pool from "./config/db.js";
import productosRoutes from "./routes/productosRoutes.js"; 
import clientesRoutes from './routes/clientesRoutes.js';
import ventasRoutes from './routes/ventasRoutes.js';
import contactoRoutes from './routes/contactoRoutes.js';
import exportRoutes from "./routes/exportRoutes.js";

dotenv.config();

const app = express();

// ==========================================
// 🔍 VERIFICAR VARIABLES DE ENTORNO CRÍTICAS
// ==========================================
console.log("🔍 Verificando variables de entorno...");

const requiredEnvVars = [
  'DB_HOST',           // ✅ Cambiar de DATABASE_HOST a DB_HOST
  'DB_USER',           // ✅ Cambiar de DATABASE_USER a DB_USER
  'DB_PASSWORD',       // ✅ Cambiar de DATABASE_PASSWORD a DB_PASSWORD
  'DB_NAME',           // ✅ Cambiar de DATABASE_NAME a DB_NAME
  'JWT_SECRET'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ FALTAN VARIABLES DE ENTORNO CRÍTICAS:');
  missingVars.forEach(varName => {
    console.error(`   - ${varName}`);
  });
  console.error('\n💡 Configúralas en Railway → Variables');
  process.exit(1);
}

console.log("✅ Variables de entorno verificadas");

// Verificar variables opcionales (email)
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.warn("⚠️ EMAIL_USER o EMAIL_PASS no configuradas (funciones de email deshabilitadas)");
}

// ==========================================
// 🗄️ VERIFICAR CONEXIÓN A BASE DE DATOS
// ==========================================
console.log("🔌 Intentando conectar a la base de datos...");

try {
  const connection = await pool.getConnection();
  console.log("✅ Conexión a base de datos exitosa");
  console.log(`📊 Base de datos: ${process.env.DATABASE_NAME}`);

    // AGREGAR ESTAS LÍNEAS DE DEBUG:
  console.log("🔍 Variables de DB:", {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
    hasPassword: !!process.env.DB_PASSWORD
  });
  
  connection.release();
} catch (error) {
  console.error("❌ Error al conectar a la base de datos:");
  console.error("   Host:", process.env.DB_HOST);        // Cambiar aquí
  console.error("   User:", process.env.DB_USER);        // Cambiar aquí
  console.error("   Database:", process.env.DB_NAME);    // Cambiar aquí
  console.error("   Error:", error.message);
  console.error("   Código:", error.code);
  process.exit(1);
}

// ==========================================
// 🛡️ MIDDLEWARES
// ==========================================
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5175",
      "https://jmfrontend-production.up.railway.app",
      "https://frontjugueteria-production.up.railway.app",
      "https://back-jugueteria.vercel.app",
      "https://starlit-gumdrop-ac85c8.netlify.app"
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.use(express.json());

// ==========================================
// 🛣️ RUTAS
// ==========================================
app.use("/api", authRoutes);
app.use("/api/productos", productosRoutes); 
app.use("/api/clientes", clientesRoutes);
app.use("/api/ventas", ventasRoutes);
app.use('/api/contacto', contactoRoutes);
app.use("/api/exportar", exportRoutes);

// Ruta de health check
app.get("/", (req, res) => {
  res.json({ 
    status: "OK",
    message: "🎁 API de Juguetería Martínez",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get("/health", async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({ 
      status: "unhealthy",
      database: "disconnected",
      error: error.message
    });
  }
});

// ==========================================
// 🚀 INICIAR SERVIDOR
// ==========================================
const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✨ ========================================`);
  console.log(`   🚀 Servidor iniciado exitosamente`);
  console.log(`   📍 Puerto: ${PORT}`);
  console.log(`   🌐 Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   🔗 Frontend: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  console.log(`   ⏰ ${new Date().toLocaleString('es-MX')}`);
  console.log(`========================================\n`);
});

// ==========================================
// ⚠️ MANEJO DE ERRORES
// ==========================================
process.on('uncaughtException', (error) => {
  console.error('\n❌ Excepción no capturada:');
  console.error(error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ Promise rechazada no manejada:');
  console.error('Razón:', reason);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️ SIGTERM recibido. Cerrando servidor gracefully...');
  server.close(() => {
    console.log('✅ Servidor cerrado');
    pool.end();
    process.exit(0);
  });
});

export default app;