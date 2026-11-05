# Contexto relevante: futbol, baloncesto y tenis

Implementado el 18 de octubre de 2026 en Encuentros y consultas individuales.
Es una capa descriptiva independiente. No modifica modelos, calibracion,
lineas, entradas o pronosticos sellados de la prueba de octubre.

## Claves del partido

El bloque compartido de Encuentros e Individual muestra ahora un resumen con
filtros de disponibilidad, rendimiento y competicion. El historial detallado,
los reportes y los titulares quedan en apartados desplegables. Cada observacion
conserva fecha, fuente, denominador y faltantes. Una muestra corta o antigua
queda identificada; ausencia de un reporte nunca significa jugador disponible.

Las tendencias comparan los ultimos cinco registros con los cinco anteriores
solo si los diez tienen la metrica. No desplazan la ventana para completar
faltantes. Futbol resume victorias, ambos marcan y gol en primer tiempo donde
haya datos; jugadores, partidos con gol o asistencia. Baloncesto resume forma,
puntos y minutos, incluida la frecuencia de alcanzar la referencia elegida.
Tenis resume victorias y compara aces cuando hay diez observaciones completas.
No se infiere fatiga, lesion, sancion ni motivacion de estas tendencias.

Los reportes admiten un jugador o asunto para que varias bajas del mismo equipo
no se sustituyan entre si. Los ligados a un encuentro solo aparecen en ese
encuentro. Se puede marcar una fuente como revisada por el usuario, volver a
pendiente o retirar un reporte sin borrarlo. Cada accion se conserva con fecha;
una revision posterior no cambia el contexto anterior. Revisado por el usuario
no significa verificado automaticamente ni modifica los pronosticos.

El directorio oficial sigue la competicion de baloncesto y el pais de futbol,
incluidas las fuentes de LigaPro, DIMAYOR, Liga 1, ANFP, AUF, APF, FBF, CBF,
Liga Profesional, MLS, Liga MX, Liga Portugal y Eredivisie. Incluye notas de
ATP y WTA; el enlace WTA no afirma que la app tenga historiales WTA integrados.
Son enlaces externos, no nuevos conectores ni autorizacion para copiar sitios.
La busqueda GDELT admite esos dominios oficiales y conserva sus limites y pausas.
No se ha certificado cobertura de noticias ni una nueva descarga real de ellas.

El analisis individual de futbol recibe cambios de datos en segundo plano,
con agrupacion de avisos y sin ocultar el resultado ni bloquear toda la pantalla.
Una seleccion modificada descarta respuestas antiguas; editar un reporte pospone
el reemplazo. Un fallo conserva el analisis anterior. El catalogo de seleccion
se recarga al abrir la vista, sin reiniciar el formulario en cada avance de lote.

## Tres bloques separados

- Historial: resultados, promedios, tarjetas, minutos y produccion observada,
  con fecha del ultimo dato y denominadores. No confunde una temporada antigua
  con la plantilla o forma actual. Una referencia de puntos de baloncesto es
  un umbral descriptivo elegido por el usuario, no una recomendacion.
- Reportes con fuente: disponibilidad registrada en los paneles existentes
  y nuevas notas de lesiones, sanciones, incidencias medicas, carga o situacion
  del torneo. Cada nota guarda identidad, competicion, temporada, enlace,
  publicacion, registro y vencimiento. No se verifica automaticamente el enlace
  ni el contenido. Son reportes registrados, no hechos certificados por la app.
- Noticias por contrastar: busqueda puntual en GDELT DOC 2.0 de hasta diez
  titulares detectados durante siete dias, limitada a dominios oficiales.
  Solo guarda titular, URL y metadatos; no descarga articulos ni imagenes.

No se deduce lesion de una ausencia, diagnostico de un retiro, sancion vigente
de una roja ni umbral de suspension sumando tarjetas de una muestra parcial.
Un partido de tenis terminado por retiro no identifica por si solo al retirado.
No se afirma motivacion, obligacion de ganar o puntos necesarios para clasificar
sin una fuente, clasificacion y reglas vigentes. Esos casos se registran como
notas con fuente, no como correcciones automaticas de probabilidades.

## Uso y cobertura real

Al abrir un analisis, Contexto relevante lee exclusivamente datos ya guardados.
El icono de periodico consulta noticias de la seleccion; no requiere una clave.
No hay actualizacion masiva ni feed garantizado para todas las ligas o clubes.
Se mantienen enlaces directos a fuentes oficiales cuando el indice no devuelve
noticias. Una seleccion sin titulares no acredita ausencia de novedades.

La integracion GDELT se comprobo con respuestas simuladas. La primera consulta
real a su endpoint el 18 de octubre agoto los diez segundos de espera. Una
prueba puntual posterior, con un limite de espera mayor, resolvio DNS y recibio
HTTP 429 en aproximadamente diez segundos: el proveedor limito la consulta.
No se certifico una descarga real de titulares ni cobertura por competicion.
No se insistio tras ese limite. Los tests simulados no prueban disponibilidad
del servicio externo. No usa claves de API-Football, FootyStats o baloncesto.

Dominios iniciales: UEFA, CONMEBOL, FIFA, Premier League, LaLiga, Bundesliga,
Lega Serie A y Ligue 1 para futbol; NBA, Euroliga y ACB para baloncesto;
ATP, ITF, Wimbledon, Australian Open, Roland-Garros y US Open para tenis.
Se valida el dominio real de cada URL, no una etiqueta suministrada por el indice.
Esta lista no incluye todos los sitios de clubes ni todas las ligas locales.
Se pueden registrar fuentes publicas HTTPS de otras competiciones manualmente.

### Como comprobar una consulta real

1. Abre Encuentros o un historial individual y selecciona equipos o jugador.
2. En Contexto relevante, pulsa el icono del periodico solo cuando este habilitado.
3. Revisa el resultado: HTTP 200 con titulares admisibles confirma esa consulta,
   no cobertura completa ni una lesion. HTTP 200 sin titulares es una respuesta
   valida sin novedades encontradas; no significa que no existan noticias.
4. Ante 429 o un fallo, conserva lo guardado y espera la hora indicada antes de
   volver a pulsar. F5 o cambiar de equipo no debe saltarse la pausa de la fuente.
5. Si persiste el fallo, usa los enlaces oficiales y registra un reporte propio
   con fecha y fuente. No se ha conectado un segundo feed automatico ni se
   sustituye una noticia ausente por un hecho supuesto.

Los tests locales usan respuestas simuladas para no agotar ni depender de la
fuente. Una prueba real debe comprobar ademas HTTP, formato, fechas y dominio;
aprobar los tests locales por si solo no acredita disponibilidad externa.

## Fechas, limites y seguridad

GDELT informa seendate, fecha de deteccion, no una publicacion verificada.
Los titulares son candidatos por busqueda de nombres, no identidades nativas
confirmadas ni reportes de lesion. Nunca entran en evaluaciones o predicciones.
Los cortes de mas de 24 horas anteriores no consultan noticias actuales ni
admiten notas retrospectivas. Una nota registrada despues del corte no existia
para ese corte, aunque el enlace se hubiera publicado antes.

Las notas vencen; la ultima nota o disponibilidad expirada no revive una version
anterior. Las de otro equipo, temporada o encuentro no son aplicables. El contexto
de baloncesto de equipos resume la temporada elegida: no rellena esa temporada
con resultados anteriores. Las referencias individuales pueden incluir las
temporadas anteriores que admite el analizador y lo indican con su fecha real.

GDELT tiene cache de seis horas por consulta exitosa, separacion minima de diez segundos,
limite preventivo de sesenta intentos diarios UTC, diez resultados y 256 KiB por
respuesta. Los errores tambien consumen el intento; no se reintentan en bucle.
La espera maxima es de treinta segundos. Los fallos transitorios pausan todas
las selecciones durante quince minutos; HTTP 429 respeta Retry-After con una
pausa minima de una hora. Cambiar de equipo no evita esa pausa. Al vencerla se
habilita una consulta manual, no una descarga automatica. No se garantiza que
el proveedor ya este disponible cuando termine el plazo.
La interfaz diferencia espera agotada, fallo DNS o de conexion, HTTP rechazado,
servicio caido, respuesta invalida y exito con o sin titulares. Muestra el codigo
HTTP si lo hay, duracion y proxima consulta permitida en hora de Guayaquil.
No guarda mensajes externos, cuerpos de error ni URLs privadas en el diagnostico.
La hora del ultimo exito y los titulares previos se conservan al fallar.
Las caches de fallos anteriores a esta mejora mantienen su pausa de seis horas:
no se borran ni disparan consultas adicionales al actualizar el programa.
Se conservan hasta cien selecciones de noticias y dos mil notas.
No se siguen redirecciones ni se consultan URLs arbitrarias de articulos.
Los enlaces manuales deben ser HTTPS, sin credenciales ni tokens.

## Codigo y rutas

- context-data.mjs: identidad y observaciones de los analizadores existentes.
- research-context.mjs: notas, caducidad, GDELT, limites y cache.
- public/relevant-context.js y .css: componente compartido.
- POST /api/context/summary: lectura local del resumen.
- POST /api/context/news: consulta limitada del indice.
- POST /api/context/report: registro manual con fuente.
- POST /api/context/review: revision humana o retiro, con historial de acciones.
- prematch-context.mjs y context-sources.mjs: resumen descriptivo y directorio.
- public/profile-refresh.js: actualizacion agrupada sin bloquear el analisis.
- research-context.test.mjs y research-context.http.test.mjs: casos simulados,
  temporales, privacidad, fallos, identidad y aislamiento del modelo.

Documentacion de la fuente:
https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
Portal ATP: https://www.atptour.com/en/news/
Portal NBA: https://www.nba.com/news
Portal Euroliga: https://www.euroleaguebasketball.net/euroleague/news/
Portal ACB: https://www.acb.com/
