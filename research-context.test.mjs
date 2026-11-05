import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchContext, publicContextUrl } from './research-context.mjs';
import { createContextReader } from './context-data.mjs';

const instant = '2026-10-18T15:00:00.000Z', hour = 3600000;
function setup(request) {
  let clock = new Date(instant), writes = 0;
  const store = { basketball: { trial: { version: 'frozen', snapshots: [{ id: 'sealed' }] }, inputs: { sealed: 'unchanged' } }, tennisLab: { snapshots: [] } };
  const read = body => ({ sport: 'basketball', key: 'nba', season: '2026/2027', cutoff: body.cutoff || clock.toISOString(),
    fixtureId: body.fixtureId || null,
    entities: (body.names || ['Alpha Team']).map(name => ({ id: `team:${name}`, name, team: name, kind: 'team', n: 3, facts: [] })),
    availability: body.availability || [], historicalCutoff: clock.getTime() - Date.parse(body.cutoff || clock) > 24 * hour, limits: [] });
  const service = createResearchContext({ getStore: () => store, persist: async () => { writes++; }, read, now: () => clock, request });
  return { store, service, advance: ms => { clock = new Date(clock.getTime() + ms); }, writes: () => writes };
}
const note = { entityId: 'team:Alpha Team', category: 'injury', title: 'Reporte de prueba', note: 'Ejemplo ficticio con fuente, sin diagnosticar ni modificar el modelo.',
  sourceUrl: 'https://www.nba.com/news/test', publishedAt: '2026-10-18T14:00:00Z', expiresAt: '2026-10-19T14:00:00Z' };

test('context reports retain native scopes, timestamps and expiry without changing frozen predictions', async () => {
  const { store, service, advance } = setup(); const frozen = JSON.stringify([store.basketball, store.tennisLab]);
  await service.saveNote(note);
  assert.equal(service.summary({}).notes[0].verification, 'manual-unverified');
  assert.equal(service.summary({ cutoff: '2026-10-18T14:30:00Z' }).notes.length, 0, 'recorded later is not historical evidence');
  await assert.rejects(service.saveNote({ ...note, entityId: 'team:Other' }), /Identidad/);
  await assert.rejects(service.saveNote({ ...note, cutoff: '2026-10-01T00:00:00Z' }), /historico/);
  await assert.rejects(service.saveNote({ ...note, publishedAt: '2026-11-01T00:00:00Z' }), /futuro/);
  await assert.rejects(service.saveNote({ ...note, expiresAt: '2026-12-01T00:00:00Z' }), /30 dias/);
  advance(2 * 24 * hour);
  assert.equal(service.summary({}).notes[0].expired, true);
  assert.equal(JSON.stringify([store.basketball, store.tennisLab]), frozen);
});
test('latest expired availability cannot revive an older healthy status or another fixture', () => {
  const { service } = setup();
  const records = [{ playerKey: 'native:1', status: 'active', publishedAt: '2026-10-17T12:00:00Z', recordedAt: '2026-10-17T12:00:00Z', expiresAt: '2026-10-20T00:00:00Z' },
    { playerKey: 'native:1', status: 'out', publishedAt: '2026-10-18T12:00:00Z', recordedAt: '2026-10-18T12:00:00Z', expiresAt: '2026-10-18T14:00:00Z' }];
  const result = service.summary({ availability: records });
  assert.equal(result.availability.length, 1); assert.equal(result.availability[0].status, 'out'); assert.equal(result.availability[0].expired, true);
  assert.equal(service.summary({ availability: [{ ...records[0], expiresAt: null }] }).availability[0].expired, true, 'unknown expiry cannot certify a current report');
});

test('review is a timestamped human action, cannot leak into an earlier cutoff and leaves predictions untouched', async () => {
  const { store, service, advance } = setup(); const frozen = JSON.stringify(store.basketball);
  const record = await service.saveNote(note); advance(hour);
  await service.reviewNote({ noteId: record.id, action: 'reviewed' });
  let summary = service.summary({}); assert.equal(summary.notes[0].review.action, 'reviewed');
  assert.equal(summary.brief.items[0].evidence, 'user-reviewed'); assert.equal(summary.notes[0].verification, 'manual-unverified');
  const beforeReview = service.summary({ cutoff: '2026-10-18T15:30:00Z' });
  assert.equal(beforeReview.notes[0].review, null); assert.equal(beforeReview.notes[0].reviews.length, 0);
  assert.equal(beforeReview.brief.items[0].evidence, 'unverified');
  await assert.rejects(service.reviewNote({ noteId: record.id, action: 'reviewed', names: ['Beta Team'] }), /seleccion/);
  await assert.rejects(service.reviewNote({ noteId: record.id, action: 'confirmed-by-api' }), /Accion/);
  advance(hour); await service.reviewNote({ noteId: record.id, action: 'withdrawn' });
  summary = service.summary({}); assert.equal(summary.notes[0].withdrawn, true); assert.equal(summary.brief.items.length, 0);
  assert.equal(summary.notes[0].reviews.length, 2); assert.equal(JSON.stringify(store.basketball), frozen);
  await service.reviewNote({ noteId: record.id, action: 'unreviewed' }); assert.equal(service.summary({}).brief.items[0].evidence, 'unverified');
});

test('different player reports coexist, fixture-specific reports stay local, and withdrawn reports do not revive older versions', async () => {
  const { service, advance } = setup();
  await service.saveNote({ ...note, subject: 'Player A' });
  await service.saveNote({ ...note, subject: 'Player B' });
  const fixture = await service.saveNote({ ...note, fixtureId: 'game-one', subject: 'Player C' });
  assert.equal(service.summary({}).notes.length, 2);
  assert.equal(service.summary({ fixtureId: 'game-one' }).notes.length, 3);
  assert.equal(service.summary({ fixtureId: 'game-two' }).notes.length, 2);
  await assert.rejects(service.reviewNote({ noteId: fixture.id, action: 'reviewed', fixtureId: 'game-two' }), /seleccion/);
  advance(hour);
  const replacement = await service.saveNote({ ...note, subject: 'player a', title: 'Correccion del reporte' });
  await service.reviewNote({ noteId: replacement.id, action: 'withdrawn' });
  assert.equal(service.summary({}).notes.length, 2); assert.equal(service.summary({}).brief.items.length, 1);
});
test('news requests are bounded, cached and official-domain candidates, never medical or model facts', async () => {
  let calls = 0;
  const { store, service, writes } = setup(async (input, options) => {
    calls++; const url = new URL(input);
    assert.equal(url.hostname, 'api.gdeltproject.org'); assert.equal(url.searchParams.get('maxrecords'), '10');
    assert.match(url.searchParams.get('query'), /"Alpha Team"/); assert.equal(options.redirect, 'error');
    return Response.json({ articles: [
      { title: 'Alpha Team publishes a report', url: 'https://www.nba.com/news/alpha', seendate: '20261018T140000Z' },
      { title: 'Duplicate', url: 'https://www.nba.com/news/alpha#x', seendate: '20261018T140000Z' },
      { title: 'Spoofed domain', url: 'https://nba.com.attacker.org/story', seendate: '20261018T140000Z' },
      { title: 'Private address', url: 'https://127.0.0.1/story', seendate: '20261018T140000Z' },
      { title: 'Secret query', url: 'https://nba.com/story?token=do-not-keep', seendate: '20261018T140000Z' },
      { title: 'Future result', url: 'https://nba.com/future', seendate: '20261118T140000Z' },
    ] });
  });
  const before = JSON.stringify(store.basketball), result = await service.refresh({});
  assert.equal(result.requests, 1); assert.equal(calls, 1); assert.equal(result.news.items.length, 1);
  assert.equal(result.news.items[0].publishedAt, null); assert.equal(result.news.items[0].verification, 'candidate');
  assert.equal(result.news.diagnostic.code, 'ok'); assert.equal(result.news.diagnostic.httpStatus, 200);
  assert.equal(result.news.nextAttemptAt, '2026-10-18T21:00:00.000Z');
  assert.equal((await service.refresh({})).requests, 0); assert.equal(calls, 1);
  assert.equal(service.summary({ cutoff: '2026-10-01T00:00:00Z' }).news.items.length, 0);
  assert.equal(writes(), 2); assert.equal(JSON.stringify(store.basketball), before);
  assert.ok(!JSON.stringify(store.researchContext).includes('do-not-keep'));
});
test('news outages preserve previous articles and successful timestamp, honor pause and consume a failed request once', async () => {
  let failing = false;
  const { service, advance, store } = setup(async () => failing ? new Response('busy', { status: 429, headers: { 'retry-after': '86400' } }) : Response.json({ articles: [
    { title: 'An official headline', url: 'https://nba.com/news/one', seendate: '20261018T140000Z' },
  ] }));
  const first = await service.refresh({}); advance(7 * hour); failing = true;
  const failed = await service.refresh({});
  assert.equal(failed.news.items.length, 1); assert.equal(failed.news.checkedAt, first.news.checkedAt);
  assert.match(failed.news.warning, /conserva/); assert.equal(store.researchContext.quota.count, 2);
  assert.equal(failed.news.diagnostic.code, 'rate_limited'); assert.equal(failed.news.diagnostic.httpStatus, 429);
  assert.equal(store.researchContext.cooldownUntil, '2026-10-19T22:00:00.000Z');
  assert.equal((await service.refresh({})).requests, 0);
  const other = await service.refresh({ names: ['Beta Team'] });
  assert.equal(other.requests, 0); assert.equal(other.news.providerHealth.code, 'rate_limited');
  assert.equal(other.news.nextAttemptAt, '2026-10-19T22:00:00.000Z');
  assert.equal(other.news.blockedReason, 'provider_pause');
  await assert.rejects(service.refresh({ cutoff: '2026-09-01T00:00:00Z' }), /anterior/);
});

test('timeouts have a bounded manual retry window, not a six-hour success cache or an automatic retry', async () => {
  let calls = 0;
  const { service, store, advance } = setup(async () => {
    calls++; if (calls === 1) throw new DOMException('upstream detail must not be stored', 'TimeoutError');
    return Response.json({ articles: [] });
  });
  const result = await service.refresh({});
  assert.equal(result.news.diagnostic.code, 'timeout'); assert.equal(result.news.checkedAt, null);
  assert.equal(result.news.nextAttemptAt, '2026-10-18T15:15:00.000Z');
  advance(14 * 60000); assert.equal((await service.refresh({})).requests, 0); assert.equal(calls, 1);
  advance(60000); const success = await service.refresh({});
  assert.equal(calls, 2); assert.equal(success.news.diagnostic.code, 'empty'); assert.equal(success.news.warning, null);
  assert.equal(success.news.nextAttemptAt, '2026-10-18T21:15:00.000Z');
  assert.equal(success.news.providerHealth.code, 'empty');
  assert.ok(!JSON.stringify(store).includes('upstream detail'));
});

test('provider, DNS and unusable responses have separate sanitized diagnostics and preserve a previous success', async () => {
  for (const [response, code, httpStatus] of [
    [() => new Response('secret provider text', { status: 503 }), 'provider_unavailable', 503],
    [() => new Response('invalid query detail', { status: 400 }), 'rejected', 400],
    [() => { throw Object.assign(new Error('private URL'), { cause: { code: 'ENOTFOUND' } }); }, 'dns_error', null],
    [() => { throw new Error('private URL'); }, 'network_error', null],
    [() => new Response('<html>secret</html>'), 'invalid_response', 200],
    [() => Response.json(null), 'invalid_response', 200],
    [() => Response.json({ error: 'secret' }), 'invalid_response', 200],
  ]) {
    let failing = false;
    const { service, advance, store } = setup(async () => failing ? response() : Response.json({ articles: [
      { title: 'An official headline', url: 'https://nba.com/news/one', seendate: '20261018T140000Z' },
    ] }));
    const before = await service.refresh({}); advance(7 * hour); failing = true;
    const failed = await service.refresh({});
    assert.equal(failed.news.diagnostic.code, code); assert.equal(failed.news.diagnostic.httpStatus, httpStatus);
    assert.equal(failed.news.items.length, 1); assert.equal(failed.news.checkedAt, before.news.checkedAt);
    assert.equal(failed.news.nextAttemptAt, '2026-10-18T22:15:00.000Z');
    assert.ok(!/secret|private URL|invalid query detail/.test(JSON.stringify(store)));
  }
});

test('legacy failure caches do not trigger unexpected retries and the daily cap reports its reset without a request', async () => {
  let calls = 0; const { service, store, advance } = setup(async () => { calls++; return Response.json({ articles: [] }); });
  await service.refresh({});
  const entry = Object.values(store.researchContext.news)[0];
  delete entry.nextAttemptAt; delete entry.diagnostic; delete entry.checkedAt; entry.warning = 'Fallo antiguo';
  assert.equal(service.summary({}).news.diagnostic.code, 'unknown_error');
  assert.equal(service.summary({}).news.nextAttemptAt, '2026-10-18T21:00:00.000Z');
  assert.equal((await service.refresh({})).requests, 0);
  advance(7 * hour); store.researchContext.quota.count = 60;
  const capped = await service.refresh({});
  assert.equal(capped.requests, 0); assert.equal(capped.news.blockedReason, 'daily_limit');
  assert.equal(capped.news.nextAttemptAt, '2026-10-19T00:00:00.000Z'); assert.equal(calls, 1);
});
test('context links reject credentials, private IPs, key fragments and non-HTTPS URLs', () => {
  for (const url of ['http://nba.com/news', 'https://user:pass@nba.com/', 'https://127.0.0.1/news', 'https://localhost/news', 'https://nba.com/?api_key=secret', 'https://nba.com/#token=secret']) assert.throws(() => publicContextUrl(url));
  assert.equal(publicContextUrl('https://www.nba.com/news').hostname, 'www.nba.com');
});
test('football context uses guarded history and never turns cards into current suspensions or motivation', () => {
  const store = { leagues: { 'api:39': { key: 'api:39', name: 'Premier League', country: 'England', source: 'api-football', seasons: [2024], teamsBySeason: { 2024: ['A', 'B'] } } },
    contextReports: [{ key: 'api:39', sport: 'football', season: '2024', team: 'A', fixtureId: 'other-game', publishedAt: '2026-10-18T14:00:00Z', recordedAt: '2026-10-18T14:00:00Z', expiresAt: '2026-10-19T14:00:00Z' }],
    matches: [{ id: 'a', leagueKey: 'api:39', season: 2024, date: '2024-11-10T15:00:00Z', home: 'A', away: 'B', homeGoals: 2, awayGoals: 1, status: 'FT',
      stats: { home: { yellow: 5, red: 1 }, away: { yellow: 1, red: 0 } }, source: 'api-football' }], playerLogs: [] };
  const reader = createContextReader({ getStore: () => store, now: () => new Date(instant) });
  const before = JSON.stringify(store), result = reader({ sport: 'football', key: 'api:39', season: '2024', names: ['A'], lookback: 5 });
  assert.equal(result.key, 'competition:england:premier-league'); assert.equal(result.season, '2024/2025');
  assert.equal(result.entities[0].n, 1); assert.equal(result.entities[0].partial, true);
  assert.equal(result.availability.length, 0, 'fixture-specific reports do not leak into other comparisons');
  assert.equal(reader({ sport: 'football', key: 'api:39', season: '2024', names: ['B'], fixtureId: 'other-game' }).availability.length, 0, 'another team is not the target');
  assert.ok(result.entities[0].facts.some(row => row.label === 'Amarillas'));
  assert.ok(result.limits.some(row => row.includes('no confirman suspensiones')));
  assert.equal(JSON.stringify(store), before);
  assert.throws(() => reader({ sport: 'football', key: 'api:39', season: '2024', names: ['Unknown'] }), /equipo/);
  assert.equal(reader({ sport: 'football', key: 'api:39', season: '2024', names: ['A'], cutoff: '2024-11-09T00:00:00Z' }).entities[0].n, 0);
});
test('basketball context counts real minutes and explicit point references without interpreting DNP as zero or inventing an ejection', () => {
  const history = [{ name: 'Player', date: '2026-10-16T15:00:00Z', opponent: 'Beta', minutes: 31, values: { points: 18, rebounds: 5, assists: 4, pra: 27 }, source: 'simulated' }];
  const reader = createContextReader({ getStore: () => ({}), readBasketball: () => ({ availability: [] }),
    basketballPlayers: { analyze: () => ({ playerKey: 'native:1', name: 'Player', history, quality: { newest: history[0].date } }) }, now: () => new Date(instant) });
  const result = reader({ sport: 'basketball', key: 'endesa', kind: 'player', playerKey: 'native:1', season: '2026/2027', referencePoints: 20 });
  assert.ok(result.entities[0].facts.some(row => row.text.includes('31 min')));
  assert.ok(result.entities[0].facts.some(row => row.text.startsWith('No alcanzo 20')));
  assert.ok(!result.entities[0].facts.some(row => /expuls|lesion/.test(row.text)));
});
test('tennis retirement belongs to the match, not automatically the selected player or a current diagnosis', () => {
  const store = { sports: { tennis: { datasets: { 2026: { matches: [{ player1Id: 1, player2Id: 2, player1: 'Alpha', player2: 'Beta', retired: true, date: '2026-10-10T15:00:00Z', availableAfter: '2026-10-10T21:00:00Z', source: 'simulated' }] } } } } };
  const reader = createContextReader({ getStore: () => store, now: () => new Date(instant), tennisLab: { profile: () => ({ player: { name: 'Alpha' }, history: [], record: { wins: 0, losses: 0, n: 0 }, context: { matches7Days: null, durationMatches: 0 } }) } });
  const result = reader({ sport: 'tennis', kind: 'player', season: '2026', playerKey: 'atp:1' });
  assert.ok(result.entities[0].facts.some(row => row.text.includes('no identifica quien')));
  assert.ok(!result.entities[0].facts.some(row => row.text.includes('Alpha viene de una lesion')));
});
