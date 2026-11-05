# Centro de datos y preparacion para Pro

Disponible desde el boton de base de datos en la barra superior, en los tres deportes.

## Cuota y planes

API-Basketball anuncia Pro con 7500 consultas/dia, reinicio a las 00:00 UTC y 300/minuto: <https://api-sports.io/sports/basketball>, consultado el 16 de octubre de 2026. La app no contrata ni cambia planes. Una clave conectada no activa Pro: `/status` debe confirmar suscripcion activa y cuota. La verificacion habilitante solo vive en memoria y caduca en 24 horas; se revalida por la cola cada doce horas. Se descartan los datos personales de cuenta.

Presupuesto inicial baloncesto: 7500, sujeto al menor valor entre presupuesto local y limite verificado. Con Pro 7500 se reserva el 10% (750), quedan 6750 utilizables y hasta 6000 detalles: 4500 de jugadores y 1500 de equipos. Los detalles tambien consumen el total. El resto se prioriza para calendario, catalogo, resultados y verificacion. Son techos, no objetivos de gasto. Las consultas se espacian sin intentar agotar la cuota.

Enfoque Pro: partidos de hoy y manana, desde las 00:00 de hoy hasta las 00:00 de pasado manana en America/Guayaquil, con limite final exclusivo. No son 48 horas moviles ni dias UTC. La cuota del proveedor sigue reiniciandose en UTC. NBA, Euroliga y Endesa comparten el presupuesto de baloncesto, sin dividirlo en tres cuotas.

Al verificar Pro se retiran de la cola los rellenos generales de temporadas antiguas. Los detalles automaticos y las cargas manuales de jugadores se limitan a equipos con un encuentro admisible guardado en esas dos fechas. Se consulta su historial previo de hasta 30 partidos, con sus jugadores, no estadisticas futuras de partidos aun sin jugar. Los rivales de esos historicos pueden aparecer en una misma respuesta: se reutiliza el partido, no se dispara una carga general de esos otros equipos. Sin participantes conocidos no se consumen consultas de detalles ni se presume que no haya partidos. El enfoque cambia al pasar la medianoche local. Lo guardado sigue consultable sin consumir API; las pruebas historicas gratuitas se mantienen mientras no haya Pro verificado.

Se mantienen las consultas minimas de plan, catalogo y calendario para descubrir esos encuentros y actualizar resultados. El endpoint ya integrado devuelve un indice por competicion y temporada; una llamada de calendario no equivale a una llamada por partido. Cuando faltan antecedentes al inicio de temporada, se obtiene el indice de la temporada anterior como contexto de esos participantes y se reutiliza durante 30 dias. Solo se descargan detalles historicos de los participantes de hoy/manana, respetando las ventanas antes de descartar campos o IDs ausentes. No cambia el modelo ni los sellos de octubre.

Sin plan de pago verificado: 90 consultas totales y 24 detalles diarios, con reserva de diez. Se conserva el contador existente para no reiniciar gastos al actualizar el programa. Se considera el menor remanente observado y los intentos fallidos cuentan por prudencia. HTTP 429/5xx establece una pausa durable respetando Retry-After. No hay reintentos inmediatos en bucle.

Desde el 18 de octubre, `Usar cuota gratuita completa` permite aprovechar hasta
100 solicitudes de API-Basketball y otras 100 de API-Football cuando esa es la
cuota real verificada. El menor limite del proveedor o presupuesto local siempre
prevalece. En este modo no se reservan diez solicitudes ni se detienen los detalles
al llegar a 24: comparten el total disponible con calendario y verificacion.
Los contadores no se reinician al activarlo ni al reconectar; una comprobacion
de plan tampoco aumenta un remanente menor previamente observado.
Los pendientes se retoman en lotes cada cinco minutos, con turnos entre ligas
y fuentes. No es una promesa de gastar el 100%: se usan todas las consultas
utiles autorizadas, sin volver a pedir datos completos para rellenar el gasto.
La prioridad es resultados y correcciones, calendario, periodos e individuales.
Una cuota amplia no habilita temporadas ni campos restringidos. Pro conserva
su reserva del 10%, el presupuesto verificado y el foco de hoy y manana.

API-Football tiene conexion, contador y presupuesto independientes, inicialmente 100. Comprar baloncesto no habilita futbol ni tenis. FootyStats conserva limites propios sin inferir una suscripcion desde una muestra. Tenis usa por ahora el archivo ATP gratuito. Las claves admiten guardado opcional mediante DPAPI del usuario de Windows, fuera del proyecto y de las copias. Si no se confirma el cifrado, permanecen solo en memoria. Abrir `Reiniciar.cmd` desde la sesión normal de Windows permite comprobarlo; un entorno aislado puede no disponer del perfil criptográfico. Véase [Claves y fuentes](CLAVES-Y-FUENTES.md).

## Cola y actualizacion

Al abrir la app, pulsar F5 o volver a una pestana visible se solicita una revision de las fuentes disponibles. La revision recorre resultados y calendarios primero, despues detalles actuales, en varios lotes de hasta cuatro tareas; no se queda en el primer lote. Se reutiliza una comprobacion terminada durante quince minutos para no consumir consultas por cada F5. Con la pagina visible se vuelve a solicitar cada quince minutos. Las pausas por acceso/cuota y los deportes desactivados se respetan siempre. La barra comun muestra progreso, hora de comprobacion y cobertura parcial; una comprobacion terminada no garantiza que el proveedor tenga datos de hoy.

Las vistas abiertas reciben aviso cuando cambia su deporte y recalculan el analisis con los datos guardados, conservando equipo, jugador y filtros principales. Los cortes automaticos usan la fecha/hora de Guayaquil al consultar; un corte historico introducido por el usuario se conserva. Los porcentajes historicos y sus recuentos no se convierten en garantias del siguiente partido.

La cola persistida retoma pendientes y marcadores por partido evitan repetir detalles completos. Baloncesto tiene prioridad, con turnos para futbol y tenis habilitados. El servidor procesa tareas vencidas cada cinco minutos incluso sin navegador. Los interruptores permiten desactivar automatizacion por deporte; el boton manual del Centro de datos solicita un lote. Detener lote espera la consulta en curso, sin borrar lo guardado ni desactivar el siguiente ciclo automatico.

NBA, Euroliga y Endesa: primero plan, calendario/resultados, despues hasta 30 partidos por equipo. En Pro solo se completan antecedentes de los participantes de hoy/manana; en Free se conserva la carga historica equilibrada. Un detalle sirve a ambos equipos. Cada tarea de detalles consulta como maximo dos partidos/tipos en Free y doce en Pro, sujeto al presupuesto. No se incluye pretemporada ni se sustituye la temporada actual bloqueada por una antigua sin indicarlo. Detalles vacios esperan 24 horas y nunca se marcan como ceros.

Futbol actualiza competiciones ya cargadas mediante su fuente nativa. API-Football amplia jugadores por liga en tareas de un partido y ventanas de 30, priorizando equipos sin registros. FootyStats procesa una liga por tarea conservando sus datos nativos separados; la vista combinada complementa campos compatibles sin modificar esos archivos. Lo restante aparece pendiente. En la revision de entrada se limita a quince minutos la cache de resultados actuales de futbol, NBA y ATP; los archivos antiguos y metadatos mantienen su cache larga. Fuera de esa revision se conserva la cache ordinaria de seis horas. No hay scraping masivo. Los CSV personales no se modifican automaticamente. Tenis conserva control contra archivos truncados; no se inventa calendario actual.

Acceso/autenticacion y cuota detienen la tarea hasta el siguiente dia o reconexion. Fallos transitorios esperan de cinco minutos a seis horas, de forma creciente. La interfaz muestra siguiente intento, pendientes y motivo. Equipo y servidor deben estar encendidos: no es actualizacion en la nube.

Las restricciones de acceso ahora persisten por competicion/temporada, tambien
cuando cambia la fecha de hoy/manana. No se reintentan automaticamente al dia
siguiente: requieren reconexion o verificacion explicita de un cambio de acceso.
La cuota diaria espera el reinicio UTC real; una pausa del proveedor respeta
su fecha indicada. Las caches siguen activas y las solicitudes vacias no se
convierten en datos. No se amplian las ventanas ni se toca el protocolo sellado.

FootyStats mantiene su propio contador de intentos diarios y el limite,
remanente y reinicio del periodo informado por sus metadatos. Ese periodo no
se supone diario: el 18 de octubre la cuenta conectada informo limite 1800.
La cuota observada y las pausas sobreviven al reinicio y a una restauracion de
respaldo, sin claves. Se comprueba el catalogo elegido una vez al dia; una liga
ya rechazada no se vuelve a descargar en segundo plano sin evidencia de nuevos
permisos. Los rechazos antiguos sin catalogo comparable requieren una prueba
manual explicita. Las notas de acceso y los historicos completos se conservan.

La revision del chat a las 07:00 de Guayaquil fue eliminada el 18 de octubre a
peticion del usuario. Tambien se retiro la revision horaria de la prueba; no
se crea otra automatizacion para reemplazarla. El Centro de datos sigue con
su cola propia cada cinco minutos, independiente del chat. El supervisor de
inicio de Windows puede recuperar el proceso y sus claves cifradas durante
la sesion normal. Si el equipo esta apagado o no existe una copia cifrada
valida de las claves, no se afirma que los proveedores se han actualizado.

## Cobertura y contexto

Informe observado por fuente, competicion y temporada: fecha real de descarga separada del ultimo partido, registros individuales, campos completos/parciales/ausentes y cobertura por equipo hasta 30 partidos. Un cero informado es dato; null, vacio y desconocido no son cero. Acumulados FootyStats no se convierten en participaciones. IDs nativos permanecen separados entre proveedores, sin fusionar personas por parecido de nombre. Historial y traspasos no prueban plantilla actual.

La validacion permite revisar muestras actuales antes de ampliar: periodos de equipos, puntos, rebotes, asistencias, PRA, triples y minutos; futbol con goles/1T, corners/1T, faltas, tarjetas, offsides e individuales; tenis con sets/juegos, servicio y quiebres. Una muestra no certifica todos los partidos ni temporadas. Lesiones y cuartos individuales no se suponen incluidos al pagar.

Reportes manuales desde cualquier detalle: identidad nativa, estado, fuente HTTPS, publicacion no futura y vencimiento de hasta siete dias. Un reporte expirado no revive uno antiguo. En baloncesto los reportes individuales del Centro de datos tambien alimentan prepartido, lista diaria y nuevos sellos de investigacion: una baja excluye al jugador y una restriccion limita sus minutos proyectados. Se respeta la temporada; no se fusionan identidades de proveedores distintos. No se ajustan automaticamente los modelos de equipos ni se reescriben sellos. Tenis conserva su panel independiente. No hay un feed automatico de noticias/lesiones contratado.

## Respaldos

Copias gzip de `state.json` con metadatos de esquema, SHA-256 y hash de la prueba congelada, en `data/backups`. Antes de actualizar se garantiza una copia de las ultimas seis horas; tambien hay creacion manual. Se retienen doce copias completas. Escritura temporal y renombrado. No se incluyen claves ni el almacén cifrado externo.

Verificar comprueba descompresion, checksum, esquema y hash congelado. Restaurar exige confirmacion literal RESTAURAR, ausencia de otro POST/lote activo y coincidencia del hash congelado actual. Se crea una copia previa. Un respaldo anterior a nuevos sellos no puede sobrescribirlos. Los contadores de consultas del dia no retroceden al restaurar. No hay recuperacion silenciosa de archivos corruptos. Restauracion y corrupcion se comprueban en carpetas temporales, nunca restaurando la base real durante las pruebas.

## Evaluacion y pruebas

### Preparacion antes de Pro

Centro de datos > Validacion muestra por separado NBA, Euroliga y Endesa. La muestra son los ultimos 20 partidos guardados de la temporada actual, incluidos los incompletos, sin buscar partidos mas antiguos para ocultar faltantes. Se distinguen cuartos/descanso de equipos de cuartos individuales; nulos no son cero. Una identidad con participaciones no confirma plantilla actual. Para participantes de hoy/manana se muestran reportes vigentes que cubren el inicio, o estado desconocido. No se inventan lesiones ni repartos de puntos por cuarto.

El contraste manual permite registrar partido, identidad nativa, campo, valor oficial, publicacion y enlace del Game Center de NBA, Euroliga o ACB. Indica coincidencia, diferencia o ausencia, sin cambiar el dato del proveedor. Si este cambia despues, el contraste vuelve a mostrar la diferencia conservando el valor observado al registrar. Las muestras historicas siguen identificadas como tales y no confirman cobertura actual. La app no descarga ni verifica automaticamente esos enlaces; un contraste manual no certifica toda la liga. El informe JSON exporta pendientes, campos, contrastes y evaluaciones por competicion, sin claves.

Los resultados prospectivos distinguen octubre congelado de investigacion separada e incluyen n, acierto, Brier, log loss y faltantes por escenario. El informe conserva error de puntos, referencia simple, calibracion y resultados historicos disponibles. Cero partidos evaluados no es precision cero ni eficacia demostrada. Endesa permanece descriptiva hasta contar con modelo y validacion independientes.

Los dos conectores de baloncesto comparten respuestas exitosas de detalles por ID nativo durante 24 horas: hasta 64 respuestas de 128 KiB, guardadas sin cabeceras ni clave. No se cachean errores, vacios ni respuestas de otro partido. Releerlas no consume cuota; los marcadores normalizados siguen evitando repetir detalles completos. El limite antiguo de 24 ya solo corresponde a Free; Pro utiliza el presupuesto verificado y sus reservas. Estas pruebas simuladas no certifican cobertura contratada.

Se mantienen evaluaciones existentes, muestras, Brier, log loss y calibracion. No se cambia el modelo, lineas, ventanas, calibracion ni registros sellados de octubre. Cobertura no significa precision predictiva ni rentabilidad. Endesa sigue descriptiva mientras su modelo no este validado. No se reconstruyen pronosticos despues del comienzo.

`node --test` cubre Free/Pro simulados, acceso, cola/reanudacion, cuotas, nulos/ceros, reportes, respaldos/restauracion, proteccion del ensayo y rutas HTTP sin persistencia de credenciales. Pro simulado comprueba el comportamiento del programa, no el acceso actual de una cuenta gratuita a datos de pago.
