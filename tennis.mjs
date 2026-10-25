import { serviceStats } from './tennis-stats.mjs';
const DAY = 86_400_000;
const MIN_PLAYER_MATCHES = 3;
const MIN_CONTEXT_MATCHES = 10;
const CATEGORIES = ['grand-slam', 'masters-1000', 'atp-500'];

export const TENNIS_SOURCE = {
  id: 'tennismylife-atp',
  parserVersion: 2,
  name: 'TennisMyLife ATP',
  url: 'https://stats.tennismylife.org/tennis-match-database',
  indexUrl: 'https://stats.tennismylife.org/api/data-files',
  seasons: ['2026', '2025', '2024'],
  downloadUrls: Object.fromEntries(['2026', '2025', '2024'].map(season => [
    season, `https://stats.tennismylife.org/data/${season}.csv`,
  ])),
  urlTemplate: 'https://stats.tennismylife.org/data/{season}.csv',
  categories: CATEGORIES,
  attribution: 'TennisMyLife; datos para investigacion personal. No redistribuir ni comercializar la base sin revisar las condiciones de la fuente.',
  dateNote: 'La fuente documenta tourney_date como semana del torneo. Se aplica un margen conservador de 14 dias en Grand Slam/Masters y 8 dias en otros torneos; no es un calendario exacto de partidos.',
  csvTemplate: 'date,tournament,category,surface,player1,player2,winner,best_of,score',
};

function key(value) {
  return String(value ?? '').trim().toLocaleLowerCase('es');
}

function nonNegative(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function integer(value) {
  const number = nonNegative(value);
  return Number.isInteger(number) ? number : null;
}

function dateString(value) {
  const text = String(value ?? '').trim();
  const short = /^\d{8}$/.test(text)
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(short)) return null;
  const date = new Date(`${short}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === short ? short : null;
}

function exactDate(value) {
  const short = dateString(value);
  // A date without a finish time becomes usable only after that Guayaquil day ends.
  if (short) return { date: `${short}T05:00:00.000Z`, availableAfter: new Date(Date.parse(`${short}T05:00:00Z`) + DAY).toISOString() };
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return null;
  if (!dateString(text.slice(0, 10)) || Number(text.slice(11, 13)) > 23 || Number(text.slice(14, 16)) > 59) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? { date: date.toISOString(), availableAfter: new Date(date.getTime() + 6 * 3600000).toISOString(), timeKnown: true } : null;
}

function csvRows(csv) {
  const source = String(csv ?? '').replace(/^\uFEFF/, '');
  const header = source.split(/\r?\n/, 1)[0] || '';
  const delimiter = [',', ';', '\t'].sort((a, b) => header.split(b).length - header.split(a).length)[0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\r' || character === '\n') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some(cell => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('El CSV de tenis contiene comillas sin cerrar.');
  row.push(field);
  if (row.some(cell => cell.trim() !== '')) rows.push(row);
  return rows;
}

function categoryFor(row) {
  const explicit = key(row.category).replace(/\s+/g, '-');
  if (CATEGORIES.includes(explicit)) return explicit;
  const level = String(row.tourney_level ?? '').trim().toUpperCase();
  if (level === 'G') return 'grand-slam';
  if (level === 'M' || level === '1000') return 'masters-1000';
  if (level === '500') return 'atp-500';
  // A denotes assorted ATP events, not specifically ATP 500. F is ATP Finals.
  return 'other';
}

function surfaceFor(value) {
  const surface = key(value);
  const surfaces = { hard: 'Hard', clay: 'Clay', grass: 'Grass', carpet: 'Carpet' };
  return surfaces[surface] ?? 'Unknown';
}

function scoreTotals(score, bestOf) {
  const unavailable = { totalGames: null, totalSets: null, player1Games: null, player2Games: null };
  const text = String(score ?? '').trim();
  if (!text || ![3, 5].includes(bestOf) || /(?:RET|W\/?O|WALKOVER|DEF|ABN|ABD|CANCEL|\[|\])/i.test(text)) return unavailable;
  const tokens = text.split(/\s+/);
  const sets = tokens.map(token => token.match(/^(\d+)-(\d+)(?:\(\d+\))?$/));
  if (sets.some(set => !set)) return unavailable;
  let wins1 = 0;
  let wins2 = 0;
  let games1 = 0;
  let games2 = 0;
  const required = (bestOf + 1) / 2;
  for (const set of sets) {
    if (wins1 === required || wins2 === required) return unavailable;
    const first = Number(set[1]);
    const second = Number(set[2]);
    const high = Math.max(first, second);
    const low = Math.min(first, second);
    const valid = (high === 6 && low <= 4) || (high === 7 && [5, 6].includes(low)) || (high >= 8 && high - low === 2);
    if (!valid) return unavailable;
    wins1 += first > second ? 1 : 0;
    wins2 += second > first ? 1 : 0;
    games1 += first;
    games2 += second;
  }
  if (Math.max(wins1, wins2) !== required || tokens.length > bestOf) return unavailable;
  return { totalGames: games1 + games2, totalSets: tokens.length, player1Games: games1, player2Games: games2, scoreWinner: wins1 > wins2 ? 1 : 2 };
}

export function parseTennisCsv(csv, { season } = {}) {
  const rows = csvRows(csv);
  if (rows.length < 2) throw new Error('El CSV de tenis no contiene partidos.');
  const columns = rows[0].map(value => key(value));
  const tml = ['tourney_name', 'tourney_date', 'winner_name', 'loser_name'].every(column => columns.includes(column));
  const custom = ['date', 'tournament', 'player1', 'player2', 'winner'].every(column => columns.includes(column));
  if (!tml && !custom) throw new Error('CSV no reconocido. Usa el formato TennisMyLife o la plantilla de tenis.');
  const matches = [];
  const ids = new Set();
  let skipped = 0;
  let approximate = 0;
  for (const values of rows.slice(1)) {
    const row = Object.fromEntries(columns.map((column, index) => [column, String(values[index] ?? '').trim()]));
    const player1 = tml ? row.winner_name : row.player1;
    const player2 = tml ? row.loser_name : row.player2;
    const winner = tml ? 1 : Number(row.winner);
    const tournament = tml ? row.tourney_name : row.tournament;
    const category = categoryFor(row);
    const precise = exactDate(tml ? row.match_date : row.date);
    const week = tml ? dateString(row.tourney_date) : null;
    const date = precise?.date ?? (week ? `${week}T00:00:00.000Z` : null);
    if (!date || !player1 || !player2 || key(player1) === key(player2) || ![1, 2].includes(winner) || !tournament) {
      skipped += 1;
      continue;
    }
    const matchSeason = String(season || row.season || row.tourney_id?.match(/^\d{4}/)?.[0] || date.slice(0, 4));
    const finishedAt = /T.*(?:Z|[+-]\d\d:\d\d)$/.test(row.finished_at || '') && Number.isFinite(Date.parse(row.finished_at)) && Date.parse(row.finished_at) > Date.parse(date) ? new Date(row.finished_at).toISOString() : null;
    const availableAfter = finishedAt || precise?.availableAfter || new Date(Date.parse(date) + (['grand-slam', 'masters-1000'].includes(category) ? 14 : 8) * DAY).toISOString();
    const bestOfNumber = integer(row.best_of);
    const bestOf = [3, 5].includes(bestOfNumber) ? bestOfNumber : null;
    const score = row.score || null;
    const totals = scoreTotals(score, bestOf);
    // A contradictory score must never be treated as a complete result.
    if (totals.scoreWinner && totals.scoreWinner !== winner) {
      skipped += 1;
      continue;
    }
    const retired = /(?:RET|W\/?O|WALKOVER|DEF|ABN|ABD|CANCEL)/i.test(score ?? '');
    const id = tml
      ? `tennis:${matchSeason}:${row.tourney_id}:${row.match_num}:${row.winner_id || key(player1)}:${row.loser_id || key(player2)}:${date}`
      : `tennis:${matchSeason}:${key(tournament)}:${date}:${key(player1)}:${key(player2)}`;
    if (ids.has(id)) continue;
    ids.add(id);
    if (!precise) approximate += 1;
    const { scoreWinner, ...countedTotals } = totals;
    matches.push({
      id, date, availableAfter, finishedAt, timeKnown: precise?.timeKnown === true, datePrecision: precise ? 'match-date' : 'tournament-week',
      season: matchSeason, tournament, tournamentId: row.tourney_id || null,
      category, surface: surfaceFor(row.surface), player1, player2, winner,
      player1Id: (tml ? row.winner_id : row.player1_id) || null, player2Id: (tml ? row.loser_id : row.player2_id) || null,
      indoor: /^(yes|true|1)$/i.test(row.indoor || '') ? true : /^(no|false|0)$/i.test(row.indoor || '') ? false : null,
      minutes: integer(row.minutes), rankings: { player1: integer(tml ? row.winner_rank : row.player1_rank), player2: integer(tml ? row.loser_rank : row.player2_rank) },
      score, bestOf, round: row.round || null, retired, completed: !retired,
      ...countedTotals,
      stats: {
        ...Object.fromEntries(['player1', 'player2'].map((side, index) => {
          const prefix = tml ? index === 0 ? 'w' : 'l' : side;
          return [side, serviceStats(Object.fromEntries(Object.entries({ aces: tml ? 'ace' : 'aces', doubleFaults: tml ? 'df' : 'double_faults',
            servePoints: tml ? 'svpt' : 'serve_points', firstIn: tml ? '1stIn' : 'first_in', firstWon: tml ? '1stWon' : 'first_won', secondWon: tml ? '2ndWon' : 'second_won',
            serviceGames: tml ? 'SvGms' : 'service_games', bpSaved: tml ? 'bpSaved' : 'bp_saved', bpFaced: tml ? 'bpFaced' : 'bp_faced' }).map(([field, column]) => [field, row[`${prefix}_${column}`.toLowerCase()]])))];
        })),
      },
    });
  }
  if (!matches.length) throw new Error('No se encontraron resultados validos en el CSV de tenis.');
  matches.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const selected = matches.filter(match => CATEGORIES.includes(match.category));
  return {
    matches,
    players: [...new Set(selected.flatMap(match => [match.player1, match.player2]))].sort((a, b) => a.localeCompare(b, 'es')),
    categories: CATEGORIES,
    tournaments: [...new Map(selected.map(match => [match.tournament, {
      name: match.tournament, category: match.category, surface: match.surface, bestOf: match.bestOf,
    }])).values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    surfaces: [...new Set(selected.map(match => match.surface))].sort(),
    skipped,
    note: [approximate ? TENNIS_SOURCE.dateNote : 'Fechas de partidos importadas; sin hora, los resultados se usan al terminar el dia de Guayaquil.',
      skipped ? `${skipped} filas invalidas excluidas.` : null].filter(Boolean).join(' '),
  };
}

function percentage(probability) {
  return Math.round(probability * 10000) / 100;
}

function round(value) {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100;
}

function mean(values) {
  const valid = values.filter(value => value !== null && value !== undefined && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function won(match, player) {
  return key(match[match.winner === 1 ? 'player1' : 'player2']) === key(player);
}

function includesPlayer(match, player) {
  return key(match.player1) === key(player) || key(match.player2) === key(player);
}

function observed(history, predicate) {
  const values = history.map(predicate).filter(value => value !== null);
  return { hits: values.filter(Boolean).length, n: values.length };
}

function qualityFor(homeN, awayN, contextN) {
  if (homeN < MIN_PLAYER_MATCHES || awayN < MIN_PLAYER_MATCHES || contextN < MIN_CONTEXT_MATCHES) return 'unavailable';
  return homeN < 10 || awayN < 10 || contextN < 100 ? 'limited' : 'adequate';
}

function market({ id, group, label, probability, homeObserved, awayObserved, contextN, method }) {
  const quality = qualityFor(homeObserved.n, awayObserved.n, contextN);
  return {
    id, group, label, probability: quality === 'unavailable' || probability === null ? null : percentage(probability),
    observed: { home: homeObserved, away: awayObserved },
    n: Math.min(homeObserved.n, awayObserved.n),
    samples: { home: homeObserved.n, away: awayObserved.n, league: contextN },
    quality, method,
  };
}

function eloRatings(matches) {
  const ratings = new Map();
  const get = player => ratings.get(key(player)) ?? 1500;
  const batches = new Map();
  for (const match of matches) {
    const batch = match.availableAfter || match.date;
    if (!batches.has(batch)) batches.set(batch, []);
    batches.get(batch).push(match);
  }
  // Same-week results are updated together: the source does not establish their chronology.
  for (const [, batch] of [...batches].sort(([a], [b]) => a.localeCompare(b))) {
    const changes = new Map();
    for (const match of batch) {
      const first = key(match.player1);
      const second = key(match.player2);
      const expected = 1 / (1 + 10 ** ((get(second) - get(first)) / 400));
      const change = 24 * ((match.winner === 1 ? 1 : 0) - expected);
      changes.set(first, (changes.get(first) ?? 0) + change);
      changes.set(second, (changes.get(second) ?? 0) - change);
    }
    for (const [player, change] of changes) ratings.set(player, get(player) + change);
  }
  return { get };
}

function historyFor(matches, player, lookback) {
  return matches.filter(match => includesPlayer(match, player))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0, lookback)
    .map(match => ({ ...match, opponent: key(match.player1) === key(player) ? match.player2 : match.player1,
      won: won(match, player), result: won(match, player) ? 'W' : 'L' }));
}

function summaryFor(history, player, ratings, bestOf) {
  const wins = history.filter(match => won(match, player)).length;
  const stats = name => history.map(match => match.stats?.[key(match.player1) === key(player) ? 'player1' : 'player2']?.[name] ?? null);
  const compatible = history.filter(match => match.bestOf === bestOf);
  return {
    team: player, player, n: history.length, wins, losses: history.length - wins,
    winRate: history.length ? percentage(wins / history.length) : null,
    rating: history.length ? round(ratings.get(player)) : null,
    averages: {
      games: round(mean(compatible.map(match => match.totalGames))), sets: round(mean(compatible.map(match => match.totalSets))),
      aces: round(mean(stats('aces'))), doubleFaults: round(mean(stats('doubleFaults'))),
    },
  };
}

export function buildTennisReport({ matches = [], season, player1, player2, lookback = 10,
  cutoff = new Date().toISOString(), surface = 'all', category = 'all', tournament = null,
  gamesLine = 22.5, bestOf = 3 } = {}) {
  if (!player1 || !player2 || key(player1) === key(player2)) throw new Error('Elige dos jugadores distintos.');
  const cutoffDate = new Date(cutoff);
  if (!Number.isFinite(cutoffDate.getTime())) throw new Error('Fecha de corte de tenis invalida.');
  const depth = Number(lookback);
  if (!Number.isInteger(depth) || depth < 3 || depth > 50) throw new Error('El historial debe contener entre 3 y 50 partidos.');
  const line = Number(gamesLine);
  if (!Number.isFinite(line) || line < 0.5 || line > 150 || line % 1 !== 0.5) throw new Error('La linea de juegos debe ser positiva y terminar en .5.');
  const format = Number(bestOf);
  if (![3, 5].includes(format)) throw new Error('El formato debe ser al mejor de 3 o 5 sets.');
  if (category !== 'all' && !CATEGORIES.includes(category)) throw new Error('Categoria de tenis no reconocida.');
  if (surface !== 'all' && !['Hard', 'Clay', 'Grass', 'Carpet'].includes(surfaceFor(surface))) throw new Error('Superficie de tenis no reconocida.');
  const targetSeason = season === undefined || season === null || season === '' ? null : Number(season);
  if (targetSeason !== null && !Number.isInteger(targetSeason)) throw new Error('Temporada de tenis invalida.');
  const eligible = [];
  const ids = new Set();
  for (const match of matches) {
    const date = Date.parse(match.date);
    const availableAfter = Date.parse(match.availableAfter || match.date);
    if (!Number.isFinite(date) || !Number.isFinite(availableAfter) || date >= cutoffDate.getTime() || availableAfter >= cutoffDate.getTime() ||
      match.completed === false || match.retired || ![1, 2].includes(match.winner) || !CATEGORIES.includes(match.category)) continue;
    if (targetSeason !== null && (!Number.isInteger(Number(match.season)) || Number(match.season) > targetSeason)) continue;
    if (surface !== 'all' && surfaceFor(match.surface) !== surfaceFor(surface)) continue;
    if (category !== 'all' && match.category !== category) continue;
    if (tournament && tournament !== 'all' && key(match.tournament) !== key(tournament)) continue;
    const id = match.id || `${match.date}:${match.tournament}:${key(match.player1)}:${key(match.player2)}`;
    if (ids.has(id)) continue;
    ids.add(id);
    eligible.push({ ...match, id });
  }
  const ratings = eloRatings(eligible);
  const homeHistory = historyFor(eligible, player1, depth);
  const awayHistory = historyFor(eligible, player2, depth);
  const homeSummary = summaryFor(homeHistory, player1, ratings, format);
  const awaySummary = summaryFor(awayHistory, player2, ratings, format);
  const formAdjustment = (history, player) => {
    if (!history.length) return 0;
    const residual = mean(history.map(match => {
      const opponent = key(match.player1) === key(player) ? match.player2 : match.player1;
      const expected = 1 / (1 + 10 ** ((ratings.get(opponent) - ratings.get(player)) / 400));
      return (won(match, player) ? 1 : 0) - expected;
    }));
    return 80 * residual * history.length / (history.length + 8);
  };
  const rating1 = ratings.get(player1) + formAdjustment(homeHistory, player1);
  const rating2 = ratings.get(player2) + formAdjustment(awayHistory, player2);
  const winnerProbability = 1 / (1 + 10 ** ((rating2 - rating1) / 400));
  const markets = [];
  for (const [index, player] of [player1, player2].entries()) {
    markets.push(market({
      id: `player${index + 1}-win`, group: 'resultado', label: `Gana ${player}`,
      probability: index === 0 ? winnerProbability : 1 - winnerProbability,
      homeObserved: observed(homeHistory, match => index === 0 ? won(match, player1) : !won(match, player1)),
      awayObserved: observed(awayHistory, match => index === 1 ? won(match, player2) : !won(match, player2)),
      contextN: eligible.length, method: 'Elo experimental con ajuste de forma; sin ventaja de localia.',
    }));
  }
  const homeTotals = homeHistory.filter(match => match.bestOf === format);
  const awayTotals = awayHistory.filter(match => match.bestOf === format);
  const totalsPool = [...new Map([...homeTotals, ...awayTotals].map(match => [match.id, match])).values()];
  const totals = [['totalGames', 'games', 'juegos', line], ...
    (format === 3 ? [2.5] : [3.5, 4.5]).map(setLine => ['totalSets', 'sets', 'sets', setLine])];
  for (const [field, id, label, threshold] of totals) {
    const predicate = match => nonNegative(match[field]) === null ? null : match[field] > threshold;
    const homeObserved = observed(homeTotals, predicate);
    const awayObserved = observed(awayTotals, predicate);
    const poolObserved = observed(totalsPool, predicate);
    const overProbability = poolObserved.n ? (poolObserved.hits + 1) / (poolObserved.n + 2) : null;
    for (const direction of ['over', 'under']) {
      const over = direction === 'over';
      markets.push(market({
        id: `${id}-${direction}-${threshold}`, group: id === 'games' ? 'juegos' : 'sets',
        label: `${over ? 'Mas' : 'Menos'} de ${threshold} ${label}`,
        probability: over ? overProbability : overProbability === null ? null : 1 - overProbability,
        homeObserved: over ? homeObserved : { hits: homeObserved.n - homeObserved.hits, n: homeObserved.n },
        awayObserved: over ? awayObserved : { hits: awayObserved.n - awayObserved.hits, n: awayObserved.n },
        contextN: poolObserved.n, method: `Frecuencia suavizada de marcadores completos, al mejor de ${format} sets.`,
      }));
    }
  }
  const messages = ['Estimaciones exploratorias, sin calibracion retrospectiva; no garantizan resultados.',
    'Jugador 1 y jugador 2 son etiquetas, no local y visitante.',
    'Los retiros, walkovers y descalificaciones se excluyen del historial de estimacion.'];
  if (eligible.some(match => match.datePrecision === 'tournament-week')) messages.push(TENNIS_SOURCE.dateNote);
  if (markets.some(item => item.quality === 'unavailable')) messages.push('Sin estimacion en mercados con menos de 3 partidos validos por jugador o 10 resultados de contexto.');
  if (homeTotals.length !== homeHistory.length || awayTotals.length !== awayHistory.length) messages.push(`Los totales excluyen formatos distintos al mejor de ${format} sets; no se mezclan Grand Slam de 5 sets con partidos de 3 sets.`);
  if (eligible.some(match => match.totalGames === null || match.totalSets === null)) messages.push('Los marcadores incompletos o no verificables no aportan totales de juegos ni de sets.');
  return {
    meta: { sport: 'tennis', season: season === undefined ? null : String(season), player1, player2,
      home: player1, away: player2, lookback: depth, cutoff: cutoffDate.toISOString(), surface,
      category, tournament: tournament || null, gamesLine: line, bestOf: format, eligibleMatches: eligible.length,
      method: 'Elo experimental K=24, actualizacion por fecha disponible y ajuste limitado de forma reciente.' },
    summary: { home: homeSummary, away: awaySummary },
    history: { home: homeHistory, away: awayHistory,
      h2h: historyFor(eligible.filter(match => includesPlayer(match, player1) && includesPlayer(match, player2)), player1, depth) },
    markets,
    quality: { status: markets.every(item => item.probability === null) ? 'unavailable' : 'exploratory', messages },
  };
}
