import { localDay, regularNba } from './basketball-data.mjs';

export function basketballFocus(now = new Date()) {
  const today = localDay(now), from = new Date(`${today}T00:00:00-05:00`);
  return { mode: 'today-tomorrow', timezone: 'America/Guayaquil', today,
    tomorrow: localDay(new Date(from.getTime() + 86400000)),
    from: from.toISOString(), until: new Date(from.getTime() + 2 * 86400000).toISOString() };
}

export function focusedTeams(games, now = new Date()) {
  const window = basketballFocus(now);
  return new Set(games.filter(game => {
    const date = Date.parse(game.date);
    return Number.isFinite(date) && date >= Date.parse(window.from) && date < Date.parse(window.until) && game.timeKnown !== false &&
      !game.preseason && !/cancel|postpon|abandon|suspend|pre.?season|friendly|all.?star/i.test(`${game.status || ''} ${game.phase || ''}`) &&
      (game.league !== 'nba' || regularNba(game.date, game.season, game.phase || 'Regular Season'));
  }).flatMap(game => [game.home, game.away]).filter(Boolean));
}

// The historical window is chosen before checking API IDs or missing fields.
export function focusedHistory(games, teams, now = new Date(), depth = 30) {
  const prior = games.filter(game => game.finished && Date.parse(game.date) < now.getTime()).sort((a, b) => b.date.localeCompare(a.date));
  return [...new Map([...teams].flatMap(team => prior.filter(game => game.home === team || game.away === team).slice(0, depth)).map(game => [game.id, game])).values()];
}
