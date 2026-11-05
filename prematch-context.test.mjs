import test from 'node:test';
import assert from 'node:assert/strict';
import { performanceSignals, buildPrematchBrief } from './prematch-context.mjs';
import { contextSources, contextNewsDomains } from './context-sources.mjs';

const cutoff = '2026-10-18T18:00:00Z';
const game = (i, values = {}, other = {}) => ({ id: String(i), date: `2026-10-${String(17 - i).padStart(2, '0')}T18:00:00Z`, result: i % 2 ? 'L' : 'W', values, source: 'Test', ...other });

test('performance uses exact windows, keeps zeros, counts missing metrics and never calls a frequency a forecast', () => {
  const history = Array.from({ length: 10 }, (_, i) => game(i, { points: i < 5 ? 20 : 10 }, { minutes: i === 0 ? 0 : 30 }));
  const before = structuredClone(history);
  const result = performanceSignals({ sport: 'basketball', kind: 'player', history, cutoff, referencePoints: 20 });
  const line = result.find(row => row.id === 'point-reference'); assert.equal(line.n, 10); assert.match(line.detail, /5 de 10/);
  assert.match(line.detail, /no probabilidad/); assert.match(result.find(row => row.id === 'trend-ten').detail, /20 frente a 10/);
  assert.match(result.find(row => row.id === 'minutes-five').detail, /24 min/); assert.deepEqual(history, before);
  history[1].values.points = null;
  const partial = performanceSignals({ sport: 'basketball', kind: 'player', history, cutoff, referencePoints: 20 });
  assert.ok(!partial.some(row => row.id === 'trend-ten'));
  assert.equal(partial.find(row => row.id === 'point-reference').n, 9); assert.equal(partial.find(row => row.id === 'point-reference').missing, 1);
});

test('football halftime and both-score signals retain separate denominators without inventing sanctions', () => {
  const history = Array.from({ length: 5 }, (_, i) => game(i, { goals: i === 0 ? 0 : 2, goalsAgainst: 1, halfTimeGoalsTotal: i < 3 ? 1 : null }));
  const result = performanceSignals({ sport: 'football', kind: 'team', history, cutoff });
  assert.match(result.find(row => row.id === 'btts').detail, /4 de 5/);
  assert.equal(result.find(row => row.id === 'first-half-goal').n, 3); assert.equal(result.find(row => row.id === 'first-half-goal').missing, 2);
  assert.ok(!JSON.stringify(result).includes('suspension'));
});

test('tennis and all sports reject future, duplicate and not-yet-available results without manufacturing workload', () => {
  const history = [game(0, { won: true, aces: 8 }, { datePrecision: 'tournament-week' }), game(1, { won: false }), game(2, { won: true }),
    game(0, { won: true }), game(3, { won: true }, { availableAfter: '2026-10-19T18:00:00Z' }), game(4, { won: true }, { date: '2026-11-01T00:00:00Z' })];
  const result = performanceSignals({ sport: 'tennis', kind: 'player', history, cutoff });
  assert.equal(result.length, 1); assert.match(result[0].detail, /2 de 3/);
  assert.ok(!/descanso|lesion|fatiga/.test(JSON.stringify(result)));
});

test('brief prioritizes reported availability, never treats a missing report as healthy and excludes withdrawn or expired notes', () => {
  const scope = { sport: 'football', country: 'England', entities: [{ id: 'team:a', name: 'A', team: 'A', kind: 'team', n: 5, partial: true,
    signals: [{ id: 'form', title: 'Forma', category: 'performance', evidence: 'historical' }] }] };
  const notes = [{ id: 'one', entityId: 'team:a', category: 'injury', title: 'One', expired: true },
    { id: 'two', entityId: 'team:a', category: 'injury', title: 'Two', withdrawn: true },
    { id: 'three', entityId: 'team:a', category: 'competition', title: 'Three', review: { action: 'reviewed' } }];
  let brief = buildPrematchBrief(scope, notes);
  assert.equal(brief.coverage[0].availability, 0); assert.equal(brief.coverage[0].reviewed, 1);
  assert.deepEqual(brief.items.map(row => row.id), ['three', 'team:a:form']);
  brief = buildPrematchBrief(scope, notes, [{ id: 'out', team: 'A', playerKey: 'api:1', name: 'Player', status: 'out' }, { id: 'other', team: 'B', status: 'out' }]);
  assert.equal(brief.items[0].id, 'availability:out'); assert.equal(brief.items[0].evidence, 'reported'); assert.equal(brief.coverage[0].availability, 1);
});

test('source directory follows competition and marks links as external, not active integrations', () => {
  const nba = contextSources({ sport: 'basketball', key: 'nba' }); assert.ok(nba.some(row => row.name === 'NBA Official'));
  assert.ok(!nba.some(row => row.url.includes('acb.com')));
  const endesa = contextSources({ sport: 'basketball', key: 'endesa' }); assert.equal(endesa.length, 1); assert.ok(endesa[0].url.includes('acb.com'));
  const tennis = contextSources({ sport: 'tennis' }); assert.ok(tennis.some(row => row.url.includes('wtatennis.com')));
  for (const row of [...nba, ...endesa, ...tennis, ...contextSources({ sport: 'football', country: 'Spain' })]) {
    assert.equal(row.access, 'external'); assert.match(row.status, /no sincronizado|sin sincronizacion automatica/); assert.equal(new URL(row.url).protocol, 'https:');
  }
});

test('domestic football sources and candidate domains follow the stored country, including both second divisions', () => {
  for (const [country, domain] of [['Ecuador', 'ligapro.ec'], ['Colombia', 'dimayor.com.co'], ['Peru', 'liga1.pe'], ['Chile', 'anfp.cl'],
    ['Uruguay', 'auf.org.uy'], ['Paraguay', 'apf.org.py'], ['Brazil', 'cbf.com.br'], ['Argentina', 'ligaprofesional.ar'],
    ['USA', 'mlssoccer.com'], ['Mexico', 'ligamx.net'], ['Portugal', 'ligaportugal.pt'], ['Netherlands', 'eredivisie.nl']]) {
    const scope = { sport: 'football', country }; assert.ok(contextSources(scope)[0].url.includes(domain));
    assert.ok(contextNewsDomains(scope).includes(domain)); assert.ok(!contextNewsDomains(scope).includes('api-sports.io'));
  }
  assert.ok(contextSources({ sport: 'football', country: 'Europe', key: 'conference-league' })[0].url.includes('uefa.com'));
  assert.ok(contextSources({ sport: 'football', country: 'South America', key: 'libertadores' })[0].url.includes('conmebol.com'));
});
