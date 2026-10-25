export function periodReference(team, id) {
  const period = team?.periods?.[id];
  if (!Number.isInteger(period?.n) || period.n <= 0 ||
      period.scored?.n !== period.n || period.conceded?.n !== period.n ||
      !Number.isFinite(period.scored?.average) || !Number.isFinite(period.conceded?.average)) return null;
  return { n: period.n, total: period.scored.average + period.conceded.average,
    margin: period.scored.average - period.conceded.average };
}

export function combinedTotalReference(teams, id) {
  if (teams?.length !== 2) return null;
  const periods = teams.map(team => periodReference(team, id));
  return periods.every(Boolean) ? (periods[0].total + periods[1].total) / 2 : null;
}

export function spreadTeamLabel(game, market) {
  const { side, line } = market.spec || {};
  if (!['home', 'away'].includes(side) || !Number.isFinite(line)) return market.label;
  return `${game[side]} ${line >= 0 ? '+' : ''}${line}`;
}

export function spreadRule(market) {
  const line = market.spec?.line;
  if (!Number.isFinite(line)) return 's/d';
  const rule = line < 0 ? `Ganar por ${Math.floor(-line) + 1} puntos o mas`
    : line > 0 ? `Ganar o perder por ${Math.ceil(line) - 1} puntos o menos` : 'Ganar el partido';
  return Number.isInteger(line) ? `${rule}; diferencia ajustada cero: devolucion` : rule;
}
