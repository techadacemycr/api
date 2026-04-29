# Infor Bridge

API HTTPS local para conectar SQL Server 2008 (Infor) con servicios en internet (Railway, etc.) sin VPN, sin abrir puertos, vía Cloudflare Tunnel.

## Quick start

> Asume que ya tenés SQL Server 2008 corriendo, TCP/IP habilitado en puerto 1433, autenticación mixta, y la contraseña de SA. Si no, mirá la guía completa.

### 1. Copiar archivos a la laptop

Copiá esta carpeta entera a `C:\infor-bridge\` en la laptop servidor.

### 2. Instalar Node.js 18 LTS

Bajá de https://nodejs.org/en/download/releases la versión `18.x.x LTS` Windows Installer 64-bit.

> ⚠️ NO uses Node 20 o 22. SQL Server 2008 da problemas de TLS con OpenSSL 3 (el que viene en Node 20+).

Verificá:

```powershell
node --version
# v18.x.x
```

### 3. Crear `.env`

```powershell
cd C:\infor-bridge
copy .env.example .env
notepad .env
```

Completá los valores. Generá el `API_KEY` con:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object {Get-Random -Max 256}))
```

### 4. Instalar dependencias

```powershell
cd C:\infor-bridge
npm install
```

### 5. Probar

```powershell
node server.js
```

Tiene que mostrar:

```
[OK] Conectado a SQL Server 2008 — BD: Infor
[OK] Tablas READ:  Productos, Inventario, ...
[OK] Tablas WRITE: Productos, Inventario
==============================================
Infor bridge escuchando en 127.0.0.1:8787
==============================================
```

En otra ventana de PowerShell:

```powershell
curl.exe http://localhost:8787/health
# {"ok":true,"db":"Infor",...}

curl.exe -H "x-api-key: TU_TOKEN" "http://localhost:8787/api/tabla/Productos?limit=3"
# {"rows":[...],"count":3,"limit":3,"offset":0}
```

### 6. Convertir en servicio Windows

Para que arranque solo y sobreviva reinicios, instalá NSSM (https://nssm.cc/download), descomprimí en `C:\nssm`, y desde PowerShell **como Administrador**:

```powershell
C:\nssm\win64\nssm.exe install InforBridge "C:\Program Files\nodejs\node.exe" "C:\infor-bridge\server.js"
C:\nssm\win64\nssm.exe set InforBridge AppDirectory "C:\infor-bridge"
C:\nssm\win64\nssm.exe set InforBridge AppStdout "C:\infor-bridge\service-out.log"
C:\nssm\win64\nssm.exe set InforBridge AppStderr "C:\infor-bridge\service-err.log"
C:\nssm\win64\nssm.exe set InforBridge Start SERVICE_AUTO_START
sc.exe failure InforBridge reset= 0 actions= restart/5000/restart/5000/restart/5000
Start-Service InforBridge
```

### 7. Configurar el túnel de Cloudflare

Mirá la PARTE D de la guía completa.

---

## Endpoints

Todos requieren el header `x-api-key: TU_TOKEN`, excepto `/health`.

| Método | Ruta | Acción |
|---|---|---|
| GET | `/health` | Estado del servicio (sin auth) |
| GET | `/api/tables` | Lista whitelist de tablas |
| GET | `/api/tabla/:nombre` | Lee filas (paginado) |
| GET | `/api/tabla/:nombre/:id` | Lee una fila por PK |
| POST | `/api/select` | SELECT libre (con guardas) |
| PUT | `/api/tabla/:nombre/:id` | Actualiza una fila |
| POST | `/api/tabla/*` | **403** — INSERT no permitido |
| DELETE | `/api/tabla/*` | **403** — DELETE no permitido |

### Ejemplos

```bash
# Leer 50 productos, ordenados por Id
curl -H "x-api-key: $TOKEN" \
  "https://api.tu-dominio.com/api/tabla/Productos?limit=50&orderBy=Id"

# Leer un producto puntual
curl -H "x-api-key: $TOKEN" \
  "https://api.tu-dominio.com/api/tabla/Productos/123?pk=Id"

# SELECT con JOIN (libre, validado)
curl -X POST -H "x-api-key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"sql":"SELECT TOP 10 p.Id, p.Nombre FROM Productos p WHERE p.Activo = @act","params":{"act":1}}' \
  "https://api.tu-dominio.com/api/select"

# Actualizar
curl -X PUT -H "x-api-key: $TOKEN" -H "Content-Type: application/json" \
  -d '{"pk":"Id","set":{"Descripcion":"nuevo texto","Precio":1500}}' \
  "https://api.tu-dominio.com/api/tabla/Productos/123"
```

---

## Seguridad

Esta API confía en 4 capas:

1. **`x-api-key`** — sin el header correcto, todas las rutas devuelven 401.
2. **Listen en 127.0.0.1** — solo procesos en la misma laptop pueden conectar (cloudflared).
3. **Whitelist de tablas** — solo las tablas listadas en `.env` son accesibles.
4. **Filtro de palabras prohibidas + queries parametrizadas** — DELETE, DROP, INSERT, etc. son bloqueadas en el código aunque el usuario SQL sea SA.

Si rotás el `API_KEY`, hay que cambiarlo en `.env`, reiniciar el servicio (`Restart-Service InforBridge`), y actualizarlo en Railway (`INFOR_API_KEY`).

---

## Logs

El servicio loguea a:

- `C:\infor-bridge\service-out.log` (stdout: requests + conexión SQL)
- `C:\infor-bridge\service-err.log` (stderr: errores)

Para ver logs en vivo:

```powershell
Get-Content C:\infor-bridge\service-out.log -Tail 50 -Wait
```
