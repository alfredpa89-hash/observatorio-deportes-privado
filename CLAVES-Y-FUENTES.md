# Claves cifradas y fuentes complementarias

## Guardado personal

### Inicio automatico sin la prueba de las 07:00

El 18 de octubre se elimino la automatizacion del chat y se retiro el ciclo
horario de la prueba. El Centro de datos conserva sus actualizaciones normales.
Al arrancar el nuevo servidor, el ensayo anterior queda inactivo sin borrar
pronosticos, entradas, modelos, calibracion ni historiales.

`Activar-inicio-automatico.cmd` configura el inicio al entrar a Windows y abre
la app bajo tu usuario real, no bajo la cuenta aislada del agente. Ejecutalo
desde el Explorador, no desde el terminal del agente. Si hay un servidor de
esta carpeta pide SI antes de pausarlo y reiniciarlo limpiamente. No fuerza
procesos ajenos ni otro programa que ocupe el puerto. No cambia ExecutionPolicy,
no necesita permisos de administrador y no publica el servidor en Internet.

El acceso `Observatorio-Deportes.cmd` de la carpeta Inicio invoca Node y
`local-server.mjs`. Se mantiene un unico supervisor por usuario y proyecto,
mediante un pipe local sin comandos ni secretos. Comprueba solo el servidor
local cada treinta segundos; no son consultas deportivas. Si el proceso se
cierra, vuelve a iniciarlo con espera progresiva de treinta segundos a cinco
minutos. Si hay un servidor que no responde o una aplicacion distinta, no lo
mata ni lo reemplaza. El estado sin claves queda en data/local-server-status.json.

En este equipo el acceso de Inicio ya fue instalado. La ejecucion real bajo
el usuario normal debe confirmarse con el activador. Un acceso instalado no
equivale a un supervisor activo ni a claves cifradas guardadas.

Una vez que el servidor corre bajo tu usuario y muestra cifrado disponible,
conecta solo las claves que nunca llegaron a guardarse y deja marcado Guardar
cifrada en este equipo. En adelante las recupera automaticamente al arrancar.
Si no existe una copia valida no es posible recuperarlas de una supuesta memoria
del chat; no se buscan en conversaciones, logs o volcados del proceso.
La prueba real desde el agente devolvio Cryptography_DpApi_ProfileMayNotBeLoaded.
No se sustituye CurrentUser por cifrado compartido del equipo ni texto plano.

Equipo apagado, hibernado o sesion cerrada: no hay servidor local ni consultas.
Al volver a entrar, el supervisor lo inicia y el Centro de datos retoma sus
pendientes con las cuotas y caches existentes. No es un servicio en la nube.
Para quitar el inicio futuro, elimina solo Observatorio-Deportes.cmd de la
carpeta Inicio de Windows. No se borran datos ni claves; el proceso actual puede
seguir disponible hasta cerrar la sesion.

Abre `Abrir.cmd` desde tu sesion normal de Windows. Marca **Guardar cifrada en este equipo** al conectar cada proveedor. Las claves verificadas se cifran con Windows DPAPI (CurrentUser), usando los cmdlets de PowerShell 7. La distribucion de Node de este equipo incluye PowerShell 7; con otro Node se necesita `pwsh.exe` disponible. No hay un cifrado alternativo en texto plano.

La copia cifrada queda en `%LOCALAPPDATA%\ObservatorioDeportes\credentials-<identificador>.dpapi`, separada de este proyecto, `data/state.json`, respaldos, CSV e informes. El identificador depende de la ruta del proyecto: otra copia no hereda estas claves. No se escriben contrasenas en argumentos de procesos, logs ni archivos temporales sin cifrar. El intercambio con el proceso de cifrado usa exclusivamente tuberias locales. El archivo temporal contiene solo cifrado y se renombra atomicamente.

Al arrancar se recuperan las claves del usuario de Windows, pero no se presupone un plan de pago ni se descargan proveedores durante la recuperacion. El acceso se verifica por los conectores existentes, respetando cuotas y pausas. API-Football y FootyStats se guardan tras validarlas; API-Basketball espera a la verificacion de `/status`. Una respuesta del proveedor o una restauracion de datos nunca entrega las claves al navegador. Variables de entorno siguen teniendo prioridad sobre el almacen.

El boton de llave junto a cada conexion olvida solo esa clave y desconecta al proveedor. Desmarcar el guardado conserva la conexion solo durante la sesion y retira la copia persistida de ese proveedor. Si un archivo esta danado o pertenece a otro usuario, no se sobrescribe ni se recupera sin cifrado.

DPAPI protege archivos en reposo, no contra programas que ya actuen como tu usuario de Windows. Cambiar de usuario, trasladar la carpeta o reinstalar Windows puede requerir introducir las claves de nuevo. No incluyas el almacen en una copia compartida del codigo.

### Entornos aislados

La prueba realizada desde el agente utiliza una cuenta aislada (`codexsandboxonline`) y Windows rechaza DPAPI porque no tiene el perfil de tu sesion. La app muestra el fallo y no afirma haber guardado claves. Para activar el guardado en tu cuenta, abre **Reiniciar.cmd desde el Explorador de Windows**, sin actualizaciones en curso. El lanzador verifica que el servidor corresponda a esta misma carpeta y solicita un cierre limpio antes de abrirlo en tu sesion. No modifica modelos, historiales ni cuotas. Despues conecta las claves una ultima vez y comprueba el mensaje **Clave cifrada con tu usuario de Windows**. No las envies al chat.

Los tests de cifrado usan un protector simulado para verificar persistencia, reinicio, corrupcion, aislamiento y ausencia de texto plano. Los tests HTTP verifican que las claves nunca aparezcan en respuestas ni en la base de datos. No se presenta esa simulacion como una prueba exitosa de DPAPI en la cuenta aislada.

## Futbol combinado

**Fuentes combinadas** es la seleccion predeterminada en Encuentros e Individual. Tambien existen **Solo API-Football** y **Solo FootyStats** para inspeccion independiente. Los archivos originales nunca se reescriben al combinarlos.

- Competiciones equivalentes se reconocen por una lista explicita de pais, division y torneo. No se confunden Serie A italiana/brasilena ni las distintas divisiones o torneos internacionales.
- Las temporadas API anuales de ligas europeas se normalizan por ano de inicio. No se rellenan temporadas actuales con estadisticas antiguas como si fueran actuales.
- Un partido coincidente exige mismos equipos canonicos, temporada y dia de Guayaquil. Si interviene FootyStats se exige tambien una diferencia de inicio no mayor a treinta minutos y no tener hora desconocida.
- API-Football es prioritario, despues FootyStats y despues las otras fuentes guardadas. Un cero informado no es vacio. Los conteos no se promedian entre proveedores.
- Si marcador, estado u hora discrepan, se conserva el partido prioritario sin tomar estadisticas del otro. Se senala la discrepancia. Duplicados ambiguos de una misma fuente no se fusionan arbitrariamente.
- El primer tiempo conserva sus propios datos. No se mezclan mitades incompletas con marcadores incompatibles, ni se admiten corners 1T mayores al total o tiros al arco superiores a los tiros del mismo conjunto.
- `fieldSources`, `sourceRefs` y `fieldConflicts` conservan la procedencia por campo, IDs nativos y discrepancias. En el historial de Encuentros se pueden desplegar las fuentes; Individual conserva esa informacion en el registro y al pasar sobre la fila.

Los historiales combinados se utilizan al calcular frecuencias y estimaciones de la app. No se combinan porcentajes comerciales ni se certifica precision por tener dos proveedores. Solo se aprovechan datos ya descargados o autorizados; el modo combinado no desbloquea ligas, planes ni endpoints.

En **Jugadores**, las actuaciones individuales permanecen identificadas por proveedor. Los acumulados de temporada FootyStats aparecen en un apartado separado dentro de la misma vista, con sus IDs, fecha de descarga y alcance. No se transforman en participaciones, no se emparejan personas por parecido del nombre y no se usan para rellenar ventanas de 5/10/15/20/25/30 partidos o proyecciones individuales. Un acumulado descargado despues de un corte historico no aparece como informacion conocida en ese corte.

## Comprobacion con el archivo guardado

El 17 de octubre de 2026, la Premier League 2024/2025 mantuvo 380 resultados unicos al juntar 380 de API-Football y 380 de FootyStats. Se complementaron campos en 376 partidos y hubo corners 1T validos en 368. Cuatro coincidencias quedaron sin complementar por diferencias de marcador, estado u hora. Es evidencia de cobertura del archivo historico, no de precision predictiva ni de acceso a 2026/2027. No se modifica la prueba congelada de baloncesto.
