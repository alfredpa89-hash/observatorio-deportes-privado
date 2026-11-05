# FootyStats: prueba de la clave personal

Comprobado el 13 de octubre de 2026 mediante la API oficial, sin compras,
cambio de ligas elegidas, CSV ni consultas a API-Football para completar datos.
La clave permanece exclusivamente en memoria del servidor.

## Acceso real

El catalogo general contiene nuestras 27 competiciones, pero no concede permiso.
Las consultas de la temporada mas reciente de las 27 fueron rechazadas por
acceso restringido (HTTP 417). No se descargaron sus temporadas actuales.
El catalogo elegido de esta clave permite estos dos historicos:

| Competicion | Temporada | Equipos | Resultados | Jugadores de temporada | Ultimo resultado |
| --- | --- | ---: | ---: | ---: | --- |
| Premier League | 2024/2025 | 20 | 380 | 775 | 25 mayo 2025 |
| Liga MX | 2019/2020 | 19 | 275 | 610 | 15 marzo 2020 (Guayaquil) |

No hay encuentros futuros en los historicos recibidos. Los 275 resultados de
Liga MX son lo recibido y finalizado en esa temporada, no una afirmacion de
temporada completa. Las cuatro paginas de jugadores permitieron descargar
todo el listado anunciado por el paginador de cada historico.

Sin historial autorizado en esta prueba: Championship, La Liga, Bundesliga,
Serie A Italia, Ligue 1, Eredivisie, Primeira Liga Portugal, MLS, Argentina,
Serie A Brasil, Serie B Brasil, LigaPro Ecuador, Serie B Ecuador, Primera A
Colombia, Primera B Colombia, Peru, Chile, Bolivia, Uruguay, Paraguay,
Champions League, Europa League, Conference League, Libertadores y Sudamericana.
Esto describe esta clave y sus temporadas comprobadas, no demuestra que
el proveedor carezca de esas competiciones o de otros campos en un plan distinto.

## Campos Utilizables

Son parejas de conteos local/visitante efectivamente guardadas y validadas.
Faltantes, negativos e incoherencias no se convierten en ceros.

| Dato por partido | Premier League: 380 | Liga MX: 275 |
| --- | ---: | ---: |
| Goles y resultado final | 380 | 275 |
| Goles del primer tiempo | 380 | 275 |
| Corners del partido | 380 | 275 |
| Corners del primer tiempo | 372 | 259 |
| Tarjetas amarillas | 380 | 275 |
| Tarjetas rojas | 380 | 275 |
| Fueras de juego | 363 | 274 |
| Faltas | 380 | 275 |
| Tiros | 380 | 275 |
| Tiros al arco | 380 | 275 |

La respuesta informa corners 1T en 373 partidos de Premier; una pareja supera
los corners finales y fue excluida del analisis. Por eso el informe de campos
informados y la muestra utilizable pueden tener distintos denominadores.
Los ceros informados no prueban por si solos que la recogida estadistica sea
exhaustiva. Esta prueba no certifica otra temporada ni otra competicion.

## Porcentajes y Jugadores

Gana local, empate, gana visitante, doble oportunidad, ambos marcan y los
overs/unders se calculan en la app usando exclusivamente esos registros.
No son porcentajes oficiales ni certificados de FootyStats, ni pronosticos
vigentes de octubre de 2026. Individual muestra frecuencias historicas con
muestra e intervalo; Encuentros ofrece estimaciones exploratorias ajustadas a
los dos equipos, sin garantia de acierto.

Los 1.385 registros personales son acumulados de temporada: participaciones,
minutos, goles, asistencias, amarillas y rojas. Este acceso no devolvio tiros,
tiros al arco, faltas o atajadas personales en `/league-players`. Permanecen
como `s/d`. No se generaron actuaciones ficticias, minutos actuales, lesiones
ni probabilidades individuales por partido a partir de acumulados del torneo.

## Verificacion

Se comprobaron por HTTP los 98 escenarios de Encuentros para cada historico,
con ventanas de 5, 10, 15 y 20 partidos, y la consulta de un solo equipo.
Las muestras usan solo FootyStats. La huella de los datos anteriores a la
importacion coincide: se conservaron los 10.907 partidos previos y el estado
de baloncesto, sin alterar su prueba congelada.

La app incluye el selector `Solo FootyStats`, la cobertura de las 27 ligas
y `Descargar cobertura de ligas`. Las fuentes anteriores siguen separadas.
Antes de contratar, pide al proveedor acceso de prueba a tus ligas/temporadas
concretas y una muestra de campos personales faltantes. Esta prueba no
confirma que un plan pagado vaya a rellenarlo todo.
