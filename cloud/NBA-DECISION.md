# Ficha prepartido NBA

En **Baloncesto > Prepartido**, elegir un encuentro futuro. Las condiciones de total, ganador, primer cuarto, descanso y handicap FT alimentan la ficha. Para un jugador, seleccionar su identidad y puntos, rebotes, asistencias, PRA o triples. La muestra y sus faltantes permanecen visibles; una referencia antigua no acredita la plantilla actual.

La ficha compara opcionalmente una cuota decimal anotada por el usuario para la misma condicion, linea y periodo. Requiere casa y hora anterior al inicio. El margen proporcional solo se calcula cuando se anotan todas las opciones del mismo mercado; no es una probabilidad verdadera. El retorno teorico depende de un modelo experimental sin eficacia rentable demostrada. Una cuota positiva no cambia este limite.

**Guardar simulacion antes del partido** sella una copia con hora del servidor, entradas e integridad, al menos cinco minutos antes del inicio. Es independiente del antiguo protocolo de octubre. Los resultados se reconcilian con los datos guardados, se excluyen mercados equivalentes repetidos y se anulan cambios de horario. Un DNP o estadistica ausente no se liquida como derrota. El seguimiento muestra Brier, log loss, frecuencia de cumplimiento y unidades/ROI simulados con cuotas manuales. No representa apuestas realizadas.

## Disponibilidad y actualizacion

El conector NBA Official consulta la pagina oficial de la temporada y descarga como maximo un PDF nuevo por comprobacion, con cache de quince minutos. Comprueba dominio, tamaño y fecha interna; procesa el PDF en un worker limitado. Ante un cambio de formato o fallo conserva lo anterior y pausa los reintentos una hora. Una publicacion de mas de seis horas se marca antigua. Solo vincula identidades verificables de la temporada y un encuentro con la misma hora. Los jugadores no vinculados siguen visibles con el nombre publicado en el reporte del encuentro. La ausencia de un nombre no implica que este disponible. Probable, doubtful y questionable se muestran como participacion por confirmar; ningun parte confirma minutos proyectados ni convocatoria completa.

Los resultados y el calendario usan los conectores existentes. Los individuales NBA gratuitos recientes se actualizan en lotes de hasta cuatro partidos y se revisan por correcciones una vez al dia, preservando correcciones personales CSV. API-Basketball puede complementar con su propia identidad y cobertura comprobada por temporada. Una comprobacion valida de Pro permite volver a revisar las temporadas rechazadas en la sesion gratuita. No se prometen lesiones ni cuartos individuales de API-Basketball.

RotoWire permanece como referencia externa; no se ha conectado su API ni automatizado su extraccion. El inicio de sesion privado y los secretos del servidor conservan su configuracion. Las simulaciones nuevas tienen limites de almacenamiento y no eliminan registros para liberar espacio.
