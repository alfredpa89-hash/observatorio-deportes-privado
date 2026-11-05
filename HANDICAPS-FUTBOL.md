# Handicaps de futbol

Disponible en Encuentros, Lista de encuentros y el analisis Individual de un
equipo, para todas las ligas guardadas con goles suficientes. El primer tiempo
usa sus propios marcadores al descanso: nunca se obtiene dividiendo el total.
No modifica baloncesto, tenis, sus modelos ni los archivos de evaluacion.

## Lineas y orientacion

- Europeo: enteros -3, -2, -1, 0, +1, +2 y +3. Tres resultados despues del ajuste:
  gana local, empate con handicap o gana visitante. El empate no es una devolucion.
  En Encuentros la linea se aplica siempre al local; en Individual, al equipo
  seleccionado aunque haya jugado de visitante en su historial.
- Asiatico: desde -2 hasta +2 en pasos de 0.25, seleccionando equipo y linea.
  Las lineas enteras pueden devolver; las medias no. Las de cuarto se reparten
  en las dos lineas enteras/medias adyacentes. Por ejemplo, -0.75 equivale a -1
  y -0.5, y +0.25 equivale a 0 y +0.5. La linea mostrada se aplica al equipo
  nombrado, no a su rival.
- Ambos admiten hasta 20 lineas personalizadas por tipo y periodo entre -10 y
  +10. El europeo exige enteros; el asiatico permite pasos de 0.25. Las lineas
  repetidas se cuentan una sola vez.

Ejemplo: un equipo gana 1-0 con -1 europeo: el resultado ajustado es empate.
Con -1 asiatico se devuelve; con -0.75 es media victoria; con -1.25 es media
perdida. Si empata con -0.25 asiatico, es media perdida, no derrota completa.

## Porcentajes y muestras

Encuentros calcula una distribucion usando el mismo modelo de goles Poisson ya
existente. Europeo reparte el 100% entre tres resultados. Asiatico lo reparte
entre victoria completa, media victoria, devolucion, media perdida y derrota.
Los porcentajes se redondean conjuntamente a una decima para conservar el 100%.
El porcentaje principal y la ordenacion asiaticos usan **solo victoria completa**.
Una linea muy favorable puede tener mayor porcentaje sin ser una buena apuesta:
no se incorporan cuotas, valor esperado ni rentabilidad.

El modelo requiere al menos 10 resultados de liga y 3 de cada equipo con datos
del periodo. Si faltan, devuelve `s/d`, no 0%. Conserva sus criterios previos de
muestra reducida. Los conteos historicos se orientan al escenario: en un mercado
del visitante, el historial del local cuenta resultados de sus rivales, y el
historial del visitante cuenta los del propio visitante.

Individual muestra frecuencias historicas del equipo seleccionado, sin ajuste
por rival y sin presentarlas como pronosticos calibrados. Se muestran conteos
por categoria y sus porcentajes desde tres partidos validos. Las ventanas de
5, 10, 15, 20, 25 y 30, la condicion local/visitante, la liga y el corte temporal
se respetan. Si falta el marcador del periodo, queda fuera del denominador;
un 0-0 confirmado si cuenta. Los datos imposibles al descanso se excluyen.

El periodo completo utiliza el marcador reglamentario normalizado por la fuente,
sin convertir prorroga o penaltis en goles de 90 minutos. Estos escenarios se
calculan con lo guardado y no requieren nuevas consultas API. La exportacion de
Encuentros identifica tipo, linea, significado y cinco probabilidades asiaticas.

## Referencias de reglas

- [Betfair: handicap europeo, tres resultados](https://support.betfair.com/app/answers/detail/a_id/6555/).
- [Betfair: handicap asiatico y lineas divididas](https://support.betfair.com/app/answers/detail/a_id/6418).

Estas referencias explican la liquidacion matematica; la app no ejecuta apuestas.
Pruebas reproducibles: `node --test football-handicap.test.mjs model.test.mjs profiles.test.mjs`.
