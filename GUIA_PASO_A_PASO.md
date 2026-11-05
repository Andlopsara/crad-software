# UTEQ — Conectar Neon Data API desde Visual Studio Code (sin Node.js)

Esta versión es un **piloto de una estación**. No está lista todavía para acceso público ni uso institucional con información real de estudiantes/docentes. El PIN actual no es una separación de roles segura. Antes de producción, TI debe separar permisos de kiosco y administración y revisar el flujo de Gmail.

## 0. No borres lo anterior

Conserva los proyectos antiguos. El ZIP incluye CSS original, 115 bloques Sept-Dic 2026, historial, espacios libres y salidas anticipadas. Esta versión utiliza un almacenamiento local nuevo para no mezclar los registros antiguos.

## 1. Habilitar Neon Data API

1. Entra a https://console.neon.tech y selecciona `uteq-aulas-digitales`.
2. Menú izquierdo **Postgres database → Data API**.
3. En **Enable Data API**, selecciona **Use Neon Auth / Managed Better Auth**.
4. Deja **Grant public schema access** sin marcar (los permisos se definen en el SQL).
5. Presiona **Enable Data API**.
6. En la misma página copia la **Data API URL**. No copies la cadena `postgresql://` de Connect.
7. Si el panel muestra ajustes de *Authorized/Trusted Origins* en Auth, agrega el origen exacto de Live Server (`http://127.0.0.1:5500`, o el puerto que uses). No habilites `*` como origen.

## 2. Configurar la tabla y los permisos

1. Abre **SQL Editor** del mismo proyecto / base `neondb`.
2. Abre `database/01_NEON_DATA_API_RLS.sql`, copia todo y presiona **Run**.
3. Revisa que la consulta final muestre 0 filas (ideal si partes de una base nueva). Si aparece una fila con `owner_id` vacío, conserva esa fila; consulta a TI para asociarla a tu cuenta antes de continuar.
4. Regresa a **Data API** y haz clic en **Refresh schema cache**.
5. Ya tienes creada la cuenta Laboratorista Aulas. No uses «Crear cuenta inicial» nuevamente. Si Neon todavía permite altas públicas, mantén el piloto sin acceso público y pide a TI un mecanismo de altas restringidas antes del uso institucional.

## 3. Preparar Visual Studio Code

1. Descomprime el ZIP y selecciona **Archivo → Abrir carpeta**.
2. Abre `config.js`. Necesitas **dos URL públicas** de Neon:
   - `NEON_DATA_API_URL`: en Neon → **Data API**, copia **API URL** tal cual, incluyendo `/rest/v1`.
   - `NEON_AUTH_URL`: en Neon → **Better Auth → Configure Auth**, copia la **Auth URL** terminada en `/auth`. Consulta el detalle de configuración de Auth si no ves la URL.
3. Pega ambas URL completas entre comillas en `config.js`. **No quites** `.apirest` ni `/rest/v1` de la URL de Data API: el SDK oficial necesita la URL original.
4. Guarda `config.js`. Nunca pegues `postgresql://`, `DATABASE_URL`, una API Key de administración, claves JWT ni la contraseña.
5. En VS Code instala la extensión **Live Server** si hace falta. Clic derecho en `index.html` → **Open with Live Server**. No uses `file://`.

## 4. Entrar por primera vez

1. La página mostrará el acceso a Neon.
2. Usa **Crear cuenta inicial** solo si todavía no tienes una cuenta autorizada de Neon Auth, y escribe correo / contraseña propios del operador.
3. Si Neon requiere verificación de email, completa esa verificación y después inicia sesión.
4. Tras entrar debe verse el diseño original del kiosco.
5. Cuando diga **Base vacía · iniciar sistema**, pulsa **Iniciar base nueva**. Esto guarda los 115 bloques de Sept-Dic 2026 con registros vacíos.
6. Comprueba el aviso **Guardado en Neon**. **Si solo aparece Pendiente o Sin sincronizar, NO se ha guardado aún en la base.**

## 5. Comprobarlo en Neon

En Neon → SQL Editor, consulta:

```sql
SELECT id, revision, owner_id, actualizado_en,
jsonb_array_length(estado->'terms') AS cuatrimestres,
jsonb_array_length(estado->'logs') AS clases_registradas,
jsonb_array_length(estado->'freeUses') AS solicitudes
FROM public.uteq_kiosk_state;
```

Debería aparecer una fila con 1 cuatrimestre y 0 registros. Prueba una solicitud ficticia de espacio libre y verifica que cambie el contador.

## 6. Reconectar los avisos de Gmail (solo piloto)

1. En la página, entra a **Administración → Avisos por correo**.
2. Pega la URL `/exec` del proyecto anterior de Gmail y tu clave `CLAVE_KIOSCO` vigente.
3. Guarda y pulsa **Diagnóstico: ver respuesta de Google**.
4. Comprueba que llegue el correo. La clave queda guardada en el navegador del kiosco, no en GitHub, pero alguien con acceso técnico al navegador podría leerla. Para producción será indispensable un servicio de servidor que envíe el correo sin exponer el secreto.

## 7. Github y despliegue futuro

Puedes versionar el código en un repositorio **privado**. El archivo `config.js` solo incluye una URL pública HTTPS (no contraseñas). La Data API requiere una sesión válida y las políticas RLS restringen la fila al dueño.

**No publiques todavía la estación**: la aplicación de un único usuario autenticado permite manipular el estado completo en la sesión del navegador, aunque el PIN proteja una pantalla. No hay permisos separados para docentes y administrador. Para funcionar en recepción con docentes reales, se debe desarrollar un kiosco de permisos limitados y un panel administrativo autenticado distinto.

## Diagnóstico

- **No carga el SDK**: revisa acceso a `https://esm.sh` y la consola del navegador (`F12`). La aplicación necesita Internet para cargar el SDK desde CDN.
- **Error 401**: revisa sesión de Neon Auth y configuración de orígenes.
- **Error 403 o RLS**: revisa que el usuario sea dueño de la fila y que el SQL se ejecutara después de activar Data API.
- **No se guarda**: mira el indicador y no cierres pestaña con movimientos pendientes. Revisa en Neon la fila y `owner_id`.
- **Otra sesión cambió los datos**: exporta un JSON de respaldo y no fuerces la sobrescritura.
- **Gmail no llega**: confirma `doPost` en Ejecuciones del proyecto de Gmail, sin mostrar claves.

## Diseño de seguridad y límites actuales

- Conserva un documento JSONB versionado en la tabla `uteq_kiosk_state`; para concurrencia intensa convendrán tablas relacionales.
- SQL RLS limita el documento al usuario que lo crea. Esto **no** separa permisos entre personas que usen la misma sesión de un kiosco compartido.
- Se guarda una copia local para contingencia pero puede contener datos personales. Usa Windows en modo restringido y respaldos institucionales.
- Los avisos Gmail de prueba pueden solicitarse desde navegador, no constatan entrega.
- Antes de operar oficialmente, solicita revisión de TI y del aviso de privacidad institucional.
