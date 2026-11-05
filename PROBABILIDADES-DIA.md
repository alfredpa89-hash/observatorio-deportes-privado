# Probabilidades del dia: baloncesto

Vista privada `Baloncesto > Probabilidades del dia`. Version de seleccion
`basketball-daily-v1`. No modifica el modelo, las lineas ni la calibracion de la
prueba congelada de octubre. No consulta la API ni compra servicios.

- Fecha en America/Guayaquil: hoy y los proximos siete dias. No se reconstruyen
  pronosticos de fechas pasadas. Solo calendario guardado, confirmado, programado
  y con al menos cinco minutos antes del inicio. Sin pretemporada ni muestras
  tecnicas de referencia. Un calendario vacio no acredita ausencia de partidos.
- Lee pronosticos sellados de octubre y del archivo de investigacion. Comprueba
  hashes de entradas, version y sellado anterior al inicio. Excluye invalidos,
  partidos ya empezados, cancelados, ausentes y reprogramaciones.
- Precedencia de octubre para un escenario duplicado. Una seleccion por familia,
  periodo y linea: se muestra el lado de mayor probabilidad. Under individual y
  total de equipo son complementos exclusivamente en lineas .5; no se buscan
  lineas extremas para inflar los porcentajes. No son cuotas de casas.
- Preparar dia sella estimaciones nuevas solo en el archivo independiente,
  ventana 20, con lineas declaradas y fijas. Reutiliza sellados existentes, sin
  sobreescribirlos ni cambiar su ventana. Maximo 20 encuentros por solicitud.
  Endesa conserva su archivo, pero no tiene modelo predictivo validado.
- Jugadores: roster del ultimo partido registrado de su equipo en la temporada
  actual, aparicion actual y al menos cinco valores para cada metrica. Minutos
  proyectados no son minutos confirmados. Historicos viejos, DNP y faltantes no
  acreditan disponibilidad actual. Los modelos individuales son condicionales
  a participar; no hay feed automatico de lesiones.
- Un reporte manual vigente de baja o un limite menor a los minutos proyectados
  retira la seleccion visible sin modificar el pronostico sellado. Reportes
  vencidos no reactivan reportes anteriores. En duda/no verificado se muestran.
- Filtros de competicion, equipos/jugadores, escenario, periodo y probabilidad
  minima. Muestra, ventana, faltantes, calibracion, minutos, fuente y fecha de
  sellado por registro. Orden descendente y exportacion CSV de todos los registros
  que coinciden con los filtros, no solo de la pagina visible.
- No es una recomendacion de apuesta ni prueba de rentabilidad. Selecciones de
  un mismo partido estan relacionadas. Mayor porcentaje no significa mayor valor
  sin precios/ cuotas y validacion futura. La lista es experimental.

Rutas: GET `/api/basketball/daily?day=YYYY-MM-DD&league=all&kind=all` y
POST `/api/basketball/daily/prepare` con los mismos filtros JSON.
