# Prepartido de baloncesto

## Alcance

`Baloncesto > Prepartido` ofrece contexto descriptivo de NBA regular, Euroliga y Liga Endesa. Lee exclusivamente el archivo local; abrirlo, cambiar filtros o leer el calendario no consume consultas del proveedor ni sella pronosticos.

- Encuentros futuros guardados con hora conocida, o comparacion manual de dos equipos sin afirmar que se enfrentaran.
- Ventanas de 5, 10, 15, 20, 25 y 30 partidos, con fecha de corte en Guayaquil y temporadas hasta la elegida. No se usa pretemporada.
- Victorias, derrotas y ultimos cinco resultados; puntos a favor/en contra FT, 1Q, 2Q, descanso, 3Q y 4Q; desglose local/visitante dentro de la misma ventana.
- Cada periodo conserva su muestra y sus faltantes. El 2Q puede calcularse restando 1Q al descanso explicito del mismo partido; no se reparte el marcador final para inventar cuartos. FT incluye prorroga.
- Cuando existe un encuentro futuro y un antecedente reciente de la misma temporada, intervalo entre sus horas de inicio, dias consecutivos y carga registrada en los siete dias previos. No son horas reales de recuperacion ni una verificacion del calendario completo, viajes u otras competiciones.
- Referencias individuales con puntos, rebotes, asistencias, PRA y triples, sus propios denominadores, fecha del ultimo registro, fuente y evidencia de temporada. El acceso individual abre el historial completo del jugador con los mismos filtros de competicion, temporada y corte.
- Reportes guardados de disponibilidad, bajas, dudas o limite de minutos: publicacion, caducidad, fuente y nota. Se distingue estar vigente al corte de cubrir el inicio futuro.
- Ultimos cinco enfrentamientos directos anteriores al corte.

## Integridad y limitaciones

Se excluyen resultados que aun no estaban disponibles al corte; sin hora final se conserva el margen prudente de seis horas ya usado en el proyecto. Un encuentro iniciado, sin hora conocida o fuera de la competicion/temporada no puede abrirse como futuro admisible. Para un corte historico, un calendario con fecha de descarga posterior no se presenta como conocido entonces.

Las referencias individuales historicas no son una plantilla ni una convocatoria actual. Se excluyen DNP y participaciones desconocidas; no se rellenan metricas ausentes con cero ni PRA incompleto. La antiguedad, la falta de apariciones en la temporada elegida y las muestras pequenas se advierten expresamente.

Los reportes de disponibilidad solo se usan si su publicacion y registro preceden al corte y corresponden al equipo/competicion y, si procede, al encuentro. El reporte mas reciente desplaza al anterior incluso si ha vencido: nunca se reactiva una baja o disponibilidad antigua. Sin reporte vigente se muestra disponibilidad no verificada, no ausencia de lesiones. No se descargan lesiones automaticamente ni se garantiza que un plan de pago las incluya.

El resumen no crea nuevas probabilidades, no ajusta el modelo por lesiones y no cambia entradas, lineas, calibracion ni ventana de la prueba congelada de octubre. Endesa permanece descriptiva y fuera de esa prueba. Los pronosticos experimentales existentes siguen en Encuentros y Probabilidades del dia, separados del resumen.

`Actualizar datos` respeta la competicion/temporada seleccionada en Prepartido y utiliza el conector existente, sujeto a clave, permisos, cuota y cobertura. No se garantiza informacion actual por el solo hecho de pagar. No se compran planes ni se guardan claves en archivos.

## Archivo NBA y Baloncesto

`Archivo NBA` es el apartado anterior de investigacion exclusiva NBA, con historial ESPN/CSV y analisis manual de equipos y jugadores. Se conserva para consultar datos e importaciones existentes.

`Baloncesto` es el espacio principal multicompeticion: Prepartido, Individual, Encuentros, Jugadores, Probabilidades del dia, Evaluacion y Datos guardados. Integra el conector de API-Basketball, historicos compatibles y reportes. No son dos deportes ni dos suscripciones; parte del archivo NBA alimenta tambien este espacio cuando cumple sus controles de admisibilidad.

## Individual de equipos

La pestana Semana se retiro de la interfaz, junto a sus consultas automaticas. Los datos guardados y el protocolo de octubre no se borran. La ruta semanal anterior se conserva por compatibilidad, sin uso desde la pagina.

`Individual` analiza un solo equipo, sin rival: NBA regular, Euroliga o Endesa. La primera apertura y el cambio de competicion prefieren la temporada mas reciente con resultados guardados cuando la elegida no tiene resultados; la temporada efectiva siempre queda visible en el selector. Elegir una temporada expresamente nunca provoca ese cambio automatico.

La muestra puede ser toda la temporada guardada o sus ultimos 5, 10, 15, 20, 25 o 30 partidos. Solo incluye la temporada exacta elegida, antes del corte y despues de filtrar local/visitante. No combina temporadas ni busca mas atras para rellenar periodos ausentes. Una temporada sin resultados muestra cero partidos y medias/frecuencias sin dato, no una supuesta forma actual.

Incluye victorias, derrotas, frecuencia historica de victorias, ultimos cinco, medias a favor/en contra/total por cuarto, descanso y final, localias, historial paginado y calendario parcial. Los empates de un cuarto o descanso se cuentan por separado de sus victorias y derrotas. La muestra de cada promedio y resultado se conserva; no se fabrican terceras o cuartas partes del marcador final.

Los over/under y rangos de puntos a favor, en contra o de ambos equipos reutilizan el calculo de frecuencias e intervalos Wilson del proyecto. Son descriptivos de esa misma muestra, no probabilidades nuevas del modelo. No consumen API, no crean pronosticos ni cambian la prueba congelada.

Rutas de lectura: `GET /api/basketball/teams/catalog` y `POST /api/basketball/teams/analysis`. Esta ultima recibe `league`, `season`, `team`, `cutoff`, `venue` (`all`, `home`, `away`) y `lookback` (`season` o una ventana admitida). No necesita `home`/`away` ni otro equipo.

## Rutas y pruebas

- `GET /api/basketball/prematch/catalog?league=nba&season=2026%2F2027`: equipos y encuentros futuros del archivo.
- `POST /api/basketball/prematch`: `league`, `season`, `lookback`, `cutoff` y `fixtureId`, o `home`/`away` para comparacion sin encuentro confirmado.
- `node --test basketball-prematch.test.mjs basketball.http.test.mjs`: cuartos, cortes, localia, faltantes, jugadores, disponibilidad, exclusiones, no mutacion y ausencia de consultas externas en las rutas de lectura. Proveedores HTTP simulados; no certifica cobertura comercial.
