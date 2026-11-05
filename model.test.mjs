import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReport } from './model.mjs';

function fixture(id, date, season, home, away, homeGoals, awayGoals, stats = null) {
  return {
    id,
    leagueKey: 'league:test',
    season,
    date,
    home,
    away,
    homeGoals,
    awayGoals,
    stats: stats ?? {
      home: { shots: 13, shotsOnTarget: 5, corners: 7, fouls: 12, yellow: 2, red: 0 },
      away: { shots: 9, shotsOnTarget: 3, corners: 4, fouls: 14, yellow: 3, red: 0 },
    },
    source: 'test',
  };
}

function history() {
  const matches = [];
  for (let round = 0; round < 20; round += 1) {
    const day = String(round + 1).padStart(2, '0');
    const date = `2025-01-${day}T12:00:00Z`;
    matches.push(fixture(`a-home-${round}`, date, 2025, 'A', 'C', 3, 0));
    matches.push(fixture(`b-away-${round}`, date, 2025, 'C', 'B', 2, 0));
    matches.push(fixture(`a-away-${round}`, date, 2025, 'D', 'A', 0, 2));
    matches.push(fixture(`b-home-${round}`, date, 2025, 'B', 'D', 0, 2));
  }
  return matches;
}

function report(matches = history(), options = {}) {
  return buildReport({
    matches,
    leagueKey: 'league:test',
    leagueName: 'Liga de prueba',
    season: 2026,
    home: 'A',
    away: 'B',
    lookback: 10,
    cutoff: '2026-06-01T00:00:00Z',
    ...options,
  });
}

function market(result, id) {
  const found = result.markets.find(item => item.id === id);
  assert.ok(found, `Falta el mercado ${id}`);
  return found;
}

test('resultados, ambos marcan y líneas de goles son coherentes', () => {
  const result = report();
  const oneXTwo = ['result-home', 'result-draw', 'result-away']
    .map(id => market(result, id).probability);
  assert.equal(oneXTwo.reduce((sum, value) => sum + value, 0), 100);
  assert.equal(market(result, 'btts-yes').probability +
    market(result, 'btts-no').probability, 100);

  const over15 = market(result, 'goals-over-1.5').probability;
  const over25 = market(result, 'goals-over-2.5').probability;
  const over35 = market(result, 'goals-over-3.5').probability;
  assert.ok(over15 >= over25 && over25 >= over35);
  assert.equal(over25 + market(result, 'goals-under-2.5').probability, 100);
  assert.ok(oneXTwo[0] > oneXTwo[2]);
  assert.equal(result.meta.leagueName, 'Liga de prueba');
});

test('la proyección usa el historial de los equipos y expone promedios comparables', () => {
  const strong = report();
  const weakerMatches = history().map(match => {
    if (match.home === 'A') return { ...match, homeGoals: 0 };
    if (match.away === 'A') return { ...match, awayGoals: 0 };
    return match;
  });
  const weak = report(weakerMatches);
  assert.ok(strong.summary.expectedGoals.home > weak.summary.expectedGoals.home);
  assert.ok(market(strong, 'result-home').probability >
    market(weak, 'result-home').probability);
  assert.ok(strong.summary.expectedGoals.home >
    strong.summary.leagueAverages.goals.home);
  assert.equal(strong.summary.home.averages.corners.n, 10);
  assert.equal(strong.summary.leagueAverages.corners.n, 80);
});

test('los valores ausentes quedan fuera de la muestra y no se interpretan como cero', () => {
  const matches = history().map(match => ({
    ...match,
    stats: {
      home: { ...match.stats.home, corners: null, red: null },
      away: { ...match.stats.away, corners: null },
    },
  }));
  const result = report(matches);
  const corners = market(result, 'corners-over-9.5');
  const cards = market(result, 'cards-over-4.5');
  assert.equal(corners.probability, null);
  assert.equal(corners.n, 0);
  assert.deepEqual(corners.observed.home, {
    hits: 0, n: 0, rate: null, interval95: null,
  });
  assert.equal(cards.probability, null);
  assert.equal(cards.samples.league, 0);
  assert.notEqual(market(result, 'goals-over-2.5').probability, null);
  assert.equal(result.summary.home.averages.corners.for, null);
});

test('las frecuencias muestran intervalos Wilson separados del pronóstico', () => {
  const result = report();
  const observed = market(result, 'result-home').observed.home;
  assert.equal(observed.hits, 10);
  assert.equal(observed.n, 10);
  assert.equal(observed.rate, 100);
  assert.ok(observed.interval95.low < 100);
  assert.equal(observed.interval95.high, 100);
  assert.notEqual(market(result, 'result-home').probability, observed.rate);
});

test('el corte temporal excluye partidos futuros, simultáneos y sin terminar', () => {
  const base = report();
  const extra = [
    fixture('future', '2026-06-02T00:00:00Z', 2026, 'A', 'B', 40, 0),
    fixture('same-time', '2026-06-01T00:00:00Z', 2026, 'A', 'B', 40, 0),
    { ...fixture('live', '2026-05-01T00:00:00Z', 2026, 'A', 'B', 40, 0), status: 'LIVE' },
  ];
  const withExtra = report([...history(), ...extra]);
  assert.deepEqual(withExtra.markets, base.markets);
  assert.deepEqual(withExtra.summary, base.summary);
  assert.ok(withExtra.history.h2h.every(match => !extra.includes(match)));
});

test('temporadas posteriores no entran aunque sus fechas sean anteriores al corte', () => {
  const matches = history();
  const futureSeason = fixture('future-season', '2026-05-01T00:00:00Z',
    '2026/2027', 'A', 'B', 40, 0);
  const selected = report([...matches, futureSeason], { season: '2025/2026' });
  const base = report(matches, { season: '2025/2026' });
  assert.deepEqual(selected.markets, base.markets);
  assert.ok(!selected.history.home.some(match => match.id === 'future-season'));
  assert.equal(selected.history.home.length, 10);
});

test('umbrales personalizados se agregan sin romper el orden de probabilidades', () => {
  const result = report(history(), { thresholds: { corners: [7.5, 12.5, 9.5, 10] } });
  const values = [7.5, 8.5, 9.5, 10.5, 12.5]
    .map(line => market(result, `corners-over-${line}`).probability);
  assert.ok(values.every((value, index) => index === 0 || values[index - 1] >= value));
  assert.equal(market(result, 'corners-over-9.5').probability +
    market(result, 'corners-under-9.5').probability, 100);
  assert.ok(!result.markets.some(item => item.id === 'corners-over-10'));
});

test('cada línea de conteo tiene over y under complementarios', () => {
  const result = report(history(), {
    thresholds: { corners: [12.5], fouls: [19.5], cards: [6.5], shotsOnTarget: [11.5] },
  });
  const lines = {
    goals: [1.5, 2.5, 3.5, 4.5],
    corners: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
    fouls: [19.5, 21.5, 24.5, 27.5],
    cards: [2.5, 3.5, 4.5, 5.5, 6.5],
    'shots-on-target': [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
  };
  for (const [metric, thresholds] of Object.entries(lines)) {
    for (const line of thresholds) {
      const over = market(result, `${metric}-over-${line}`);
      const under = market(result, `${metric}-under-${line}`);
      assert.equal(over.probability + under.probability, 100, `${metric} ${line}`);
      assert.equal(over.observed.home.n, under.observed.home.n);
      assert.equal(over.observed.away.n, under.observed.away.n);
    }
  }
});

test('offsides totals expose complementary lines, averages and valid sample counts', () => {
  const matches = history().map((match, index) => ({ ...match, stats: {
    home: { ...match.stats.home, offsides: index % 5 },
    away: { ...match.stats.away, offsides: 1 },
  } }));
  const result = report(matches);
  const overs = [1.5, 2.5, 3.5, 4.5].map(line => market(result, `offsides-over-${line}`));
  assert.equal(result.markets.filter(item => item.group === 'fuera-de-juego').length, 8);
  assert.ok(overs.every((item, index) => index === 0 || overs[index - 1].probability >= item.probability));
  for (const over of overs) {
    const under = market(result, over.id.replace('-over-', '-under-'));
    assert.equal(over.probability + under.probability, 100);
    assert.equal(over.samples.league, 80);
    for (const side of ['home', 'away']) {
      assert.equal(over.observed[side].n, 10);
      assert.equal(over.observed[side].hits + under.observed[side].hits, 10);
    }
  }
  assert.equal(result.summary.home.averages.offsides.n, 10);
  assert.equal(result.summary.leagueAverages.offsides.total, 3);
});

test('red-card overs count both teams independently of missing yellow cards', () => {
  const matches = history().map((match, index) => ({ ...match, stats: {
    home: { ...match.stats.home, yellow: null, red: index % 3 },
    away: { ...match.stats.away, yellow: null, red: 1 },
  } }));
  const result = report(matches);
  const reds = result.markets.filter(item => item.group === 'tarjetas-rojas');
  assert.deepEqual(reds.map(item => item.id), ['red-cards-over-0.5', 'red-cards-over-1.5', 'red-cards-over-2.5']);
  assert.ok(reds.every((item, index) => Number.isFinite(item.probability) && (index === 0 || reds[index - 1].probability >= item.probability)));
  assert.equal(reds[0].observed.home.hits, 10);
  assert.equal(reds[0].samples.league, 80);
  assert.equal(result.summary.home.averages.red.n, 10);
  assert.equal(market(result, 'cards-over-2.5').probability, null);
});

test('new count markets distinguish explicit zeros from absent or invalid fields', () => {
  for (const metric of ['red', 'offsides']) {
    const withValue = value => history().map(match => ({ ...match, stats: {
      home: { ...match.stats.home, [metric]: value },
      away: { ...match.stats.away, [metric]: 0 },
    } }));
    const id = metric === 'red' ? 'red-cards-over-0.5' : 'offsides-over-1.5';
    const zeros = report(withValue(0));
    assert.equal(market(zeros, id).probability, 0);
    assert.equal(market(zeros, id).samples.league, 80);
    for (const value of [null, undefined, '', -1, 1.5]) {
      const missing = report(withValue(value));
      assert.equal(market(missing, id).probability, null);
      assert.equal(market(missing, id).samples.league, 0);
      assert.equal(missing.summary.home.averages[metric].for, null);
    }
    const partial = report([...withValue(0).slice(0, 2), ...withValue(null).slice(2)]);
    assert.equal(market(partial, id).probability, null);
    assert.equal(market(partial, id).samples.league, 2);
  }
});

test('doble oportunidad complementa el resultado y conserva la orientación de ambos equipos', () => {
  const result = report();
  for (const [id, excluded] of [
    ['double-chance-1x', 'result-away'],
    ['double-chance-x2', 'result-home'],
    ['double-chance-12', 'result-draw'],
  ]) {
    assert.equal(market(result, id).probability + market(result, excluded).probability, 100);
    for (const team of ['home', 'away']) {
      const included = market(result, id).observed[team];
      const excludedObserved = market(result, excluded).observed[team];
      assert.equal(included.hits + excludedObserved.hits, included.n);
      assert.equal(included.n, excludedObserved.n);
    }
  }
  assert.equal(market(result, 'double-chance-1x').observed.home.hits, 10);
  assert.equal(market(result, 'double-chance-x2').observed.away.hits, 0);
  assert.equal(market(result, 'double-chance-12').observed.home.hits, 10);
});

function halfTimeHistory(homeGoals = 1, awayGoals = 0) {
  return history().map(match => ({
    ...match,
    halfTime: {
      homeGoals: Math.min(homeGoals, match.homeGoals),
      awayGoals: Math.min(awayGoals, match.awayGoals),
      homeCorners: 2,
      awayCorners: 1,
    },
  }));
}

test('primer tiempo usa sus propios goles y córners sin modificar los mercados de 90 minutos', () => {
  const result = report(halfTimeHistory());
  const scoreless = report(halfTimeHistory(0, 0));
  const firstHalf = result.markets.filter(item => /-1t$/.test(item.group));
  assert.equal(firstHalf.length, 72);
  assert.equal(firstHalf.filter(item => !item.handicapKind).length, 17);
  assert.deepEqual(result.markets.filter(item => !/-1t$/.test(item.group)),
    scoreless.markets.filter(item => !/-1t$/.test(item.group)));
  assert.ok(market(result, 'half-time-goals-over-0.5').probability > 0);
  assert.equal(market(scoreless, 'half-time-goals-over-0.5').probability, 0);
  assert.equal(market(scoreless, 'half-time-goals-under-0.5').probability, 100);
  const resultIds = ['half-time-result-home', 'half-time-result-draw', 'half-time-result-away'];
  assert.equal(resultIds.reduce((sum, id) => sum + market(result, id).probability, 0), 100);
  assert.deepEqual(resultIds.map(id => market(scoreless, id).probability), [0, 100, 0]);
  assert.equal(market(result, 'half-time-result-home').observed.home.hits, 5);
  assert.equal(market(result, 'half-time-result-home').observed.away.hits, 5);
  assert.equal(market(scoreless, 'half-time-result-draw').observed.home.hits, 10);
  for (const side of ['home', 'away']) {
    assert.equal(resultIds.reduce((sum, id) => sum + market(result, id).observed[side].hits, 0), 10);
    assert.ok(resultIds.every(id => market(result, id).observed[side].n === 10));
  }
  assert.equal(result.summary.home.averages.halfTimeCorners.for, 1.5);
  assert.equal(result.summary.home.averages.halfTimeGoals.n, 10);
  for (const [metric, lines] of [
    ['half-time-goals', [0.5, 1.5, 2.5]],
    ['half-time-corners', [1.5, 2.5, 3.5, 4.5]],
  ]) {
    const probabilities = lines.map(line => {
      const over = market(result, `${metric}-over-${line}`);
      const under = market(result, `${metric}-under-${line}`);
      assert.equal(over.probability + under.probability, 100);
      assert.equal(over.observed.home.hits + under.observed.home.hits, over.observed.home.n);
      assert.equal(over.observed.away.hits + under.observed.away.hits, over.observed.away.n);
      return over.probability;
    });
    assert.ok(probabilities.every((value, index) => index === 0 || probabilities[index - 1] >= value));
  }
});

test('primer tiempo no se infiere de totales y descarta registros incompletos o imposibles', () => {
  const absent = report();
  assert.ok(absent.markets.filter(item => /-1t$/.test(item.group)).every(item => item.probability === null && item.n === 0));
  const valid = halfTimeHistory();
  for (const halfTime of [
    { homeGoals: null, awayGoals: 0 },
    { homeGoals: ' ', awayGoals: 0 },
    { homeGoals: -1, awayGoals: 0 },
    { homeGoals: 0.5, awayGoals: 0 },
    { homeGoals: 40, awayGoals: 0 },
  ]) {
    const result = report(valid.map(match => ({ ...match, halfTime: { ...match.halfTime, ...halfTime } })));
    assert.equal(market(result, 'half-time-goals-over-0.5').probability, null);
    for (const id of ['half-time-result-home', 'half-time-result-draw', 'half-time-result-away']) {
      assert.equal(market(result, id).probability, null);
      assert.equal(market(result, id).observed.home.n, 0);
    }
    assert.equal(result.summary.home.averages.halfTimeGoals.n, 0);
    assert.notEqual(market(result, 'half-time-corners-over-1.5').probability, null);
    assert.deepEqual(market(result, 'goals-over-2.5'), market(absent, 'goals-over-2.5'));
  }
  const invalidCorners = report(valid.map(match => ({
    ...match, halfTime: { ...match.halfTime, homeCorners: match.stats.home.corners + 1 },
  })));
  assert.equal(market(invalidCorners, 'half-time-corners-over-1.5').probability, null);
  assert.notEqual(market(invalidCorners, 'half-time-goals-over-0.5').probability, null);
});

test('sin historia no se inventan porcentajes ni se aceptan campos vacíos', () => {
  const result = report([
    fixture('blank-date', null, 2026, 'A', 'B', 2, 1),
    fixture('blank-goal', '2026-01-01T00:00:00Z', 2026, 'A', 'B', ' ', 1),
  ]);
  assert.equal(result.history.home.length, 0);
  assert.equal(result.summary.expectedGoals, null);
  assert.equal(result.quality.status, 'unavailable');
  assert.ok(result.markets.every(item => item.probability === null));
});
