# Prueba privada de baloncesto, octubre 2026

## Archivo inactivo

El 18 de octubre de 2026 el usuario solicito eliminar la prueba programada.
La automatizacion del chat de las 07:00 fue eliminada y el nuevo servidor
desactiva el seguimiento anterior al arrancar. No ejecuta el ciclo horario
de la prueba. Lo siguiente documenta el protocolo archivado, no una orden
vigente para iniciar pruebas, avisos diarios o un balance automatico en noviembre.
Los pronosticos, entradas y resultados existentes se conservan sin reescritura.
La actualizacion de datos del Centro de datos es independiente y continua.

## Alcance

- Euroliga: desde la conexion de datos e inicio del protocolo, no retrospectivamente.
- NBA: temporada regular desde el 20 de octubre de 2026. Sin pretemporada.
- Ultimo inicio admisible: 31 de octubre, 23:59, America/Guayaquil.
- Revision final el 1 de noviembre, para recoger partidos de la noche anterior.
- Liga Endesa queda fuera del protocolo predictivo: esta visible en las consultas descriptivas, pero no se mezclan sus partidos con NBA/Euroliga ni se inventa un modelo validado.

## Conexion gratuita

Actualizacion de carga del 18 de octubre: el Centro de datos permite activar
`Usar cuota gratuita completa` para consumir hasta la cuota verificada en
consultas utiles, sin el antiguo tope local de 24 detalles ni reserva de diez.
Con Free 100, calendario, verificacion y detalles comparten esas 100. Se respeta
un limite menor y el remanente observado; no se reinician contadores, se evitan
temporadas bloqueadas y se conservan caches. Esta politica de descarga no cambia
el modelo, lineas, ventana, calibracion ni sellos de la prueba. La descripcion
90/24 siguiente corresponde al modo conservador que sigue disponible.

Crear una cuenta personal en https://dashboard.api-football.com/register y obtener la clave en Account / My Access. Conectarla en Prueba baloncesto > Datos gratuitos y conexion. No pegar la clave en el chat.

API-Basketball ofrece 100 solicitudes diarias. La app mantiene un limite preventivo local de 90 y reserva al menos diez cuando el proveedor informa cuota restante. Las solicitudes fallidas tambien consumen el contador. No contrata ni actualiza planes. La cuota puede compartirse con otros usos de la misma cuenta. Los detalles se descargan gradualmente, con cache, hasta ocho solicitudes por competicion y ciclo y veinticuatro por dia, reservando consultas para calendario y resultados. El catalogo se descubre por nombre, no por identificadores inventados. La cobertura real y las temporadas autorizadas del plan gratuito solo se confirman al conectar la clave; no se presupone acceso a todas las estadisticas anunciadas.

La clave puede guardarse cifrada con el usuario de Windows, fuera del proyecto, al seleccionar `Guardar cifrada en este equipo`. Baloncesto solo la guarda después de verificar correctamente el acceso. Si el cifrado no está disponible o no se selecciona, queda solo en memoria del servidor y debe reconectarse tras reiniciar. Abrir `Reiniciar.cmd` desde la sesión normal de Windows permite comprobar el guardado. Una variable de entorno API_BASKETBALL_KEY es una alternativa opcional; no se incorpora a los archivos de datos, CSV o navegador. Véase [Claves y fuentes](CLAVES-Y-FUENTES.md).

La NBA ya guardada procede del feed publico ESPN, sin licencia abierta ni garantia de disponibilidad. El conector API-Basketball verifica cobertura de equipos/jugadores por temporada y conserva registros si falla. Se pueden importar CSV personales; una importacion no acredita derechos sobre el contenido. No se importa masivamente EuroLeague ni NBA.com porque sus terminos restringen ese uso. No hay fuente gratuita verificada de lesiones, alineaciones o cuotas archivadas.

## Modelo y protocolo

### Consulta semanal de Euroliga

La vista Semana consulta resultados, medias por equipo y registros individuales de un periodo de 1 a 31 dias, con fechas inclusivas en Guayaquil. Incluye una muestra puntual, parcial y revisada manualmente el 11 de octubre de tres cronicas de clubes (Real Madrid, FC Barcelona y Olympiacos) y dos encuentros futuros del calendario del Real Madrid. No es el calendario completo ni un ranking de jugadores. Sus referencias y enlaces estan en research/euroleague-2026-10-11.json; no se refrescan mediante scraping ni solicitudes al feed restringido de EuroLeague.

Estas referencias se mantienen fuera de data/state.json, del historial de prediccion, calibracion, entradas selladas y metricas de la prueba. Consultarlas no consume cuota ni reconstruye pronosticos. Los resultados conectados prevalecen sobre referencias del mismo dia, temporada y equipos reconocidos; un lote conectado de jugadores sustituye la seleccion parcial de ese partido para evitar duplicar nombres abreviados. Si la hora del resultado no esta verificada, timeKnown=false lo muestra solo como fecha; el instante de fin de dia es una clave de agrupacion, no una hora real del partido. Nunca se usa en el modelo.

Solo se transcriben campos finales o de periodos explicitamente identificados en las cronicas. No se confunde valoracion PIR con puntos ni una estadistica de un cuarto con el total final. Minutos, triples, rebotes o asistencias desconocidos siguen siendo null; PRA solo se calcula con los tres componentes. Las medias muestran n y faltantes, no representan probabilidades ni toda la liga. Hoy sin registros no significa ausencia de partidos. El historial completo sigue pendiente de verificar acceso y cobertura con la clave gratuita.

Version: basketball-2026-10-v2. Ventana de prueba fija: veinte partidos. La investigacion manual permite 5, 10, 15, 20, 25 y 30, sin modificar la ventana ni calibracion congeladas de octubre. Ajuste regularizado de ataque/defensa por rival, descanso aprendido y posesiones estimadas cuando ambos equipos tienen suficientes FGA, FTA, rebotes ofensivos y perdidas. Los modelos de partido completo, primer cuarto y descanso usan sus propios resultados; no dividen artificialmente el total final. FT incluye prorroga.

La comprobacion historica separa el 70% inicial para calibrar del 30% final para validar. Cada prediccion solo utiliza encuentros finalizados antes del corte. Si no hay hora final conocida se aplica un margen conservador de seis horas. Calibracion por escenario solo con al menos cien registros; se aplica a la misma ventana, version y linea de referencia. Los experimentos historicos repetidos no son una nueva prueba independiente.

Los porcentajes individuales se basan en produccion por minuto, ponderacion reciente y minutos proyectados. Estan condicionados a jugar, no calibrados y no son una alineacion confirmada. DNP y datos faltantes no se sustituyen por cero. PRA solo existe cuando puntos, rebotes y asistencias estan completos. Los pronosticos automaticos de jugadores requieren una aparicion en la temporada actual; no se presume una plantilla actual a partir del ano anterior.

La prueba sella una sola prediccion por encuentro, al menos cinco minutos antes del inicio y dentro de las siguientes 36 horas. Guarda entradas, hash SHA-256, modelo, probabilidades, supuestos y fecha. La calibracion queda congelada al iniciar el protocolo. No se modifica tras conocer resultados. Los resultados pueden completarse despues, sin recalcular la prediccion. GET /api/basketball/audit comprueba consistencia; el hash local no es una certificacion externa contra manipulacion.

Lineas de investigacion fijadas: NBA 220.5 FT, 55.5 1Q, 110.5 descanso; Euroliga 160.5 FT, 40.5 1Q, 80.5 descanso; handicap local -3.5. No son cuotas reales historicas, no permiten demostrar rentabilidad. Ganador FT, totales, handicap, periodos y estadisticas individuales se evaluan por separado. Complementarios no duplican la muestra. En ganador 1Q/descanso se mide el evento binario local gana, no acierto de un clasificador de tres resultados. Los casos de jugadores pueden pertenecer al mismo partido y no son observaciones independientes.

Se guarda tambien una referencia simple anterior al partido: frecuencia de victoria local y media de puntos de la liga. Encuentros cuyo horario final cambia mas de seis horas quedan excluidos por reprogramacion, sin alterar la prediccion original. Registros con integridad invalida no se incorporan a las metricas.

## Evaluacion y continuidad

El panel muestra acierto, Brier, log loss, error medio absoluto de puntos y calibracion por rangos con intervalos Wilson. Un mes es exploratorio: hay que considerar cantidad de casos, datos faltantes, incertidumbre, comparacion con referencias simples y otra temporada/mes sin retocar el modelo en medio de la prueba. No decidir solo por el porcentaje del ganador.

El servidor local revisa cada hora mientras esta encendido y la prueba activa. La revision diaria de Codex complementa este proceso. Si el equipo esta apagado, la app cerrada, falta clave o falta cobertura, pueden perderse pronosticos; nunca se rellenan retrospectivamente. Despues del 31 de octubre no se sellan encuentros nuevos; se conserva el historial para reconciliar resultados.

## Fuentes verificadas

- https://api-sports.io/sports/basketball
- https://api-sports.io/documentation/basketball/v1
- https://www.api-football.com/news/post/api-basketball-new-release-available
- https://api-sports.io/terms
- https://pr.nba.com/2026-27-nba-regular-season-schedule
- https://pr.nba.com/2025-26-nba-regular-season-schedule/
- https://inform.euroleague.net/terms
- https://www.nba.com/termsofuse
