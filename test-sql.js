const sql = require('mssql');

// ============================================================
// ⚠️ CAMBIA ESTOS DATOS CON LOS TUYOS ⚠️
// ============================================================
const CONTRASENA_SA = 'ESCRIBE_AQUÍ_TU_CONTRASEÑA_REAL';   // <-- CAMBIA
const BASE_DATOS = 'TechShop_App';   // ¿Es Infor o TechShop_App? Pon el nombre correcto

// ============================================================
// Lista de configuraciones a probar (solo localhost)
// ============================================================
const configuraciones = [
    {
        nombre: 'Opción 1: encrypt=false + trustServerCertificate=true + tdsVersion 7_3_A',
        opciones: {
            encrypt: false,
            trustServerCertificate: true,
            enableArithAbort: true,
            tdsVersion: '7_3_A'
        }
    },
    {
        nombre: 'Opción 2: encrypt=false + trustServerCertificate=true (sin tdsVersion)',
        opciones: {
            encrypt: false,
            trustServerCertificate: true,
            enableArithAbort: true
        }
    },
    {
        nombre: 'Opción 3: encrypt=true + trustServerCertificate=true (forzando cifrado)',
        opciones: {
            encrypt: true,
            trustServerCertificate: true,
            enableArithAbort: true,
            tdsVersion: '7_3_A'
        }
    },
    {
        nombre: 'Opción 4: usando "localhost" con instancia por defecto (sin puerto específico)',
        opciones: {
            encrypt: false,
            trustServerCertificate: true
        },
        server: 'localhost',  // sin puerto, usa el 1433 por defecto
        port: undefined
    }
];

// ============================================================
// Función de prueba
// ============================================================
async function probar(configuracion) {
    const cfg = {
        user: 'sa',
        password: CONTRASENA_SA,
        server: 'localhost',
        port: 1433,
        database: BASE_DATOS,
        options: configuracion.opciones,
        connectionTimeout: 10000,
        requestTimeout: 10000
    };
    // Si la configuración define server o port diferente, se sobreescribe
    if (configuracion.server) cfg.server = configuracion.server;
    if (configuracion.port === undefined && configuracion.server === 'localhost') delete cfg.port;
    
    console.log(`\n🔍 ${configuracion.nombre}`);
    console.log(`   Servidor: ${cfg.server}:${cfg.port || 1433}`);
    console.log(`   Opciones: encrypt=${cfg.options.encrypt}, trustCert=${cfg.options.trustServerCertificate}, tdsVersion=${cfg.options.tdsVersion || 'auto'}`);
    
    try {
        const pool = await sql.connect(cfg);
        const result = await pool.request().query('SELECT @@VERSION AS version, DB_NAME() AS db_name');
        console.log(`   ✅ CONECTADO correctamente`);
        console.log(`   📌 Versión: ${result.recordset[0].version.substring(0, 80)}...`);
        console.log(`   📚 Base de datos actual: ${result.recordset[0].db_name}`);
        await pool.close();
        return true;
    } catch (err) {
        console.log(`   ❌ ERROR: ${err.message}`);
        if (err.code) console.log(`      Código: ${err.code}`);
        if (err.originalError && err.originalError.info) {
            const info = err.originalError.info;
            console.log(`      Mensaje del servidor: ${info.message}`);
            if (info.number === 18456) {
                const estadoMatch = info.message.match(/state\s*(\d+)/i);
                if (estadoMatch) {
                    console.log(`      🔑 Estado (state): ${estadoMatch[1]} → Causa específica:`);
                    explicarEstado(estadoMatch[1]);
                }
            }
        } else if (err.message.includes('ELOGIN')) {
            console.log(`      ⚠️ Error ELOGIN: las credenciales son rechazadas. Puede ser contraseña incorrecta o modo de autenticación no mixto.`);
        }
        return false;
    }
}

function explicarEstado(state) {
    const estados = {
        '1': 'Error interno o información de autenticación incorrecta.',
        '2': 'Modo de autenticación incorrecto (el servidor está en solo Windows).',
        '5': 'El usuario sa no existe (no debería pasar).',
        '6': 'Intento de login de Windows con autenticación SQL.',
        '8': 'Contraseña incorrecta. Revisa que la hayas escrito bien en el script.',
        '10': 'Login sa deshabilitado o sin permiso de conexión.',
        '11': 'Login sa válido pero sin permiso para acceder a la base de datos.',
        '12': 'Login sa válido pero base de datos incorrecta o sin permiso.',
        '18': 'La contraseña debe cambiarse (política de expiración).'
    };
    console.log(`      ➡️ ${estados[state] || 'Causa desconocida. Revisa el log de SQL Server.'}`);
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 DIAGNÓSTICO DE CONEXIÓN A SQL SERVER 2008 (solo localhost)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Base de datos configurada: ${BASE_DATOS}`);
    console.log(`Usuario: sa`);
    console.log(`⚠️ Asegúrate de haber cambiado la contraseña en el script.`);
    
    let algunaExitosa = false;
    for (const conf of configuraciones) {
        const exito = await probar(conf);
        if (exito) {
            algunaExitosa = true;
            break;  // Si una funciona, no hace falta probar más
        }
    }
    
    if (!algunaExitosa) {
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('❌ NINGUNA CONFIGURACIÓN FUNCIONÓ. Causas probables:');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('1. Contraseña incorrecta (revisa que la hayas puesto bien en el script).');
        console.log('2. El modo de autenticación no es mixto (solo Windows).');
        console.log('   → Solución: Conéctate con Windows Auth, propiedades del servidor > Seguridad > SQL Server y Windows');
        console.log('3. El servicio SQL Browser no está corriendo o el puerto 1433 no está escuchando.');
        console.log('   → Ejecuta en PowerShell: Test-NetConnection localhost -Port 1433');
        console.log('4. La base de datos especificada no existe o no se puede acceder.');
        console.log('5. El login sa está deshabilitado.');
        console.log('\n📄 Para más detalles, revisa el archivo ERRORLOG:');
        console.log('   C:\\Program Files\\Microsoft SQL Server\\MSSQL10_50.MSSQLSERVER\\MSSQL\\Log\\ERRORLOG');
        console.log('   Busca "Login failed" o "18456".');
        console.log('\n🔧 O crea un usuario específico y úsalo en lugar de sa:');
        console.log('   CREATE LOGIN infor_bridge WITH PASSWORD = \'Clave\', CHECK_POLICY = OFF;');
        console.log('   USE TechShop_App; CREATE USER infor_bridge FOR LOGIN infor_bridge;');
        console.log('   ALTER ROLE db_datareader ADD MEMBER infor_bridge;');
    } else {
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('🎉 ÉXITO: Se encontró una configuración que funciona.');
        console.log('   Copia esas opciones a tu server.js y listo.');
        console.log('═══════════════════════════════════════════════════════════');
    }
}

main().catch(console.error);
