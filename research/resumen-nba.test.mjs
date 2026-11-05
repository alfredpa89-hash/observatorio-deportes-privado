import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { periodReference, combinedTotalReference, spreadTeamLabel, spreadRule } from '../public/resumen-nba.js';

const team = (scored, conceded, n = 20) => ({ periods: { ft: { n, scored: { n, average: scored }, conceded: { n, average: conceded } } } });
test('el total suma puntos a favor y en contra de la misma muestra; el margen los resta', () => {
  assert.deepEqual(periodReference(team(118.1, 112.4), 'ft'), { n: 20, total: 230.5, margin: 118.1 - 112.4 });
  assert.equal(combinedTotalReference([team(118.1, 112.4), team(112.35, 118.6)], 'ft'), (230.5 + 230.95) / 2);
});
test('los faltantes o muestras incompatibles no se convierten en cero; cero real se conserva', () => {
  assert.equal(periodReference(team(null, 110), 'ft'), null);
  assert.equal(periodReference(team(100, 110, 0), 'ft'), null);
  const different = team(100, 110); different.periods.ft.conceded.n = 19;
  assert.equal(periodReference(different, 'ft'), null);
  assert.equal(combinedTotalReference([team(100, 110), team(null, 110)], 'ft'), null);
  assert.deepEqual(periodReference(team(0, 0), 'ft'), { n: 20, total: 0, margin: 0 });
});
test('el handicap identifica al equipo correcto y explica el signo', () => {
  const game = { home: 'Lakers', away: 'Warriors' };
  const home = { spec: { side: 'home', line: -3.5 } }, away = { spec: { side: 'away', line: 3.5 } };
  assert.equal(spreadTeamLabel(game, home), 'Lakers -3.5');
  assert.equal(spreadTeamLabel(game, away), 'Warriors +3.5');
  assert.equal(spreadRule(home), 'Ganar por 4 puntos o mas');
  assert.equal(spreadRule(away), 'Ganar o perder por 3 puntos o menos');
  assert.match(spreadRule({ spec: { line: -3 } }), /devolucion/);
});
test('el resumen conserva los 20 partidos y la antiguedad sin inventar una muestra individual', async () => {
  const report = JSON.parse(await fs.readFile(new URL('../public/resumen-2026-10-21.json', import.meta.url), 'utf8'));
  const expected = [230.725, 235.8, 232.85];
  report.basketball.forEach((game, index) => {
    assert.ok(Math.abs(combinedTotalReference(game.teams, 'ft') - expected[index]) < 1e-8);
    for (const team of game.teams) {
      assert.equal(team.n, 20);
      assert.ok(team.playerReferences.length > 0);
      for (const player of team.playerReferences) {
        assert.ok(player.n > 0 && player.n <= 20);
        assert.ok(Date.parse(player.latest) < Date.parse(report.asOf));
        for (const metric of Object.values(player.metrics)) assert.ok(metric.n <= player.n);
      }
    }
    assert.ok(game.markets.every(market => market.evidence.label === 'Solo referencia historica'));
    assert.ok(game.markets.some(market => market.id === 'spread-home'));
    assert.ok(game.markets.some(market => market.id === 'spread-away'));
  });
});
