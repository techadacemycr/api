require('dotenv').config();
const sql = require('mssql');

const config = {
    user: process.env.MSSQL_USER || 'sa',
    password: process.env.MSSQL_PASS,
    server: process.env.MSSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MSSQL_PORT || '1433', 10),
    database: process.env.MSSQL_DB || 'TechShop_App',
    options: {
        encrypt: false,                // ← necesario para SQL Server 2008
        trustServerCertificate: true,  // ← confía en el certificado autofirmado
        tdsVersion: '7_3_A'           // ← compatible con SQL 2008 SP3
    },
    connectionTimeout: 15000
};

async function testConnection() {
    try {
        await sql.connect(config);
        console.log('✅ Conexión exitosa a SQL Server con las credenciales del .env');
        const result = await sql.query`SELECT @@VERSION AS version`;
        console.log('Versión:', result.recordset[0].version);
        await sql.close();
    } catch (err) {
        console.error('❌ Error de conexión:', err.message);
        if (err.code) console.error('Código:', err.code);
        if (err.originalError && err.originalError.info) {
            console.error('Detalle del error:', err.originalError.info.message);
        }
    }
}

testConnection();
