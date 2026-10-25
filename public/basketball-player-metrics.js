import { wilson } from './player-markets.js';

export const BASKETBALL_PLAYER_METRICS = {
  points: 'Puntos', rebounds: 'Rebotes', assists: 'Asistencias', pra: 'PRA',
  pr: 'Puntos + rebotes', pa: 'Puntos + asistencias', ra: 'Rebotes + asistencias',
  threes: 'Triples anotados', fieldGoalsMade: 'Tiros de campo anotados',
  twoPointersMade: 'Tiros de dos anotados', twoPointersAttempted: 'Tiros de dos intentados',
  fieldGoalsAttempted: 'Tiros de campo intentados', threesAttempted: 'Triples intentados',
  freeThrowsMade: 'Tiros libres anotados', freeThrowsAttempted: 'Tiros libres intentados',
};
export const isCount = value => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const clean = value => isCount(value) ? value : null;
const sum = values => values.every(isCount) ? values.reduce((a, b) => a + b, 0) : null;

export function shootingPair(made, attempted) {
  const pair = [clean(made), clean(attempted)];
  return pair.every(isCount) && pair[0] > pair[1] ? [null, null] : pair;
}

export function shootingConvention(raw) {
  const { points, fieldGoalsMade: field, threes, freeThrowsMade: free } = raw;
  if (![points, field, threes, free].every(isCount) || !threes) return null;
  if (2 * field + threes + free === points && field >= threes) return 'all-field-goals';
  if (2 * field + 3 * threes + free === points) return 'two-point';
  return null;
}

export function normalizeApiShooting(raw, hint) {
  const [providerFieldGoalsMade, providerFieldGoalsAttempted] = shootingPair(raw.fieldGoalsMade, raw.fieldGoalsAttempted);
  const [threes, threesAttempted] = shootingPair(raw.threes, raw.threesAttempted);
  const [freeThrowsMade, freeThrowsAttempted] = shootingPair(raw.freeThrowsMade, raw.freeThrowsAttempted);
  let basis = shootingConvention(raw) || hint || (threes === 0 && threesAttempted === 0 ? 'all-field-goals' : 'unverified');
  const allKnown = [raw.points, providerFieldGoalsMade, threes, freeThrowsMade].every(isCount);
  const expected = basis === 'two-point' ? sum([providerFieldGoalsMade === null ? null : 2 * providerFieldGoalsMade, threes === null ? null : 3 * threes, freeThrowsMade])
    : sum([providerFieldGoalsMade === null ? null : 2 * providerFieldGoalsMade, threes, freeThrowsMade]);
  if (allKnown && basis !== 'unverified' && expected !== raw.points) basis = 'inconsistent';
  let fieldGoalsMade = null, fieldGoalsAttempted = null, twoPointersMade = null, twoPointersAttempted = null;
  if (basis === 'two-point') {
    twoPointersMade = providerFieldGoalsMade; twoPointersAttempted = providerFieldGoalsAttempted;
    fieldGoalsMade = sum([twoPointersMade, threes]); fieldGoalsAttempted = sum([twoPointersAttempted, threesAttempted]);
  } else if (basis === 'all-field-goals') {
    fieldGoalsMade = providerFieldGoalsMade; fieldGoalsAttempted = providerFieldGoalsAttempted;
    twoPointersMade = isCount(fieldGoalsMade) && isCount(threes) && fieldGoalsMade >= threes ? fieldGoalsMade - threes : null;
    twoPointersAttempted = isCount(fieldGoalsAttempted) && isCount(threesAttempted) && fieldGoalsAttempted >= threesAttempted ? fieldGoalsAttempted - threesAttempted : null;
    if (isCount(fieldGoalsMade) && isCount(threes) && fieldGoalsMade < threes || isCount(fieldGoalsAttempted) && isCount(threesAttempted) && fieldGoalsAttempted < threesAttempted) {
      fieldGoalsMade = fieldGoalsAttempted = twoPointersMade = twoPointersAttempted = null; basis = 'inconsistent';
    }
  }
  return { schema: 2, basis, providerFieldGoalsMade, providerFieldGoalsAttempted, fieldGoalsMade, fieldGoalsAttempted,
    twoPointersMade, twoPointersAttempted, threesAttempted, freeThrowsMade, freeThrowsAttempted };
}

export function normalizeLegacyShooting(records) {
  const hints = new Map();
  const key = row => `${row.league}:${row.matchId || `${row.date}:${[row.team, row.opponent].sort().join(':')}`}`;
  for (const row of records) if (row.shooting?.schema === 1) {
    const basis = shootingConvention({ ...row.shooting, points: row.values?.points, threes: row.values?.threes });
    if (basis) { const values = hints.get(key(row)) || new Set(); values.add(basis); hints.set(key(row), values); }
  }
  return records.map(row => row.shooting?.schema === 1 ? { ...row, shooting: normalizeApiShooting({ ...row.shooting, points: row.values?.points, threes: row.values?.threes },
    hints.get(key(row))?.size === 1 ? [...hints.get(key(row))][0] : undefined) } : row);
}

export function playerValues(record) {
  const values = record.values || {}, shooting = record.shooting || {};
  const result = Object.fromEntries(['points', 'rebounds', 'assists', 'threes'].map(key => [key, clean(values[key])]));
  for (const [metric, components] of Object.entries({ pr: ['points', 'rebounds'], pa: ['points', 'assists'], ra: ['rebounds', 'assists'], pra: ['points', 'rebounds', 'assists'] })) {
    result[metric] = sum(components.map(key => result[key]));
  }
  for (const [made, attempted] of [['fieldGoalsMade', 'fieldGoalsAttempted'], ['twoPointersMade', 'twoPointersAttempted'], ['threes', 'threesAttempted'], ['freeThrowsMade', 'freeThrowsAttempted']]) {
    const pair = shootingPair(made === 'threes' ? result.threes : shooting[made], shooting[attempted]);
    [result[made], result[attempted]] = pair;
  }
  return result;
}

export function targetRates(history, rules) {
  if (!Array.isArray(rules) || !rules.length || rules.length > 3 || rules.some(rule => !Object.hasOwn(BASKETBALL_PLAYER_METRICS, rule.metric) || !Number.isInteger(rule.minimum) || rule.minimum < 1 || rule.minimum > 499)) throw new Error('El objetivo necesita de una a tres condiciones, con minimos enteros entre 1 y 499.');
  const played = history.filter(row => typeof row.minutes === 'number' && row.minutes > 0);
  const values = played.map(playerValues).filter(value => rules.every(rule => isCount(value[rule.metric])));
  const hits = values.filter(value => rules.every(rule => value[rule.metric] >= rule.minimum)).length;
  return { hits, n: values.length, missing: played.length - values.length,
    frequency: values.length ? 100 * hits / values.length : null, interval: wilson(hits, values.length) };
}

export function shootingSummary(history) {
  return [['fieldGoalsMade', 'fieldGoalsAttempted', 'Tiros de campo'], ['twoPointersMade', 'twoPointersAttempted', 'Tiros de dos'], ['threes', 'threesAttempted', 'Triples'], ['freeThrowsMade', 'freeThrowsAttempted', 'Tiros libres']].map(([madeKey, attemptedKey, label]) => {
    const pairs = history.map(playerValues).filter(row => isCount(row[madeKey]) && isCount(row[attemptedKey]));
    const made = pairs.reduce((total, row) => total + row[madeKey], 0), attempts = pairs.reduce((total, row) => total + row[attemptedKey], 0);
    return { label, n: pairs.length, missing: history.length - pairs.length, made: pairs.length ? made : null,
      attempts: pairs.length ? attempts : null, percentage: attempts > 0 ? 100 * made / attempts : null };
  });
}

export function defaultTargets(group) {
  const thresholds = { points: [5, 10, 15, 20, 25, 30], rebounds: [2, 4, 6, 8, 10, 12], assists: [2, 4, 6, 8, 10], threes: [1, 2, 3, 4, 5] };
  if (thresholds[group]) return thresholds[group].map(minimum => [{ metric: group, minimum }]);
  return [[['points', 10], ['rebounds', 5]], [['points', 15], ['rebounds', 8]], [['points', 20], ['assists', 5]],
    [['points', 10], ['rebounds', 10]], [['points', 10], ['assists', 10]], [['points', 10], ['rebounds', 10], ['assists', 10]]]
    .map(rules => rules.map(([metric, minimum]) => ({ metric, minimum })));
}
