# Observatorio Deportes

Aplicacion de investigacion de futbol, baloncesto y tenis, programada en JavaScript con Node.js y una interfaz HTML/CSS. El repositorio incluye el servidor, la interfaz, pruebas, documentacion y archivos de inicio local. No incluye claves, sesiones, dependencias instaladas ni el historial privado de `data/state.json`.

Para revisar una copia en otro computador, instala Node.js 24 o posterior y ejecuta `node server.mjs` desde la raiz del proyecto; abre `http://127.0.0.1:4173`. En Windows tambien puedes usar `Abrir.cmd`. Una copia nueva empieza sin tu historial personal; conectar una fuente requiere su propia clave y cobertura. El alojamiento privado con autenticacion y persistencia cifrada se configura por separado siguiendo [cloud/README.md](cloud/README.md).

Programa local de investigación prepartido. Permite elegir liga, temporada, dos equipos, fecha de corte e historial de 5, 10, 15, 20, 25 o 30 partidos de futbol. Muestra resultados, promedios a favor/en contra, frecuencias observadas, estimaciones por escenario, historial y enfrentamientos directos. Las listas de próximos encuentros se pueden ordenar por probabilidad; cada análisis se puede exportar a CSV.

En **Futbol > Individual > Equipo** basta seleccionar un club de cualquier liga guardada, sin elegir rival. Muestra promedios por partido a favor, en contra y totales de goles, corners, tarjetas, rojas, offsides, faltas, tiros y tiros al arco. Incluye victorias/empates/derrotas, doble oportunidad, ambos marcan y los mismos limites de conteo de Encuentros, mas limites de tiros y limites personalizados. El bloque **Escenarios al descanso** separa resultado, goles y corners de 1T, con sus propias muestras y faltantes. No infiere el primer tiempo dividiendo el resultado final.

La columna **Prob. historica** de Individual es la frecuencia empirica del equipo, no el pronostico de Encuentros ajustado a un rival. Se muestra desde tres partidos validos por escenario, junto a cumplidos/con datos e intervalo Wilson del 95%. Una frecuencia de 100% en una muestra pequena no garantiza el siguiente partido; no esta calibrada para predecirlo. Los campos ausentes conservan `s/d`. Los filtros local/visitante y las ventanas de 5/10/15/20/25/30 se aplican tambien a estos escenarios de futbol, sin mezclar otras ligas ni datos posteriores al corte. La ventana puede incluir temporadas anteriores. Si hay menos resultados disponibles, se informa la muestra real; no se crean partidos para completarla.

## Abrir

### Resumen diario y fiabilidad

En Baloncesto > Prepartido, **Condiciones y probabilidades del encuentro** permite seleccionar total de puntos, over/under, linea y periodo (FT, primer cuarto o descanso), ademas de ganador y handicap FT. Hay lineas sugeridas y otra linea personalizada terminada en .5; cada una conserva sus conteos con datos. El resumen diario permite elegir el mismo sentido y linea sin sustituir un under por otra opcion de mayor porcentaje. Todas usan el modelo existente, sin alterar registros sellados ni calibracion. Endesa mantiene su analisis descriptivo.

**RotoWire** aparece como referencia externa en prepartido, jugadores y resumen NBA, con el enlace de alineaciones y bajas y la opcion existente de registrar reportes con fuente y vigencia. El feed de RotoWire no esta conectado ni forma parte de API-Basketball: la sincronizacion requiere acceso API de RotoWire verificado. No se extrae automaticamente la pagina ni se inventa disponibilidad a partir de minutos o ausencias del historial. Documentacion: https://rotowire.readme.io/docs/quick-start.

El boton **Resumen del dia** de la cabecera reune hoy y manana en Guayaquil.
Permite elegir deporte y condicion, muestra conteos historicos por equipo,
fecha del ultimo resultado, partidos de la temporada seleccionada y faltantes.
Las vistas actuales se calculan con los modelos existentes y no se guardan como
pronosticos sellados. Las referencias antiguas o sin datos no aparecen como una
estimacion actual utilizable. La ausencia de calendario no significa 0%.

El resumen enlaza **Claves del partido** para consultar reportes con fuente,
fecha y vigencia. No supone lesiones, sanciones ni minutos futuros. El apartado
**Comprobar si los porcentajes funcionan** lee la evaluacion de los registros
previamente sellados de NBA, Euroliga o tenis, con muestra, acierto, Brier, log loss
y rangos de calibracion. No reajusta parametros ni reconstruye pronosticos pasados.
Endesa conserva sus datos descriptivos mientras su modelo siga pendiente.
**Guardar equipos para evaluar** permite sellar manualmente NBA o Euroliga de
la fecha elegida con el protocolo existente (20 partidos y lineas internas), sin
consultas deportivas ni sobrescritura. Una respuesta interrumpida no se reintenta:
primero hay que leer los registros, porque parte del lote puede estar guardada.

En la version alojada, las claves se recuperan de los secretos del servidor:
`API_FOOTBALL_KEY`, `API_BASKETBALL_KEY` y `FOOTYSTATS_KEY`. Los formularios locales
se sustituyen por el estado y enlace de configuracion de Render; no se pide
reintroducir una clave que ya este configurada. La cobertura real se comprueba
por competicion, temporada y campo, independientemente del nombre del plan.

Las consultas de los paneles principales comparten un cliente con concurrencia
limitada y lecturas GET simultaneas agrupadas. Las paginas HTML de arranque o
error no se interpretan como JSON. Una mutacion fallida o agotada no se reintenta
automaticamente. Las fechas masivas reutilizan sus formateadores ICU para evitar
agotar memoria nativa del servidor; la conversion de zona y el modelo no cambian.

Inicio automatico: ejecuta `Activar-inicio-automatico.cmd` una vez desde el
Explorador de Windows. Configura el arranque en tu sesion y permite comprobar
el guardado cifrado real. Las claves guardadas se recuperan al abrir el servidor;
no dependen de que el chat las recuerde. El supervisor local recupera procesos
cerrados mientras la sesion y el equipo sigan activos. Detalles y limites en
[Claves y fuentes](CLAVES-Y-FUENTES.md).

La automatizacion de NBA/Euroliga de las 07:00 fue eliminada a peticion del
usuario el 18 de octubre. El nuevo servidor desactiva la prueba anterior y no
ejecuta su revision horaria; conserva el archivo y las actualizaciones de datos.

En Windows, ejecuta `Abrir.cmd`. Requiere Node.js 24 o posterior, ya disponible en este equipo. También puede iniciarse con `node server.mjs` desde esta carpeta. La dirección predeterminada es `http://127.0.0.1:4173`.

La aplicación escucha únicamente en este equipo. Los partidos y la caché quedan guardados en `data/state.json`. Las claves nunca se escriben en ese archivo: pueden guardarse fuera del proyecto, cifradas con el usuario de Windows, si se activa `Guardar cifrada en este equipo`. Si Windows no permite el cifrado, la conexión queda solo en memoria y la app muestra la advertencia. Consulta [Claves y fuentes](CLAVES-Y-FUENTES.md). No hace falta instalar paquetes.

## Datos

### Contexto relevante

El bloque **Claves del partido** resume forma reciente, tendencias y referencias
con conteos y faltantes. Separa disponibilidad, rendimiento y competicion; ofrece
fuentes oficiales por pais o liga y revision humana de reportes con trazabilidad.
Los enlaces externos no se presentan como feeds conectados. Los avances de carga
actualizan el analisis individual de futbol en segundo plano sin ocultarlo.

Encuentros y consultas individuales de futbol, baloncesto y tenis incluyen un resumen de datos observados, reportes con fuente y noticias por contrastar. La busqueda puntual usa GDELT sin consumir las claves deportivas; la prueba real mas reciente recibio HTTP 429, sin certificar aun titulares ni cobertura. El panel distingue el motivo del fallo y la proxima consulta permitida; respeta pausas sin reintentos automaticos. Los reportes registrados no se verifican automaticamente ni modifican los modelos. Identidad, fechas, caducidad y limites en [CONTEXTO-RELEVANTE.md](CONTEXTO-RELEVANTE.md).

### Tenis: seis bloques de investigacion

Tenis tiene ahora Jugador, Prepartido, Encuentros, Probabilidades del dia, Evaluacion y Datos/disponibilidad. Incorpora historicos gratuitos actualizados, IDs ATP, servicio/quiebres, ventanas hasta treinta, conteos e intervalos, contexto con cobertura explicita y un protocolo prospectivo independiente. El calendario con hora exacta y las lesiones siguen pendientes de una fuente especifica o registro manual documentado. Las frecuencias no se presentan como probabilidades calibradas. Alcance, comparacion antes/despues y primera validacion en [TENIS-MEJORAS.md](TENIS-MEJORAS.md).

### Ligas unificadas

Encuentros, Individual y Jugadores presentan una sola entrada por competicion reconocida y pais. Los 27 archivos/fuentes guardados el 13 de octubre se agrupan en 16 competiciones; las competiciones configuradas pero sin registros siguen pendientes, no se inventan datos para mostrarlas como cargadas. **Historial y fuentes** detalla las temporadas, el numero de resultados y las fechas reales de cada fuente. Los archivos originales se conservan por separado.

La vista combina historicos anteriores y recientes: por ejemplo, API-Football 2024 de Premier League se rotula 2024/2025. Liga MX tambien usa ano de inicio; Brasil, Argentina, Ecuador, Colombia y MLS mantienen temporadas de ano calendario. Los nombres equivalentes de clubes se resuelven con una lista explicita por pais, sin coincidencias difusas ni union entre divisiones. Un club sin equivalencia verificada conserva su nombre.

Un partido identificado en dos fuentes cuenta una vez; API-Football tiene prioridad y campos ausentes se completan desde la otra fuente solo si coinciden marcador y estado. Coincidencias ambiguas del mismo dia se conservan y se advierten; discrepancias de marcador no mezclan sus estadisticas. No se convierten ausencias en cero. Se conservan los identificadores nativos para descargar detalles y jugadores, y los calendarios manuales siguen guardados en su fuente original.

Seleccionar una temporada permite usar sus partidos y temporadas anteriores, siempre antes del corte y dentro de la ventana elegida de 5/10/15/20/25/30. En futbol, un corte pasado incluye ese dia; el corte de hoy se limita al instante actual, no al final futuro del dia. Las participaciones de jugadores estan rotuladas por temporada y no acreditan la plantilla actual. Actualizar archivos gratuitos no asegura que lleguen hasta hoy; la ultima fecha guardada aparece expresamente. El historial API sigue limitado por el plan conectado.

La evaluacion de precio/cobertura de pago esta en [COBERTURA-API-FOOTBALL.md](COBERTURA-API-FOOTBALL.md). El precio mensual publico verificado el 13 de octubre de 2026 es **US$19 Pro**, no US$15; comprarlo no garantiza estadisticas completas en todas las ligas o temporadas.

- **Europa sin clave:** descarga la temporada elegida y la anterior de Premier League, La Liga, Bundesliga, Serie A o Ligue 1 desde [Football-Data.co.uk](https://football-data.co.uk/downloadm.php). Intenta actualizar también el calendario gratuito. Puede no haber próximos encuentros en ese archivo; los dos equipos se pueden seleccionar manualmente. Algunos campos, como faltas, pueden faltar según liga y temporada.
- **Championship sin clave:** también descarga la segunda división inglesa, temporada elegida y anterior, con resultados, goles al descanso, córners, tarjetas y otras estadísticas según disponibilidad. [Fuente](https://football-data.co.uk/englandm.php).
- **Eredivisie y Primeira Liga:** fuentes gratuitas de [Países Bajos](https://football-data.co.uk/netherlandsm.php) y [Portugal](https://football-data.co.uk/portugalm.php), con temporada seleccionada y anterior. Los archivos incluyen resultados, goles al descanso y estadísticas de equipos cuando estén informadas; no contienen participaciones individuales ni córners del primer tiempo. Sus versiones API se buscan por nombre o país para comprobar cobertura de jugadores y campos adicionales. Se admite también la búsqueda «Liga holandesa», «Everdise» y «Liga de Portugal».
- **Champions League, Europa League, Conference League, Copa Libertadores y Copa Sudamericana:** accesos configurados como `API o CSV`, no como datos ya descargados. Se descubren en API-Football por catálogo real, sin identificadores supuestos, separando las competiciones femeninas y juveniles. Mantienen las ventanas y escenarios existentes; cada campo ausente sigue sin datos. Los resultados de prórroga/penaltis solo aportan el marcador de 90 minutos explícito, nunca sus conteos extendidos ni participaciones individuales como si fueran de 90 minutos. [Cobertura del proveedor](https://www.api-football.com/coverage).
- **MLS y Liga MX sin clave:** descarga la temporada elegida y la anterior de los archivos gratuitos de [MLS](https://football-data.co.uk/usa.php) y [Liga MX](https://football-data.co.uk/mexico.php). Estos archivos incluyen resultados y goles, pero no córners, tarjetas, faltas ni tiros al arco. Esos campos quedan como `s/d`; no se rellenan con ceros ni porcentajes inventados. Tampoco proporcionan próximos encuentros. MLS usa temporadas anuales; Liga MX usa temporadas como `2026/2027`, sin separar Apertura y Clausura en este archivo.
- **Brasil y Argentina sin clave:** [Brasileirão Serie A](https://football-data.co.uk/brazil.php) y [Liga Profesional Argentina](https://football-data.co.uk/argentina.php), temporada elegida y anterior. Estos archivos también incluyen solo resultados y goles de tiempo reglamentario, no marcadores al descanso ni estadísticas de conteo. Las temporadas disponibles son 2026, 2025 y 2024.
- **Colombia y Ecuador sin clave:** archivos abiertos de OpenFootball de 2025. [Primera A Colombia](https://github.com/openfootball/football.json/blob/master/2025/co.1.json) contiene 139 resultados de la fase regular del Apertura, hasta el 4 de mayo de 2025. [LigaPro Ecuador](https://github.com/openfootball/south-america/blob/master/ecuador/2025_ec1.txt) contiene 86 resultados de la fase regular, hasta el 4 de mayo de 2025, con 79 marcadores al descanso. Son históricos parciales, no la temporada completa ni datos actuales de 2026. No incluyen córners, tarjetas, faltas ni tiros al arco. Las filas sin marcador confirmado no se importan como resultados ni como encuentros próximos. Para un historial actual hay que importar un CSV o conectar la API y comprobar qué temporadas permite la cuenta.
- **Serie B de Brasil sin clave:** [OpenFootball 2025](https://github.com/openfootball/football.json/blob/master/2025/br.2.json), un histórico parcial de 53 resultados, hasta el 4 de mayo de 2025. Incluye goles al descanso, pero no estadísticas de conteo ni un calendario actual. No equivale a la temporada 2026; la muestra de algunos equipos es menor de diez partidos.
- **Serie B de Ecuador, Primera B de Colombia, Bolivia y Uruguay:** accesos configurados en el selector, claramente separados como `API o CSV`. No tienen historial descargado ni equipos inventados. Al elegirlos se ofrecen conexión API-Football o importación de CSV. Con una clave, la búsqueda consulta el país y resuelve el identificador y las temporadas reales del proveedor. La cobertura y las temporadas del plan gratuito deben verificarse antes de cargar. [Cobertura del proveedor](https://www.api-football.com/coverage).
- **API-Football:** conecta una clave propia y busca una liga o país. El plan gratuito tiene 100 consultas diarias y temporadas limitadas. La cobertura nominal de una liga no garantiza estadísticas de todos sus partidos. El programa guarda las consultas y solicita estadísticas en lotes al abrir un análisis. [Cobertura](https://www.api-football.com/coverage) y [plan gratuito](https://www.api-football.com/pricing/).
- **CSV:** admite los encabezados de Football-Data.co.uk o los de `plantilla.csv`. Indica nombre de liga y temporada al importar. Un campo vacío o negativo se trata como ausente. Las fechas pueden ser `YYYY-MM-DD` o `DD/MM/YYYY`; `time` es opcional. En modo automático, encabezados `HomeTeam` y `FTHG` usan la hora de Londres; la plantilla usa Guayaquil. Puedes elegir otra zona o proporcionar fechas ISO con zona explícita. Las filas sin hora se consideran disponibles al final de ese día en Guayaquil y se excluyen del análisis durante ese día. Las filas sin goles se guardan como encuentros programados. Un archivo nuevo de la misma liga y temporada sustituye esos resultados, por lo que debe contener la temporada completa que quieras conservar.

La búsqueda funciona sin clave para las fuentes gratuitas configuradas y las ligas guardadas. Los accesos pendientes de API/CSV no se cuentan como ligas con datos guardados. Para descargar otras competiciones se necesita una API con acceso comprobado. La consulta gratuita de una temporada actual debe verificarse con la cuenta: no está garantizada para todas las ligas. FootyStats tambien puede conectarse mediante su API oficial; su cobertura efectiva depende de las ligas y temporadas autorizadas para la clave. Este programa usa un diseño y cálculos propios y no extrae automáticamente su sitio.

### Lista de encuentros

El buscador carga competiciones; el selector over/under ordena encuentros ya guardados por su probabilidad y no busca partidos nuevos. Un listado vacío indica calendario ausente o que todas sus fechas son anteriores al corte, no una probabilidad del 0%. Un historial de resultados permite analizar dos equipos, aunque no tenga próximos partidos.

`Añadir encuentro` registra local, visitante, fecha y hora en Guayaquil para la temporada seleccionada. Es un calendario manual, marcado como tal; no verifica por sí solo que el evento esté oficialmente programado. Registra únicamente encuentros reales cuya programación hayas comprobado. La fecha debe pertenecer a la temporada y ser posterior al corte. El programa calcula todos los escenarios con los resultados anteriores al corte, conserva ese mismo corte al abrir el análisis y mantiene el calendario manual al actualizar la fuente. `Quitar` elimina solo encuentros manuales; no borra partidos del proveedor. API-Football o un CSV con filas sin marcador también pueden proporcionar calendario.

### Clave de API-Football

No existe una clave pública compartida. Crea tu propia cuenta gratuita en [dashboard.api-football.com/register](https://dashboard.api-football.com/register), confirma tu correo y abre `Account > My Access` para obtenerla. Pégala únicamente en el campo de la aplicación, no en el chat. Esta conexión usa el proveedor directo API-Sports, no una clave de RapidAPI. El [plan gratuito](https://www.api-football.com/pricing/) ofrece 100 consultas al día y limita las temporadas disponibles. El guardado cifrado es opcional y solo se confirma cuando la app indica `Clave cifrada con tu usuario de Windows`. Para activarlo abre `Reiniciar.cmd` desde tu sesión normal de Windows y vuelve a conectar una vez. Sin guardado confirmado, la clave solo dura esa sesión.

El 7 de octubre de 2026 se descargaron 2.002 resultados reales de las cinco ligas europeas para las temporadas 2025/2026 y 2026/2027. No hay datos de demostración inventados. La consulta del calendario no devolvió próximos encuentros; el análisis manual de equipos funciona sin calendario.

Después se incorporaron 944 resultados de MLS (2025 y 2026) y 424 de Liga MX (2025/2026 y 2026/2027). En estas dos ligas, los archivos gratuitos solo permiten estimar resultado, ambos marcan y totales de goles.

El 13 de octubre de 2026 se incorporaron 755 resultados de Eredivisie y Primeira Liga: respectivamente 72 y 71 de 2026/2027, mas 306 de 2025/2026 en cada liga. Ambas fuentes informaron corners, amarillas y rojas en todos estos resultados, pero no offsides ni corners del primer tiempo. El calendario gratuito no devolvio proximos encuentros. La reconexion de API-Football fue rechazada por limite de consultas; los cinco torneos internacionales estan configurados, pero su historial y los jugadores nuevos siguen pendientes. No se reintento ni se presento cobertura nominal como registros descargados.

## Interpretación

### Handicaps de futbol

Encuentros, Lista de encuentros e Individual incluyen handicap europeo y asiatico,
tanto de 90 minutos como del primer tiempo. El europeo tiene tres resultados;
el asiatico separa victoria completa, media victoria, devolucion, media perdida
y derrota. Se pueden elegir lineas y agregar otras entre -10 y +10. El porcentaje
principal asiatico representa solo victoria completa, nunca devolucion ni media
victoria. Usa goles ya guardados, sin consultas adicionales ni cuotas de apuestas.
Reglas, orientacion local/equipo, muestras y limites en [HANDICAPS-FUTBOL.md](HANDICAPS-FUTBOL.md).

### Directorio de jugadores de futbol

`Futbol > Jugadores` muestra un ranking por liga y equipo, fichas individuales, minutos y goles, asistencias, tiros, tiros al arco, faltas cometidas/recibidas, tarjetas y fuera de juego. Permite separar total de la muestra, promedio y por 90 minutos, con ventanas de 5/10/15/20/25/30 participaciones o temporada guardada. Los faltantes conservan su denominador y no se rellenan con cero. No mezcla temporadas ni presenta el ranking parcial como clasificacion oficial. Frecuencias over/under e intervalos historicos no equivalen a pronosticos.

Admite CSV individual y carga bajo demanda de encuentros terminados de ligas guardadas con API-Football, sujeta a cobertura y temporadas del plan. Consulta hasta cinco encuentros pendientes por accion; no descarga automaticamente todos los jugadores de todas las ligas. Los archivos gratuitos de equipos no contienen estas estadisticas personales. Detalles, limites y fuentes en [JUGADORES-FUTBOL.md](JUGADORES-FUTBOL.md).

Incluye filtro de porteros y atajadas reales, totales, medias, por 90 minutos y frecuencias over/under. Al iniciar recupera solo atajadas ausentes desde detalles API ya guardados, sin nuevas consultas ni participaciones. Las competiciones pendientes son visibles por separado. Asistentes del torneo consulta, solo bajo demanda, el top 20 de `/players/topassists`; estos agregados se guardan separados de la muestra y no se usan en pronosticos o cortes historicos.

### Consulta individual

La opción `Individual`, debajo del selector de deporte, permite consultar un solo equipo de fútbol o NBA, o un solo tenista, sin seleccionar un rival. Futbol y NBA admiten ventanas manuales de 5/10/15/20/25/30 partidos finalizados antes del corte, de la temporada elegida y anteriores. Tenis mantiene sus ventanas de 5/10/15/20. Puedes separar local/visitante en fútbol y NBA, o categoría y superficie en tenis. Los promedios incluyen el número de partidos con datos; los campos ausentes siguen como `s/d`. En fútbol se distinguen estadísticas a favor, en contra y el total del encuentro, incluidos fuera de juego, rojas y primer tiempo. La exportación individual contiene los registros de la muestra.

Los porcentajes de esta vista son **frecuencias históricas**, no pronósticos contra un rival no identificado. Por ejemplo, over 1.5 goles a favor cuenta únicamente los goles del equipo, mientras que goles del encuentro suma los dos equipos. La vista `Encuentros` mantiene los análisis prepartido de dos participantes.

Para jugadores de fútbol y NBA, el selector `Consultar > Jugador` admite registros personales por partido mediante CSV. Las plantillas están en `public/templates/football-players.csv` y `public/templates/nba-players.csv`. Se requieren `date,player,team,opponent` y al menos una columna estadística; `time`, `venue` (`home` o `away`) y `minutes` son opcionales. Las fechas sin hora quedan disponibles al final del día en Guayaquil. Deja vacíos los datos desconocidos, no pongas cero. Filas negativas, inválidas o con cero minutos se omiten.

En NBA, `Cargar jugadores del equipo` consulta los box scores públicos de ESPN de los últimos 5, 10, 15, 20, 25 o 30 partidos del equipo antes del corte, respetando local/visitante. En modo jugador selecciona primero `Equipo del jugador`; también puedes cargar desde la consulta de un equipo. Guarda puntos, rebotes, asistencias, PRA y triples anotados. Excluye DNP y cero minutos; una ausencia no cuenta como cero. La ventana de carga es de partidos del equipo, por lo que un jugador ausente puede tener menos participaciones guardadas. El filtro por equipo permite separar los registros tras un traspaso; `Todos` combina sus equipos. No es una plantilla vigente ni una proyección de minutos. Los box scores se guardan en caché y las fallas parciales se informan sin borrar registros previos. ESPN es una fuente pública no contratada, sin garantía de disponibilidad; CSV sigue disponible como alternativa.

### Liga Endesa en baloncesto

Baloncesto incorpora un resumen de la condicion elegida en Encuentros,
Individual de equipos y Jugadores. Incluye cumplidos/con datos cuando hay
frecuencia historica, fecha del ultimo dato, faltantes y partidos pendientes
para completar la ventana. Las selecciones del dia muestran tambien ese
respaldo junto a la muestra del modelo. Mas de 45 dias sin registros utiles
o una muestra formada solo por temporadas anteriores se marca como referencia
historica. El aviso describe los datos; no mide la precision del porcentaje.
Disponibilidad, plantilla y minutos siguen pendientes de verificacion cuando
no hay reporte vigente. Esta lectura usa los archivos existentes, sin nuevas
consultas API ni cambios de formulas, lineas, calibracion o pronosticos sellados.
El filtro Respaldo de datos de Probabilidades del dia permite excluir antiguos
y escenarios sin datos. La exportacion de esa lista conserva los avisos y las
muestras por equipo. Los calculos de Encuentros se cargan al abrir esa vista.

El analisis individual ampliado de NBA, Euroliga y Endesa incluye PR/PA/RA, objetivos de distintos umbrales con condiciones conjuntas, volumen de lanzamiento segun cobertura y filtros de equipo/localia. Conserva faltantes y muestra antiguedad y tamano de muestra. Su carga gradual consulta hasta cuatro partidos del equipo por accion, sin cambiar la prueba congelada. Detalles en [INDIVIDUALES-BALONCESTO.md](INDIVIDUALES-BALONCESTO.md).

`Baloncesto > Prepartido` compara equipos por periodo, forma y localia, referencias individuales y reportes de disponibilidad con fuente/vigencia. Solo usa datos guardados anteriores al corte y distingue historico de plantilla actual. `Archivo NBA` conserva el modulo anterior exclusivo de NBA; Baloncesto es el espacio principal para las tres competiciones. Alcance, limites y rutas en [PREPARTIDO-BALONCESTO.md](PREPARTIDO-BALONCESTO.md). Este resumen no modifica el modelo congelado ni agrega pronosticos de Endesa.

El selector principal incluye **Liga Endesa / ACB** en Individual, Encuentros, Jugadores y Evaluacion. Probabilidades del dia y Datos guardados tambien permiten seleccionarla. El historial de equipos, cuartos y participaciones procede exclusivamente del archivo guardado de Endesa, separado de NBA y Euroliga. Encuentros puede usar temporadas anteriores antes del corte; se muestran por separado los resultados de esa temporada y el historial anterior.

`Individual` analiza un solo equipo sin rival, exclusivamente en la temporada elegida: completa guardada o ultimos 5/10/15/20/25/30, con filtros de localia, resultados, medias por periodo, over/under y rangos historicos. La antigua pestaña Semana ya no aparece ni se consulta automaticamente. No se borran datos ni se modifica el modelo de octubre. Detalles en [PREPARTIDO-BALONCESTO.md](PREPARTIDO-BALONCESTO.md#individual-de-equipos).

Endesa ofrece consulta descriptiva de medias, historial y frecuencias individuales, no probabilidades de un modelo validado. No se reutiliza el modelo de Euroliga ni se incorpora Endesa a la prueba de octubre. La evaluacion predictiva y los pronosticos permanecen pendientes. `Actualizar datos` en Endesa usa el conector existente de API-Basketball, con sus limites gratuitos y la cobertura efectiva de la clave. No garantiza acceso a la temporada actual. Las ventanas manuales de baloncesto incluyen 25 y 30; la prueba congelada conserva 20 partidos, sus lineas y su calibracion.

Los puntos del equipo en `1Q` y `al descanso` provienen de los marcadores por periodo: primer cuarto y suma de primero más segundo. No incluyen prórroga ni se derivan proporcionalmente del total final. Aparecen en el resumen y el historial de encuentros, y en `Individual > Equipo` se pueden consultar a favor, en contra y sumados, con over/under históricos y línea personalizada. La plantilla NBA admite `home_q1_points,away_q1_points,home_ht_points,away_ht_points`. Un dato ausente, negativo, no entero, superior al marcador final o un descanso inferior al 1Q queda como `s/d`. Actualiza NBA con `Cargar historial gratuito` para incorporar periodos a los resultados guardados con versiones anteriores.

La evaluación de opciones pagadas de fútbol está en [EVALUACION-DATOS.md](EVALUACION-DATOS.md). Es una comparación documental, no una auditoría de datos contratados ni una promesa de precisión predictiva.

En NBA se admiten `points,assists,rebounds,threes`; PRA se calcula como la suma de puntos, asistencias y rebotes **del mismo partido**, solo cuando están los tres datos. En fútbol se admiten `goals,assists,shots,shots_on_target,fouls,yellow,red,offsides`. Las importaciones de jugadores no reemplazan los partidos de los equipos; actualizan los registros coincidentes por deporte, competición, temporada, fecha, jugador, equipo y rival. Los registros quedan guardados localmente y se conservan al reiniciar.

El total de fuera de juego suma los conteos del local y el visitante: over/under de 1.5, 2.5, 3.5 y 4.5. El apartado de tarjetas rojas muestra over de 0.5, 1.5 y 2.5, separado del total de tarjetas. Ambos aparecen en las listas, los promedios, el historial y la exportación. Las rojas se cuentan tal como las informa la fuente; no se deducen de amarillas ni se convierten en puntos de tarjetas. API-Football aporta `Offsides` y `Red Cards` cuando tiene cobertura. La plantilla CSV incluye `home_offsides`, `away_offsides`, `home_red` y `away_red`; los campos ausentes no se convierten en cero. Los archivos gratuitos no garantizan estos conteos: sin una muestra válida, el escenario muestra `s/d`.

`7/10` significa que el escenario ocurrió en siete partidos del historial seleccionado. No equivale por sí solo a la probabilidad del próximo partido. El intervalo Wilson al pasar sobre esa frecuencia describe su incertidumbre muestral.

Las estimaciones combinan ataque y defensa de ambos equipos, localía y media de la liga, con suavizado. Resultado 1X2, ambos marcan y líneas de goles salen de una misma distribución Poisson de marcadores. Para otros conteos se considera la dispersión del historial de liga. Amarillas y rojas suman una tarjeta cada una; no se incluyen puntos de tarjetas ni faltas de otra definición.

Doble oportunidad usa el mismo modelo 1X2: `1X` es local o empate, `X2` visitante o empate y `12` local o visitante (sin empate). También está disponible para ordenar la lista de encuentros.

El bloque de primer tiempo incluye resultado 1X2 al descanso, goles over/under 0.5, 1.5 y 2.5, y córners over/under 1.5, 2.5, 3.5 y 4.5. El resultado y las líneas de goles 1T comparten una matriz Poisson basada únicamente en marcadores al descanso; los tres resultados disponibles suman 100%. Usa datos explícitos del primer tiempo, incluido el añadido antes del descanso; nunca divide los totales del partido. Los archivos europeos incluyen goles al descanso (`HTHG` y `HTAG`), al igual que algunos registros de OpenFootball; los de MLS, Liga MX, Brasil y Argentina no. API-Football aporta el marcador `score.halftime` cuando está disponible. Esta versión no consulta automáticamente córners por periodo en la API: para estimarlos, importa `home_half_corners` y `away_half_corners` en CSV. La plantilla incluye también `home_half_goals` y `away_half_goals`. Campos ausentes, incompletos o superiores al total reglamentario correspondiente quedan fuera de la muestra y pueden producir `s/d`.

Los escenarios se refieren al tiempo reglamentario. En partidos de API-Football con prórroga o penales se usa el marcador al finalizar los 90 minutos; las estadísticas acumuladas durante la prórroga se excluyen si no pueden separarse.

El historial solo contiene partidos finalizados anteriores al corte, de la temporada seleccionada y anteriores. Un escenario sin al menos tres partidos válidos de cada equipo y diez de liga muestra `s/d`. Los porcentajes son estimaciones exploratorias: aún no han sido calibrados con una evaluación independiente de cada liga. Los límites de muestra son controles de disponibilidad, no una garantía de precisión.

## Verificación

Desde la raiz, con Node.js 24 o posterior:

```sh
node --test --test-concurrency=2 "*.test.mjs" "cloud/*.test.mjs" "research/*.test.mjs"
```

La seleccion explicita evita ejecutar de nuevo copias de las pruebas que puedan existir en `cloud/source` o en carpetas privadas de trabajo. Los proveedores deportivos se simulan; no hace falta una clave real para estas comprobaciones.

### Centro de datos

Actualizacion diaria ampliada: Centro de datos > Actualizaciones permite usar
la cuota gratuita completa de API-Basketball y API-Football, sin el antiguo
tope de 24 detalles. Los lotes pendientes continuan cada cinco minutos con el
servidor encendido; no reinician contadores ni repiten temporadas bloqueadas.
FootyStats conserva su propio periodo y cuota observada, sin asumir 1800 al dia
ni habilitar ligas restringidas por tener saldo. Se aprovecha la cuota en datos
utiles, no en repetir consultas sin informacion nueva. La revision diaria del
chat de las 07:00 fue eliminada; la cola local funciona independientemente.

El boton de base de datos de la barra superior abre cobertura, cola de actualizacion, presupuesto por proveedor, validacion y respaldos de los tres deportes. Baloncesto tiene prioridad. El limite de pago solo se habilita despues de verificar una suscripcion activa. Consulta [CENTRO-DATOS.md](CENTRO-DATOS.md) para distribucion de consultas, actualizacion automatica, reportes con fuente y restauracion protegida de datos.

### Prueba de FootyStats sin contratar

En `Fuentes de datos > FootyStats API` (acceso directo `http://127.0.0.1:4173/#footystats`), introduce la clave propia en el campo protegido y pulsa `Conectar FootyStats`. Es una conexion independiente de API-Football y API-Basketball. La clave se valida contra `/league-list`. Si se confirma el guardado cifrado, se recupera al reiniciar con el mismo usuario de Windows. No se incluye en archivos del proyecto, informes ni almacenamiento del navegador. Desconectar elimina su copia guardada; si no se puede eliminar, la app lo advierte. No se deduce el plan comercial a partir de la cuota recibida.

El catalogo elegido devuelve las ligas seleccionadas en la cuenta; el catalogo completo no prueba permiso para todas ellas. `Comprobar datos` consulta una pagina de hasta 20 partidos, un detalle de partido, una pagina de hasta 200 jugadores de temporada y, cuando existe un jugador, un detalle individual: maximo cuatro solicitudes, sin reintentos automaticos. Conserva negativos y ausencias como faltantes y exige registro de tiempos para contar corners 1T. Los ceros informados se muestran por separado, pues pueden necesitar verificacion de cobertura.

Las muestras de `Comprobar datos` se guardan en `footystatsResearch.audits`, separadas de partidos y participaciones. Una muestra parcial no certifica toda una liga ni otra temporada. El endpoint individual puede quedar restringido o rechazado; el informe lo indica y conserva el resto de la muestra.

`Cargar ligas FootyStats` comprueba las 27 competiciones configuradas en lotes de hasta tres. Primero intenta la temporada mas reciente del catalogo; si esta restringida, solo intenta un historico expresamente incluido en el catalogo elegido de la cuenta. No recorre temporadas supuestas ni cambia la seleccion de ligas del proveedor. Consulta hasta 1.000 partidos de esa temporada y cuatro paginas de 200 jugadores; informa si la descarga queda parcial. Las solicitudes se espacian y el lote se detiene ante cuota, autenticacion o fallo de conexion. Los datos previos se conservan.

El selector `Datos de futbol` aplica a Encuentros, Individual y Jugadores. Por defecto, `Fuentes combinadas` prioriza API-Football y completa huecos con FootyStats al coincidir competición, temporada, equipos, fecha y marcadores compatibles. Conserva ceros válidos, identificadores y procedencia por campo; no mezcla estadísticas si detecta discrepancias de marcador, estado u hora. `Solo API-Football` y `Solo FootyStats` permiten revisar los archivos nativos sin complementarlos. Los datos originales nunca se sobrescriben. Una liga sin temporada autorizada no recibe equipos ni resultados inventados. El informe de cobertura distingue temporada actual restringida, historico importado, campos ausentes y cantidad de registros. Véanse las reglas en [Claves y fuentes](CLAVES-Y-FUENTES.md).

Encuentros calcula sus probabilidades con el historial importado; no las presenta como porcentajes oficiales de FootyStats. Individual muestra frecuencias historicas, sus denominadores e intervalos. Goles y corners del primer tiempo requieren campos explicitos, sin dividir el total final. Amarillas y rojas tienen escenarios separados. No se modifica la prueba congelada de NBA y Euroliga.

En `Jugadores`, el modo FootyStats muestra exclusivamente los acumulados de temporada que devuelve `/league-players`: equipo cuando se identifica en los partidos descargados, participaciones, minutos, goles, asistencias y otros campos realmente informados. En el modo combinado aparecen en un apartado separado del historial individual de API-Football. Estos acumulados no se convierten en registros por partido ni entran en ventanas prepartido de 5/10/15/20/25/30. Tiros, faltas y atajadas ausentes quedan como `s/d`. Un historico permitido no acredita la plantilla ni la cobertura de la temporada actual.

Los tests de FootyStats usan claves ficticias y respuestas simuladas. La prueba publica real con `example` se etiqueta separadamente y no demuestra el acceso de una clave personal. Fuentes: [catalogo](https://footystats.org/api/documentations/league-list), [partidos](https://footystats.org/api/documentations/match-schedule-and-stats) y [jugadores de temporada](https://footystats.org/api/documentations/league-players).

Las pruebas comprueban coherencia 1X2 y doble oportunidad, complementos over/under, independencia del primer tiempo, influencia del historial, exclusión de información futura, campos ausentes, importación, caché y rutas HTTP. Las pruebas HTTP usan un proveedor simulado y una carpeta temporal, sin claves ni datos personales.
# Bajas y contexto de futbol

En Encuentros, Individual y las fichas de Jugadores, el panel Claves del partido muestra bajas y dudas reportadas por API-Football para un proximo encuentro guardado. El boton Consultar bajas del encuentro respeta el plan, la cobertura por temporada y una cache de cuatro horas. Un resultado vacio no confirma una plantilla sana. En la app alojada, la clave API_FOOTBALL_KEY se configura una sola vez en los secretos de Render.

El desplegable selecciona partidos futuros de los proximos 14 dias de los equipos consultados. Las tarjetas individuales muestran totales y denominadores de participaciones del historial, sin inferir sanciones vigentes ni reglas de acumulacion. Buscar noticias oficiales utiliza la busqueda puntual existente y conserva los titulares separados de hechos confirmados. Los reportes manuales requieren enlace, fecha y vencimiento. Ninguno de estos datos cambia el modelo de probabilidades.
