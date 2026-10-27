import { createHash, randomUUID } from 'node:crypto';
import { SportsError } from './sports.mjs';
import { buildTennisReport } from './tennis.mjs';
import { TENNIS_VERSION, TENNIS_WINDOWS, playerKey, normalizeTennisIdentities, tennisValues, rates, mean } from './tennis-stats.mjs';

const DAY = 86400000, CATEGORIES = ['grand-slam', 'masters-1000', 'atp-500'];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = message => { throw new SportsError(400, message); };
const unique = values => [...new Set(values)];
const text = value => String(value ?? '').trim();
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' });
const day = value => dayFormatter.format(new Date(value));
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
export const TENNIS_METRICS = {
  aces: 'Aces', doubleFaults: 'Dobles faltas', breaks: 'Quiebres logrados', bpFaced: 'Puntos de quiebre enfrentados', bpSaved: 'Puntos de quiebre salvados',
  games: 'Juegos ganados', gamesTotal: 'Juegos del encuentro', setsWon: 'Sets ganados', setsTotal: 'Sets del encuentro',
};
const LINES = { aces: [.5, 1.5, 2.5, 3.5, 4.5, 5.5, 7.5, 9.5, 11.5, 14.5, 19.5], doubleFaults: [.5, 1.5, 2.5, 3.5, 4.5, 5.5, 7.5],
  breaks: [.5, 1.5, 2.5, 3.5, 4.5, 5.5, 7.5], bpFaced: [.5, 2.5, 4.5, 6.5, 8.5, 10.5, 14.5], bpSaved: [.5, 1.5, 2.5, 3.5, 5.5, 7.5, 9.5],
  games: [6.5, 8.5, 10.5, 12.5, 14.5, 16.5, 18.5, 20.5, 24.5, 29.5], gamesTotal: [18.5, 20.5, 22.5, 24.5, 26.5, 28.5, 32.5, 36.5, 40.5, 44.5], setsWon: [.5, 1.5, 2.5], setsTotal: [2.5, 3.5, 4.5] };
const validSeal = snapshot => {
  const { integrity, ...payload } = snapshot;
  return integrity === hash(payload);
};

export function createTennisLab({ getStore, persist, sports, now = () => new Date() }) {
  const clock = () => now().toISOString();
  const read = () => getStore().tennisLab || { fixtures: [], reports: [], snapshots: [], inputs: {}, evaluations: [] };
  const writable = () => (getStore().tennisLab ||= read());
  function config(body = {}) {
    const season = text(body.season || '2026'), lookback = Number(body.lookback ?? 20), bestOf = Number(body.bestOf ?? 3);
    if (!['2026', '2025', '2024'].includes(season) || !TENNIS_WINDOWS.includes(lookback) || ![3, 5].includes(bestOf)) fail('Temporada, historial o formato no valido.');
    const time = Math.min(Date.parse(body.cutoff || clock()), now().getTime());
    if (!Number.isFinite(time)) fail('Fecha de corte no valida.');
    const cutoff = new Date(time).toISOString();
    const surface = body.surface || 'all', category = body.category || 'all', indoor = body.indoor || 'all';
    if (!['all', 'Hard', 'Clay', 'Grass', 'Carpet'].includes(surface) || !['all', ...CATEGORIES].includes(category) || !['all', 'indoor', 'outdoor'].includes(indoor)) fail('Filtro de tenis no valido.');
    return { season, lookback, bestOf, cutoff, surface, category, indoor, tournament: text(body.tournament) };
  }
  function allMatches(season) {
    const sets = getStore().sports?.tennis?.datasets || {};
    const rows = Object.entries(sets).filter(([year]) => year <= season).flatMap(([, set]) => set.matches || []);
    return normalizeTennisIdentities([...new Map(rows.map(row => [row.id, row])).values()]);
  }
  function eligible(c, includeRetired = false) {
    return allMatches(c.season).filter(match => CATEGORIES.includes(match.category) && [1, 2].includes(match.winner) && match.bestOf === c.bestOf && (includeRetired || match.completed !== false && !match.retired) &&
      Date.parse(match.date) < Date.parse(c.cutoff) && Date.parse(match.availableAfter || match.date) < Date.parse(c.cutoff) &&
      (c.surface === 'all' || match.surface === c.surface) && (c.category === 'all' || match.category === c.category) &&
      (!c.tournament || match.tournament === c.tournament) && (c.indoor === 'all' || match.indoor === (c.indoor === 'indoor')));
  }
  function identities(matches) {
    const map = new Map();
    for (const match of matches) for (const side of ['player1', 'player2']) {
      const key = playerKey(match, side);
      if (!map.has(key)) map.set(key, { key, name: match[side], n: 0 });
      map.get(key).n++;
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }
  function coverage(body = {}) {
    const c = config(body), all = allMatches(c.season), selected = eligible(c, true), usable = selected.filter(match => !match.retired && match.completed !== false);
    const players = identities(usable), sets = getStore().sports?.tennis?.datasets || {};
    return { ...c, players, metrics: TENNIS_METRICS, windows: TENNIS_WINDOWS,
      tournaments: unique(all.filter(match => CATEGORIES.includes(match.category)).map(match => match.tournament)).sort(),
      coverage: { results: selected.length, usable: usable.length, excludedRetirements: selected.length - usable.length,
        approximateDates: usable.filter(match => match.datePrecision !== 'match-date').length,
        exactDates: usable.filter(match => match.datePrecision === 'match-date').length,
        serviceMatches: usable.filter(match => [match.stats?.player1?.servePoints, match.stats?.player2?.servePoints].some(positive)).length,
        breakMatches: usable.filter(match => [match.stats?.player1?.bpFaced, match.stats?.player2?.bpFaced].some(value => value !== null && value !== undefined)).length,
        latestTournamentDate: selected.map(match => match.date).sort().at(-1) || null,
        datasets: Object.entries(sets).filter(([year]) => year <= c.season).map(([season, set]) => ({ season, loadedAt: set.loadedAt, source: set.source, parserVersion: set.parserVersion || 1, n: set.matches?.length || 0 })) },
      fixtures: fixtures(c), version: TENNIS_VERSION,
      notice: 'ATP individual. Fechas de semana de torneo no son fechas exactas de partido. Sin feed contratado de calendario ni lesiones.' };
  }
  function history(key, c, matches = eligible(c)) {
    return matches.filter(match => ['player1', 'player2'].some(side => playerKey(match, side) === key))
      .sort((a, b) => (b.availableAfter || b.date).localeCompare(a.availableAfter || a.date) || b.id.localeCompare(a.id)).slice(0, c.lookback)
      .map(match => ({ ...match, opponent: match[playerKey(match, 'player1') === key ? 'player2' : 'player1'], values: tennisValues(match, key) }));
  }
  function availability(key, cutoff) {
    const latest = read().reports.filter(report => report.playerKey === key && report.publishedAt <= cutoff && report.recordedAt <= cutoff)
      .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.recordedAt.localeCompare(b.recordedAt)).at(-1);
    return latest ? { ...latest, stale: latest.expiresAt <= cutoff, status: latest.expiresAt <= cutoff ? 'unknown' : latest.status } : null;
  }
  function profile(body = {}) {
    const c = config(body), matches = eligible(c), key = text(body.playerKey), player = identities(matches).find(player => player.key === key);
    if (!player) fail('Selecciona un jugador con historial anterior al corte.');
    const rows = history(key, c, matches), metric = body.metric || 'aces';
    if (!TENNIS_METRICS[metric]) fail('Estadistica de tenis no valida.');
    const custom = body.line === undefined || body.line === '' ? [] : [Number(body.line)];
    if (custom.some(value => !Number.isFinite(value) || value < .5 || value > 99.5 || value % 1 !== .5)) fail('La linea debe terminar en .5, entre 0.5 y 99.5.');
    // Take the window before excluding absent metrics or incompatible match formats.
    const values = rows.map(row => ['games', 'gamesTotal', 'setsWon', 'setsTotal'].includes(metric) && row.bestOf !== c.bestOf ? null : row.values[metric]);
    const summary = Object.entries(TENNIS_METRICS).map(([field, label]) => {
      const sample = rows.map(row => ['games', 'gamesTotal', 'setsWon', 'setsTotal'].includes(field) && row.bestOf !== c.bestOf ? null : row.values[field]);
      const valid = sample.filter(value => value !== null && Number.isFinite(value));
      return { metric: field, label, average: mean(valid), n: valid.length, missing: rows.length - valid.length };
    });
    const defaults = metric === 'setsTotal' ? c.bestOf === 3 ? [2.5] : [3.5, 4.5] : metric === 'setsWon' ? LINES[metric].filter(line => line < (c.bestOf + 1) / 2) : LINES[metric];
    if (custom.some(line => metric === 'setsWon' && line >= (c.bestOf + 1) / 2 || metric === 'setsTotal' && (line < (c.bestOf + 1) / 2 || line > c.bestOf))) fail('La linea de sets no corresponde al formato seleccionado.');
    const lines = unique([...defaults, ...custom]).sort((a, b) => a - b).flatMap(line => ['over', 'under'].map(direction => ({ line, direction,
      ...rates(values, value => direction === 'over' ? value > line : value < line) })));
    const width = metric === 'aces' || metric.includes('games') ? 5 : metric.includes('sets') ? 1 : 2;
    const ranges = Array.from({ length: 6 }, (_, i) => ({ from: i * width, to: i === 5 ? null : (i + 1) * width - 1,
      ...rates(values, value => value >= i * width && (i === 5 || value < (i + 1) * width)) }));
    const ratios = [['firstIn', 'servePoints', 'Primer servicio dentro'], ['firstWon', 'firstIn', 'Puntos ganados con primero'], ['secondWon', 'secondPlayed', 'Puntos ganados con segundo'],
      ['bpSaved', 'bpFaced', 'Puntos de quiebre salvados'], ['breaks', 'breakChances', 'Puntos de quiebre convertidos'], ['serviceHeld', 'serviceGames', 'Juegos de servicio conservados']]
      .map(([a, b, label]) => {
        const pairs = rows.map(row => [row.values[a], row.values[b]]).filter(pair => pair.every(value => value !== null && Number.isFinite(value)) && pair[0] <= pair[1]);
        const numerator = pairs.reduce((sum, pair) => sum + pair[0], 0), denominator = pairs.reduce((sum, pair) => sum + pair[1], 0);
        return { label, numerator, denominator, percentage: denominator ? 100 * numerator / denominator : null, n: pairs.length, missing: rows.length - pairs.length };
      });
    const exact = matches.filter(match => match.datePrecision === 'match-date' && ['player1', 'player2'].some(side => playerKey(match, side) === key));
    const recent = days => exact.filter(match => Date.parse(match.date) >= Date.parse(c.cutoff) - days * DAY);
    const timed = recent(14).map(match => match.minutes).filter(positive);
    const last = [...exact].sort((a, b) => b.date.localeCompare(a.date))[0];
    const rankRow = rows.find(row => row.rankings?.[playerKey(row, 'player1') === key ? 'player1' : 'player2']);
    return { ...c, player, metric, summary, ratios, lines, ranges, history: rows,
      record: { wins: rows.filter(row => row.values.won).length, losses: rows.filter(row => !row.values.won).length, n: rows.length },
      context: { exactDateMatches: exact.length, matches7Days: exact.length ? recent(7).length : null, matches14Days: exact.length ? recent(14).length : null,
        minutes14Days: timed.length ? timed.reduce((a, b) => a + b, 0) : null, durationMatches: timed.length,
        daysSinceLast: last ? Math.floor((Date.parse(c.cutoff) - Date.parse(last.date)) / DAY) : null,
        historicalRanking: rankRow ? { rank: rankRow.rankings[playerKey(rankRow, 'player1') === key ? 'player1' : 'player2'], date: rankRow.date } : null,
        availability: availability(key, c.cutoff) },
      warnings: [`${rows.length} de ${c.lookback} partidos solicitados; cada estadistica usa su propia muestra.`,
        'Frecuencias historicas con intervalo Wilson 95 %, no probabilidades calibradas del siguiente partido.',
        'Ranking historico, no ranking actual. Ausencia de reporte no confirma disponibilidad.',
        ...(rows.some(row => row.datePrecision !== 'match-date') ? ['Hay fechas por semana del torneo; no sirven para confirmar descanso ni carga diaria.'] : []),
        ...(rows.length && Date.parse(c.cutoff) - Date.parse(rows[0].availableAfter || rows[0].date) > 90 * DAY ? ['Historial antiguo: mas de 90 dias desde la ultima disponibilidad de datos de la muestra.'] : [])] };
  }
  function comparison(body = {}) {
    const c = config(body), a = profile({ ...body, playerKey: body.player1Key }), b = profile({ ...body, playerKey: body.player2Key });
    if (a.player.key === b.player.key) fail('Selecciona dos jugadores distintos.');
    const gamesLine = Number(body.gamesLine ?? (c.bestOf === 5 ? 38.5 : 22.5));
    if (!Number.isFinite(gamesLine) || gamesLine < .5 || gamesLine > 99.5 || gamesLine % 1 !== .5) fail('El total de juegos debe terminar en .5, entre 0.5 y 99.5.');
    const matches = eligible(c), forecast = buildTennisReport({ ...c, gamesLine, matches, player1: a.player.name, player2: b.player.name });
    const scenarios = [];
    for (const [metric, label] of [['firstSetWon', 'Gana primer set'], ['anySetWon', 'Gana al menos un set'], ['tieBreak', 'Hay tie-break']]) {
      for (const player of [a, b]) scenarios.push({ group: 'sets', label: `${player.player.name}: ${label.toLowerCase()}`, ...rates(player.history.map(row => row.bestOf === c.bestOf ? row.values[metric] : null), value => value === 1) });
    }
    for (const [field, label, lines] of [['gameMargin', 'juegos', [-5.5, -3.5, -1.5, 1.5, 3.5, 5.5]], ['setMargin', 'sets', c.bestOf === 3 ? [-1.5, -.5, .5, 1.5] : [-2.5, -1.5, -.5, .5, 1.5, 2.5]]]) {
      for (const player of [a, b]) for (const line of lines) scenarios.push({ group: 'handicap', label: `${player.player.name} ${line > 0 ? '+' : ''}${line} ${label}`,
        ...rates(player.history.map(row => row.bestOf === c.bestOf ? row.values[field] : null), value => value + line > 0) });
    }
    for (const player of [a, b]) for (let lost = 0; lost < (c.bestOf + 1) / 2; lost++) scenarios.push({ group: 'sets',
      label: `${player.player.name}: gana ${(c.bestOf + 1) / 2}-${lost} en sets`,
      ...rates(player.history.map(row => row.values.setsWon === null || row.values.setsAgainst === null ? null : Number(row.values.setsWon === (c.bestOf + 1) / 2 && row.values.setsAgainst === lost)), value => value === 1) });
    return { ...c, a, b, estimates: forecast.markets, scenarios,
      h2h: matches.filter(match => [playerKey(match, 'player1'), playerKey(match, 'player2')].includes(a.player.key) && [playerKey(match, 'player1'), playerKey(match, 'player2')].includes(b.player.key)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, c.lookback),
      note: 'Elo y totales suavizados son experimentales, sin calibracion. Los escenarios y handicaps adicionales son frecuencias individuales frente a rivales historicos, no pronosticos del duelo.' };
  }
  function publicUrl(value) {
    let url; try { url = new URL(value); } catch { fail('Incluye una URL publica de la fuente.'); }
    if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/i.test(url.hostname) || url.href.length > 2000) fail('La fuente debe ser una URL HTTPS publica, sin credenciales.');
    return url.href;
  }
  async function saveAvailability(body) {
    const c = config(body), player = identities(eligible(c)).find(player => player.key === body.playerKey);
    if (!player || !['unknown', 'available', 'questionable', 'out'].includes(body.status)) fail('Selecciona jugador y estado de disponibilidad.');
    if (![body.publishedAt, body.expiresAt].every(value => /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value || '') && Number.isFinite(Date.parse(value)))) fail('Publicacion y vigencia deben incluir fecha, hora y zona horaria.');
    const publishedAt = new Date(body.publishedAt).toISOString(), expiresAt = new Date(body.expiresAt).toISOString(), recordedAt = clock();
    if (publishedAt > recordedAt || expiresAt <= recordedAt || Date.parse(expiresAt) - Date.parse(publishedAt) > 7 * DAY) fail('El reporte debe estar publicado y tener vigencia de hasta siete dias.');
    const report = { id: randomUUID(), playerKey: player.key, name: player.name, status: body.status, sourceUrl: publicUrl(body.sourceUrl), publishedAt, expiresAt, recordedAt, note: text(body.note).slice(0, 500) };
    writable().reports.push(report); await persist(); return report;
  }
  function fixtures(c) {
    const legacy = getStore().sports?.tennis?.manual?.[c.season] || [];
    return [...read().fixtures, ...legacy].filter(row => row.season === c.season).sort((a, b) => a.date.localeCompare(b.date));
  }
  async function addFixture(body) {
    const c = config(body), players = identities(eligible(c)), a = players.find(player => player.key === body.player1Key), b = players.find(player => player.key === body.player2Key);
    if (!a || !b || a.key === b.key) fail('Elige dos jugadores con historial.');
    if (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(body.date || '') || !Number.isFinite(Date.parse(body.date))) fail('Se necesita fecha, hora y zona horaria verificadas.');
    const date = new Date(body.date).toISOString();
    if (date <= clock() || date.slice(0, 4) !== c.season || c.surface === 'all' || c.category === 'all' || !c.tournament) fail('Completa torneo, superficie, categoria y una fecha futura de la temporada.');
    if (fixtures(c).some(row => row.date === date && [row.player1Key, row.player2Key].includes(a.key) && [row.player1Key, row.player2Key].includes(b.key))) fail('Ese encuentro ya esta guardado.');
    const fixture = { id: randomUUID(), season: c.season, player1: a.player1 || a.name, player2: b.name, player1Key: a.key, player2Key: b.key,
      date, timeKnown: true, sourceUrl: publicUrl(body.sourceUrl), registeredAt: clock(), tournament: c.tournament, category: c.category, surface: c.surface, indoor: c.indoor, bestOf: c.bestOf };
    writable().fixtures.push(fixture); await persist(); return fixture;
  }
  async function removeFixture(body) {
    const fixture = read().fixtures.find(row => row.id === body.id);
    if (!fixture) fail('Encuentro no encontrado.');
    if (read().snapshots.some(row => row.fixture.id === fixture.id)) fail('Un encuentro con pronostico sellado se conserva para evaluacion.');
    writable().fixtures = read().fixtures.filter(row => row.id !== fixture.id); await persist(); return { removed: true };
  }

  function snapshotValid(snapshot) {
    return validSeal(snapshot) && snapshot.version === TENNIS_VERSION && read().inputs[snapshot.inputHash] && hash(read().inputs[snapshot.inputHash]) === snapshot.inputHash &&
      Date.parse(snapshot.createdAt) <= Date.parse(snapshot.fixture.date) - 5 * 60000;
  }
  async function prepare(body = {}) {
    daily(body);
    const c = config(body), results = [], skipped = [];
    for (const fixture of fixtures(c).filter(row => row.date > clock() && Date.parse(row.date) <= now().getTime() + 36 * 3600000)) {
      if (read().snapshots.some(row => row.fixture.id === fixture.id)) continue;
      if (!fixture.timeKnown || !fixture.sourceUrl || !Number.isFinite(Date.parse(fixture.registeredAt)) || fixture.registeredAt > clock() || Date.parse(fixture.date) - now().getTime() < 5 * 60000) { skipped.push({ id: fixture.id, reason: 'Hora o fuente no verificada, o menos de cinco minutos antes del inicio.' }); continue; }
      const options = { season: fixture.season, surface: fixture.surface, indoor: fixture.indoor || 'all', category: 'all', tournament: '', bestOf: fixture.bestOf, lookback: 20, cutoff: clock() };
      const scoped = eligible(config(options)), players = identities(scoped), a = players.find(row => row.key === fixture.player1Key), b = players.find(row => row.key === fixture.player2Key);
      if (!a || !b || [a, b].some(player => availability(player.key, options.cutoff)?.status === 'out')) { skipped.push({ id: fixture.id, reason: 'Sin historial o baja reportada.' }); continue; }
      const report = buildTennisReport({ ...options, matches: scoped, player1: a.name, player2: b.name, gamesLine: fixture.bestOf === 5 ? 38.5 : 22.5 });
      const markets = report.markets.filter(row => row.probability !== null && row.samples.home >= 5 && row.samples.away >= 5).map(row => ({ id: row.id, group: row.group, label: row.label, probability: row.probability, n: row.n }));
      if (!markets.some(row => row.group === 'resultado')) { skipped.push({ id: fixture.id, reason: 'Muestra insuficiente: minimo cinco partidos validos por jugador y diez de contexto.' }); continue; }
      const evidence = { matches: scoped, config: options, availability: [availability(a.key, options.cutoff), availability(b.key, options.cutoff)] }, inputHash = hash(evidence);
      const totals = [...new Map([...report.history.home, ...report.history.away].filter(row => row.bestOf === fixture.bestOf && Number.isFinite(row.totalGames)).map(row => [row.id, row])).values()];
      const snapshot = { id: randomUUID(), version: TENNIS_VERSION, fixture: structuredClone(fixture), createdAt: clock(), inputHash, markets, expectedGames: mean(totals.map(row => row.totalGames)),
        note: 'Experimental, no calibrado. Ventana prospectiva fija 20, por superficie, formatos separados. Sin pronosticos de lesiones.' };
      snapshot.integrity = hash(snapshot); writable().inputs[inputHash] = structuredClone(evidence); writable().snapshots.push(snapshot); results.push(snapshot.id);
    }
    if (results.length) await persist();
    return { prepared: results.length, skipped, daily: daily(body) };
  }
  function outcomes(snapshot, result) {
    const a = tennisValues(result, snapshot.fixture.player1Key), values = [];
    for (const market of snapshot.markets) {
      let outcome = null;
      if (market.id === 'player1-win') outcome = a.won;
      else if (market.id === 'player2-win') outcome = 1 - a.won;
      else {
        const parsed = market.id.match(/^(games|sets)-(over|under)-([\d.]+)$/);
        if (parsed) { const value = parsed[1] === 'games' ? result.totalGames : result.totalSets; if (Number.isFinite(value)) outcome = Number(parsed[2] === 'over' ? value > Number(parsed[3]) : value < Number(parsed[3])); }
      }
      values.push({ ...market, outcome });
    }
    return values;
  }
  function resolve(snapshot) {
    const { fixture } = snapshot;
    const matches = allMatches(fixture.season).filter(match => match.datePrecision === 'match-date' && match.tournament === fixture.tournament && day(match.date) === day(fixture.date) &&
      [playerKey(match, 'player1'), playerKey(match, 'player2')].includes(fixture.player1Key) && [playerKey(match, 'player1'), playerKey(match, 'player2')].includes(fixture.player2Key) &&
      Date.parse(match.availableAfter || match.date) < now().getTime());
    if (matches.length !== 1) return null;
    return matches[0];
  }
  function evaluation() {
    const groups = new Map(), exclusions = { invalid: 0, pending: 0, retired: 0, formatChanged: 0, rescheduled: 0 }, errors = [];
    for (const snapshot of read().snapshots) {
      if (!snapshotValid(snapshot)) { exclusions.invalid++; continue; }
      const result = resolve(snapshot);
      if (!result) { exclusions.pending++; continue; }
      if (result.timeKnown && Math.abs(Date.parse(result.date) - Date.parse(snapshot.fixture.date)) > 6 * 3600000) { exclusions.rescheduled++; continue; }
      if (result.retired || result.completed === false) { exclusions.retired++; continue; }
      if (result.bestOf !== snapshot.fixture.bestOf) { exclusions.formatChanged++; continue; }
      if (Number.isFinite(result.totalGames) && Number.isFinite(snapshot.expectedGames)) errors.push(Math.abs(result.totalGames - snapshot.expectedGames));
      for (const group of unique(snapshot.markets.map(row => row.group))) {
        const market = outcomes(snapshot, result).filter(row => row.group === group).sort((a, b) => b.probability - a.probability)[0];
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(market);
      }
    }
    return { version: TENNIS_VERSION, snapshots: read().snapshots.length, groups: [...groups].map(([group, rows]) => ({ group, ...metrics(rows) })),
      exclusions, gamesMAE: mean(errors), gamesN: errors.length, historical: read().evaluations.at(-1) || null };
  }
  function daily(body = {}) {
    const date = body.date || day(clock());
    if (!/^\d{4}-\d\d-\d\d$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || day(`${date}T12:00:00Z`) !== date || date < day(clock()) || Date.parse(`${date}T05:00:00Z`) > now().getTime() + 7 * DAY) fail('Selecciona hoy o una fecha de los proximos siete dias.');
    const picks = [];
    for (const snapshot of read().snapshots) {
      if (!snapshotValid(snapshot) || day(snapshot.fixture.date) !== date || snapshot.fixture.date <= clock() ||
        [snapshot.fixture.player1Key, snapshot.fixture.player2Key].some(key => availability(key, clock())?.status === 'out')) continue;
      for (const group of unique(snapshot.markets.map(row => row.group))) {
        const market = snapshot.markets.filter(row => row.group === group).sort((a, b) => b.probability - a.probability)[0];
        picks.push({ ...market, fixture: snapshot.fixture, createdAt: snapshot.createdAt, snapshotId: snapshot.id });
      }
    }
    return { date, picks: picks.sort((a, b) => b.probability - a.probability), evaluation: evaluation(),
      notice: 'Una seleccion por grupo y partido, no apuestas independientes. Pronosticos experimentales, sin calibrar. No se rellenan encuentros ya iniciados.' };
  }
  async function backtest(body = {}) {
    const c = config(body), matches = eligible(c).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    if (matches.length < 30) fail('Se necesitan al menos treinta resultados para separar historial y validacion.');
    const split = Math.floor(matches.length * .7), candidates = matches.slice(split).slice(-200), rows = [], pointErrors = [];
    let skipped = 0;
    for (const match of candidates) {
      // Source files put the winner first; calibration needs an outcome-independent side.
      const first = playerKey(match, 'player1').localeCompare(playerKey(match, 'player2')) < 0;
      const report = buildTennisReport({ matches, season: c.season, cutoff: match.date, lookback: c.lookback, surface: c.surface, category: c.category, bestOf: match.bestOf,
        player1: first ? match.player1 : match.player2, player2: first ? match.player2 : match.player1, gamesLine: match.bestOf === 5 ? 38.5 : 22.5 });
      const winner = report.markets.find(row => row.id === 'player1-win');
      if (winner?.probability === null || winner?.n < 5) { skipped++; continue; }
      rows.push({ probability: winner.probability, outcome: Number(match.winner === (first ? 1 : 2)) });
      const previous = [...new Map([...report.history.home, ...report.history.away].filter(row => row.bestOf === match.bestOf && Number.isFinite(row.totalGames)).map(row => [row.id, row])).values()];
      if (Number.isFinite(match.totalGames) && previous.length) pointErrors.push(Math.abs(match.totalGames - mean(previous.map(row => row.totalGames))));
    }
    const result = { at: clock(), version: TENNIS_VERSION, sideRule: 'stable-player-id', config: c, split, candidates: candidates.length, skipped, ...metrics(rows), gamesMAE: mean(pointErrors), gamesN: pointErrors.length,
      note: 'Validacion temporal sobre el 30 % final (maximo 200 encuentros). Cada caso usa solo resultados disponibles antes de su fecha; las semanas usan margen conservador. Sin ajuste de parametros ni calibracion. Referencia de ganador 50 %: Brier 0.25 y log loss 0.6931. No demuestra rentabilidad.' };
    writable().evaluations.push(result); await persist(); return result;
  }
  async function refresh(body = {}) { const result = await sports.load({ sport: 'tennis', season: config(body).season, freshness: body.freshness === true }); return { warning: result.warning, state: coverage(body) }; }
  return { coverage, profile, comparison, addFixture, removeFixture, saveAvailability, prepare, daily, evaluation, backtest, refresh };
}

function metrics(rows) {
  const valid = rows.filter(row => row.outcome !== null && Number.isFinite(row.probability)), probabilities = valid.map(row => row.probability / 100);
  const bins = Array.from({ length: 10 }, (_, i) => {
    const sample = valid.filter(row => row.probability >= i * 10 && (i === 9 ? row.probability <= 100 : row.probability < (i + 1) * 10));
    return { from: i * 10, to: (i + 1) * 10, n: sample.length, predicted: mean(sample.map(row => row.probability)), observed: sample.length ? 100 * mean(sample.map(row => row.outcome)) : null,
      interval: rates(sample.map(row => row.outcome), value => value === 1).interval };
  });
  return { n: valid.length, missing: rows.length - valid.length, accuracy: valid.length ? 100 * mean(valid.map(row => Number((row.probability >= 50) === Boolean(row.outcome)))) : null,
    brier: mean(valid.map((row, i) => (probabilities[i] - row.outcome) ** 2)), logLoss: mean(valid.map((row, i) => -Math.log(Math.max(1e-12, row.outcome ? probabilities[i] : 1 - probabilities[i])))), bins };
}
