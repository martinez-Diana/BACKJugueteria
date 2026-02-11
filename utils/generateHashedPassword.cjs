// utils/generateHashedPassword.js
// Ejecutar con: node utils/generateHashedPassword.js

const bcrypt = require('bcrypt');

const generateHashedPassword = async (password) => {
  try {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    console.log('\n=================================');
    console.log('CONTRASEÑA HASHEADA GENERADA');
    console.log('=================================');
    console.log('Contraseña original:', password);
    console.log('Contraseña hasheada:', hashedPassword);
    console.log('=================================\n');
    console.log('Copia esta contraseña hasheada y úsala en tu script SQL');
    console.log('para insertar el usuario administrador en la base de datos.\n');
    
    return hashedPassword;
  } catch (error) {
    console.error('Error al generar hash:', error);
  }
};

// Puedes cambiar esta contraseña por la que desees
const passwordToHash = process.argv[2] || 'Admin123!';

generateHashedPassword(passwordToHash);

/* 
INSTRUCCIONES DE USO:

1. Instalar bcrypt si no lo tienes:
   npm install bcrypt

2. Ejecutar el script:
   node utils/generateHashedPassword.js

3. O con una contraseña personalizada:
   node utils/generateHashedPassword.js "MiContraseñaSegura2024"

4. Copiar el hash generado y usarlo en el script SQL
   para insertar el administrador en la base de datos
*/
