import { SportsError } from './sports.mjs';
import { localDay, regularNba } from './basketball-data.mjs';
import { buildBasketballReport, availableTime } from './basketball-model.mjs';
import { buildReport } from './model.mjs';
import { combineFootballHistory } from './football-history.mjs';
import { basketballEvidence, basketballTeamEvidence } from './public/basketball-evidence.js';

const finite = Number.isFinite;
const NAMES = { nba: 'NBA', euroleague: 'Euroliga', endesa: 'Liga Endesa' };
const fresh = (row, cutoff) => Date.parse(row.date) < cutoff && (!row.availableAfter || Date.parse(row.availableAfter) < cutoff);
const publicMarket = row => ({ id: row.id, label: row.label, group: row.group, probability: row.probability, calibrated: row.calibrated === true,
  calibrationN: row.calibrationN || 0, observed: row.observed || null, spec: row.spec || null });
const newest = rows => rows.map(row => row.date).filter(Boolean).sort().at(-1) || null;
const fieldFor = { corners: 'corners', tarjetas: 'cards', 'tarjetas-amarillas': 'yellow', 'tarjetas-rojas': 'red', 'fuera-de-juego': 'offsides', faltas: 'fouls', 'tiros-al-arco': 'shotsOnTarget' };
function footballEvidence(report, market) {
  const field = fieldFor[market.group];
  const valid = row => {
    if (market.group === 'corners-1t') return ['homeCorners', 'awayCorners'].every(key => finite(row.halfTime?.[key]));
    if (market.group?.endsWith('-1t')) return ['homeGoals', 'awayGoals'].every(key => finite(row.halfTime?.[key]));
    if (field) return ['home', 'away'].every(side => field === 'cards'
      ? finite(row.stats?.[side]?.yellow) && finite(row.stats?.[side]?.red) : finite(row.stats?.[side]?.[field]));
    return finite(row.homeGoals) && finite(row.awayGoals);
  };
  const samples = ['home', 'away'].map(side => ({ side, ...basketballEvidence({ ...report.meta,
    history: report.history[side], validHistory: report.history[side].filter(valid) }) }));
  const weakest = [...samples].sort((a, b) => b.level - a.level)[0];
  return { ...weakest, samples, reasons: [...new Set(samples.flatMap(row => row.reasons))] };
}

// Read-only previews: no provider calls, no forecasts written after a start,
// and no changes to parameters, sealed inputs or calibration.
export function createDailyOverview({ getStore, basketballResearch, basketballDaily, tennisLab, now = () => new Date() }) {
  let cached;
  function state(body = {}) {
    const store = getStore(), cutoff = now().toISOString(), time = Date.parse(cutoff), today = localDay(cutoff);
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const day = body.day || today, sport = body.sport || 'basketball';
    if (![today, tomorrow].includes(day) || !['all', 'basketball', 'football', 'tennis'].includes(sport))
      throw new SportsError(400, 'Selecciona hoy o manana, en Guayaquil, y un deporte disponible.');
    if (cached?.store === store && cached.key === `${day}:${sport}` && time - cached.at < 30000) return cached.value;
    const rows = [], coverage = [], issues = [];
    const upcoming = row => Number.isFinite(Date.parse(row.date)) && localDay(row.date) === day && Date.parse(row.date) >= time + 5 * 60000 &&
      row.timeKnown !== false && !row.finished && !row.preseason && !row.referenceOnly &&
      (!row.status || ['NS', 'Scheduled', 'STATUS_SCHEDULED'].includes(row.status));
    const add = (fixture, report, markets, support, scope) => {
      const usable = markets.filter(row => finite(row.probability));
      const contextScope = { ...scope, fixtureId: fixture.id, ...(scope.sport === 'tennis'
        ? { playerKeys: [fixture.player1Key, fixture.player2Key] } : { names: [fixture.home, fixture.away] }) };
      rows.push({ id: `${scope.sport}:${scope.key}:${fixture.id}`, fixture, scope: contextScope, markets: usable.map(market => ({ ...publicMarket(market), evidence: support(market) })),
        expectedTotal: report.meta?.expectedTotalPoints ?? null, mode: 'preview', cutoff,
        sources: [...new Set([...(report.history?.home || report.a?.history || []), ...(report.history?.away || report.b?.history || [])].map(row => row.source).filter(Boolean))] });
    };
    if (sport === 'all' || sport === 'basketball') {
      const data = basketballResearch.prematchData();
      for (const [league, name] of Object.entries(NAMES)) {
        const history = data.games.filter(row => row.league === league && row.finished && fresh(row, time));
        const fixtures = data.games.filter(row => row.league === league && upcoming(row) &&
          !/pre.?season|friendly/i.test(row.phase || '') && (league !== 'nba' || regularNba(row.date, row.season, row.phase || '')));
        coverage.push({ sport: 'basketball', key: league, name, fixtures: fixtures.length, latest: newest(history),
          note: league === 'endesa' ? 'Datos descriptivos disponibles; modelo independiente pendiente.' : !fixtures.length ? 'Sin calendario admisible guardado para este dia; no equivale a que no haya partidos.' : 'Vista calculada con datos guardados; bajas no ajustadas.' });
        if (league === 'endesa') continue;
        for (const fixture of fixtures.slice(0, 16)) {
          try {
            const report = buildBasketballReport({ matches: data.games, league, season: fixture.season, home: fixture.home, away: fixture.away,
              date: fixture.date, cutoff, lookback: 20, neutralSite: fixture.neutralSite });
            add({ ...fixture, competition: name }, report, report.markets,
              market => basketballTeamEvidence(report.history, market.spec, report.meta),
              { sport: 'basketball', key: league, season: fixture.season, home: fixture.home, away: fixture.away, kind: 'team', lookback: 20, cutoff });
          } catch (error) { issues.push(`${name}: ${error.message}`); }
        }
      }
      const saved = basketballDaily.state({ day, kind: 'player' });
      for (const item of saved.rows) rows.push({ id: item.id, fixture: { ...item.fixture, competition: item.competition }, mode: 'sealed', cutoff: item.createdAt,
        scope: { sport: 'basketball', key: item.league, season: item.fixture.season, team: item.spec.team, playerKey: item.spec.playerKey, fixtureId: item.fixture.id, kind: 'player', lookback: item.lookback, cutoff },
        sources: item.sources, markets: [{ ...item, group: `player-${item.spec.metric}`, evidence: item.evidence }], availability: item.availability });
    }
    if (sport === 'all' || sport === 'football') {
      const view = combineFootballHistory(store, cutoff);
      for (const league of Object.values(view.leagues)) {
        const fixtures = Object.values(league.fixturesBySeason || {}).flat().filter(upcoming);
        const history = view.matches.filter(row => row.leagueKey === league.key && fresh(row, time));
        coverage.push({ sport: 'football', key: league.key, name: league.name, fixtures: fixtures.length, latest: newest(history),
          note: fixtures.length ? 'Solo datos guardados; cada condicion conserva sus faltantes.' : 'Sin calendario admisible guardado para este dia.' });
        for (const fixture of fixtures.slice(0, 8)) {
          if (rows.filter(row => row.scope.sport === 'football').length >= 24) { issues.push('Futbol: se muestran hasta 24 encuentros por lectura.'); break; }
          const report = buildReport({ matches: view.matches, leagueKey: league.key, leagueName: league.name, season: fixture.season,
            home: fixture.home, away: fixture.away, cutoff, lookback: 20 });
          add({ ...fixture, competition: league.name }, report, report.markets, market => footballEvidence(report, market),
            { sport: 'football', key: league.key, season: fixture.season, home: fixture.home, away: fixture.away, kind: 'team', lookback: 20, cutoff });
        }
      }
    }
    if (sport === 'all' || sport === 'tennis') {
      const fixtures = (store.tennisLab?.fixtures || []).filter(row => upcoming(row) && row.sourceUrl && Date.parse(row.registeredAt) <= time);
      const results = Object.values(store.sports?.tennis?.datasets || {}).flatMap(row => row.matches || []).filter(row => fresh(row, time));
      coverage.push({ sport: 'tennis', key: 'atp', name: 'Tenis ATP', fixtures: fixtures.length, latest: newest(results), note: 'Requiere cruces con hora y fuente registradas. Las fechas historicas pueden ser aproximadas por semana.' });
      for (const fixture of fixtures.slice(0, 16)) {
        try {
          const out = [fixture.player1Key, fixture.player2Key].some(key => {
            const latest = (store.tennisLab?.reports || []).filter(row => row.playerKey === key && Date.parse(row.publishedAt) <= time && Date.parse(row.recordedAt) <= time)
              .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.recordedAt.localeCompare(b.recordedAt)).at(-1);
            return latest?.status === 'out' && Date.parse(latest.expiresAt) > time;
          });
          if (out) { issues.push(`${fixture.player1}–${fixture.player2}: baja reportada; sin estimacion.`); continue; }
          const report = tennisLab.comparison({ ...fixture, category: 'all', tournament: '', lookback: 20, cutoff });
          const samples = [report.a, report.b].map((player, index) => ({ side: index ? 'away' : 'home', ...basketballEvidence({ history: player.history,
            validHistory: player.history.filter(row => row.bestOf === fixture.bestOf), cutoff, season: fixture.season, lookback: 20, kind: 'player' }) }));
          const weakest = [...samples].sort((a, b) => b.level - a.level)[0], evidence = { ...weakest, samples, reasons: [...new Set(samples.flatMap(row => row.reasons)), 'Fechas historicas pueden corresponder a la semana del torneo.'] };
          add({ ...fixture, home: fixture.player1, away: fixture.player2, competition: fixture.tournament }, report, report.estimates, () => evidence,
            { sport: 'tennis', key: 'atp', season: fixture.season, player1Key: fixture.player1Key, player2Key: fixture.player2Key, kind: 'player', lookback: 20, cutoff });
        } catch (error) { issues.push(`${fixture.tournament}: ${error.message}`); }
      }
    }
    const value = { day, today, tomorrow, sport, generatedAt: cutoff, timeZone: 'America/Guayaquil', rows, coverage, issues: [...new Set(issues)],
      notice: 'Vista exploratoria, no pronosticos nuevos sellados. No consulta proveedores ni modifica modelos. Mayor porcentaje no garantiza acierto. Lineas internas, no cuotas actuales. Disponibilidad y minutos por verificar.' };
    cached = { store, key: `${day}:${sport}`, at: time, value }; return value;
  }
  return { state, invalidate: () => { cached = null; } };
}
