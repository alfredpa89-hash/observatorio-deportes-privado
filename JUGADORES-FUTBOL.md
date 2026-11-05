# Jugadores de futbol

Panel local en Futbol > Jugadores, con navegacion por competicion y equipo, ranking y fichas individuales. Usa los registros guardados, no datos ni valoraciones extraidos de SofaScore.

## Estadisticas

Goles, asistencias, atajadas individuales, tiros, tiros al arco, faltas cometidas y recibidas, amarillas, rojas y fuera de juego. Minutos y valoracion API-Football por encuentro cuando existen. La valoracion del proveedor no es una nota propia ni equivale a SofaScore.

Ventanas de 5, 10, 15 y 20 participaciones, o toda la temporada guardada. No mezcla temporadas. El ranking separa equipo y jugador tras traspasos; no es una plantilla vigente. Filtros por nombre, equipo, minimo de participaciones, estadistica y total, promedio o por 90 minutos. CSV del ranking filtrado y del historial individual.

El filtro Posicion permite seleccionar porteros, defensas, mediocampistas o delanteros. Usa la posicion documentada de la ultima participacion admisible; no supone portero por el nombre o las atajadas. Los jugadores sin posicion confirmada aparecen solo en Todas. La cobertura y el numero de registros corresponden a la posicion seleccionada.

Atajadas viene de `statistics[].goals.saves`, no del total del equipo ni de los tiros al arco del rival. Hay lineas iniciales over/under 0.5 a 6.5 y rangos configurables, conservando los faltantes. El 13 de octubre de 2026 se recuperaron 124 registros y 106 identidades portero/equipo desde 66 detalles API cacheados: sin consultas nuevas, sin nuevas participaciones y sin reemplazar valores existentes. La recuperacion exige identidad del fixture, FT, temporada, fecha y ambos clubes. Es idempotente y solo completa esta columna en registros de API-Football.

**Asistentes del torneo** es distinto del ranking de la muestra. `POST /api/football/players/assist-leaders` devuelve el agregado guardado sin contactar al proveedor; `refresh: true` consulta `/players/topassists` para la liga y temporada API nativas. Hasta 20 jugadores segun el proveedor, una consulta, cache de seis horas, misma reserva de cinco consultas y control de concurrencia. Muestra fecha real de consulta del cache. No aplica equipo, posicion, ventana o corte del historial, ni inserta estos totales en las participaciones o modelos. Un error o ranking invalido conserva el anterior. No hay rankings del torneo descargados al terminar esta actualizacion, porque la clave no estaba conectada.

Los totales y los promedios usan exclusivamente filas con esa estadistica. Un total parcial no se presenta como total oficial de temporada. Por 90 es 90 multiplicado por el total de la estadistica dividido por los minutos, **en los mismos partidos con ambos datos**. No usa los minutos de otras filas ni el promedio de cocientes. Se muestran ambos denominadores. Una ausencia no es una participacion con cero.

Over/under e intervalos son frecuencias historicas con intervalos Wilson del 95%, no pronosticos individuales calibrados. Participaciones CSV sin minutos permanecen en la frecuencia, pero no en el calculo por 90. La grafica muestra las ultimas 20 observaciones de la ventana; el resumen puede cubrir la temporada entera. Los faltantes aparecen como s/d.

## Fuentes y conexion

Las busquedas individuales tambien reconocen Eredivisie (Liga holandesa/Everdise), Primeira Liga (Liga de Portugal), Champions League, Europa League, Conference League, Copa Libertadores y Copa Sudamericana. Los torneos se resuelven contra el catalogo internacional de API-Football, sin elegir sus variantes femeninas o juveniles. Conference admite ambos nombres del proveedor, UEFA Europa Conference League y UEFA Conference League. Aparecer en la lista de competiciones configuradas no acredita datos individuales descargados ni acceso a una temporada: deben cargarse y comprobarse con la clave. Los archivos gratuitos N1/P1 solo contienen datos de equipos, no de jugadores.

1. CSV individual: `public/templates/football-players.csv`, importado para la liga y temporada elegidas. No sustituye los resultados de equipos. Fechas sin hora se consideran disponibles al final del dia en Guayaquil. Filas con cero minutos, minutos superiores a 130 o tiros al arco superiores a tiros se omiten. Campos vacios no se convierten en cero.
2. API-Football: conectar clave en Fuentes de datos. Se verifica `/status` antes de aceptarla, mostrando solo plan y cuota, sin guardar ni devolver datos de cuenta. En Jugadores > Datos y cobertura se busca la **version API** de la liga y se carga una temporada permitida. Seleccionar despues un equipo. La navegacion unifica archivos y API de la misma competicion; conserva las fuentes originales y traduce temporadas y clubes con equivalencias explicitas. Una temporada sin partidos API no puede descargar jugadores desde resultados de equipos. No es obligatorio usar CSV.
3. Cargar jugadores consulta el detalle `/fixtures?id=...` con su bloque `players`, hasta 5 encuentros pendientes por accion dentro de una ventana de 5/10/15/20/25/30 partidos del equipo. Usa ambos equipos para aprovechar la misma consulta. Se puede continuar la ventana en otro clic. No recorre automaticamente ligas completas ni consume consultas al abrir un ranking.

4. Ampliar jugadores de la liga hace un lote acotado de hasta cinco encuentros sin elegir equipo. Forma la union de las ultimas 5/10/15/20/25/30 fechas admisibles de cada equipo, prioriza los que no tienen participaciones guardadas y despues los menos representados. Cada encuentro cuenta una vez, aunque este en las ventanas de ambos equipos. Usa los mismos controles de identidad, FT, cuota, cache y faltantes. Los equipos con registros se acreditan por sus participaciones reales, no porque su rival tenga datos. No descarga temporadas completas automaticamente. La API acepta `scope: "league"` y `maxGames` entero de 1 a 5 para cargas acotadas; el valor por defecto es 5.

La navegacion de Jugadores muestra por defecto fuentes API y archivos con participaciones individuales. Todas las fuentes sigue disponible como filtro; los CSV de equipos no se presentan como registros individuales. Los equipos muestran el numero de encuentros con participaciones guardadas en la temporada, no partidos jugados oficiales ni una plantilla vigente. Se aceptan busquedas como Liga espanola, italiana, francesa y alemana: se resuelven por pais y nombre del proveedor sin asignar identificadores inventados. Serie A de Brasil y de Italia siguen separadas.

Competiciones por cargar muestra Chile, Uruguay, Ecuador B, Colombia B y los cinco torneos internacionales, entre otras configuradas sin historial. No se cuentan como ligas cargadas ni tienen equipos ficticios. Seleccionar una abre su nombre en el buscador, sin consumir consultas automaticamente. La cobertura de jugadores en las dos divisiones B no esta declarada en la tabla publica del proveedor; la presencia en esa lista no promete atajadas ni corners 1T.

Se comprueba `coverage.fixtures.statistics_players` por temporada, identidad de fixture, temporada, fecha y equipos. Solo FT; las prorrogas y penales se excluyen. Minutos desconocidos o cero no se importan como participaciones de API. Asistencias o tiros nulos no se infieren del marcador. Los encuentros sin registros se revisan nuevamente despues de 24 horas; los errores permanecen pendientes.

Las consultas de encuentros terminados se cachean 30 dias. La carga deja 6,5 segundos entre consultas no cacheadas y reserva las ultimas 5 de la cuota diaria cuando el proveedor informa el saldo. Un error detiene el lote conservando lo anterior. Las solicitudes simultaneas de carga se rechazan. La clave solo queda en memoria; no se guarda en CSV, JSON ni navegador.

La conexion distingue clave invalida, problema de red, cuota agotada y temporada restringida. Un intento fallido de cambiar la clave no reemplaza una conexion ya verificada. La cache API se reutiliza solo bajo el mismo plan verificado. Si el proveedor devuelve un rango permitido para Free, se muestran y deshabilitan las temporadas bloqueadas sin gastar otra consulta en la misma sesion. El rango no se supone por anticipado ni se conserva entre reinicios. Comprobar conexion y plan vuelve a consultar `/status`; si se cambia de plan se elimina el rango anterior. La app no contrata ni cambia suscripciones.

Comprobacion real del 12 de octubre de 2026 (Guayaquil): la clave conectada acepto Premier League 2024 (2024/25), 380 resultados; rechazo 2026 con rango gratuito 2022-2024. Se importaron 150 participaciones de ambos equipos en los ultimos cinco partidos del Arsenal, 74 del Arsenal. La cobertura individual es parcial: solo 8/74 filas del Arsenal informaron goles, 31/74 tiros, 23/74 tiros al arco y 29/74 faltas. Los null no se convierten en cero ni la muestra historica se presenta como plantilla o temporada actual. Esta prueba no acredita todas las ligas ni la cobertura de Pro.

Para cortes historicos, se aplica disponibilidad conservadora de tres horas despues del inicio a los partidos FT importados. No es una hora oficial de finalizacion ni un registro de informacion conocida en tiempo real. Este panel es descriptivo, no un backtest prospectivo.

Los archivos gratuitos de Football-Data/OpenFootball ya cargados contienen datos de equipos, no registros individuales. El plan conectado puede bloquear temporadas recientes. Tener una liga en el catalogo no garantiza estadisticas de jugadores en cada encuentro. No se ha certificado cobertura de todas las ligas con una cuenta activa en esta implementacion.

Referencias del proveedor: [detalles por fixture](https://www.api-football.com/news/post/fifa-world-cup-2026-group-stage-recap-and-complete-match-reports-with-api-football), [guia de estadisticas individuales](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide), [cobertura y cuota](https://www.api-football.com/news/post/how-to-optimize-api-sports-calls-and-quota-usage).

## Alcance

No modifica modelos, lineas, ventanas ni calibracion congelados de la prueba de baloncesto. Tampoco cambia el modelo de pronosticos de futbol: primero se necesita evaluar la calidad y disponibilidad de minutos, participaciones y estadisticas individuales. Lesiones, titularidades futuras, xG/xA y pronosticos de jugadores quedan pendientes de fuentes comprobadas y evaluacion independiente.

Se verifico acceso al historial de 2024 y cobertura individual declarada para Premier League, La Liga, Serie A italiana, Ligue 1, Bundesliga, Serie A brasilena, Liga Profesional Argentina, MLS, Liga MX, Liga Pro Ecuador y Primera A Colombia. La declaracion de cobertura no significa que todos los campos o encuentros esten completos: las muestras individuales y sus faltantes deben verificarse por separado. Ligue 1 y Bundesliga incluyen 19 equipos en el catalogo devuelto; no se presenta ese conteo como numero de clubes de la fase regular. Los registros son historicos, no datos de 2026 ni plantillas actuales.

Ampliacion real del 12 de octubre de 2026, Guayaquil: 4.050 resultados y 2.054 participaciones individuales guardadas, en 66 encuentros con registros. La ventana de carga fue de cinco encuentros admisibles por equipo; no significa que ya haya cinco participaciones de todos los equipos o jugadores.

| Competicion | Participaciones | Equipos con registros / catalogo |
| --- | ---: | ---: |
| Premier League | 490 | 20 / 20 |
| La Liga | 349 | 20 / 20 |
| Serie A Italia | 345 | 20 / 20 |
| Ligue 1 | 343 | 19 / 19 |
| Bundesliga | 345 | 19 / 19 |
| Serie A Brasil | 32 | 2 / 20 |
| Liga Profesional Argentina | 31 | 2 / 28 |
| MLS | 29 | 2 / 29 |
| Liga MX | 30 | 2 / 18 |
| Liga Pro Ecuador | 31 | 2 / 16 |
| Primera A Colombia | 29 | 2 / 20 |

Las cinco grandes tienen participaciones en todos los equipos del catalogo, no plantillas completas ni temporada individual completa. Las otras seis ligas solo tienen una muestra de un encuentro cada una, ampliable por lotes. Una comprobacion final de estado fue rechazada por limite de consultas. Por eso no se considera confirmado el ultimo saldo de siete mostrado por cabeceras anteriores ni se continuaron las descargas. El panel bloquea las cargas ante ese aviso o la reserva de cinco y permite seguir leyendo lo guardado. Comprobar conexion y plan, cuando el proveedor permita consultas, confirma de nuevo el estado sin introducir otra clave ni contratar un plan.

Pruebas: `node --test`. El proveedor se simula en pruebas aisladas; no se importa esa muestra en la base real.
