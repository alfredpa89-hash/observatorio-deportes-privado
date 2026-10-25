import { NBA_SOURCE, parseNbaSchedule, buildNbaReport, parseNbaPlayerBoxscore, normalizeNbaPeriods, validMatch } from './nba.mjs';
import { TENNIS_SOURCE, parseTennisCsv, buildTennisReport } from './tennis.mjs';
import { buildBasketballReport } from './basketball-model.mjs';
import { normalizeTennisIdentities } from './tennis-stats.mjs';

const NBA_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const NBA_SEASONS = ['2026/2027', '2025/2026'];
const TENNIS_SEASONS = ['2026', '2025'];
const CATEGORIES = ['all', 'grand-slam', 'masters-1000', 'atp-500'];
const SURFACES = ['all', 'Hard', 'Clay', 'Grass', 'Carpet'];
const TTL = 6 * 60 * 60 * 1000;
const clean = value => String(value ?? '').trim();
const names = matches => [...new Set(matches.flatMap(match => [match.home || match.player1, match.away || match.player2]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
const unique = matches => [...new Map(matches.map(match => [String(match.id), match])).values()];

export class SportsError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createSportsService({ getStore, persist, parseCsvRows, parseCsvDateTime }) {
  function data(sport) {
    if (!['nba', 'tennis'].includes(sport)) throw new SportsError(400, 'Deporte no válido.');
    const store = getStore();
    store.sports ||= {};
    store.sports[sport] ||= { datasets: {}, manual: {} };
    return store.sports[sport];
  }

  function allowed(sport) { return sport === 'nba' ? NBA_SEASONS : TENNIS_SEASONS; }
  function selectedSeason(sport, value) {
    data(sport);
    const season = clean(value || allowed(sport)[0]);
    if (!allowed(sport).includes(season)) throw new SportsError(400, 'Selecciona una temporada disponible.');
    return season;
  }
  function cutoff(value) {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.valueOf())) throw new SportsError(400, 'Fecha de corte no válida.');
    return date.toISOString();
  }
  function history(sport, season) {
    const rows = unique(Object.entries(data(sport).datasets).filter(([year]) => year <= season).flatMap(([, set]) => set.matches || []));
    return sport === 'tennis' ? normalizeTennisIdentities(rows) : rows;
  }
  function calendar(sport, season) {
    return unique([...(data(sport).datasets[season]?.fixtures || []), ...(data(sport).manual[season] || [])]);
  }
  function participants(sport, season) {
    const results = history(sport, season).filter(match => sport !== 'tennis' || CATEGORIES.includes(match.category));
    return names([...results, ...(data(sport).datasets[season]?.fixtures || [])]);
  }
  function metadata(sport, season) {
    const dataset = data(sport).datasets[season];
    const matches = dataset?.matches || [];
    return {
      season, matchCount: matches.length, historyCount: history(sport, season).length,
      fixtureCount: calendar(sport, season).length, participants: participants(sport, season),
      tournaments: sport === 'tennis' ? [...new Map(history(sport, season).filter(match => CATEGORIES.includes(match.category)).map(match => [match.tournament, {
        name: match.tournament, category: match.category, surface: match.surface, bestOf: match.bestOf,
      }])).values()].filter(tournament => tournament.name).sort((a, b) => a.name.localeCompare(b.name)) : [],
      loadedAt: dataset?.loadedAt || null, source: dataset?.source || null, sourcePage: dataset?.sourcePage || null,
      note: dataset?.note || 'No hay historial cargado para esta temporada.',
      lastResult: matches.map(match => match.date).sort().at(-1) || null,
    };
  }
  function state() {
    return Object.fromEntries(['nba', 'tennis'].map(sport => [sport, {
      source: sport === 'nba' ? { ...NBA_SOURCE, name: 'ESPN', sourcePage: 'https://www.espn.com/nba/scoreboard' } : TENNIS_SOURCE,
      seasons: allowed(sport), datasets: allowed(sport).map(season => metadata(sport, season)),
    }]));
  }

  async function fetchText(url) {
    let response;
    try { response = await fetch(url, { signal: AbortSignal.timeout(20000) }); }
    catch { throw new SportsError(502, 'No se pudo conectar con la fuente gratuita. Los datos guardados no se han borrado.'); }
    if (!response.ok) throw new SportsError(502, `La fuente gratuita respondió ${response.status}. Puedes importar un CSV en su lugar.`);
    const text = await response.text();
    if (!text.trim() || text.length > 12 * 1024 * 1024) throw new SportsError(502, 'La fuente devolvió un archivo vacío o demasiado grande.');
    return text;
  }

  async function downloadNba(season, freshness = false) {
    const previous = data('nba').datasets[season];
    if (previous?.source === 'ESPN' && previous.parserVersion === NBA_SOURCE.parserVersion && Date.now() - new Date(previous.loadedAt).valueOf() < (freshness ? 15 * 60000 : TTL)) return previous;
    const first = Number(season.slice(0, 4));
    const months = [10, 11, 12, 1, 2, 3, 4].map(month => `${month >= 10 ? first : first + 1}${String(month).padStart(2, '0')}`);
    const matches = []; const fixtures = []; const warnings = [];
    let validMonths = 0;
    for (const month of months) {
      try {
        const text = await fetchText(`${NBA_URL}?dates=${month}&limit=400`);
        let payload;
        try { payload = JSON.parse(text); } catch { throw new SportsError(502, 'ESPN no devolvió JSON válido.'); }
        if (!Array.isArray(payload.events) || payload.events.length >= 400) throw new SportsError(502, `El calendario de ${month} no está completo.`);
        const parsed = parseNbaSchedule(payload, { season });
        matches.push(...parsed.matches); fixtures.push(...parsed.fixtures); validMonths += 1;
      } catch (error) { warnings.push(`${month}: ${error.message}`); }
    }
    if (!validMonths || (!matches.length && !fixtures.length)) throw new SportsError(502, 'No se encontraron partidos de temporada regular en la fuente. Se conserva el historial anterior.');
    const result = {
      matches: unique(matches), fixtures: unique(fixtures), loadedAt: new Date().toISOString(), source: 'ESPN',
      parserVersion: NBA_SOURCE.parserVersion,
      sourcePage: 'https://www.espn.com/nba/scoreboard',
      note: `Temporada regular NBA. Puntos finales y estadísticas FT incluyen prórroga; 1Q y descanso usan solo sus periodos. Sin pretemporada, playoffs, All-Star ni final de NBA Cup.${warnings.length ? ` Descarga parcial (${validMonths}/7 meses). ${warnings.join(' ')}` : ''}`,
    };
    if (warnings.length && previous?.matches?.length) {
      result.matches = unique([...previous.matches, ...result.matches]);
      const completed = new Set(result.matches.map(match => match.id));
      result.fixtures = unique([...(previous.fixtures || []), ...result.fixtures]).filter(match => !completed.has(match.id));
    }
    data('nba').datasets[season] = result; await persist();
    return result;
  }

  async function downloadTennis(season, freshness = false) {
    const previous = data('tennis').datasets[season];
    if (previous?.source === 'TennisMyLife' && previous.parserVersion === TENNIS_SOURCE.parserVersion && Date.now() - new Date(previous.loadedAt).valueOf() < (freshness ? 15 * 60000 : TTL)) return previous;
    const url = `https://stats.tennismylife.org/data/${season}.csv`;
    const parsed = parseTennisCsv(await fetchText(url), { season });
    if (previous?.matches?.length >= 100 && parsed.matches.length < previous.matches.length * .75) throw new SportsError(502, 'El archivo de tenis contiene muchos menos resultados de los esperados. Se conserva el historico anterior para revisar la fuente.');
    if (!parsed.matches?.length) throw new SportsError(502, 'El archivo de tenis no contiene resultados válidos.');
    const result = {
      matches: parsed.matches, fixtures: [], loadedAt: new Date().toISOString(), source: 'TennisMyLife', parserVersion: TENNIS_SOURCE.parserVersion,
      sourcePage: 'https://stats.tennismylife.org/tennis-match-database',
      note: parsed.note || TENNIS_SOURCE.dateNote || 'Resultados ATP; las fechas del archivo corresponden a la semana del torneo.',
    };
    data('tennis').datasets[season] = result; await persist();
    return result;
  }

  async function load({ sport, season: input, freshness = false }) {
    const season = selectedSeason(sport, input);
    const seasons = [season, allowed(sport)[allowed(sport).indexOf(season) + 1]].filter(Boolean);
    const warnings = [];
    for (const selected of seasons) {
      try { await (sport === 'nba' ? downloadNba(selected, freshness && selected === season) : downloadTennis(selected, freshness && selected === season)); }
      catch (error) { warnings.push(`${selected}: ${error.message}`); }
    }
    if (!data(sport).datasets[season]) throw new SportsError(502, warnings.join(' '));
    return { sport, season, state: state(), warning: warnings.join(' ') || null };
  }

  function nbaCsv(csv, season) {
    const rows = parseCsvRows(csv);
    const header = rows.shift()?.map(value => clean(value).toLowerCase());
    if (!header || !['date', 'home', 'away', 'home_points', 'away_points'].every(key => header.includes(key))) {
      throw new SportsError(400, 'CSV NBA: se requieren date, home, away, home_points y away_points.');
    }
    const matches = []; const fixtures = []; let skipped = 0;
    const number = value => clean(value) !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    for (const row of rows) {
      const values = Object.fromEntries(header.map((key, index) => [key, row[index] || '']));
      const date = parseCsvDateTime(values.date, values.time, 'America/Guayaquil');
      const home = clean(values.home); const away = clean(values.away);
      if (!date || !home || !away || home.toLowerCase() === away.toLowerCase()) { skipped += 1; continue; }
      const match = { id: `csv:${date}:${home}:${away}`, date, season, home, away,
        homePoints: number(values.home_points), awayPoints: number(values.away_points), source: 'CSV',
        stats: Object.fromEntries(['home', 'away'].map(side => [side, {
          rebounds: number(values[`${side}_rebounds`]), assists: number(values[`${side}_assists`]),
          threePointersMade: number(values[`${side}_threes`]),
          ...normalizeNbaPeriods({ firstQuarterPoints: values[`${side}_q1_points`], halfTimePoints: values[`${side}_ht_points`] }, values[`${side}_points`]),
        }])) };
      if (!season.split('/').includes(date.slice(0, 4))) { skipped += 1; continue; }
      if (clean(values.home_points) === '' && clean(values.away_points) === '') fixtures.push(match);
      else if (Number.isInteger(match.homePoints) && Number.isInteger(match.awayPoints) && match.homePoints > 0 && match.awayPoints > 0 && match.homePoints !== match.awayPoints) matches.push(match);
      else skipped += 1;
    }
    return { matches: unique(matches), fixtures: unique(fixtures), skipped };
  }

  async function importCsv({ sport, season: input, csv }) {
    const season = selectedSeason(sport, input);
    if (typeof csv !== 'string' || csv.length > 10 * 1024 * 1024) throw new SportsError(400, 'Selecciona un CSV válido de hasta 10 MB.');
    let parsed;
    try { parsed = sport === 'nba' ? nbaCsv(csv, season) : parseTennisCsv(csv, { season }); }
    catch (error) { throw new SportsError(400, error.message); }
    if (!parsed.matches?.length && !parsed.fixtures?.length) throw new SportsError(400, 'No hay resultados ni encuentros válidos en el archivo.');
    if (sport === 'tennis' && !parsed.matches.some(match => CATEGORIES.includes(match.category))) throw new SportsError(400, 'El archivo no contiene resultados de Grand Slam, Masters 1000 o ATP 500.');
    data(sport).datasets[season] = {
      matches: parsed.matches || [], fixtures: parsed.fixtures || [], source: 'CSV', loadedAt: new Date().toISOString(),
      note: parsed.note || `Archivo personal importado; ${parsed.skipped || 0} filas inválidas omitidas. NBA incluye prórroga.`,
    };
    await persist();
    return { imported: parsed.matches?.length || 0, skipped: parsed.skipped || 0, state: state(), season };
  }

  function args(body) {
    const { sport } = body;
    const season = selectedSeason(sport, body.season);
    const available = participants(sport, season);
    if (!available.length) throw new SportsError(404, 'Carga el historial gratuito o importa un CSV primero.');
    const home = clean(body.home || body.player1); const away = clean(body.away || body.player2);
    if (!available.includes(home) || !available.includes(away) || home === away) throw new SportsError(400, 'Selecciona dos participantes distintos del historial cargado.');
    const line = Number(body.totalLine ?? (sport === 'nba' ? 220.5 : 22.5));
    if (!Number.isFinite(line) || line <= 0 || line >= (sport === 'nba' ? 500 : 100) || line % 1 !== 0.5) throw new SportsError(400, 'El total debe terminar en .5 y estar dentro del rango del deporte.');
    const result = { sport, season, home, away, player1: home, player2: away, matches: history(sport, season),
      cutoff: cutoff(body.cutoff), lookback: [5, 10, 15, 20, 25, 30].includes(Number(body.lookback)) ? Number(body.lookback) : 10, totalLine: line, gamesLine: line,
      spreadLine: Number(body.spreadLine ?? -3.5), category: body.category || 'all', surface: body.surface || 'all',
      tournament: clean(body.tournament) || null, bestOf: Number(body.bestOf || 3) };
    result.neutralSite = body.neutralSite === true;
    if (!CATEGORIES.includes(result.category) || !SURFACES.includes(result.surface)) throw new SportsError(400, 'Categoría o superficie no válida.');
    if (sport === 'tennis' && ![3, 5].includes(result.bestOf)) throw new SportsError(400, 'El formato debe ser al mejor de 3 o 5 sets.');
    if (!Number.isFinite(result.spreadLine) || Math.abs(result.spreadLine) > 100) throw new SportsError(400, 'Hándicap no válido.');
    return result;
  }
  function build(options) {
    try { return options.sport === 'nba' ? buildBasketballReport({ ...options, league: 'nba' }) : buildTennisReport(options); }
    catch (error) { throw new SportsError(400, error.message); }
  }
  function report(body) {
    const options = args(body); const result = build(options);
    result.meta = { ...result.meta, sport: options.sport, home: options.home, away: options.away,
      providerNote: data(options.sport).datasets[options.season]?.note || '' };
    return result;
  }
  function list(body) {
    const sport = body.sport; const season = selectedSeason(sport, body.season); const selectedCutoff = cutoff(body.cutoff);
    const saved = calendar(sport, season);
    const upcoming = saved.filter(fixture => fixture.date > selectedCutoff).sort((a, b) => a.date.localeCompare(b.date));
    const selected = upcoming.slice(0, 60);
    const fixtures = selected.map(fixture => {
      const home = fixture.home || fixture.player1; const away = fixture.away || fixture.player2;
      const result = report({ ...body, ...fixture, sport, season, home, away, cutoff: selectedCutoff });
      return { ...fixture, home, away, markets: result.markets, analysisCutoff: selectedCutoff };
    });
    return { fixtures, total: upcoming.length, note: fixtures.length
      ? `${fixtures.length} encuentros calculados${upcoming.length > 60 ? ` de ${upcoming.length}; se muestran los 60 más próximos` : ''}.`
      : saved.length ? 'No hay encuentros posteriores al corte seleccionado.' : 'Sin calendario guardado. El historial permite analizar participantes, pero no contiene próximos encuentros confirmados.' };
  }
  async function addFixture(body) {
    const options = args(body); const { sport, season, home, away } = options;
    const date = parseCsvDateTime(body.date, body.time, 'America/Guayaquil');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(body.date)) || !/^\d{2}:\d{2}$/.test(clean(body.time)) || !date || date <= options.cutoff) throw new SportsError(400, 'Indica una fecha y hora válidas posteriores al corte, en Guayaquil.');
    if (!season.split('/').includes(body.date.slice(0, 4))) throw new SportsError(400, 'La fecha no pertenece a la temporada seleccionada.');
    if (calendar(sport, season).some(match => match.date === date && (match.home || match.player1) === home && (match.away || match.player2) === away)) throw new SportsError(409, 'Ese encuentro ya está guardado.');
    const fixture = { id: `manual:${sport}:${season}:${date}:${home}:${away}`, date, season, home, away, player1: home, player2: away, manual: true,
      category: options.category, surface: options.surface, tournament: options.tournament, bestOf: options.bestOf };
    data(sport).manual[season] = [...(data(sport).manual[season] || []), fixture];
    await persist(); return { fixture, state: state() };
  }
  async function removeFixture({ sport, season: input, id }) {
    const season = selectedSeason(sport, input); const saved = data(sport).manual[season] || [];
    if (!saved.some(match => match.id === id)) throw new SportsError(404, 'No se encontró ese encuentro manual.');
    data(sport).manual[season] = saved.filter(match => match.id !== id); await persist();
    return { state: state() };
  }
  async function loadNbaPlayers(body) {
    if (body.sport !== 'nba') throw new SportsError(400, 'Esta carga corresponde a NBA.');
    const season = selectedSeason('nba', body.season);
    const team = clean(body.team);
    if (!participants('nba', season).includes(team)) throw new SportsError(400, 'Selecciona un equipo NBA con historial guardado.');
    const depth = Number(body.lookback ?? 10);
    if (![5, 10, 15, 20, 25, 30].includes(depth)) throw new SportsError(400, 'Selecciona 5, 10, 15, 20, 25 o 30 partidos.');
    if (!['all', 'home', 'away'].includes(body.venue || 'all')) throw new SportsError(400, 'Condición no válida.');
    const time = Math.min(Date.parse(cutoff(body.cutoff)), Date.now());
    const matches = history('nba', season).filter(match => validMatch(match) && Date.parse(match.date) < time &&
      [match.home, match.away].includes(team) && (!body.venue || body.venue === 'all' || match[body.venue] === team))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, depth);
    if (!matches.length) throw new SportsError(404, 'No hay partidos finales anteriores al corte para este equipo.');
    const store = getStore(); const records = []; const cached = new Set(store.nbaPlayerBoxscores || []);
    let downloaded = 0; const warnings = [];
    for (const match of matches) {
      if (cached.has(String(match.id))) continue;
      if (match.source !== NBA_SOURCE.id || !/^\d+$/.test(String(match.id))) {
        warnings.push(`${match.id}: el resultado CSV no tiene un identificador ESPN.`); continue;
      }
      try {
        const parsed = parseNbaPlayerBoxscore(JSON.parse(await fetchText(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${match.id}`)), match);
        if (!parsed.length) throw new Error('Sin registros individuales disponibles.');
        records.push(...parsed); cached.add(String(match.id)); downloaded++;
      } catch (error) { warnings.push(`${match.id}: ${error.message}`); }
    }
    if (downloaded) {
      // Keep personal CSV corrections when a public box score has the same record identity.
      store.playerLogs = [...new Map([...records, ...(store.playerLogs || [])].map(row => [row.id, row])).values()];
      store.nbaPlayerBoxscores = [...cached]; await persist();
    }
    const available = matches.filter(match => cached.has(String(match.id))).length;
    if (!available) throw new SportsError(502, `No se pudieron cargar jugadores. Se conserva lo guardado. ${warnings.join(' ')}`);
    return { team, games: matches.length, available, downloaded, imported: records.length,
      warning: warnings.length ? `${warnings.length} partidos sin box score; puedes completar con CSV.` : null };
  }
  return { state, load, importCsv, report, list, addFixture, removeFixture, loadNbaPlayers };
}
