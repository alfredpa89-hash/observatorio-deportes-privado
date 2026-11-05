import assert from 'node:assert/strict';
import test from 'node:test';
import { leagueSearch, searchApiLeagues, matchesLeague, individualLeagues } from './public/football-leagues.js';

test('Spanish league searches resolve countries and do not confuse Italian and Brazilian Serie A', () => {
  for (const [query, country, name] of [['Liga española', 'Spain', 'La Liga'], ['Liga italiana', 'Italy', 'Serie A'], ['Liga francesa', 'France', 'Ligue 1'], ['Liga alemana', 'Germany', 'Bundesliga'], ['Liga brasileña', 'Brazil', 'Serie A']]) {
    const target = leagueSearch(query); assert.deepEqual(target, { query: country, country, name });
    const candidates = [{ sourceType: 'api', country, name }, { sourceType: 'api', country: 'Wrong', name }, { sourceType: 'free', country, name }];
    assert.deepEqual(searchApiLeagues(candidates, target), [candidates[0]]);
  }
  assert.equal(leagueSearch('Otra liga').query, 'Otra liga');
  assert.equal(searchApiLeagues([{ sourceType: 'api', name: 'Copa' }, { sourceType: 'saved' }], leagueSearch('Otro pais')).length, 1);
});

test('individual navigation prioritizes API, retains CSV individuals, and searches Spanish aliases', () => {
  const catalog = [
    { name: 'La Liga', country: 'Spain', source: 'Football-Data', seasonsInfo: { 2024: { records: 0 } } },
    { name: 'La Liga', country: 'Spain', source: 'api-football', seasonsInfo: { 2024: { records: 5 } } },
    { name: 'Archivo personal', country: 'Chile', source: 'csv', seasonsInfo: { 2024: { records: 2 } } },
  ];
  assert.equal(individualLeagues(catalog).length, 2); assert.equal(individualLeagues(catalog)[0].source, 'api-football');
  assert.equal(individualLeagues(catalog, 'all').length, 3); assert.equal(catalog[0].source, 'Football-Data');
  for (const query of ['LaLiga', 'Liga española', 'España']) assert.equal(matchesLeague(catalog[1], query), true);
  assert.equal(matchesLeague(catalog[1], 'Serie A'), false);
});

test('Dutch, Portuguese and international player searches keep competitions distinct', () => {
  for (const [query, country, name] of [['Everdise', 'Netherlands', 'Eredivisie'], ['Liga holandesa', 'Netherlands', 'Eredivisie'], ['Liga de Portugal', 'Portugal', 'Primeira Liga'], ['Champions', 'World', 'UEFA Champions League'], ['Europa League', 'World', 'UEFA Europa League'], ['Conference League', 'World', 'UEFA Europa Conference League'], ['Libertadores', 'World', 'CONMEBOL Libertadores'], ['Sudamericana', 'World', 'CONMEBOL Sudamericana']]) {
    const target = leagueSearch(query);
    assert.equal(target.query, country);
    const candidates = [{ sourceType: 'api', country, name }, { sourceType: 'api', country, name: name + ' Women' }, { sourceType: 'api', country, name: name + ' U20' }, { sourceType: 'saved', country, name }];
    assert.deepEqual(searchApiLeagues(candidates, target), [candidates[0]]);
    assert.equal(matchesLeague({ country, name }, query), true);
  }
  const conference = { sourceType: 'api', country: 'World', name: 'UEFA Conference League' };
  assert.deepEqual(searchApiLeagues([conference], leagueSearch('Conference League')), [conference]);
  assert.equal(matchesLeague(conference, 'Conference'), true);
  assert.equal(matchesLeague({ country: 'World', name: 'CONMEBOL Sudamericana' }, 'Libertadores'), false);
  assert.equal(matchesLeague({ country: 'Netherlands', name: 'Eredivisie' }, 'Países Bajos'), true);
});

test('combined leagues remain searchable in Spanish and eligible for API player navigation', () => {
  const league = { key: 'competition:brazil:brasileirao-serie-a', name: 'Brasileirao Serie A', country: 'Brazil', source: 'combined', sourceKeys: ['football-data:BRA', 'api:71'], seasonsInfo: {} };
  assert.equal(matchesLeague(league, 'Liga brasilena'), true);
  assert.equal(matchesLeague(league, 'Serie A Brasil'), true);
  assert.deepEqual(individualLeagues([league]), [league]);
  assert.equal(matchesLeague({ name: 'Serie A', country: 'Italy' }, 'Liga brasilena'), false);
});

test('Ecuador and Colombia second divisions, Chile and Uruguay searches exclude other divisions', () => {
  for (const [query, country, name] of [['Serie B de Ecuador', 'Ecuador', 'Liga Pro Serie B'], ['Serie B de Colombia', 'Colombia', 'Primera B'],
    ['Liga de Chile', 'Chile', 'Primera Division'], ['Liga de Uruguay', 'Uruguay', 'Primera Division']]) {
    const target = leagueSearch(query);
    const allowed = { sourceType: 'api', country, name };
    assert.equal(target.country, country);
    assert.deepEqual(searchApiLeagues([allowed, { ...allowed, country: 'Argentina' }, { ...allowed, name: name + ' Women' }, { ...allowed, name: 'Segunda Division' }], target), [allowed]);
    assert.equal(matchesLeague(allowed, query), true);
  }
  const clausura = { sourceType: 'api', country: 'Uruguay', name: 'Primera Division - Clausura' };
  assert.deepEqual(searchApiLeagues([clausura], leagueSearch('Liga de Uruguay')), [clausura]);
});
