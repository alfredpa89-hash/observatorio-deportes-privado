# Observatorio privado: Render Free y Supabase Free

Estado: preparacion local y pruebas. Este documento no confirma un despliegue.

## Arquitectura

- `node cloud/server.mjs` inicia una puerta HTTPS con Supabase Auth y un unico UUID autorizado.
- El servidor de analisis existente escucha solo en un puerto interno aleatorio.
- El analisis se ejecuta en un worker separado para que los calculos del historial no bloqueen la autenticacion ni la comprobacion HTTPS de Render. La persistencia remota sigue teniendo un unico escritor.
- Los guardados parten el historial con serializaciones acotadas y descartan buffers de piezas ya existentes. No se borra historial ni se cambia el cifrado o la comprobacion de integridad.
- Paginas, JSON, fuentes, exportaciones y todas las API pasan por la misma verificacion de usuario.
- La unica ruta publica de estado es `/healthz`, sin estadisticas ni configuracion.
- Las cookies de sesion son Secure, HttpOnly y SameSite=Lax. Cada solicitud valida al usuario con Supabase; no se confia en un UUID enviado por el navegador.
- El historial se divide en piezas, se comprime y cifra con AES-256-GCM antes de enviarse a un bucket privado. Solo se transfieren piezas nuevas y el indice se confirma con control de revision. No se comparte un archivo JSON mutable entre dos servidores.
- No hay nuevas formulas deportivas ni cambios de ventanas, lineas o pronosticos sellados.

## Antes del primer despliegue

1. Crear una organizacion Supabase **Free** y un proyecto. No agregar tarjeta ni cambiar de plan.
2. Ejecutar `cloud/supabase.sql` en el SQL Editor del proyecto. No crea politicas para anon ni authenticated y mantiene privado el bucket `observatorio-private`.
3. En Authentication, desactivar altas publicas y crear manualmente un solo usuario de la app, con correo confirmado y contrasena introducida por el propietario. La cuenta del panel de Supabase NO es el usuario de la app. Copiar su UUID como `OBSERVATORIO_OWNER_ID`.
4. Configurar un secreto de almacenamiento aleatorio de al menos 32 caracteres. Conservar una copia segura: perderlo impide descifrar el historial, aunque se conserve en Supabase. No cambiarlo despues de cargar datos sin una migracion.
5. Antes de subir el historial, confirmar con el propietario el destino y la cuenta. El historial no va en GitHub. `cloud/seed.mjs` recibe por stdin un JSON con `supabaseUrl`, `serviceKey`, `encryptionKey` e `input` (ruta absoluta de `data/state.json`). No enviar esas claves al chat, no usar argumentos ni guardarlas en archivos. El programa rechaza un destino que ya tiene datos.
6. Crear la copia de codigo con `node cloud/package-source.mjs`. Publicar solamente esa carpeta en un repositorio GitHub **privado** del propietario, despues de su autorizacion. Nunca hacer `git add .` en la carpeta de trabajo con los datos.
7. En Render, crear un **Web Service Free**, no un Static Site ni una base Render Postgres. Usar el repositorio privado y `render.yaml`. Elegir Oregon para acercarlo al proyecto Supabase existente en us-west-2.
8. Configurar las variables indicadas abajo antes de abrir acceso. Una direccion HTTPS equivocada deja el acceso cerrado; no habilitar comodines ni excepciones para corregirlo.
9. Comprobar desde otro dispositivo: acceso anonimo denegado, acceso propietario correcto, otro usuario denegado, consultas protegidas y restauracion del historial tras reiniciar. No anunciar el enlace como listo hasta pasar estas pruebas.

## Variables de Render

- `OBSERVATORIO_PUBLIC_URL`: origen HTTPS exacto asignado por Render, sin rutas ni parametros.
- `OBSERVATORIO_OWNER_ID`: UUID del unico usuario de Supabase Auth autorizado.
- `OBSERVATORIO_STORAGE_SECRET`: secreto persistente para el cifrado del historial; Render puede generarlo, pero debe conservarse y ser el mismo de la carga inicial.
- `SUPABASE_URL`: URL HTTPS del proyecto.
- `SUPABASE_PUBLISHABLE_KEY`: clave publicable para autenticacion; se utiliza solo en el servidor.
- `SUPABASE_SERVICE_ROLE_KEY`: clave privilegiada del proyecto, exclusivamente como secreto del servidor. Nunca enviarla al navegador ni al repositorio.
- Opcionales: `API_FOOTBALL_KEY`, `API_BASKETBALL_KEY`, `FOOTYSTATS_KEY`, como secretos de Render. No se exporta el almacen DPAPI de Windows: las claves deben introducirse una vez en el alojamiento y se restauran al iniciar.

En la version alojada no se cambian claves desde los formularios de la app: hay que cambiarlas en los secretos de Render. La app conserva las consultas de estado y comprobacion de acceso.

## Limites y conservacion

Render Free puede dormirse y no ejecuta actualizaciones mientras esta dormido. El despliegue desactiva el temporizador local; las actualizaciones autorizadas se inician al abrir la app mediante su ruta de visita existente. No se reactiva ninguna prueba diaria ni se garantiza actualizacion continua.

Supabase Free puede pausarse por inactividad. Se aplican sus limites de almacenamiento y transferencias; vigilar consumo antes de aumentar cargas. No se eliminan automaticamente las piezas antiguas: son recuperables mientras se conserve su indice y el secreto. La limpieza requiere revisar referencias y una accion separada del propietario.

Los respaldos del modulo local creados dentro del servidor Render son temporales; exportarlos por la interfaz autenticada para conservarlos. Las copias permanentes principales son el historial cifrado de Supabase y la copia local conservada en Windows.

Un fallo de lectura nunca inicia con un historial vacio. Un conflicto de revision detiene guardados hasta reiniciar, evitando que un segundo proceso sobrescriba cambios. No usar varias instancias ni desplegar otra copia con el mismo historial sin coordinar primero el cierre de la anterior.

Los guardados concurrentes comparten una escritura y una comprobacion final para conservar cambios recibidos durante la transferencia. Los fallos se comunican como almacenamiento no disponible (503), sin repetir mutaciones ni sobrescribir otra revision. La optimizacion de particiones conserva los identificadores existentes; no requiere volver a subir el historial. Si termina el proceso de analisis, la puerta HTTPS deja de anunciarse disponible y sale para que el alojamiento pueda reiniciarla. El cierre de un despliegue tiene un limite de diez segundos para evitar conexiones antiguas indefinidas.

## Pruebas

`node --test cloud/storage.test.mjs cloud/access.test.mjs`

Las pruebas usan proveedores simulados y datos sinteticos. No confirman credenciales reales ni un despliegue. La instalacion de dependencias oficiales queda separada de la app local: no requiere reiniciar ni instalar dependencias para seguir usando `node server.mjs`.
