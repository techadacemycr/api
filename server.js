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


const PORT       = 8787;
const API_KEY    = "AQUÍ_PON_UN_TOKEN_SEGURO"; 

const DB_USER    = "sa";
const DB_PASS    = "ESCRIBE_AQUÍ_TU_CONTRASEÑA_DE_SA"; 
const DB_HOST    = "localhost";
const DB_PORT    = 1433;
const DB_NAME    = "TechShop_App";  

const ALLOWED_READ = [
    "itemvend", "jobmatl", "job_ref", "po", "poitem", "preq", "preqitem",
    "vendaddr", "vendor", "item", "CorCOpenOrders", "coitem", "CorCAWB",
    "co", "inv_item", "inv_hdr", "custaddr", "customer", "CorPJobOper"
];
const ALLOWED_WRITE = [...ALLOWED_READ];   

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

app.get('/health', (_req, res) => res.json({
    ok: true,
    db: DB_NAME,
    uptime: Math.round(process.uptime()),
    ts: new Date().toISOString(),
}));

app.use((req, res, next) => {
    if (req.path === '/health') return next();
    if (req.headers['x-api-key'] !== API_KEY) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    next();
});

const cfg = {
    user: DB_USER,
    password: DB_PASS,
    server: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    options: {
        encrypt: false,             
        trustServerCertificate: true, 
        enableArithAbort: true,
        tdsVersion: '7_3_A'       
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 15000,
    requestTimeout: 30000
};

let pool;
async function initPool() {
    try {
        pool = await sql.connect(cfg);
        pool.on('error', err => console.error('[POOL ERROR]', err.message));
        console.log(`[OK] Conectado a SQL Server 2008 — BD: ${cfg.database}`);
        console.log(`[OK] Tablas READ:  ${ALLOWED_READ.join(', ') || '(ninguna)'}`);
        console.log(`[OK] Tablas WRITE: ${ALLOWED_WRITE.join(', ') || '(ninguna)'}`);
    } catch (err) {
        console.error('[FATAL] No se pudo conectar a SQL Server:', err.message);
        process.exit(1);
    }
}
initPool();

app.get('/api/tables', (_req, res) => {
    res.json({ read: ALLOWED_READ, write: ALLOWED_WRITE });
});

app.get('/api/tabla/:nombre', async (req, res) => {
    const { nombre } = req.params;
    if (!isSafeIdentifier(nombre) || !ALLOWED_READ.includes(nombre)) {
        return res.status(403).json({ error: 'tabla no permitida o inválida' });
    }
    const limit  = Math.min(Number(req.query.limit) || 50, 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const orderBy = isSafeIdentifier(req.query.orderBy) ? req.query.orderBy : null;
    const orderClause = orderBy ? `ORDER BY [${orderBy}]` : `ORDER BY (SELECT NULL)`;

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

app.get('/api/tabla/:nombre/:id', async (req, res) => {
    const { nombre, id } = req.params;
    const pk = req.query.pk || 'Id';
    if (!isSafeIdentifier(nombre) || !ALLOWED_READ.includes(nombre) || !isSafeIdentifier(pk)) {
        return res.status(403).json({ error: 'parámetros inválidos' });
    }
    try {
        const r = await pool.request()
            .input('id', id)
            .query(`SELECT TOP 1 * FROM [dbo].[${nombre}] WHERE [${pk}] = @id`);
        if (r.recordset.length === 0) return res.status(404).json({ error: 'no encontrado' });
        res.json(r.recordset[0]);
    } catch (e) {
        console.error('[ERROR GET BY ID]', nombre, id, e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/select', async (req, res) => {
    const { sql: queryText, params = {} } = req.body || {};
    if (typeof queryText !== 'string') return res.status(400).json({ error: 'falta sql' });
    const cleaned = queryText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '').trim();
    if (!/^SELECT\b/i.test(cleaned)) return res.status(400).json({ error: 'solo SELECT' });
    if (FORBIDDEN_SQL.test(cleaned) || containsForbidden(params)) {
        return res.status(400).json({ error: 'consulta no permitida' });
    }
    try {
        const request = pool.request();
        for (const [k, v] of Object.entries(params)) {
            if (!isSafeIdentifier(k)) return res.status(400).json({ error: 'parámetro inválido' });
            request.input(k, v);
        }
        const r = await request.query(cleaned);
        res.json({ rows: r.recordset, count: r.recordset.length });
    } catch (e) {
        console.error('[ERROR SELECT]', e.message);
        res.status(500).json({ error: e.message });
    }
});
app.put('/api/tabla/:nombre/:id', async (req, res) => {
    const { nombre, id } = req.params;
    const { pk = 'Id', set = {} } = req.body || {};
    if (!isSafeIdentifier(nombre) || !ALLOWED_WRITE.includes(nombre) || !isSafeIdentifier(pk)) {
        return res.status(403).json({ error: 'tabla no permitida para modificación' });
    }
    const cols = Object.keys(set);
    if (cols.length === 0) return res.status(400).json({ error: 'set vacío' });
    for (const c of cols) if (!isSafeIdentifier(c)) return res.status(400).json({ error: 'columna inválida' });
    if (containsForbidden(set)) return res.status(400).json({ error: 'valores prohibidos' });

    const setClauses = cols.map((c, i) => `[${c}] = @v${i}`).join(', ');
    const query = `UPDATE [dbo].[${nombre}] SET ${setClauses} WHERE [${pk}] = @id`;
    try {
        const request = pool.request().input('id', id);
        cols.forEach((c, i) => request.input('v' + i, set[c]));
        const r = await request.query(query);
        res.json({ ok: true, affected: r.rowsAffected[0], tabla: nombre, id });
    } catch (e) {
        console.error('[ERROR PUT]', nombre, id, e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/tabla/*', (_req, res) => res.status(403).json({ error: 'INSERT no permitido' }));
app.delete('/api/tabla/*', (_req, res) => res.status(403).json({ error: 'DELETE no permitido' }));

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

const server = app.listen(PORT, '127.0.0.1', () => {
    console.log('==============================================');
    console.log(`Infor bridge escuchando en 127.0.0.1:${PORT}`);
    console.log('==============================================');
});

async function shutdown(sig) {
    console.log(`\n[${sig}] cerrando...`);
    server.close();
    if (pool) await pool.close();
    process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
