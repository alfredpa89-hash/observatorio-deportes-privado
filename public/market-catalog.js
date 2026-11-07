// Shared identifiers and lines for the existing football model and its three views.
// This catalog describes availability in the app, not provider coverage.
export const FOOTBALL_LINES = {
  goals: [1.5, 2.5, 3.5, 4.5], corners: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
  fouls: [21.5, 24.5, 27.5], cards: [2.5, 3.5, 4.5, 5.5, 6.5], yellow: [2.5, 3.5, 4.5, 5.5, 6.5],
  red: [0.5, 1.5, 2.5], offsides: [1.5, 2.5, 3.5, 4.5], shotsOnTarget: [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
  halfTimeGoals: [0.5, 1.5, 2.5], halfTimeCorners: [1.5, 2.5, 3.5, 4.5],
};
export const FOOTBALL_METRICS = {
  goals: { group: 'goles', id: 'goals', label: 'goles' },
  corners: { group: 'corners', id: 'corners', label: 'córners' },
  halfTimeGoals: { group: 'goles-1t', id: 'half-time-goals', label: 'goles en el primer tiempo' },
  halfTimeCorners: { group: 'corners-1t', id: 'half-time-corners', label: 'córners en el primer tiempo' },
  fouls: { group: 'faltas', id: 'fouls', label: 'faltas' }, cards: { group: 'tarjetas', id: 'cards', label: 'tarjetas' },
  yellow: { group: 'tarjetas-amarillas', id: 'yellow-cards', label: 'tarjetas amarillas' },
  red: { group: 'tarjetas-rojas', id: 'red-cards', label: 'tarjetas rojas', overOnly: true },
  offsides: { group: 'fuera-de-juego', id: 'offsides', label: 'fueras de juego' },
  shotsOnTarget: { group: 'tiros-al-arco', id: 'shots-on-target', label: 'tiros al arco' },
};
export const FOOTBALL_FT_GROUPS = {
  resultado: 'Resultado', 'doble-oportunidad': 'Doble oportunidad', 'ambos-marcan': 'Ambos marcan',
  handicap: 'Handicap europeo', 'asian-handicap': 'Handicap asiatico', goles: 'Goles', corners: 'Córners',
  tarjetas: 'Tarjetas (amarillas + rojas)', 'tarjetas-amarillas': 'Amarillas', 'tarjetas-rojas': 'Tarjetas rojas',
  'fuera-de-juego': 'Fuera de juego', faltas: 'Faltas', 'tiros-al-arco': 'Tiros al arco',
};
export const FOOTBALL_HT_GROUPS = { 'resultado-1t': 'Resultado 1T', 'goles-1t': 'Goles 1T', 'corners-1t': 'Córners 1T', 'handicap-1t': 'Handicap europeo 1T', 'asian-handicap-1t': 'Handicap asiatico 1T' };
export const FOOTBALL_GROUPS = { ...FOOTBALL_FT_GROUPS, tiros: 'Tiros', ...FOOTBALL_HT_GROUPS };
export function marketGroupLabel(group, sport) {
  if (sport === 'football' || group in FOOTBALL_GROUPS) return FOOTBALL_GROUPS[group] || group;
  return ({ winner: 'Ganador', total: 'Total de puntos', spread: 'Handicap', 'q1-total': 'Total primer cuarto', 'ht-total': 'Total al descanso',
    'team-total': 'Total por equipo', games: 'Juegos', sets: 'Sets', aces: 'Aces', breaks: 'Quiebres' })[group] || group;
}
export function selectConditionMarkets(markets, { group = 'all', direction = 'both', line } = {}) {
  // Select every matching condition. Ranking/limits belong to the view, not to selection.
  return markets.filter(market => (group === 'all' || market.group === group) &&
    (direction === 'both' || (market.spec?.direction || market.direction) === direction) &&
    (line == null || line === '' || Number(market.spec?.line ?? market.line) === Number(line)));
}
