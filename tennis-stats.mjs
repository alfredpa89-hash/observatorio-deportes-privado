export const TENNIS_WINDOWS = [5, 10, 15, 20, 25, 30];
export const TENNIS_VERSION = 'tennis-research-v1';
export const count = value => typeof value !== 'boolean' && value !== null && value !== undefined && String(value).trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
export const mean = values => { const valid = values.filter(Number.isFinite); return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null; };
export const playerKey = (match, side) => match[`${side}Id`] ? `atp:${match[`${side}Id`]}` : `name:${String(match[side]).trim().toLowerCase()}`;

export function serviceStats(raw = {}) {
  const fields = ['aces', 'doubleFaults', 'servePoints', 'firstIn', 'firstWon', 'secondWon', 'serviceGames', 'bpSaved', 'bpFaced'];
  const result = Object.fromEntries(fields.map(field => [field, count(raw[field])]));
  for (const [part, total] of [['firstIn', 'servePoints'], ['firstWon', 'firstIn'], ['bpSaved', 'bpFaced']]) {
    if (result[part] !== null && result[total] !== null && result[part] > result[total]) result[part] = result[total] = null;
  }
  if (result.secondWon !== null && result.servePoints !== null && result.firstIn !== null && result.secondWon > result.servePoints - result.firstIn) result.secondWon = null;
  return result;
}

export function completeScore(score, bestOf) {
  if (![3, 5].includes(bestOf) || /RET|W\/?O|DEF|ABN|ABD|CANCEL|\[|\]/i.test(score || '')) return null;
  const tokens = String(score || '').trim().split(/\s+/), sets = [];
  let wins1 = 0, wins2 = 0;
  for (const token of tokens) {
    const parsed = token.match(/^(\d+)-(\d+)(?:\((\d+)\))?$/);
    if (!parsed || wins1 >= (bestOf + 1) / 2 || wins2 >= (bestOf + 1) / 2) return null;
    const a = Number(parsed[1]), b = Number(parsed[2]), high = Math.max(a, b), low = Math.min(a, b);
    if (!((high === 6 && low <= 4) || (high === 7 && [5, 6].includes(low)) || (high >= 8 && high - low === 2))) return null;
    wins1 += a > b ? 1 : 0; wins2 += b > a ? 1 : 0;
    sets.push({ player1: a, player2: b, tieBreak: high === 7 && low === 6 });
  }
  if (Math.max(wins1, wins2) !== (bestOf + 1) / 2) return null;
  return { sets, wins1, wins2, tieBreaks: sets.filter(set => set.tieBreak).length };
}

export function tennisValues(match, key) {
  const first = playerKey(match, 'player1') === key, side = first ? 'player1' : 'player2', other = first ? 'player2' : 'player1';
  const stats = serviceStats(match.stats?.[side]), opponent = serviceStats(match.stats?.[other]);
  const score = completeScore(match.score, match.bestOf), ownSets = score ? first ? score.wins1 : score.wins2 : null;
  const games = count(match[`${side}Games`]), against = count(match[`${other}Games`]);
  const breaks = opponent.bpFaced !== null && opponent.bpSaved !== null ? opponent.bpFaced - opponent.bpSaved : null;
  const broken = stats.bpFaced !== null && stats.bpSaved !== null ? stats.bpFaced - stats.bpSaved : null;
  return { ...stats, games, gamesAgainst: against, gamesTotal: count(match.totalGames), setsTotal: count(match.totalSets), setsWon: ownSets,
    setsAgainst: score ? score.sets.length - ownSets : null, gameMargin: games !== null && against !== null ? games - against : null,
    setMargin: score ? 2 * ownSets - score.sets.length : null, breaks,
    serviceHeld: stats.serviceGames !== null && broken !== null && broken <= stats.serviceGames ? stats.serviceGames - broken : null,
    breakChances: opponent.bpFaced, secondPlayed: stats.servePoints !== null && stats.firstIn !== null ? stats.servePoints - stats.firstIn : null,
    firstSetWon: score ? Number((score.sets[0].player1 > score.sets[0].player2) === first) : null,
    anySetWon: ownSets === null ? null : Number(ownSets > 0), tieBreak: score ? Number(score.tieBreaks > 0) : null,
    won: Number(match.winner === (first ? 1 : 2)) };
}

export function normalizeTennisIdentities(matches) {
  const labels = new Map();
  for (const match of [...matches].sort((a, b) => a.date.localeCompare(b.date))) for (const side of ['player1', 'player2']) {
    const key = playerKey(match, side);
    if (!labels.has(key) || match[`${side}Id`]) labels.set(key, match[side]);
  }
  return matches.map(match => ({ ...match, player1: labels.get(playerKey(match, 'player1')), player2: labels.get(playerKey(match, 'player2')) }));
}

export function rates(values, predicate) {
  const valid = values.filter(value => value !== null && Number.isFinite(value)), hits = valid.filter(predicate).length, n = valid.length;
  if (!n) return { hits: 0, n: 0, missing: values.length, frequency: null, interval: null };
  const p = hits / n, z = 1.95996398454, d = 1 + z * z / n, mid = (p + z * z / (2 * n)) / d, half = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / d;
  return { hits, n, missing: values.length - n, frequency: 100 * p, interval: [100 * Math.max(0, mid - half), 100 * Math.min(1, mid + half)] };
}
