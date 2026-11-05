# API-Football: cobertura antes de comprar

Revision: 13 de octubre de 2026. Proveedor directo API-Sports usado por esta app; no apifootball.com, otro proveedor distinto, ni un plan de RapidAPI.

## Precio y acceso

La [tarifa oficial](https://www.api-football.com/pricing) y [API-Sports Football](https://api-sports.io/sports/football) anuncian **Pro US$19/mes**, 7.500 consultas/dia y 300/minuto. El precio de US$15 mencionado anteriormente no es el precio mensual publico actual de API-Football. Confirma el importe final, moneda e impuestos en tu panel antes de contratar; no hemos contratado nada.

Free: 100 consultas/dia y temporadas restringidas. Todos los planes incluyen las competiciones y endpoints, pero pagar no crea estadisticas donde el proveedor no las recoge. El salto a Pro aumenta cuota y acceso temporal; no es una promesa de mayor exactitud de los pronosticos. La [guia oficial](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide) advierte que incluso una cobertura marcada true no garantiza todos los partidos o campos.

## Datos y escenarios

| Necesidad | Dato o calculo | Limite |
| --- | --- | --- |
| Goles, victoria/empate/derrota | /fixtures, marcador reglamentario | Distinguir FT, prorroga y penales |
| Goles y ganador del primer tiempo | score.halftime en /fixtures | Debe existir marcador de ambos equipos |
| Corners, offsides, faltas, amarillas, rojas, tiros, tiros al arco | /fixtures/statistics | Campos null en competiciones/partidos sin recogida |
| Corners del primer tiempo | /fixtures/statistics?fixture=ID&half=true | Disponible desde temporada 2024 donde haya datos de periodos; no garantizado para cada liga |
| Over/under, ambos marcan y doble oportunidad | Calculos de la app desde marcadores/conteos | La frecuencia observada no es una probabilidad prepartido calibrada |
| Probabilidades del proveedor | /predictions donde coverage.predictions sea true | No cubre todos nuestros escenarios ni garantiza acierto |
| Cuotas de apuestas | /odds donde haya cobertura | Una cuota no es una estadistica observada ni probabilidad calibrada |
| Rendimiento individual | /fixtures/players | Depende de statistics_players por liga/temporada; no se deduce de totales del club |
| Atajadas individuales | statistics[].goals.saves en /fixtures/players | Null no es cero. Goalkeeper Saves del equipo no se asigna a un portero |
| Lideres de asistencias del torneo | /players/topassists?league=ID&season=YEAR | Hasta 20 segun el proveedor, con cobertura top_assists; agregados de temporada, no registros por partido |

La [documentacion oficial](https://api-sports.io/documentation/football/v3) enumera los conteos y el parametro half, con inicio de datos en 2024. La [publicacion del cambio](https://www.api-football.com/news/post/api-football-new-release-available) confirma su incorporacion. No se deducen corners al descanso restando goles o dividiendo los corners finales.

**Estado del conector:** el conector actual consulta detalles de /fixtures para los totales y score.halftime para goles 1T. Tener disponible el endpoint half=true no significa que ya hayamos descargado sus corners 1T. Ese enriquecimiento debe implementarse y verificarse con muestras reales antes de prometer que los huecos actuales quedaran cubiertos. No hemos verificado una suscripcion Pro ni muestras actuales con ella.

## Competiciones solicitadas

La [tabla publica oficial](https://api-sports.io/sports/football) lista estas competiciones. "Declarada" corresponde a las columnas Statistics y Players statistics de esa tabla general; **no es una auditoria por campo, partido o temporada 2026**. Goles 1T y corners 1T requieren comprobacion aparte.

| Competicion | Estadisticas de partidos | Estadisticas individuales |
| --- | --- | --- |
| Premier League | Declaradas | Declaradas |
| La Liga | Declaradas | Declaradas |
| Serie A Italia | Declaradas | Declaradas |
| Bundesliga | Declaradas | Declaradas |
| Ligue 1 | Declaradas | Declaradas |
| Championship | Declaradas | Declaradas |
| Eredivisie | Declaradas | Declaradas |
| Primeira Liga Portugal | Declaradas | Declaradas |
| MLS | Declaradas | Declaradas |
| Liga MX | Declaradas | Declaradas |
| Liga Profesional Argentina | Declaradas | Declaradas |
| Serie A Brasil | Declaradas | Declaradas |
| Serie B Brasil | Declaradas | Declaradas |
| LigaPro Ecuador | Declaradas | Declaradas |
| LigaPro Serie B Ecuador | No declaradas | No declaradas |
| Primera A Colombia | Declaradas | Declaradas |
| Primera B Colombia | No declaradas | No declaradas |
| Primera Division Peru | Declaradas | Declaradas |
| Primera Division Chile | Declaradas | Declaradas |
| Primera Division Bolivia | Declaradas | Declaradas |
| Primera Division Uruguay | Declaradas | Declaradas |
| Uruguay Clausura, archivo separado | Declaradas | No declaradas |
| Paraguay Apertura/Clausura, archivos separados | Declaradas | Declaradas |
| Champions League | Declaradas | Declaradas |
| Europa League | Declaradas | Declaradas |
| Conference League | Declaradas | Declaradas |
| Copa Libertadores | Declaradas | Declaradas |
| Copa Sudamericana | Declaradas | Declaradas |

La tabla general anuncia cobertura amplia en las principales ligas y torneos. Sin embargo, las segundas divisiones de Ecuador y Colombia son contraejemplos claros a "todo en todas". Tampoco se deben juntar fases paraguayas o uruguayas con identificadores diferentes sin verificar calendarios y temporadas.

## Lo que ya quedo en la app

- Las nueve competiciones consultadas (Ecuador B, Colombia B, Chile, Uruguay, Champions, Europa, Conference, Libertadores y Sudamericana) estan configuradas y visibles en Jugadores > Competiciones por cargar. Eso no equivale a tener su historial: siguen sin partidos API descargados en este servidor. No se crean equipos ni rendimientos ficticios para rellenarlas.
- Atajadas en los rankings, perfiles, medias, por 90 minutos, exportaciones y frecuencias over/under de 0.5 a 6.5, con lineas e intervalos configurables. Filtro por posicion, incluidos porteros.
- Se recuperaron del cache 124 registros reales de atajadas para 106 identidades de portero/equipo en once ligas, de historicos API 2024 (2024/2025 cuando corresponda). No son todas las participaciones de todos los porteros. Se conservaron los conteos desconocidos y no se modificaron marcadores ni archivos de baloncesto.
- Asistentes del torneo tiene un conector separado y bajo demanda, de una consulta, con cache de seis horas y reserva de cuota. Aun no hay rankings del torneo descargados: la clave estaba desconectada al verificar. El ranking de los partidos guardados sigue etiquetado como muestra.
- Los agregados de asistentes no se convierten en partidos, no se usan para reconstruir pronosticos y no respetan un corte historico anterior a su consulta: la fecha de consulta se muestra por separado.

El esquema oficial de jugadores incluye [goals.saves](https://www.api-football.com/news/post/how-to-get-all-teams-and-players-from-a-league-id). La [guia de endpoints](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide) documenta el ranking de asistentes. Ninguno de ellos garantiza atajadas para cada portero de cada liga. Tener mas atajadas no basta para calificar al mejor portero: tambien importa la exposicion a tiros, minutos y tamanos de muestra comparables.

## Alternativas para primer tiempo y jugadores

| API | Tarifa publica consultada | Encaje con esta app |
| --- | --- | --- |
| API-Football Pro | US$19/mes, 7.500 consultas/dia | El conector ya existe; permite probar primero con historicos Free. Campos de primer tiempo y jugadores deben auditarse por liga y temporada |
| FootyStats API Hobby | GBP 29.99/mes, elegir 50 ligas | Orientada a porcentajes de goles, ambos marcan y over/under; no confundir con membresia de su pagina |
| Sportmonks Starter | EUR 29/mes, elegir 5 ligas | Estadisticas detalladas, pero el plan inicial no cubre simultaneamente toda nuestra lista |

Fuentes: [API-Football precios](https://www.api-football.com/pricing), [FootyStats API](https://footystats.org/api), [Sportmonks planes](https://www.sportmonks.com/football-api/). Las monedas no se convierten ni incluyen posibles impuestos.

FootyStats [documenta datos individuales por temporada/liga](https://footystats.org/api/documentations/player-individual), con asistencias y estadisticas detalladas de porteros. Eso no confirma la disponibilidad por partido ni de todas las ligas B solicitadas. No se ha contratado ni probado su API pagada. No recomiendo cambiar de proveedor solo porque anuncie mas ligas: pedir muestras especificas de corners 1T, atajadas y jugadores de Ecuador B/Colombia B antes de pagar.

## Prueba de compra prudente

1. En el panel del proveedor revisar /leagues por cada competicion y temporada: fixtures.statistics_fixtures y fixtures.statistics_players.
2. Pedir al proveedor confirmacion de corners 1T con half=true para las temporadas y ligas prioritarias, especialmente las sudamericanas y divisiones B.
3. Examinar una muestra de hasta 20 partidos recientes por competicion: disponibilidad de marcadores 1T, corners FT/1T, offsides, faltas, amarillas, rojas y jugadores. Medir porcentaje de registros validos por campo, no solo si responde HTTP 200.
4. Si se contrata Pro, comenzar con un mes y pocas ligas; sincronizar por lotes con cache y sin descargar toda la historia de golpe. No hace falta Ultra para acceder a mas tipos de datos.
5. Antes de usar pronosticos, evaluar fuera de muestra por escenario y liga, con Brier, log loss, calibracion y faltantes. Mejor cobertura no equivale automaticamente a mayor acierto ni rentabilidad.

Conclusion: Pro es una opcion dentro del presupuesto de US$20 **si aceptas cobertura parcial**, pero no cumple una exigencia de todos los campos para todas las competiciones. Si corners del primer tiempo y las divisiones B son indispensables, no comprar basandose solamente en la lista de ligas.
