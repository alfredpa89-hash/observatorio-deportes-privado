# Tenis: comparacion de los seis bloques

Aplicado el 16 de octubre de 2026. Uso personal, circuito ATP individual. No se ha contratado ninguna API de tenis y no se ha modificado la prueba congelada de NBA/Euroliga.

| Punto | Antes | Ahora | Limite real |
| --- | --- | --- | --- |
| 1. Historicos y cobertura | Carga del 7 de octubre en Guayaquil, sin detalle de servicio ni identidades de jugador conservadas | Archivos 2026 y 2025 actualizados, importador version 2, IDs ATP, cobertura y precision de fechas visibles | Una descarga reciente no convierte la semana de torneo en fecha exacta de partido |
| 2. Servicio y quiebres | Solo aces y dobles faltas | Primer servicio, puntos ganados con primero/segundo, quiebres logrados, puntos de quiebre enfrentados/salvados y servicio conservado | Ausencias siguen como s/d; cero oportunidades no produce un porcentaje ficticio |
| 3. Ficha individual | Ventanas de 5 a 20 y limites basicos | Ventanas 5/10/15/20/25/30, medias con n y faltantes, lineas personalizadas, intervalos, aciertos de n e intervalo Wilson 95 % | Se toma primero la ventana; no se buscan registros anteriores para rellenar campos ausentes |
| 4. Escenarios | Ganador Elo y total basico de juegos/sets | Mas lineas individuales, primer set, al menos un set, tie-break, handicap de juegos/sets y resultados en sets | Los escenarios adicionales son frecuencias historicas, no probabilidades calibradas del duelo |
| 5. Contexto | Superficie, categoria y H2H basicos | Pista cubierta/exterior, formato, ranking historico, carga/descanso con fechas exactas y disponibilidad documentada | No hay feed de lesiones; la carga con fechas parciales no representa toda la actividad |
| 6. Dia y evaluacion | Sin ensayo prospectivo propio de tenis | Calendario manual con fuente, sellado previo al inicio, lista diaria, evaluacion y validacion temporal | La fuente actual no proporciona un calendario futuro con hora verificada; no se inventan encuentros |

## Resultado de la actualizacion real

- ATP 2026: 2.481 resultados guardados, frente a 2.419 antes (+62).
- ATP 2025: 2.944 resultados guardados, conservando correcciones del archivo actual de la fuente.
- Seleccion inicial al mejor de tres, todas las superficies/categorias admitidas y corte del 16 de octubre: 2.298 resultados utilizables, 248 identidades y 2.297 partidos con algun dato de servicio y quiebres. Cada indicador calcula despues sus pares completos y su propio denominador.
- En esa seleccion, las 2.298 fechas corresponden a semana de torneo, no a una fecha/hora exacta. Se conservan los margenes de disponibilidad de catorce dias en Grand Slam/Masters y ocho en ATP 500.
- No se cargaron partidos futuros ficticios ni reportes de lesiones inventados. No se utiliza el archivo de torneos en curso como si fuera un calendario de inicio confirmado.

La actualizacion al entrar en Tenis se intenta si el archivo supera seis horas o tiene un importador antiguo. El navegador limita sus reintentos automaticos a uno cada quince minutos; el servidor reutiliza la cache de seis horas. Actualizar historicos permite solicitar una revision manual, sujeta a esa cache. Una descarga fallida conserva los registros y su fecha anterior. Una caida superior al 25 % frente a un archivo de al menos cien registros se bloquea para revisar la fuente, sin ocultarla mezclando filas viejas.

## Estadisticas y definiciones

Los porcentajes de servicio suman numeradores y denominadores de los mismos partidos completos. No promedian porcentajes individuales. Los quiebres logrados se obtienen de puntos de quiebre enfrentados menos salvados por el rival en ese partido. Servicio conservado requiere juegos al servicio y puntos de quiebre perdidos completos y consistentes. Duracion es la del encuentro, no minutos individuales estimados.

Todos los filtros de la nueva seccion, incluido el formato, se aplican antes de seleccionar los ultimos partidos. No se mezcla el historial de tres y cinco sets en esos indicadores. Los retiros, walkovers y marcadores no verificables no producen totales inventados. Las identidades se unen solo por ID ATP, sin equivalencias difusas entre nombres parecidos.

Una fecha con hora no se presume hora de finalizacion: si no hay finished_at explicito, el importador aplica un margen conservador de seis horas. Una fecha sin hora solo se usa tras terminar ese dia en Guayaquil. La fecha de semana mantiene su margen propio. Un resultado con hora de inicio verificada desplazada mas de seis horas frente al encuentro sellado se separa como reprogramado.

La comparacion muestra por separado el Elo experimental y los totales suavizados existentes, frente a frecuencias descriptivas de escenarios. Un 100 % en una muestra pequena no garantiza el siguiente partido. Los handicaps de sets se limitan a los que corresponden al formato y las lineas son semienteras, sin resultados nulos por empate de linea.

En **Prepartido**, el handicap de juegos tiene un selector de -10.5 a +10.5 y una linea personalizada de -30.5 a +30.5, siempre terminada en .5. La linea corresponde al jugador A; el jugador B recibe la opuesta. Cada jugador conserva su frecuencia historica, cumplidos/con datos, intervalo Wilson y faltantes. Las dos frecuencias provienen de rivales distintos y no se presentan como probabilidades complementarias del duelo. Los juegos se suman desde sets completos verificados; no se cuenta un match tie-break como un set de diez juegos ni se usan retiros o datos contradictorios.

El bloque **Marcador de sets** muestra cuatro desenlaces en mejor de tres (2-0/2-1 para cada ganador) o seis en mejor de cinco (3-0/3-1/3-2). Desglosa la estimacion Elo existente suponiendo sets independientes con probabilidad constante, invertida numericamente para mantener la misma probabilidad de ganador. El redondeo conjunto conserva el total de cada ganador y el 100 % del conjunto. No es un modelo de servicio punto a punto ni esta calibrado para marcador exacto. Los totales de sets empiricos de la tabla general usan otro metodo y pueden diferir. Exige cinco marcadores completos por jugador y diez de contexto; si faltan, muestra s/d junto al conteo real. Incluye cuantas veces gano asi el jugador y cuantas veces sufrio ese marcador su rival. Este bloque de investigacion no se incorpora al protocolo prospectivo v1 ni reescribe sellos, entradas o evaluaciones existentes.

## Protocolo prospectivo de tenis

Version tennis-research-v1, independiente de baloncesto. Ventana fija de veinte, misma superficie y formato, categorias de historial admitidas sin limitarse al torneo de destino. Linea total fija de 22.5 juegos en tres sets y 38.5 en cinco sets. Los filtros manuales de investigacion no cambian este protocolo.

Solo se sella un encuentro registrado con fuente y fecha/hora, al menos cinco minutos antes de comenzar y dentro de las siguientes 36 horas. Se requieren al menos cinco partidos validos de cada jugador y diez de contexto para el ganador. Una vez sellado, no se reemplaza ni se borra. Se conserva una copia de las entradas, el hash SHA-256 y el modelo; el hash local no es certificacion externa de tiempo ni de integridad.

La lista diaria es de solo lectura y muestra una seleccion por grupo y partido, ordenada por porcentaje. No son selecciones independientes entre si. Una baja documentada posterior retira la seleccion visible sin reescribir el pronostico original. Un reporte vencido no revive otro mas antiguo. No se reconstruyen pronosticos despues del inicio.

Solo se reconcilia un resultado con fecha de partido exacta, torneo, IDs y dia coincidentes, sin ambiguedad. La semana de torneo no acredita el resultado de un encuentro concreto del calendario. Resultados ausentes quedan pendientes, retiros y cambios de formato se separan de los aciertos. Se informa Brier, log loss, acierto, MAE de juegos y faltantes; no se infiere rentabilidad.

## Primera validacion historica

Se ejecuta sobre el 30 % final por fecha, con un maximo de doscientos candidatos y sin ajustar parametros con sus resultados. Cada prediccion usa unicamente datos disponibles antes de la fecha del caso. Con fechas semanales esto es conservador y no permite validar la carga diaria ni disponibilidad medica.

El lado evaluado se elige por identificador estable, antes de considerar el resultado. Los CSV de la fuente ponen al ganador en la primera columna; conservar ese orden para la calibracion produciria artificialmente observaciones positivas en todos los casos. El orden de las columnas no se utiliza como variable predictiva.

Prueba inicial real, al mejor de tres, ventana veinte y todas las superficies, 16 de octubre de 2026:

- 200 candidatos, 156 evaluables y 44 omitidos por muestra.
- Acierto del ganador: 61.54 %.
- Brier: 0.2316; log loss: 0.6546.
- Error absoluto medio de juegos: 5.20, n=156.
- Referencia constante de ganador 50 %: Brier 0.25 y log loss 0.6931. Es una referencia sencilla, no una comparacion con cuotas de mercado.

No es una evaluacion fuera de muestra prospectiva ni una promesa de precision futura. Repetir filtros o ventanas sobre estos mismos resultados no produce una prueba nueva independiente. El panel presenta tambien los intervalos de calibracion observada por rangos de probabilidad.

## Fuente y rutas

Fuente publica consultada: https://stats.tennismylife.org/tennis-match-database. La fuente describe los campos, IDs ATP y el significado semanal de tourney_date. La app no presupone derechos de redistribucion comercial.

GET /api/tennis/state, POST /api/tennis/refresh, POST /api/tennis/player y POST /api/tennis/comparison.

POST /api/tennis/fixtures, POST /api/tennis/fixtures/remove, POST /api/tennis/availability.

GET /api/tennis/daily, POST /api/tennis/daily/prepare, GET /api/tennis/evaluation y POST /api/tennis/backtest.
