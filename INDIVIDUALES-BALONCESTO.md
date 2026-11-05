# Analisis individual de baloncesto

Disponible en Baloncesto > Jugadores y Datos guardados > Jugadores, para NBA, Euroliga y Endesa. Usa registros guardados; no acredita la plantilla ni la disponibilidad actual de los jugadores. La temporada elegida puede incluir historial anterior antes del corte. Cada consulta conserva la competicion, club, localia y ventana elegida de 5/10/15/20/25/30 participaciones.

## Condiciones

- Puntos, rebotes, asistencias, PRA, triples anotados y las combinaciones PR, PA y RA. Las sumas requieren componentes completos del mismo partido; no se suman promedios de muestras diferentes.
- Objetivos de puntos desde 5, rebotes desde 2, asistencias desde 2 y triples desde 1, con varios umbrales. Hasta diez objetivos personales por jugador y hasta tres requisitos conjuntos con minimos enteros. No se exige que todos alcancen diez rebotes o diez puntos. Las combinaciones 10 puntos + 10 rebotes y 10 puntos + 10 asistencias describen esas condiciones concretas, no todas las formas oficiales de un doble-doble.
- Tiros de campo, triples y tiros libres anotados/intentados, cuando esten informados. Los porcentajes agregan anotados e intentados de los mismos partidos completos; no promedian porcentajes por partido. Cero intentos no produce un porcentaje de acierto de cero. Los registros anteriores sin estos campos conservan s/d hasta una nueva consulta autorizada.

La muestra real de Endesa usa field_goals para tiros de dos puntos: 2 * field_goals + 3 * triples + libres concuerda con los puntos individuales. La normalizacion comprueba esa identidad frente a la alternativa de tiros de campo inclusivos. Solo suma los conteos de dos y tres cuando la definicion queda verificada en el registro o en evidencia consistente del mismo partido. Conserva ambos desgloses y los campos originales; casos ambiguos o inconsistentes quedan sin dato. El formato inicial shooting.schema=1 se interpreta en lectura sin reescribir pronosticos ni volver a consumir API. No se deducen intentos a partir de los puntos.
- Over/under e intervalos historicos, filtros local/visitante y separacion de clubes. Ultima fecha, temporadas de la muestra, faltantes y advertencias por menos de diez participaciones o mas de noventa dias de antiguedad.

Los porcentajes son frecuencias historicas con intervalo Wilson del 95 %, no probabilidades calibradas del siguiente partido. Cada escenario tiene su propio denominador. Los DNP, minutos desconocidos y datos faltantes no se sustituyen por cero. Se toma primero la ventana y despues se excluyen los valores ausentes de cada escenario; no se buscan partidos mas antiguos para inflar la muestra. El historial no incluye resultados posteriores al corte ni referencias parciales oficiales.

Cada linea over/under muestra tambien su conteo: por ejemplo, 17 de 20 partidos y 85 %. El conteo se obtiene de los resultados individuales, no de redondear una probabilidad estimada. Si solo 18 participaciones de la ventana tienen esa estadistica, el denominador es 18 y se conservan los dos faltantes. Sin muestra se indica Sin partidos con dato, no cero aciertos de veinte. Las probabilidades estimadas, cuando existen, siguen en columnas separadas de las frecuencias y conteos historicos.

No se ha anadido el nuevo analisis de minutos, variacion de minutos o produccion por minuto que el usuario excluyo. Los campos de minutos y las proyecciones experimentales que ya existian se conservan separados.

## Carga gradual

El selector de equipos incluye tambien clubes con resultados historicos anteriores a la temporada elegida, aunque todavia no tengan jugadores descargados. No los presenta como participantes ni plantillas de la temporada actual. Cada opcion indica cuantos jugadores tienen participaciones guardadas o si faltan; el resumen separa equipos del archivo, equipos con jugadores y temporadas reales de las participaciones. Seleccionar un club sin registros no crea jugadores. Completar historial sigue consultando exclusivamente la temporada seleccionada, no cambia de temporada silenciosamente.

Completar historial del equipo requiere un club y partidos guardados de la temporada exacta con identificador API-Basketball. Comprueba la cobertura del catalogo y consulta como maximo cuatro encuentros por accion, priorizando los que no tienen detalles. Reutiliza las protecciones de 90 consultas locales y 24 detalles diarios; no cambia esos limites por conectar un plan Pro. Un lote de equipo se conserva en cache quince minutos. Se detiene ante errores de acceso o cuota y mantiene los registros anteriores. No descarga masivamente Game Center ni otras fuentes restringidas.

Los campos adicionales de lanzamiento se guardan en shooting, separados de las cinco variables del modelo. El analisis manual usa playerData para conservar registros de varios partidos aunque un archivo antiguo no tenga matchId. No modifica el modelo, lineas, ventana de veinte ni calibracion de la prueba de octubre. Los objetivos y las nuevas combinaciones no se sellan ni se evaluan como escenarios de esa prueba.

## API y suscripciones

La conexion verificada en este equipo es API-Basketball Free: cien consultas anunciadas por dia y acceso de temporada restringido por el proveedor a 2022-2024. La consulta de Endesa 2026/2027 fue rechazada; el historial 2024/2025 fue aceptado. El catalogo anuncia estadisticas por temporada, pero eso no demuestra que todos los partidos o jugadores tengan todos los campos.

API-Football Pro es el producto de futbol, no una ampliacion de API-Basketball. Una cuenta o clave compartida no demuestra una suscripcion de pago al producto de baloncesto. Las paginas consultadas anuncian Football Pro por US$19/mes y Basketball Pro por US$15/mes, ambos con 7.500 consultas diarias en su producto. No se ha contratado ningun plan ni confirmado la cobertura efectiva de una cuenta Basketball Pro. Las combinaciones y frecuencias las calcula la app; pagar no certifica su precision. Lesiones y desglose individual por cuarto requieren una fuente especifica comprobada y no se prometen como resueltos por Pro.

Fuentes oficiales consultadas el 14 de octubre de 2026:
- https://api-sports.io/sports/basketball
- https://www.api-football.com/pricing/
- https://www.api-football.com/news/post/api-basketball-new-release-available
- https://api-sports.io/documentation/basketball/v1

## Rutas locales

- GET /api/basketball/players/catalog: catalogo de jugadores guardados, sin consumir API externa.
- POST /api/basketball/players/analysis: historial y analisis descriptivo, sin consumir API externa.
- POST /api/basketball/research/player-sync: lote limitado por equipo, temporada y corte. Consume solo las solicitudes necesarias del proveedor conectado.

Los tests usan respuestas simuladas y claves ficticias. Una prueba simulada no demuestra cobertura real de produccion. La clave real permanece en memoria del servidor y no se guarda en estos documentos ni en exportaciones.
