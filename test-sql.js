require('dotenv').config();
const sql = require('mssql');

const cfg = {
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASS,
  server: process.env.MSSQL_HOST,
  port: Number(process.env.MSSQL_PORT),
  database: process.env.MSSQL_DB,
  options: { encrypt: false, trustServerCertificate: true, tdsVersion: '7_3_A' },
  connectionTimeout: 15000,
};

async function test() {
  try {
    await sql.connect(cfg);
    console.log('✅ Conexión exitosa con las credenciales del .env');
    await sql.close();
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}
test();
