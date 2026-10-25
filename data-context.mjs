import { randomUUID } from 'node:crypto';
import { SportsError } from './sports.mjs';
import { playerKey } from './tennis-stats.mjs';

const fail = message => { throw new SportsError(400, message); };
export function createDataContext({ getStore, persist, basketballData, now = () => new Date() }) {
  function entities({ sport, key, season }) {
    let rows = [], teams = [];
    const store = getStore();
    if (sport === 'basketball') {
      const data = basketballData(), games = data.games.filter(row => row.league === key && row.season === season);
      teams = [...new Set(games.flatMap(row => [row.home, row.away]))];
      rows = data.players.filter(row => row.league === key && row.season === season).map(row => ({ id: row.playerKey || `${row.source}:${row.apiPlayerId || row.playerId || row.name}`, name: row.name, team: row.team }));
    } else if (sport === 'football') {
      const games = (store.matches || []).filter(row => row.leagueKey === key && String(row.season) === String(season));
      teams = [...new Set(games.flatMap(row => [row.home, row.away]))];
      rows = (store.playerLogs || []).filter(row => row.sport === 'football' && row.leagueKey === key && String(row.season) === String(season)).map(row => ({ id: row.playerKey || `api:${row.playerId}`, name: row.name, team: row.team }));
    } else if (sport === 'tennis') {
      rows = (store.sports?.tennis?.datasets?.[season]?.matches || []).flatMap(game => ['player1', 'player2'].map(side => ({ id: playerKey(game, side), name: game[side], team: '' })));
    } else fail('Deporte no valido.');
    return { teams: teams.sort(), players: [...new Map(rows.map(row => [`${row.id}:${row.team}`, row])).values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }
  async function save(body) {
    const catalog = entities(body), player = catalog.players.find(row => row.id === body.playerKey && (body.sport === 'tennis' || row.team === body.team));
    if (!player && !catalog.teams.includes(body.team)) fail('Selecciona una identidad del historial de esta competicion y temporada.');
    if (body.playerKey && !player) fail('Jugador no encontrado con ese equipo e identidad.');
    if (!['active', 'questionable', 'out', 'minutes_limit'].includes(body.status)) fail('Estado no valido.');
    let url; try { url = new URL(body.sourceUrl); } catch { fail('Incluye una fuente publica HTTPS.'); }
    if (url.protocol !== 'https:' || url.username || url.password || !/\.[a-z]{2,}$/i.test(url.hostname) || /(?:localhost|\.local)$/.test(url.hostname) || /^(?:\d+\.){3}\d+$/.test(url.hostname)) fail('Fuente HTTPS publica sin credenciales.');
    if (/[?&](?:api[_-]?key|key|token|secret|password|authorization)=/i.test(url.href)) fail('La fuente del reporte no debe contener claves ni tokens.');
    const validTime = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
    if (!validTime(body.publishedAt) || !validTime(body.expiresAt)) fail('Publicacion y vencimiento requieren zona horaria.');
    const publishedAt = new Date(body.publishedAt).toISOString(), expiresAt = new Date(body.expiresAt).toISOString(), recordedAt = now().toISOString();
    if (publishedAt > recordedAt || expiresAt <= recordedAt || Date.parse(expiresAt) - Date.parse(publishedAt) > 7 * 86400000) fail('Reporte vigente, publicacion no futura y hasta siete dias de vigencia.');
    const minutesLimit = body.minutesLimit == null || body.minutesLimit === '' ? null : Number(body.minutesLimit);
    if (minutesLimit !== null && (body.sport === 'tennis' || !Number.isFinite(minutesLimit) || minutesLimit < 0 || minutesLimit > (body.sport === 'football' ? 120 : 68)) || body.status === 'minutes_limit' && (!player || minutesLimit === null)) fail('Limite de minutos no valido para esta identidad.');
    const report = { id: randomUUID(), sport: body.sport, key: String(body.key).slice(0, 120), season: String(body.season).slice(0, 20),
      team: player?.team || body.team || '', playerKey: player?.id || null, name: player?.name || body.team, status: body.status, minutesLimit,
      sourceUrl: url.href, publishedAt, expiresAt, recordedAt, verification: 'manual', note: String(body.note || '').trim().slice(0, 500) };
    (getStore().contextReports ||= []).push(report); await persist(); return report;
  }
  function current() {
    const latest = new Map();
    for (const row of [...(getStore().contextReports || [])].filter(row => row.publishedAt <= now().toISOString() && row.recordedAt <= now().toISOString()).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.recordedAt.localeCompare(b.recordedAt))) latest.set(`${row.sport}:${row.key}:${row.season}:${row.team}:${row.playerKey}`, row);
    return [...latest.values()].map(row => ({ ...row, expired: row.expiresAt <= now().toISOString() }));
  }
  return { entities, save, current };
}
