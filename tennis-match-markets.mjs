import { completeScore, count, playerKey, rates } from './tennis-stats.mjs';

const percent = value => Math.round(value * 10000) / 100;
const signed = value => `${value > 0 ? '+' : ''}${value}`;
export const TENNIS_GAME_HANDICAPS = Array.from({ length: 22 }, (_, i) => i - 10.5);

// Read recorded set scores; never use a fraction of a full-match total.
function scoreFor(match, key, bestOf) {
  if (match.bestOf !== bestOf || match.completed === false || match.retired || ![1, 2].includes(match.winner)) return null;
  const score = completeScore(match.score, bestOf);
  if (!score || (score.wins1 > score.wins2 ? 1 : 2) !== match.winner) return null;
  const first = playerKey(match, 'player1') === key;
  if (!first && playerKey(match, 'player2') !== key) return null;
  const games1 = score.sets.reduce((sum, set) => sum + set.player1, 0), games2 = score.sets.reduce((sum, set) => sum + set.player2, 0);
  for (const [field, expected] of [['player1Games', games1], ['player2Games', games2], ['totalGames', games1 + games2], ['totalSets', score.sets.length]]) {
    if (match[field] !== null && match[field] !== undefined && count(match[field]) !== expected) return null;
  }
  return { won: first ? score.wins1 : score.wins2, lost: first ? score.wins2 : score.wins1, margin: first ? games1 - games2 : games2 - games1 };
}

function choose(n, k) {
  let result = 1;
  for (let i = 1; i <= k; i++) result = result * (n - i + 1) / i;
  return result;
}
const scoreWeight = (q, target, lost) => choose(target + lost - 1, lost) * q ** target * (1 - q) ** lost;
function matchWin(q, target) {
  return Array.from({ length: target }, (_, lost) => scoreWeight(q, target, lost)).reduce((a, b) => a + b, 0);
}
function setChance(probability, target) {
  let low = 0, high = 1;
  for (let i = 0; i < 64; i++) {
    const middle = (low + high) / 2;
    if (matchWin(middle, target) < probability) low = middle; else high = middle;
  }
  return (low + high) / 2;
}
// Round each winner's score probabilities together to preserve its Elo total.
function distribute(weights, total) {
  const units = Math.round(total * 100), sum = weights.reduce((a, b) => a + b, 0);
  if (!units) return weights.map(() => 0);
  const raw = weights.map(weight => units * weight / sum), values = raw.map(Math.floor);
  const order = raw.map((value, i) => ({ i, remainder: value - values[i] })).sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (let remaining = units - values.reduce((a, b) => a + b, 0), i = 0; i < remaining; i++) values[order[i].i]++;
  return values.map(value => value / 100);
}

export function buildTennisMatchMarkets({ a, b, matches, bestOf, winnerProbability, handicapLine = -2.5 }) {
  if (![3, 5].includes(bestOf)) throw new Error('El formato debe ser al mejor de 3 o 5 sets.');
  if (typeof handicapLine !== 'number' || !Number.isFinite(handicapLine) || Math.abs(handicapLine) > 30.5 || Math.abs(handicapLine) % 1 !== .5) {
    throw new Error('El handicap de juegos debe terminar en .5, entre -30.5 y +30.5.');
  }
  const players = [a, b], scores = players.map(player => player.history.map(row => scoreFor(row, player.player.key, bestOf)));
  const samples = { home: scores[0].filter(Boolean).length, away: scores[1].filter(Boolean).length,
    context: new Set(matches.filter(match => scoreFor(match, playerKey(match, 'player1'), bestOf)).map(match => match.id)).size };
  const lines = [...new Set([...TENNIS_GAME_HANDICAPS, handicapLine, -handicapLine])].sort((a, b) => a - b);
  const handicaps = players.flatMap((player, side) => lines.map(line => ({
    id: `games-handicap-${side + 1}-${line}`, playerKey: player.player.key, playerName: player.player.name, line,
    label: `${player.player.name} ${signed(line)} juegos`, selected: line === (side === 0 ? handicapLine : -handicapLine),
    ...rates(scores[side].map(score => score?.margin ?? null), value => value + line > 0),
  })));
  const target = (bestOf + 1) / 2, eligible = samples.home >= 5 && samples.away >= 5 && samples.context >= 10 &&
    typeof winnerProbability === 'number' && Number.isFinite(winnerProbability) && winnerProbability >= 0 && winnerProbability <= 100;
  const q = eligible ? setChance(winnerProbability / 100, target) : null;
  const rows = players.flatMap((player, side) => {
    const probabilities = eligible ? distribute(Array.from({ length: target }, (_, lost) => scoreWeight(side === 0 ? q : 1 - q, target, lost)), side === 0 ? winnerProbability : 100 - winnerProbability) : Array(target).fill(null);
    return Array.from({ length: target }, (_, lost) => ({
      id: `sets-score-${side + 1}-${target}-${lost}`, playerKey: player.player.key, playerName: player.player.name,
      opponentName: players[1 - side].player.name, setsWon: target, setsLost: lost,
      label: `${player.player.name} gana ${target}-${lost}`, probability: probabilities[lost],
      historical: { winner: rates(scores[side].map(score => score ? Number(score.won === target && score.lost === lost) : null), value => value === 1),
        opponent: rates(scores[1 - side].map(score => score ? Number(score.won === lost && score.lost === target) : null), value => value === 1) },
    }));
  });
  return { handicapLine, handicaps, setScores: { version: 'tennis-set-score-research-v1', bestOf, samples, rows,
    status: eligible ? 'experimental' : 'unavailable', setWinProbability: q === null ? null : percent(q),
    method: 'Desglose del ganador Elo existente suponiendo sets independientes y la misma probabilidad de ganar cada set. Sin calibracion propia; no modela lesiones ni cambios durante el partido.',
    reason: eligible ? null : 'Sin estimacion: se necesitan cinco marcadores completos por jugador, diez de contexto y una estimacion de ganador disponible.' } };
}
