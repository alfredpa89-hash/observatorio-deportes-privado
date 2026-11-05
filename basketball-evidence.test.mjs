import test from 'node:test';
import assert from 'node:assert/strict';
import { basketballEvidence, basketballTeamEvidence } from './public/basketball-evidence.js';
import { historyRates } from './public/player-markets.js';
import { priorGames, buildBasketballReport } from './basketball-model.mjs';

const cutoff = '2026-10-19T16:00:00.000Z', season = '2026/2027';
const history = Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, league: 'euroleague', season,
  date: new Date(Date.UTC(2026, 8, 20 + i, 18)).toISOString(), home: 'A', away: 'B', finished: true,
  homePoints: 85, awayPoints: 75, minutes: 30, values: { rebounds: i < 17 ? 5 : 0 },
  stats: { home: { firstQuarterPoints: 20 }, away: { firstQuarterPoints: 19 } } }));

test('selected basketball condition counts explicit zeros and distinguishes missing fields from unfilled history', () => {
  const rows = structuredClone(history); rows[0].values.rebounds = null;
  const rates = historyRates(rows, 'rebounds', [4.5], []);
  assert.equal(rates.lines[0].over.hits, 16); assert.equal(rates.n, 19); assert.equal(rates.missing, 1);
  const evidence = basketballEvidence({ history: rows, validHistory: rows.filter(row => row.values.rebounds !== null), cutoff, season, lookback: 25, kind: 'player' });
  assert.equal(evidence.n, 19); assert.equal(evidence.missing, 1); assert.equal(evidence.unfilled, 5);
  assert.equal(evidence.label, 'Evidencia limitada');
  assert.ok(evidence.reasons.some(reason => /minutos.*sin confirmar/.test(reason)));
});

test('old or previous-only samples stay historical even when all twenty observations exist', () => {
  const old = history.map(row => ({ ...row, season: '2025/2026', date: row.date.replace('2026-', '2025-') }));
  const result = basketballEvidence({ history: old, cutoff, season, lookback: 20 });
  assert.equal(result.n, 20); assert.equal(result.missing, 0); assert.equal(result.previousOnly, true);
  assert.equal(result.label, 'Solo referencia historica'); assert.ok(result.ageDays > 365);
  const recentPrevious = history.map(row => ({ ...row, season: '2025/2026' }));
  assert.equal(basketballEvidence({ history: recentPrevious, cutoff, season, lookback: 20 }).level, 3);
});

test('fresh history is separate from availability and missing dates cannot appear current', () => {
  assert.equal(basketballEvidence({ history, cutoff, season, lookback: 20 }).label, 'Historial disponible');
  assert.equal(basketballEvidence({ history, cutoff, season, lookback: 20, kind: 'player' }).label, 'Disponibilidad por confirmar');
  const invalid = history.map(row => ({ ...row, date: null }));
  const result = basketballEvidence({ history: invalid, cutoff, season, lookback: 20 });
  assert.equal(result.latest, null); assert.equal(result.level, 3);
  assert.equal(basketballEvidence({ history: [], cutoff, season, lookback: 20 }).label, 'Pendiente de datos');
});

test('period support follows the selected field, and the weaker team determines the evidence label', () => {
  const away = history.map((row, i) => ({ ...row, stats: i < 3 ? {} : row.stats }));
  const result = basketballTeamEvidence({ home: history, away }, { period: 'q1' }, { cutoff, season, lookback: 20 });
  assert.equal(result.n, 17); assert.equal(result.missing, 3); assert.equal(result.samples[1].n, 17);
  assert.equal(result.label, 'Evidencia limitada');
  const absent = basketballTeamEvidence({ home: history, away }, { period: 'ht' }, { cutoff, season, lookback: 20 });
  assert.equal(absent.n, 0); assert.equal(absent.label, 'Pendiente de datos');
});

test('evidence inspection preserves predictions and conservative cutoff excludes unfinished-time results', () => {
  const options = { matches: history, league: 'euroleague', season, home: 'A', away: 'B', cutoff, lookback: 20 };
  const report = buildBasketballReport(options), before = structuredClone(report);
  for (const market of report.markets) basketballTeamEvidence(report.history, market.spec, report.meta);
  assert.deepEqual(report, before);
  const overlap = { ...history[0], id: 'overlap', date: '2026-10-19T15:00:00.000Z' };
  assert.equal(priorGames([overlap], cutoff, 'euroleague').length, 0);
  assert.equal(priorGames([{ ...overlap, availableAfter: '2026-10-19T15:30:00.000Z' }], cutoff, 'euroleague').length, 1);
});

test('twenty records with only three current-season matches cannot be labelled a complete current sample', () => {
  const mixed = history.map((row, i) => ({ ...row, season: i < 17 ? '2025/2026' : season }));
  const result = basketballEvidence({ history: mixed, cutoff, season, lookback: 20 });
  assert.equal(result.n, 20); assert.equal(result.currentSeasonN, 3); assert.equal(result.previousSeasonN, 17);
  assert.equal(result.level, 2); assert.ok(result.reasons.some(reason => reason.includes('Solo 3 de 20')));
});
