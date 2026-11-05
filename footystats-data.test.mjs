import test from 'node:test';
import assert from 'node:assert/strict';
import { FOOTYSTATS_COMPETITIONS, footystatsCompetition } from './footystats-competitions.mjs';
import { normalizeFootystatsMatch, importFootystatsSeason } from './footystats-data.mjs';
import { combineFootballHistory } from './football-history.mjs';
import { buildReport } from './model.mjs';

const target = FOOTYSTATS_COMPETITIONS[0], season = { id: 12325, year: '20242025' };
const raw = { id: 1, competition_id: 12325, date_unix: 1723834800, status: 'complete', home_name: 'A', away_name: 'B',
  homeID: 10, awayID: 20, homeGoalCount: 2, awayGoalCount: 1, ht_goals_team_a: 1, ht_goals_team_b: 0, HTGoalCount: 1,
  team_a_corners: 6, team_b_corners: 4, corner_timings_recorded: 2, team_a_fh_corners: 2, team_b_fh_corners: 1,
  team_a_yellow_cards: 2, team_b_yellow_cards: 3, team_a_red_cards: 0, team_b_red_cards: 0, team_a_shots: 10,
  team_b_shots: 7, team_a_shotsOnTarget: 4, team_b_shotsOnTarget: 3, team_a_offsides: -1, team_b_offsides: 1 };

test('FootyStats competition identities match all 27 targets without conflating countries, divisions or cups', () => {
  assert.equal(FOOTYSTATS_COMPETITIONS.length, 27);
  assert.equal(footystatsCompetition({ country: 'England', name: 'England Premier League' }).id, 'premier');
  assert.equal(footystatsCompetition({ country: 'Italy', name: 'Serie A' }).id, 'italy');
  assert.equal(footystatsCompetition({ country: 'Brazil', name: 'Serie A' }).id, 'brazil');
  assert.equal(footystatsCompetition({ country: 'Ecuador', name: 'Primera Categoria Serie B' }).id, 'ecuador-b');
  assert.equal(footystatsCompetition({ country: 'Colombia', name: 'Categoria Primera B' }).id, 'colombia-b');
  assert.equal(footystatsCompetition({ country: 'Europe', name: 'UEFA Europa Conference League' }).id, 'conference');
  assert.equal(footystatsCompetition({ country: 'Portugal', name: 'LigaPro' }), null);
  assert.equal(footystatsCompetition({ country: 'Europe', name: 'UEFA Champions League Women' }), null);
});

test('FootyStats parsing preserves observed zero and missing values, requires actual half corners and rejects identity or extra-time errors', () => {
  const normalized = normalizeFootystatsMatch(raw, target, season);
  assert.equal(normalized.stats.home.red, 0);
  assert.equal(normalized.stats.home.offsides, null);
  assert.equal(normalized.stats.home.fouls, null);
  assert.equal(normalized.halfTime.homeCorners, 2);
  assert.equal(normalizeFootystatsMatch({ ...raw, corner_timings_recorded: 0 }, target, season).halfTime.homeCorners, null);
  assert.equal(normalizeFootystatsMatch({ ...raw, team_a_fh_corners: 50 }, target, season).halfTime.homeCorners, null);
  assert.equal(normalizeFootystatsMatch({ ...raw, HTGoalCount: -1 }, target, season).halfTime.homeGoals, null);
  assert.equal(normalizeFootystatsMatch({ ...raw, competition_id: 999 }, target, season), null);
  assert.equal(normalizeFootystatsMatch({ ...raw, homeGoals: ['102'] }, target, season), null);
  assert.equal(normalizeFootystatsMatch({ ...raw, homeGoals: ['90+5'] }, target, season).homeGoals, 2);
  assert.equal(normalizeFootystatsMatch({ ...raw, status: 'incomplete', date_unix: 1 }, target, season), null);
});

test('FootyStats histories remain isolated from existing sources and provide result, double chance, BTTS, yellow, red and actual half markets', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ ...raw, id: index + 1, date_unix: raw.date_unix + index * 86400 }));
  const legacy = { id: 'legacy', leagueKey: 'api:39', date: '2024-08-01T00:00:00Z', season: 2024, home: 'A', away: 'B', homeGoals: 10, awayGoals: 0, source: 'api-football' };
  const store = { version: 1, leagues: { 'api:39': { key: 'api:39', name: 'Premier League', country: 'England', seasons: [2024], teamsBySeason: { 2024: ['A', 'B'] }, source: 'api-football' } }, matches: [legacy], playerLogs: [{ id: 'old' }], basketball: { frozen: true } };
  const imported = importFootystatsSeason(store, target, season, rows, []);
  assert.equal(imported.results, 20); assert.equal(store.leagues[target.key].source, 'FootyStats');
  importFootystatsSeason(store, target, season, rows, []);
  assert.equal(store.matches.length, 21);
  assert.deepEqual(store.matches.find(row => row.id === 'legacy'), legacy);
  assert.deepEqual(store.playerLogs, [{ id: 'old' }]); assert.deepEqual(store.basketball, { frozen: true });
  const combined = combineFootballHistory(store);
  const combinedLeague = Object.values(combined.leagues).find(row => row.sourceKeys?.includes('api:39'));
  assert.equal(combinedLeague.source, 'combined');
  assert.equal(combined.matches.filter(row => row.leagueKey === combinedLeague.key).length, 21);
  assert.equal(combinedLeague.sources.some(source => source.source === 'FootyStats'), true);
  const report = buildReport({ matches: store.matches.filter(row => row.leagueKey === target.key), leagueKey: target.key, leagueName: target.name,
    season: '2024/2025', home: 'A', away: 'B', cutoff: '2026-10-13T00:00:00Z', lookback: 10 });
  for (const id of ['result-home', 'double-chance-1x', 'btts-yes', 'half-time-result-home', 'half-time-goals-over-0.5',
    'half-time-corners-over-1.5', 'yellow-cards-over-2.5', 'red-cards-over-0.5']) {
    assert.ok(Number.isFinite(report.markets.find(market => market.id === id)?.probability), id);
  }
});
