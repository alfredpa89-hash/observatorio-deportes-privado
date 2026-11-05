# Archivo privado por cuarto

Seccion: Baloncesto > Datos guardados > Por cuarto. Implementacion local, sin compras, nuevas suscripciones ni reinicio del servidor.

## Datos disponibles

- Reutiliza GET /api/basketball/research/export. No consume consultas de API-Sports. Equipos: Q1-Q4, descanso, final y prorroga, segun registros existentes. Temporada e historial de 5, 10, 15 o 20 encuentros seleccionables.
- NBA: una muestra oficial privada de Warriors-Nuggets, 29 de marzo de 2026 en Denver (30 de marzo UTC). 28 jugadores con minutos, puntos, rebotes, asistencias y triples por cuarto; PRA calculado solo con campos completos. Fuente: https://statsdmz.nba.com/pdfs/20260329/20260329_GSWDEN_book.pdf . Tablas de cuartos en paginas 2, 3, 5 y 7; pagina 6 es acumulada, NO tercer cuarto.
- Endesa: una muestra tecnica privada de Barca-Real Madrid, 22 de marzo de 2026, 18:00 UTC. 24 jugadores. Fuente: https://live.acb.com/es/partidos/barca-vs-real-madrid-104665/estadisticas . Datos por periodo proporcionados en la pagina publica, no endpoints privados.
- Euroliga: parciales de equipos ya guardados por API-Basketball. No se ha verificado un historial individual por cuarto de Game Center. Una consulta de pagina publica devolvio HTTP 429: no se insistio ni se intento eludir la restriccion. Fuente de referencia: https://www.euroleaguebasketball.net/euroleague/game-center/ .
- Los registros individuales finales de API/ESPN permanecen en Partidos y jugadores. No se convierten en cuartos ni se supone que cada cuarto sea el final dividido por cuatro.

Las dos muestras puntuales estan identificadas como referenceOnly y conservan atribucion. No son un feed libre completo, no otorgan licencia para descargar bases completas ni se usan en probabilidades o pronosticos. Revisar permisos de los titulares antes de cualquier ampliacion automatizada o uso diferente al privado de comprobacion. Condiciones NBA: https://www.nba.com/termsofuse . Las fuentes oficiales no se refrescan automaticamente.

## Validacion

Cuartos mas prorroga deben coincidir con el final cuando todos los campos estan disponibles; descanso es Q1 + Q2. Minutos individuales se validan contra la duracion real de cada cuarto. PRA requiere puntos, rebotes y asistencias. Los triples no pueden superar los puntos. Un cero registrado es distinto de un faltante. Minutos desconocidos o cero no sirven para frecuencias de jugadores. En rosters declarados completos, se concilian puntos individuales con puntos del equipo. No se atribuyen rebotes colectivos a jugadores.

Cada fuente se conserva. Diferencias entre el resultado final de una muestra oficial y registros guardados se muestran para revision; no se sobrescribe ni reescribe el archivo congelado. Las frecuencias agrupan partidos duplicados por liga, fecha y equipos; valores discrepantes se excluyen. La ventana no se extiende silenciosamente para sustituir partidos recientes sin datos. Solo clubes NBA y fase regular; sin pretemporada, All-Star o resultados futuros.

## Archivo personal

Plantilla: public/templates/basketball-periods.json. Reemplazar campos de ejemplo por registros reales. JSON schema 1, license, games (1-500 por importacion). league: nba, euroleague o endesa; season: YYYY/YYYY consecutivos; date ISO con zona; finished: true; preseason: false; NBA phase: regular. Incluir id, equipos, source y sourceUrl. periods.home/away contiene q1-q4, ot y ft; players contiene playerId, name, team y periods por cuarto con minutes, points, rebounds, assists y threes. Se aceptan campos parciales con null; minutos decimales expresados en minutos, no MM.SS. No importes datos sin autorizacion.

Se exige confirmar derechos. Importacion atomica, hasta 2 MB, maximo 2.000 partidos personales. Conflictos no se sobrescriben. Persistencia exclusiva en localStorage de este origen/navegador (observatorio-period-records-v1). Se puede exportar JSON, incluyendo fuentes y autorizaciones por registro; no contiene claves ni pronosticos de octubre. Limpiar el navegador elimina esta copia. No hay sincronizacion al servidor ni garantia de copia de seguridad. No se modifica un archivo local invalido sin revision.

## Comprobacion historica

Reproduccion cronologica descriptiva e independiente: para cada resultado, usa los 5/10/15/20 encuentros anteriores, como minimo cinco valores disponibles. Excluye partidos iniciados en las cuatro horas anteriores al encuentro objetivo para evitar incorporar encuentros simultaneos. Probabilidad over = (ocurrencias previas + 1)/(n + 2); valor esperado = media previa. Es una referencia sencilla, no un nuevo modelo validado.

Muestra cada resultado, probabilidad previa retrospectiva, valor esperado, valor real y error; resume acierto, Brier, log loss, error absoluto y calibracion. Excluye referenceOnly, conflictos, valores ausentes y jugadores sin participacion verificada. No verifica que los datos fueran accesibles realmente en el instante historico, ni incorpora lesiones o cuotas. No es una prueba prospectiva ni demuestra precision futura o rentabilidad. Elegir lineas tras ver resultados introduce sesgo; no comparar este ejercicio con la prueba congelada como si fueran equivalentes.

La prueba de octubre, sus entradas, modelos, lineas y calibracion siguen intactos. Para pruebas previas reales usar Pronosticos y evaluacion, con encuentros futuros admisibles y datos autorizados suficientes. Los reportes de disponibilidad existentes conservan fuente, fecha y vigencia; no deducimos lesiones de una ausencia ni de minutos escasos.

## Verificacion

Pruebas: basketball-periods.test.mjs. Cubre muestras reales conciliadas, faltantes, DNP, descanso, prorroga, minutos, PRA, derechos, fechas, importacion atomica, duplicados, discrepancias y ausencia de informacion futura en la reproduccion cronologica.
