const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const slug = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
const definitions = [
  ['England', 'Premier League', ['Premier League'], true], ['England', 'Championship', ['Championship'], true],
  ['Spain', 'La Liga', ['La Liga', 'LaLiga'], true], ['Germany', 'Bundesliga', ['Bundesliga'], true],
  ['Italy', 'Serie A', ['Serie A'], true], ['France', 'Ligue 1', ['Ligue 1'], true],
  ['Netherlands', 'Eredivisie', ['Eredivisie'], true], ['Portugal', 'Primeira Liga', ['Primeira Liga'], true],
  ['USA', 'MLS', ['MLS', 'Major League Soccer']], ['Mexico', 'Liga MX', ['Liga MX'], true],
  ['Brazil', 'Brasileirao Serie A', ['Serie A', 'Brasileirao Serie A']],
  ['Brazil', 'Brasileirao Serie B', ['Serie B', 'Brasileirao Serie B']],
  ['Argentina', 'Liga Profesional Argentina', ['Liga Profesional Argentina']],
  ['Colombia', 'Primera A Colombia', ['Primera A', 'Primera A Colombia']],
  ['Ecuador', 'LigaPro Ecuador', ['Liga Pro', 'LigaPro Ecuador']],
  ['Peru', 'Liga 1 Peru', ['Liga 1 Peru', 'Primera Division']],
  ['Chile', 'Primera Division Chile', ['Primera Division Chile', 'Primera Division']],
  // Separate Apertura/Clausura APIs are not assumed to be the same competition archive.
  ['Paraguay', 'Primera Division Paraguay', ['Primera Division Paraguay']],
  ['Ecuador', 'LigaPro Serie B Ecuador', ['Liga Pro Serie B', 'LigaPro Serie B Ecuador']],
  ['Colombia', 'Primera B Colombia', ['Primera B', 'Primera B Colombia']],
  ['Bolivia', 'Primera Division Bolivia', ['Primera Division', 'Primera Division Bolivia']],
  ['Uruguay', 'Primera Division Uruguay', ['Primera Division', 'Primera Division Uruguay']],
  ['World', 'Champions League', ['UEFA Champions League', 'Champions League'], true],
  ['World', 'Europa League', ['UEFA Europa League', 'Europa League'], true],
  ['World', 'Conference League', ['UEFA Europa Conference League', 'UEFA Conference League', 'Conference League'], true],
  ['World', 'Copa Libertadores', ['CONMEBOL Libertadores', 'Copa Libertadores']],
  ['World', 'Copa Sudamericana', ['CONMEBOL Sudamericana', 'Copa Sudamericana']],
];
const footystatsDefinitions = ['premier', 'championship', 'spain', 'germany', 'italy', 'france', 'netherlands', 'portugal', 'mls', 'mexico',
  'brazil', 'brazil-b', 'argentina', 'colombia', 'ecuador', 'peru', 'chile', 'paraguay', 'ecuador-b', 'colombia-b', 'bolivia', 'uruguay',
  'champions', 'europa', 'conference', 'libertadores', 'sudamericana'];

// Explicit provider-name equivalences, scoped to a country; no fuzzy club matching.
const teamAliases = {
  England: [['Man United', 'Manchester United'], ['Man City', 'Manchester City'], ["Nott'm Forest", 'Nottingham Forest'],
    ['Tottenham', 'Tottenham Hotspur'], ['Wolves', 'Wolverhampton Wanderers'], ['Newcastle', 'Newcastle United'],
    ['West Ham', 'West Ham United'], ['Brighton', 'Brighton & Hove Albion'], ['Leicester', 'Leicester City'], ['Ipswich', 'Ipswich Town'], ['Bournemouth', 'AFC Bournemouth']],
  Spain: [['Ath Madrid', 'Atletico Madrid'], ['Ath Bilbao', 'Athletic Club'], ['Betis', 'Real Betis'], ['Sociedad', 'Real Sociedad'], ['Celta', 'Celta Vigo'], ['Vallecano', 'Rayo Vallecano'], ['Espanol', 'Espanyol']],
  Germany: [['Bayern Munich', 'Bayern Munchen'], ['Stuttgart', 'VfB Stuttgart'], ['Leverkusen', 'Bayer Leverkusen'], ['Hoffenheim', '1899 Hoffenheim'], ['Mainz', 'FSV Mainz 05'], ["M'gladbach", 'Borussia Monchengladbach'], ['Ein Frankfurt', 'Eintracht Frankfurt'], ['Dortmund', 'Borussia Dortmund'], ['Freiburg', 'SC Freiburg'], ['Augsburg', 'FC Augsburg'], ['Wolfsburg', 'VfL Wolfsburg'], ['St Pauli', 'FC St. Pauli'], ['Heidenheim', '1. FC Heidenheim'], ['Elversberg', 'SV Elversberg']],
  Italy: [['Milan', 'AC Milan'], ['Roma', 'AS Roma'], ['Verona', 'Hellas Verona']],
  France: [['Paris SG', 'Paris Saint Germain'], ['Brest', 'Stade Brestois 29']],
  Brazil: [['Flamengo RJ', 'Flamengo'], ['Botafogo RJ', 'Botafogo'], ['Vasco', 'Vasco DA Gama'], ['Bragantino', 'RB Bragantino'], ['Fortaleza', 'Fortaleza EC'], ['Athletico-PR', 'Atletico Paranaense']],
  Argentina: [['Dep. Riestra', 'Deportivo Riestra'], ['Ind. Rivadavia', 'Independ. Rivadavia'], ['Belgrano', 'Belgrano Cordoba'], ['Instituto', 'Instituto Cordoba'], ['Atl. Tucuman', 'Atletico Tucuman'], ['Union de Santa Fe', 'Union Santa Fe'], ['Central Cordoba', 'Central Cordoba de Santiago']],
  Mexico: [['Atl. San Luis', 'Atletico San Luis'], ['Queretaro', 'Club Queretaro'], ['Juarez', 'FC Juarez'], ['UNAM Pumas', 'U.N.A.M. - Pumas'], ['Club Leon', 'Leon'], ['Pachuca', 'CF Pachuca'], ['Mazatlan FC', 'Mazatlan']],
  USA: [['Minnesota United', 'Minnesota United FC'], ['Atlanta Utd', 'Atlanta United FC'], ['Orlando City', 'Orlando City SC'], ['New York City', 'New York City FC'], ['Austin FC', 'Austin']],
  Colombia: [['Boyaca Chico', 'Chico'], ['Atletico Bucaramanga', 'Bucaramanga'], ['Atletico Junior', 'Junior'], ['Envigado FC', 'Envigado']],
  Ecuador: [['Barcelona', 'Barcelona SC'], ['LDU Quito', 'LDU de Quito'], ['Libertad de Loja', 'Libertad'], ['Mushuc Runa', 'Mushuc Runa SC']],
};
export function canonicalTeam(name, country) {
  const pair = teamAliases[country]?.find(names => names.some(value => norm(value) === norm(name)));
  return pair?.[0] || String(name || '').trim();
}
function seasonLabel(value, split) {
  const year = String(value).match(/^(\d{4})(?:[/-]\d{2,4})?$/)?.[1];
  return year ? split ? `${year}/${Number(year) + 1}` : year : String(value);
}
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' });
const day = date => {
  const parts = dayFormatter.formatToParts(new Date(date));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
};
const firstValue = (records, read) => records.map(read).find(validCount) ?? null;
const priority = record => record.sourceRefs?.[0]?.leagueKey.startsWith('api:') ? 0 : record.source === 'FootyStats' ? 1 : record.manual ? 3 : 2;
const validCount = value => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const paths = ['homeGoals', 'awayGoals', ...['home', 'away'].flatMap(side => ['shots', 'shotsOnTarget', 'corners', 'fouls', 'yellow', 'red', 'offsides'].map(field => `stats.${side}.${field}`)),
  ...['homeGoals', 'awayGoals', 'homeCorners', 'awayCorners'].map(field => `halfTime.${field}`)];
const at = (row, field) => field.split('.').reduce((value, key) => value?.[key], row);
const reference = row => ({ source: row.source || row.sourceRefs[0].leagueKey, ...row.sourceRefs[0] });
function traceFields(result, records) {
  result.fieldSources = Object.fromEntries(paths.filter(field => validCount(at(result, field))).map(field => {
    const provider = records.find(row => at(row, field) === at(result, field));
    return [field, reference(provider || result)];
  }));
  result.fieldConflicts = paths.flatMap(field => {
    const values = records.filter(row => validCount(at(row, field))).map(row => ({ value: at(row, field), ...reference(row) }));
    return new Set(values.map(row => row.value)).size > 1 ? [{ field, values }] : [];
  });
}
function mergeHalf(result, rows) {
  const half = { ...result.halfTime };
  for (const metric of ['Goals', 'Corners']) {
    const keys = [`home${metric}`, `away${metric}`];
    for (const row of rows) {
      if (!keys.every(key => validCount(row.halfTime?.[key]) && (!validCount(half[key]) || half[key] === row.halfTime[key]))) continue;
      if (!keys.every((key, index) => {
        const full = metric === 'Goals' ? result[index ? 'awayGoals' : 'homeGoals'] : result.stats?.[index ? 'away' : 'home']?.corners;
        return !validCount(full) || row.halfTime[key] <= full;
      })) continue;
      for (const key of keys) if (!validCount(half[key])) half[key] = row.halfTime[key];
      if (keys.every(key => validCount(half[key]))) break;
    }
  }
  return half;
}
function mergeRecords(records) {
  const buckets = new Map();
  for (const record of records) {
    const identity = `${record.season}|${day(record.date)}|${norm(record.home)}|${norm(record.away)}`;
    if (!buckets.has(identity)) buckets.set(identity, []);
    buckets.get(identity).push(record);
  }
  let duplicateCount = 0, conflicts = 0;
  const merged = [];
  for (const rows of buckets.values()) {
    rows.sort((a, b) => priority(a) - priority(b) || String(a.id).localeCompare(String(b.id)));
    const counts = new Map();
    for (const row of rows) {
      const source = row.sourceRefs[0].leagueKey;
      counts.set(source, (counts.get(source) || 0) + 1);
    }
    const ambiguous = [...counts.values()].some(count => count > 1);
    const conflict = rows.some(row => row.homeGoals !== rows[0].homeGoals || row.awayGoals !== rows[0].awayGoals ||
      (row.status && rows[0].status && row.status !== rows[0].status));
    const timeConflict = rows.some(row => row.source === 'FootyStats') && rows.some(row =>
      row.timeKnown === false || Math.abs(Date.parse(row.date) - Date.parse(rows[0].date)) > 30 * 60000);
    if (ambiguous) { merged.push(...rows); conflicts++; continue; }
    const result = { ...rows[0], sourceRefs: rows.flatMap(row => row.sourceRefs),
      source: [...new Set(rows.map(row => row.source).filter(Boolean))].join(' + ') };
    duplicateCount += rows.length - 1;
    if (conflict || timeConflict) {
      // Keep the preferred score, but never splice statistics from disagreeing results.
      result.integrityWarning = 'Las fuentes discrepan en marcador, estado u hora; no se combinan sus estadisticas.';
      conflicts++;
    } else if (rows.length > 1 && !['AET', 'PEN'].includes(result.status)) {
      result.stats = Object.fromEntries(['home', 'away'].map(side => [side, Object.fromEntries(
        ['shots', 'shotsOnTarget', 'corners', 'fouls', 'yellow', 'red', 'offsides'].map(field => [field, firstValue(rows, row => row.stats?.[side]?.[field])]))]));
      result.halfTime = mergeHalf(result, rows);
      for (const side of ['home', 'away']) {
        const stats = result.stats[side], primary = rows[0].stats?.[side];
        if (validCount(stats.shots) && validCount(stats.shotsOnTarget) && stats.shotsOnTarget > stats.shots) {
          if (!validCount(primary?.shots)) stats.shots = null;
          else stats.shotsOnTarget = null;
        }
        const halfKey = `${side}Corners`;
        if (validCount(stats.corners) && validCount(result.halfTime[halfKey]) && result.halfTime[halfKey] > stats.corners) {
          if (!validCount(primary?.corners)) stats.corners = null;
          else result.halfTime[halfKey] = null;
        }
      }
    }
    traceFields(result, conflict || timeConflict ? [rows[0]] : rows);
    if (!conflict && !timeConflict && result.fieldConflicts.length) result.integrityWarning = `${result.fieldConflicts.length} campo(s) con discrepancias. Se conserva el dato de la fuente prioritaria, sin promediar.`;
    merged.push(result);
  }
  return { records: merged, duplicateCount, conflicts };
}

export function combineFootballHistory(store, now = new Date().toISOString()) {
  const groups = new Map(), mapping = new Map();
  for (const league of Object.values(store.leagues || {})) {
    const found = league.source === 'FootyStats' ? definitions[footystatsDefinitions.indexOf(league.key.replace('footystats:', ''))] :
      definitions.find(([country, , names]) => country === league.country && names.some(name => norm(name) === norm(league.name)));
    const groupKey = found ? `competition:${slug(found[0])}:${slug(found[1])}` : league.key;
    if (!groups.has(groupKey)) groups.set(groupKey, { key: groupKey, name: found?.[1] || league.name, country: league.country, split: found?.[3] || false, members: [] });
    groups.get(groupKey).members.push(league); mapping.set(league.key, groupKey);
  }
  const leagues = {}, matches = [], playerLogs = [];
  for (const group of groups.values()) {
    const names = new Map();
    const club = name => {
      const canonical = canonicalTeam(name, group.country), identity = norm(canonical);
      if (!names.has(identity)) names.set(identity, canonical);
      return names.get(identity);
    };
    const sourceKeys = group.members.map(league => league.key);
    const project = record => ({ ...record, id: record.leagueKey === group.key ? record.id : `${record.leagueKey}|${record.id}`,
      leagueKey: group.key, season: seasonLabel(record.season, group.split), home: club(record.home), away: club(record.away),
      sourceRefs: [{ leagueKey: record.leagueKey, season: record.season, id: record.id }] });
    const rows = (store.matches || []).filter(row => sourceKeys.includes(row.leagueKey));
    const combined = mergeRecords(rows.map(project)); matches.push(...combined.records);
    const seasons = [...new Set(group.members.flatMap(league => league.seasons || []).map(season => seasonLabel(season, group.split)))].sort().reverse();
    const sourceSeasons = {}, teamsBySeason = {}, fixturesBySeason = {}, coverageBySeason = {};
    for (const season of seasons) {
      sourceSeasons[season] = group.members.flatMap(league => (league.seasons || []).filter(value => seasonLabel(value, group.split) === season).map(value => ({ leagueKey: league.key, season: value })));
      teamsBySeason[season] = [...new Set(sourceSeasons[season].flatMap(({ leagueKey, season: rawSeason }) => store.leagues[leagueKey].teamsBySeason?.[rawSeason] || []).map(club))].sort();
      const fixtures = sourceSeasons[season].flatMap(({ leagueKey, season: rawSeason }) => [
        ...(store.leagues[leagueKey].fixturesBySeason?.[rawSeason] || []), ...(store.leagues[leagueKey].manualFixturesBySeason?.[rawSeason] || []),
      ]).map(project);
      const finished = new Set(combined.records.filter(row => row.season === season).map(row => `${day(row.date)}|${norm(row.home)}|${norm(row.away)}`));
      fixturesBySeason[season] = mergeRecords(fixtures.filter(row => !finished.has(`${day(row.date)}|${norm(row.home)}|${norm(row.away)}`))).records;
      const apiSource = sourceSeasons[season].find(ref => store.leagues[ref.leagueKey].source === 'api-football');
      coverageBySeason[season] = apiSource ? store.leagues[apiSource.leagueKey].coverageBySeason?.[apiSource.season] ?? null : null;
    }
    const sources = group.members.map(league => {
      const dated = rows.filter(row => row.leagueKey === league.key && Date.parse(row.date) <= Date.parse(now)).map(row => row.date).sort();
      return { key: league.key, source: league.source, seasons: (league.seasons || []).map(season => seasonLabel(season, group.split)),
        firstResult: dated[0] || null, lastResult: dated.at(-1) || null, matchCount: dated.length, coverageNote: league.coverageNote || null };
    });
    const dated = combined.records.filter(row => Date.parse(row.date) <= Date.parse(now)).map(row => row.date).sort();
    const supplemented = combined.records.filter(row => Object.entries(row.fieldSources || {}).some(([field, source]) => source.source === 'FootyStats' && !['homeGoals', 'awayGoals'].includes(field)) && row.sourceRefs.some(ref => ref.leagueKey.startsWith('api:'))).length;
    const coverageNote = `Historial combinado de ${sources.length} fuente(s). API-Football tiene prioridad; FootyStats completa solo datos ausentes de coincidencias verificadas. ${supplemented} partido(s) API con campos FootyStats. Ultimo resultado guardado (Guayaquil): ${dated.length ? day(dated.at(-1)) : 'sin resultados'}. No certifica cobertura completa hasta hoy.${combined.conflicts ? ` ${combined.conflicts} coincidencia(s) con discrepancias o identidad ambigua.` : ''}`;
    leagues[group.key] = { ...group.members[0], key: group.key, name: group.name, source: 'combined', sourceKeys, sources, sourceSeasons,
      seasons, teamsBySeason, fixturesBySeason, manualFixturesBySeason: {}, coverageBySeason, coverageNote,
      firstResult: dated[0] || null, lastResult: dated.at(-1) || null, duplicateCount: combined.duplicateCount, conflicts: combined.conflicts, supplemented };
    for (const row of (store.playerLogs || []).filter(row => row.sport === 'football' && sourceKeys.includes(row.leagueKey))) {
      playerLogs.push({ ...row, leagueKey: group.key, season: seasonLabel(row.season, group.split), team: club(row.team), opponent: club(row.opponent) });
    }
  }
  return { ...store, leagues, matches, playerLogs: [...(store.playerLogs || []).filter(row => row.sport !== 'football' || !mapping.has(row.leagueKey)), ...playerLogs] };
}

export function footballSeasonAggregates(store, league, body) {
  const keys = league.sourceKeys || [league.key];
  return Object.values(store.footystatsResearch?.datasets || {}).filter(dataset => keys.includes(dataset.leagueKey) && String(dataset.season) === String(body.season) &&
    dataset.scope === 'season-aggregates' && Date.parse(dataset.downloadedAt) <= Date.parse(body.cutoff || new Date().toISOString()))
    .sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt)).slice(0, 1)
    .map(dataset => ({ source: 'FootyStats', season: dataset.season, downloadedAt: dataset.downloadedAt, partial: dataset.playersPartial,
      scope: 'season-aggregates', players: (dataset.players || []).filter(player => !body.team || norm(canonicalTeam(player.team, league.country)) === norm(body.team)),
      note: 'Acumulados de temporada del archivo FootyStats; no son participaciones ni se usan en ventanas, por 90 o pronosticos de jugadores.' }));
}
