# Datos de futbol: API-Football y FootyStats

Revision: 10 de octubre de 2026. Uso personal, investigacion prepartido, ventanas de 5/10/15/20 resultados.

## Recomendacion

Empezaria con **un mes de API-Football Pro**, no con una compra anual. Ya tenemos un conector para este proveedor. Es una buena base para calendario, resultados, estadisticas y jugadores por partido, pero **no completa todos los campos de todas nuestras ligas**. Antes de comprar FootyStats o sus CSV, pediria una muestra de Ecuador B, Colombia B y Uruguay con los campos que faltan. Esta recomendacion es una inferencia sobre integracion, coste y cobertura publicada, no una comparacion empirica de exactitud.

## Que se compra

| Opcion | Precio publicado | Limites relevantes | Uso en este programa |
| --- | --- | --- | --- |
| API-Football Pro | US$19/mes | 7.500 consultas/dia; todas las competiciones y endpoints | Conector existente; faltan integraciones de jugadores de futbol y estadisticas por periodo |
| FootyStats API Hobby | GBP 29,99/mes | 50 ligas seleccionadas, 1.800 consultas/hora, todos los endpoints | Necesita un conector nuevo |
| FootyStats Premium y CSV | Confirmar precio y creditos en la cuenta | Premium del sitio no equivale a la API; revisar archivos disponibles y licencia | Importacion con adaptador de columnas; actualizacion manual |

Los precios y limites son los publicados por [API-Football](https://www.api-football.com/pricing) y [FootyStats API](https://footystats.org/api). El plan Hobby permite elegir mas ligas que las solicitadas, pero hay que comprobar como se cuentan temporadas y fases. La tarifa de [Premium](https://footystats.org/premium) puede depender de region y promocion; no traslado un precio regional a tu cuenta de Ecuador. Los [CSV](https://footystats.org/download-stats-csv) pueden consumir creditos. Hay diferencias entre paginas idiomaticas sobre creditos incluidos: confirmarlos en el checkout.

## Ligas

La tabla indica la **matriz publica** de API-Football y el **catalogo** de FootyStats, no la existencia de cada campo en cada encuentro.

| Competicion | API-Football: estadisticas de partido | FootyStats: catalogada |
| --- | --- | --- |
| Premier League, La Liga, Bundesliga, Serie A italiana, Ligue 1 | Si | Si |
| Championship, MLS, Liga MX | Si | Si |
| Ecuador LigaPro | Si | Si |
| Ecuador LigaPro Serie B | **No anunciadas** | Si; comprobar campos |
| Colombia Primera A | Si | Si |
| Colombia Primera B | **No anunciadas** | Si; comprobar campos |
| Brasil Serie A y Serie B | Si | Si |
| Argentina Liga Profesional | Si | Si |
| Peru, Chile, Paraguay y Bolivia: primera division | Si | Si |
| Uruguay Primera Division | Si en la entrada general; **no en la entrada separada Clausura** | Si; comprobar fases |

Fuente: [cobertura detallada API-Football](https://www.api-football.com/coverage), columnas Fixtures Statistics y Fixtures Players, y [catalogo FootyStats](https://footystats.org/api). La matriz tambien anuncia datos individuales de partido salvo Ecuador B, Colombia B y Uruguay. Una marca positiva no garantiza estadisticas completas, todos los historicos o todos los periodos. Pagar un plan superior de API-Football aumenta cuotas; no crea datos que el proveedor no recoge. Verificar temporada e identificador concretos al conectar la cuenta.

## Condiciones del panel

| Dato o escenario | API-Football | FootyStats API | FootyStats CSV de partidos |
| --- | --- | --- | --- |
| Goles FT y al descanso | Marcadores finales y HT | Campos FT y HT | Incluidos en el esquema publicado |
| BTTS, over/under de goles, 1X2 y doble oportunidad | Los calculamos a partir de resultados e historial | Se pueden calcular; incluye indicadores agregados propios | Se pueden calcular con resultados por partido |
| Corners, tiros al arco, faltas | Estadisticas cuando hay cobertura | Campos documentados cuando disponibles | Columnas publicadas, sujetos a disponibilidad |
| Amarillas y rojas separadas | Conteos separados cuando disponibles | Campos separados documentados | Columnas separadas publicadas |
| Offsides | Campo de estadisticas | Campo por equipo documentado | **No aparece en el esquema publicado** |
| Corners 1T | Endpoint de estadisticas con parametro `half`; comprobar cada partido y temporada | Tiempos de corners documentados: solo derivar 1T con eventos completos y periodo identificado | **No aparece como columna por partido**; un agregado de equipo no permite rehacer ultimos 5/15 |
| Jugadores de futbol, ultimos partidos | Fixture Players, condicionado a cobertura | Documentacion individual orientada a agregados de temporada; verificar game logs | Confirmar que el producto comprado tiene una fila por jugador y partido |

Para las estadisticas generales, consultar la [guia de API-Football](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide). El parametro `half` fue anunciado en la [actualizacion de octubre de 2024](https://www.api-football.com/news/post/api-football-new-release-available); no implica cobertura retroactiva completa. FootyStats documenta los datos de conteo y tiempos de corners en [Match Details](https://footystats.org/api/documentations/match-details), y sus agregados de jugador en [Player Individual](https://footystats.org/api/documentations/player-individual). Las limitaciones de CSV corresponden al [esquema publico de descarga](https://footystats.org/download-stats-csv), no a un archivo pagado que hayamos auditado. Pedir un archivo de muestra antes de asumir que estas limitaciones se mantienen o se han resuelto.

**Tarjetas:** FootyStats describe algunos totales agregados contando una roja como dos tarjetas. Nuestro programa suma una amarilla y una roja como una tarjeta cada una. Hay que importar amarillas y rojas separadas y normalizar la definicion; no mezclar totales ponderados con conteos. Los indicadores de BTTS/over de FootyStats son agregados historicos y no demuestran por si mismos una probabilidad futura calibrada. [Esquema CSV](https://footystats.org/download-stats-csv), [definiciones de Match Details](https://footystats.org/api/documentations/match-details).

## Precision y prueba antes de pagar mas

API y CSV son formatos de acceso. Si contienen los mismos encuentros y estadisticas, **el formato no cambia la precision del pronostico**. Lo importante es cobertura real, definiciones consistentes, fechas, correcciones y validacion del modelo. No he contratado ni comparado muestras pagadas, por lo que no hay evidencia para afirmar que un proveedor pronostique mejor.

1. Pedir a ambos una muestra de 20 encuentros consecutivos por liga, no solamente partidos con datos completos. Medir faltantes por campo, periodos y temporadas.
2. Comprobar especialmente Ecuador B, Colombia B, Uruguay, offsides, rojas y corners 1T. El cero real debe distinguirse de un dato desconocido. El tiempo anadido del 1T pertenece al primer periodo.
3. Comparar resultados y conteos contra actas o reportes oficiales. Excluir prorroga cuando el escenario se refiere a 90 minutos.
4. Conseguir 2-3 temporadas para evaluar cronologicamente, sin usar partidos posteriores al pronostico. Comparar Brier, log loss y calibracion por liga y condicion, frente a una referencia sencilla.
5. Usar 5/10/15/20 como ventanas de consulta, no como garantia de precision. Cinco partidos y sucesos raros como varias rojas generan mucha incertidumbre.

Para nuestra primera prueba pagada, API-Football Pro mas almacenamiento local autorizado es mi primera opcion. Un CSV de partidos puede ser un complemento eficiente para historial, pero solo si la muestra realmente llena los huecos. No compraria ambos sin esa comprobacion.

## Licencia y estado del programa

Comprar CSV compra una licencia de uso, no la propiedad de la base. Confirmar uso personal, almacenamiento tras terminar la suscripcion y acceso a correcciones con el proveedor. FootyStats permite ciertos usos en aplicaciones y modelos, pero impone limites a redistribucion y productos competitivos; revisar sus [terminos API](https://footystats.org/api/documentations/terms-of-use-and-legal) y los terminos especificos del CSV comprado.

No hay una clave pagada configurada ni se ha comprado una suscripcion. El programa ya importa resultados y estadisticas FT de API-Football; **todavia no consulta automaticamente corners 1T ni game logs de jugadores de futbol**. Esas conexiones requeririan trabajo adicional cuando confirmemos cobertura real. La clave propia se introduce en el campo local de la aplicacion, no en el chat.
