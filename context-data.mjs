import { SportsError } from './sports.mjs';
import { buildIndividualProfile } from './profiles.mjs';
import { combineFootballHistory, canonicalTeam } from './football-history.mjs';
import { playerKey as tennisKey } from './tennis-stats.mjs';
import { performanceSignals } from './prematch-context.mjs';

const fail = message => { throw new SportsError(400, message); };
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const num = value => numeric(value) ? value.toLocaleString('es-EC', { maximumFractionDigits: 1 }) : 's/d';
const date = value => value ? new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short' }).format(new Date(value)) : 's/d';
const tennisDate = row => row.datePrecision === 'tournament-week' ? `${row.date.slice(0, 10)} (semana del torneo)` : date(row.date);
const average = values => { const valid = values.filter(numeric); return { n: valid.length, average: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null }; };
const fact = (label, text, n = null, source = 'Historial guardado') => ({ label, text, n, source });
function playerFacts(history, sport, referencePoints) {
  const last = history[0], facts = [];
  if (!last) return facts;
  const minutes = average(history.map(row => row.minutes));
  facts.push(fact('Ultima participacion', `${date(last.date)} / ${last.opponent || 'Rival no informado'} / ${num(last.minutes)} min`, 1, last.source));
  if (minutes.n) facts.push(fact('Carga registrada', `Media ${num(minutes.average)} min por participacion`, minutes.n));
  for (const [key, label] of sport === 'basketball' ? [['points', 'Puntos'], ['rebounds', 'Rebotes'], ['assists', 'Asistencias'], ['pra', 'PRA']]
    : [['goals', 'Goles'], ['assists', 'Asistencias'], ['yellow', 'Amarillas'], ['red', 'Rojas']]) {
    const sample = average(history.map(row => row.values?.[key]));
    if (sample.n) facts.push(fact(label, `Ultimo: ${num(last.values?.[key])} / media de la muestra: ${num(sample.average)}`, sample.n));
  }
  if (sport === 'basketball' && referencePoints !== null && numeric(last.values?.points)) {
    facts.push(fact('Referencia de puntos', `${last.values.points >= referencePoints ? 'Alcanzo' : 'No alcanzo'} ${referencePoints} puntos en la ultima participacion. No es un pronostico.`, 1, last.source));
  }
  return facts;
}
export function createContextReader({ getStore, footballPlayers, basketballPrematch, basketballPlayers, readBasketball, tennisLab, now = () => new Date() }) {
  return function read(body = {}) {
    const sport = body.sport === 'nba' ? 'basketball' : body.sport;
    if (!['football', 'basketball', 'tennis'].includes(sport)) fail('Deporte de contexto no valido.');
    const kind = sport === 'tennis' ? 'player' : body.kind || 'team';
    if (!['team', 'player'].includes(kind)) fail('Tipo de identidad no valido.');
    const lookback = body.lookback === 'season' ? 30 : Number(body.lookback ?? 20);
    if (![5, 10, 15, 20, 25, 30].includes(lookback)) fail('Ventana de contexto no valida.');
    const time = Date.parse(body.cutoff || now().toISOString());
    if (!Number.isFinite(time) || time > now().getTime() + 1000) fail('Corte de contexto no valido o futuro.');
    const cutoff = new Date(time).toISOString(), season = String(body.season || '');
    const fixtureId = body.fixtureId == null ? null : String(body.fixtureId);
    if (fixtureId !== null && (!fixtureId.length || fixtureId.length > 160 || /[\s<>]/.test(fixtureId))) fail('Identidad de encuentro no valida.');
    const key = String(body.key || body.leagueKey || body.league || (sport === 'tennis' ? 'atp' : body.sport === 'nba' ? 'nba' : ''));
    const referencePoints = body.referencePoints == null || body.referencePoints === '' ? null : Number(body.referencePoints);
    if (referencePoints !== null && (sport !== 'basketball' || kind !== 'player' || !numeric(referencePoints) || referencePoints > 100)) fail('Referencia de puntos no valida.');
    const requested = body.names || [body.name || body.team].filter(Boolean);
    if (!Array.isArray(requested) || requested.length > 2 || requested.some(name => typeof name !== 'string' || name.length > 160)) fail('Selecciona hasta dos identidades del archivo.');
    let scopeKey = key, scopeSeason = season, country, sourceScopes = [{ key, season }], entities = [];
    const common = { season, lookback, cutoff, venue: body.venue || 'all' };
    if (sport === 'football') {
      const raw = getStore(), combined = combineFootballHistory(raw);
      const store = raw.leagues?.[key] ? raw : combined, league = store.leagues?.[key];
      if (!league || !league.seasons.some(value => String(value) === season)) fail('Competicion o temporada de futbol no guardada.');
      const competition = Object.values(combined.leagues).find(row => row.key === key || row.sourceKeys.includes(key));
      scopeKey = competition?.key || key; country = league.country;
      scopeSeason = Object.entries(competition?.sourceSeasons || {}).find(([label, refs]) => label === season || refs.some(ref => ref.leagueKey === key && String(ref.season) === season))?.[0] || season;
      sourceScopes = [{ key: scopeKey, season: scopeSeason }, ...(competition?.sourceSeasons?.[scopeSeason] || []).map(ref => ({ key: ref.leagueKey, season: String(ref.season) }))];
      if (kind === 'team') {
        const teams = new Set([...(league.teamsBySeason?.[season] || []), ...store.matches.filter(row => row.leagueKey === key && String(row.season) === season).flatMap(row => [row.home, row.away])]);
        for (const name of [...new Set(requested)]) {
          if (!teams.has(name)) fail('Selecciona un equipo de esta competicion y temporada.');
          const report = buildIndividualProfile({ ...common, sport, kind, name, leagueKey: key, matches: store.matches, playerLogs: store.playerLogs || [] });
          const history = report.history, last = history[0], facts = [];
          if (history.length) facts.push(fact('Forma registrada', `${report.record.wins} victorias, ${report.record.draws} empates y ${report.record.losses} derrotas`, history.length));
          for (const [metric, label] of [['goals', 'Goles a favor'], ['goalsAgainst', 'Goles en contra'], ['yellow', 'Amarillas'], ['red', 'Rojas'], ['fouls', 'Faltas']]) {
            const item = report.summary.find(row => row.id === metric);
            if (item?.n) facts.push(fact(label, `Media ${num(item.average)} por partido`, item.n));
          }
          if (last) facts.unshift(fact('Ultimo partido guardado', `${date(last.date)} / ${last.opponent} / ${{ W: 'Victoria', D: 'Empate', L: 'Derrota' }[last.result] || 'Resultado sin dato'}`, 1, last.source));
          entities.push({ id: `team:${canonicalTeam(name, country)}`, name, team: name, kind, facts, latest: last?.date || null, n: history.length,
            signals: performanceSignals({ sport, kind, history, cutoff }) });
        }
      } else {
        const report = footballPlayers.profile({ ...common, leagueKey: key, window: String(lookback), team: body.team, playerKey: body.playerKey });
        entities.push({ id: report.playerKey, playerKey: report.playerKey, name: report.name, team: report.team, kind, latest: report.history[0]?.date || null, n: report.history.length,
          facts: playerFacts(report.history, sport, null), signals: performanceSignals({ sport, kind, history: report.history, cutoff }) });
      }
    } else if (sport === 'basketball') {
      if (kind === 'player') {
        const report = basketballPlayers.analyze({ ...common, league: key, team: body.team || '', playerKey: body.playerKey });
        entities.push({ id: report.playerKey, playerKey: report.playerKey, name: report.name, team: body.team || report.history[0]?.team || '', kind,
          latest: report.quality.newest, n: report.history.length, facts: playerFacts(report.history, sport, referencePoints),
          signals: performanceSignals({ sport, kind, history: report.history, cutoff, referencePoints }) });
      } else for (const name of [...new Set(requested)]) {
        const report = basketballPrematch.teamReport({ ...common, league: key, team: name });
        const facts = [fact('Resultados de la muestra', `${report.summary.wins} victorias / ${report.summary.losses} derrotas en la muestra`, report.summary.n)];
        const last = report.history[0];
        if (last) facts.push(fact('Ultimo marcador', `${date(last.date)} / ${last.opponent} / ${num(last.periods.ft.scored)} a favor y ${num(last.periods.ft.conceded)} en contra`, 1, last.source));
        if (report.periods.ft.n) facts.push(fact('Puntos del equipo', `Media ${num(report.periods.ft.scored.average)} a favor / ${num(report.periods.ft.conceded.average)} en contra`, report.periods.ft.n));
        const records = basketballPlayers.records({ ...common, league: key }).filter(row => row.team === name && row.season === season && row.minutes > 0);
        const lastPlayerDate = records[0]?.date;
        const players = records.filter(row => row.date === lastPlayerDate).sort((a, b) => b.minutes - a.minutes).slice(0, 5);
        for (const row of players) facts.push(fact('Minutos individuales registrados', `${row.name}: ${num(row.minutes)} min y ${num(row.values.points)} puntos / ${date(row.date)}. No confirma plantilla actual.`, 1, row.source));
        const history = report.history.map(row => ({ ...row, values: { points: row.periods.ft.scored },
          result: !numeric(row.periods.ft.scored) || !numeric(row.periods.ft.conceded) ? null : row.periods.ft.scored > row.periods.ft.conceded ? 'W' : row.periods.ft.scored < row.periods.ft.conceded ? 'L' : 'D' }));
        entities.push({ id: `team:${name}`, name, team: name, kind, latest: report.meta.newest, n: report.summary.n, facts,
          signals: performanceSignals({ sport, kind, history, cutoff }) });
      }
    } else {
      const keys = body.playerKeys || [body.playerKey].filter(Boolean);
      if (!Array.isArray(keys) || !keys.length || keys.length > 2 || keys.some(value => typeof value !== 'string')) fail('Selecciona hasta dos tenistas por su identidad.');
      for (const playerKey of [...new Set(keys)]) {
        const report = tennisLab.profile({ ...body, ...common, playerKey });
        const last = report.history[0], facts = [];
        facts.push(fact('Forma registrada', `${report.record.wins} victorias / ${report.record.losses} derrotas`, report.record.n));
        if (last) facts.push(fact('Ultimo partido admisible', `${tennisDate(last)} / ${last.opponent} / ${last.score || 'Marcador sin dato'}`, 1, last.source));
        const c = report.context;
        if (c.matches7Days !== null) facts.push(fact('Carga con fecha exacta', `${c.matches7Days} partidos en 7 dias; ${num(c.minutes14Days)} min en 14 dias (muestra parcial)`, c.durationMatches));
        const retirements = Object.entries(getStore().sports?.tennis?.datasets || {}).filter(([year]) => year <= season).flatMap(([, set]) => set.matches || [])
          .filter(row => row.retired && ['player1', 'player2'].some(side => tennisKey(row, side) === playerKey) && Date.parse(row.availableAfter || row.date) < time && Date.parse(row.date) < time)
          .sort((a, b) => b.date.localeCompare(a.date));
        if (retirements[0]) facts.push(fact('Retiro en un partido del archivo', `${tennisDate(retirements[0])}: encuentro terminado por retiro. Esto no identifica quien se retiro ni confirma una lesion actual.`, 1, retirements[0].source));
        entities.push({ id: playerKey, playerKey, name: report.player.name, team: '', kind, facts, latest: last?.date || null, latestPrecision: last?.datePrecision || null, n: report.record.n,
          signals: performanceSignals({ sport, kind, history: report.history, cutoff }) });
      }
    }
    if (!entities.length) fail('Selecciona un equipo o jugador para ver su contexto.');
    for (const entity of entities) {
      entity.ageDays = entity.latest ? Math.floor((time - Date.parse(entity.latest)) / 86400000) : null;
      entity.partial = !entity.n || entity.n < lookback || entity.ageDays === null || entity.ageDays > 30;
    }
    const candidates = [...(getStore().contextReports || []), ...(sport === 'basketball' ? readBasketball().availability || [] : sport === 'tennis' ? getStore().tennisLab?.reports || [] : [])];
    const availability = candidates.filter(row => (!row.sport || row.sport === sport) && sourceScopes.some(scope =>
      (sport === 'tennis' || String(row.key || row.league) === scope.key) && (!row.season || String(row.season) === scope.season)) &&
      entities.some(entity => kind === 'player' ? row.playerKey === entity.playerKey : canonicalTeam(row.team, country) === canonicalTeam(entity.team, country)) &&
      (!row.fixtureId || fixtureId && String(row.fixtureId) === fixtureId) && Date.parse(row.publishedAt) <= time && Date.parse(row.recordedAt) <= time);
    return { sport, key: scopeKey, season: scopeSeason, cutoff, fixtureId, lookback, country, sourceScopes, entities, availability,
      historicalCutoff: now().getTime() - time > 86400000,
      limits: ['Historial parcial: no acredita la plantilla ni el estado fisico actual.',
        'Tarjetas y rojas guardadas no confirman suspensiones: faltan reglas, actas y sanciones vigentes.',
        'Clasificacion, puntos necesarios, motivacion, expulsiones y lesiones requieren una fuente expresa. No se deducen de resultados ni ausencias.',
        'El contexto y las noticias no cambian probabilidades ni pronosticos sellados.'] };
  };
}
