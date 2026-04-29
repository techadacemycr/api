/*
 * Infor Bridge — API HTTPS para SQL Server 2008
 * ----------------------------------------------------
 * Lectura (GET) y modificación (PUT) sobre tablas de Infor.
 * NO permite INSERT, DELETE, CREATE, ALTER, DROP, TRUNCATE.
 * Usa whitelist de tablas + queries parametrizadas + filtro de palabras clave.
 *
 * Requiere Node.js 18 LTS y un archivo .env en la misma carpeta.
 */

require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const morgan  = require('morgan');
const cors    = require('cors');
const sql     = require('mssql');

const app = express();
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));

// =====================================================
// CONFIG desde .env
// =====================================================
const PORT       = Number(process.env.PORT) || 8787;
const API_KEY    = process.env.API_KEY;

const ALLOWED_READ = (process.env.ALLOWED_READ_TABLES || '')
  .split(',').map(t => t.trim()).filter(Boolean);

const ALLOWED_WRITE = (process.env.ALLOWED_WRITE_TABLES || '')
  .split(',').map(t => t.trim()).filter(Boolean);

if (!API_KEY) {
  console.error('[FATAL] API_KEY no está definida en .env');
  process.exit(1);
}
if (ALLOWED_READ.length === 0) {
  console.warn('[WARN] ALLOWED_READ_TABLES está vacío. Ningún GET va a funcionar.');
}

// =====================================================
// SAFETY: rechazar palabras clave peligrosas en cualquier
// input del usuario. Es una segunda línea de defensa por
// encima de las queries parametrizadas.
// =====================================================
const FORBIDDEN_SQL = /\b(DELETE|DROP|TRUNCATE|INSERT|CREATE|ALTER|EXEC|EXECUTE|GRANT|REVOKE|SHUTDOWN|MERGE|BACKUP|RESTORE|XP_|SP_CONFIGURE)\b/i;

function isSafeIdentifier(s) {
  return typeof s === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(s);
}

function containsForbidden(value) {
  if (value == null) return false;
  if (typeof value === 'string') return FORBIDDEN_SQL.test(value);
  if (typeof value === 'object') {
    return Object.values(value).some(containsForbidden);
  }
  return false;
}

// =====================================================
// HEALTH CHECK — sin auth, para que UptimeRobot lo
// pueda chequear sin pasar credenciales en la URL.
// =====================================================
app.get('/health', (_req, res) => res.json({
  ok: true,
  db: process.env.MSSQL_DB,
  uptime: Math.round(process.uptime()),
  ts: new Date().toISOString(),
}));

// =====================================================
// AUTENTICACIÓN — todo abajo de acá requiere x-api-key
// =====================================================
app.use((req, res, next) => {
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

// =====================================================
// CONEXIÓN A SQL SERVER 2008
// =====================================================
const cfg = {
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASS,
  server: process.env.MSSQL_HOST,
  port: Number(process.env.MSSQL_PORT),
  database: process.env.MSSQL_DB,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    tdsVersion: '7_3_A',  // SQL Server 2008
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  connectionTimeout: 15000,
  requestTimeout: 30000,
};

let pool;
async function initPool() {
  try {
    pool = await sql.connect(cfg);
    pool.on('error', err => {
      console.error('[POOL ERROR]', err.message);
    });
    console.log(`[OK] Conectado a SQL Server 2008 — BD: ${cfg.database}`);
    console.log(`[OK] Tablas READ:  ${ALLOWED_READ.join(', ') || '(ninguna)'}`);
    console.log(`[OK] Tablas WRITE: ${ALLOWED_WRITE.join(', ') || '(ninguna)'}`);
  } catch (err) {
    console.error('[FATAL] No se pudo conectar a SQL Server:', err.message);
    process.exit(1);
  }
}
initPool();

// =====================================================
// LISTAR TABLAS PERMITIDAS (debug)
// =====================================================
app.get('/api/tables', (_req, res) => {
  res.json({ read: ALLOWED_READ, write: ALLOWED_WRITE });
});

// =====================================================
// LEER FILAS DE UNA TABLA — con paginación
// GET /api/tabla/:nombre?limit=50&offset=0&orderBy=Id
// =====================================================
app.get('/api/tabla/:nombre', async (req, res) => {
  const { nombre } = req.params;

  if (!isSafeIdentifier(nombre)) {
    return res.status(400).json({ error: 'nombre de tabla inválido' });
  }
  if (!ALLOWED_READ.includes(nombre)) {
    return res.status(403).json({ error: 'tabla no permitida para lectura' });
  }

  const limit  = Math.min(Number(req.query.limit)  || 50, 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const orderBy = isSafeIdentifier(req.query.orderBy) ? req.query.orderBy : null;

  // SQL Server 2008 NO soporta OFFSET/FETCH (eso es 2012+).
  // Usamos ROW_NUMBER() para paginar.
  const orderClause = orderBy
    ? `ORDER BY [${orderBy}]`
    : `ORDER BY (SELECT NULL)`;

  const query = `
    SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER (${orderClause}) AS __rn
      FROM [dbo].[${nombre}]
    ) t
    WHERE __rn BETWEEN @from AND @to
  `;

  try {
    const r = await pool.request()
      .input('from', sql.Int, offset + 1)
      .input('to',   sql.Int, offset + limit)
      .query(query);
    res.json({ rows: r.recordset, count: r.recordset.length, limit, offset });
  } catch (e) {
    console.error('[ERROR GET]', nombre, e.message);
    res.status(500).json({ error: e.message });
  }
});

// =====================================================
// LEER UNA FILA POR ID
// GET /api/tabla/:nombre/:id?pk=Id
// =====================================================
app.get('/api/tabla/:nombre/:id', async (req, res) => {
  const { nombre, id } = req.params;
  const pk = req.query.pk || 'Id';

  if (!isSafeIdentifier(nombre)) return res.status(400).json({ error: 'tabla inválida' });
  if (!isSafeIdentifier(pk))     return res.status(400).json({ error: 'pk inválida' });
  if (!ALLOWED_READ.includes(nombre)) {
    return res.status(403).json({ error: 'tabla no permitida' });
  }

  try {
    const r = await pool.request()
      .input('id', id)
      .query(`SELECT TOP 1 * FROM [dbo].[${nombre}] WHERE [${pk}] = @id`);
    if (r.recordset.length === 0) {
      return res.status(404).json({ error: 'no encontrado' });
    }
    res.json(r.recordset[0]);
  } catch (e) {
    console.error('[ERROR GET BY ID]', nombre, id, e.message);
    res.status(500).json({ error: e.message });
  }
});

// =====================================================
// QUERY SELECT LIBRE (con whitelist y guardas)
// POST /api/select  body: { sql: "SELECT ...", params: {...} }
// =====================================================
app.post('/api/select', async (req, res) => {
  const { sql: queryText, params = {} } = req.body || {};

  if (typeof queryText !== 'string' || queryText.trim().length === 0) {
    return res.status(400).json({ error: 'falta sql' });
  }

  // Limpiar comentarios
  const cleaned = queryText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim();

  // Tiene que empezar con SELECT
  if (!/^SELECT\b/i.test(cleaned)) {
    return res.status(400).json({ error: 'solo se permite SELECT' });
  }

  // Rechazar palabras clave peligrosas
  if (FORBIDDEN_SQL.test(cleaned)) {
    return res.status(400).json({ error: 'query contiene palabras prohibidas' });
  }
  if (containsForbidden(params)) {
    return res.status(400).json({ error: 'parámetros contienen palabras prohibidas' });
  }

  try {
    const request = pool.request();
    for (const [k, v] of Object.entries(params)) {
      if (!isSafeIdentifier(k)) {
        return res.status(400).json({ error: 'nombre de parámetro inválido: ' + k });
      }
      request.input(k, v);
    }
    const r = await request.query(cleaned);
    res.json({ rows: r.recordset, count: r.recordset.length });
  } catch (e) {
    console.error('[ERROR SELECT]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// =====================================================
// ACTUALIZAR FILAS — SOLO UPDATE
// PUT /api/tabla/:nombre/:id
// body: { pk: "Id", set: { Campo1: "valor1", Campo2: 42 } }
// =====================================================
app.put('/api/tabla/:nombre/:id', async (req, res) => {
  const { nombre, id } = req.params;
  const { pk = 'Id', set = {} } = req.body || {};

  if (!isSafeIdentifier(nombre)) return res.status(400).json({ error: 'tabla inválida' });
  if (!isSafeIdentifier(pk))     return res.status(400).json({ error: 'pk inválida' });
  if (!ALLOWED_WRITE.includes(nombre)) {
    return res.status(403).json({ error: 'tabla no permitida para modificación' });
  }

  const cols = Object.keys(set);
  if (cols.length === 0) {
    return res.status(400).json({ error: 'set vacío' });
  }
  for (const c of cols) {
    if (!isSafeIdentifier(c)) {
      return res.status(400).json({ error: 'columna inválida: ' + c });
    }
  }
  if (containsForbidden(set)) {
    return res.status(400).json({ error: 'valores contienen palabras prohibidas' });
  }

  // Construir SET con parámetros (anti-injection)
  const setClauses = cols.map((c, i) => `[${c}] = @v${i}`).join(', ');
  const query = `
    UPDATE [dbo].[${nombre}]
       SET ${setClauses}
     WHERE [${pk}] = @id
  `;

  try {
    const request = pool.request().input('id', id);
    cols.forEach((c, i) => request.input('v' + i, set[c]));
    const r = await request.query(query);
    res.json({
      ok: true,
      affected: r.rowsAffected[0],
      tabla: nombre,
      id,
    });
  } catch (e) {
    console.error('[ERROR PUT]', nombre, id, e.message);
    res.status(500).json({ error: e.message });
  }
});

// =====================================================
// BLOQUEO EXPLÍCITO — POST y DELETE en rutas de tablas
// =====================================================
app.post('/api/tabla/*', (_req, res) => {
  res.status(403).json({ error: 'INSERT no permitido' });
});
app.delete('/api/tabla/*', (_req, res) => {
  res.status(403).json({ error: 'DELETE no permitido' });
});

// 404 final
app.use((_req, res) => res.status(404).json({ error: 'not found' }));

// =====================================================
// LEVANTAR EL SERVIDOR (solo en localhost — el túnel
// de Cloudflare es el único que puede llegar)
// =====================================================
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log('==============================================');
  console.log(`Infor bridge escuchando en 127.0.0.1:${PORT}`);
  console.log('==============================================');
});

// Cierre limpio
async function shutdown(sig) {
  console.log(`\n[${sig}] cerrando...`);
  server.close();
  if (pool) await pool.close();
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
