# Archivo privado de baloncesto

Actualizado: 11 de octubre de 2026. Version: basketball-2026-10-v2+research-v1.

## Separacion de la prueba

El apartado `Prueba baloncesto > Archivo e investigacion` guarda sus registros en
`basketballResearch`. No modifica el modelo, protocolo, lineas, ventana, calibracion,
entradas ni pronosticos congelados de octubre. Las consultas al proveedor comparten
los limites diarios del conector existente. Las referencias parciales de la semana
de Euroliga no se convierten en historial completo del modelo.

## Cobertura comprobada y limitaciones

El catalogo autenticado guardado anuncia NBA (ID 12), Euroleague (ID 120) y
ACB de Espana (ID 117, Liga Endesa), con estadisticas de equipos y jugadores
para 2026/2027. Esto no equivale a haber descargado todos los datos.
La cuenta Free rechaza 2025 y 2026 y comunica acceso a los anios 2022-2024.
Las consultas reales del archivo tambien confirmaron rechazo de NBA y Endesa
2026/27 con el mismo mensaje. NBA mantiene su calendario y resultados gratuitos
de una fuente distinta; ese acceso no procede del plan Free de API-Basketball.
Los anios del proveedor se normalizan a temporadas: Euroliga usa 2024;
NBA y Endesa pueden usar `2024-2025`. Cada carga comprueba el catalogo.

Fuentes oficiales consultadas:
- [API-Basketball: cobertura y precios](https://api-sports.io/sports/basketball)
- [Documentacion](https://api-sports.io/documentation/basketball/v1)
- [Condiciones de uso](https://api-sports.io/terms)

| Capacidad | Free | Pro anunciado |
| --- | --- | --- |
| Precio mensual | US$0 | US$15 |
| Consultas diarias | 100 | 7.500 |
| Acceso | Temporadas restringidas | Todos los endpoints y competiciones; comprobar acceso y completitud reales |
| Formato de estadisticas | El mismo, si hay acceso/cobertura | El mismo; no asegura mayor exactitud |
| Lesiones | Sin endpoint dedicado documentado | Sin endpoint dedicado documentado |
| Jugadores por cuarto/descanso | Sin desglose documentado | Sin desglose documentado |

No se compra ningun plan. API-Football Pro no es API-Basketball Pro.
La app conserva 90 consultas locales/dia, 24 consultas de detalle/dia y
un maximo de ocho detalles por carga, incluso si se verifica Pro.
Cambiar estos limites requiere una configuracion separada y explicita.
La exportacion es privada y no implica permiso de redistribucion o reventa.

## Datos y reportes

Prueba real de Free del 11/10/2026, sin compra de Pro:
- Euroliga 2024/25: 330 resultados con los cuatro cuartos; 82 registros de
  jugadores obtenidos de cuatro encuentros. No es historial individual completo.
- Endesa 2024/25: 325 resultados con los cuatro cuartos; 90 registros de
  jugadores obtenidos de cuatro encuentros. Modelo de Endesa pendiente.
- NBA 2025/26: 1.230 resultados ya guardados desde una fuente gratuita distinta.
  La comprobacion cronologica independiente valida 369 encuentros: ganador
  76,69% de acierto, Brier 0,1875 y log loss 0,5609; referencia Brier 0,2449.
  Error absoluto de total FT 14,45 puntos frente a 16,01 de referencia.
  Son resultados retrospectivos con datos potencialmente corregidos, no prueba
  de eficacia futura, precision de lesiones ni rentabilidad.
- Euroliga 2024/25: validacion historica de 100 partidos. Ganador: acierto
  67%, Brier 0,2115 frente a 0,2316 de referencia. Total 1Q: Brier 0,2503,
  sin ventaja sobre la referencia constante de 50% (Brier 0,25) en esa muestra.
  No se cambia el modelo congelado por estos resultados.

- Partidos: fuente, temporada, fecha, resultado, 1Q-4Q, prorroga y descanso
  sumado de 1Q+2Q completos. Un periodo inconsistente se marca ausente.
- Equipos: promedios a favor/en contra FT, 1Q y descanso, con muestra real.
- Jugadores: ID estable del proveedor, equipo, minutos, titularidad,
  puntos, rebotes, asistencias y triples. PRA exige los tres componentes.
- DNP y minutos desconocidos son registros separados, no resultados de cero.
- Ventanas exactas de 5/10/15/20 partidos. Los promedios omiten faltantes.
- Disponibilidad manual: URL HTTPS, publicacion, registro, vigencia de hasta
  siete dias, equipo/jugador, partido opcional, estado y limite de minutos.
  Un reporte vencido no se reutiliza. Nunca se deduce una lesion de un DNP.
- Enlaces a NBA, Euroliga y ACB son referencias, no feeds automaticos.
  El enlace NBA 2025/26 debe contrastarse con la temporada del reporte.

## Pronosticos y evaluacion

NBA y Euroliga: sellado manual solo antes de un encuentro con hora conocida,
al menos cinco minutos de margen y muestra suficiente. Endesa: archivo de datos
habilitado, modelo independiente pendiente; no se extrapola el de Euroliga.
Se conserva version, fecha, lineas, ventana, entradas y hashes de integridad.
No se sobrescribe un escenario sellado ni se reconstruye despues del inicio.

Los pronosticos de equipos usan la temporada seleccionada y la anterior.
Los de jugador requieren una aparicion con ese equipo en la temporada elegida;
son condicionales a participar y no calculan la probabilidad de jugar.
Las bajas no ajustan automaticamente las predicciones de equipos.
Un limite de minutos manual puede restringir la proyeccion individual.
El total de equipo usa una aproximacion normal sin estimar la covarianza entre
total y margen; es experimental y se evalua aparte.

La evaluacion prospectiva informa muestra, faltantes, acierto, Brier, log loss,
errores de puntos y minutos, y frecuencia observada por rango de probabilidad.
Los escenarios complementarios no duplican la muestra de equipos; los registros
individuales tampoco duplican su referencia. Los errores individuales se agrupan
por metrica, no se mezclan puntos con rebotes o triples. No implica rentabilidad.

La comprobacion historica requiere al menos 100 resultados, divide cronologicamente
70% para ajuste y 30% para validacion y guarda el informe aparte. No modifica
la calibracion de octubre. Los datos historicos pueden contener correcciones
posteriores de la fuente; no equivalen a una prueba futura prospectiva.

## Seguridad y rutas

La clave queda solo en memoria y se reconecta desde el campo protegido al reiniciar.
`Verificar plan` conserva solo plan, vigencia, cuota y fecha; no conserva los
datos personales de la cuenta. El JSON exportado no incluye la clave.

- GET `/api/basketball/research/state?league=euroleague&season=2024/2025&lookback=20`
- GET `/api/basketball/research/export`
- POST `/api/basketball/research/access`
- POST `/api/basketball/research/sync`
- POST `/api/basketball/research/availability`
- POST `/api/basketball/research/forecast`
- POST `/api/basketball/research/backtest`
