export function basketballTotalLines(league = 'nba', period = 'ft', extra = null) {
  const ranges = league === 'nba' ? { ft: [180.5, 280.5], q1: [30.5, 80.5], ht: [80.5, 160.5] }
    : { ft: [120.5, 210.5], q1: [20.5, 65.5], ht: [50.5, 120.5] };
  const [from, to] = ranges[period] || ranges.ft;
  const lines = Array.from({ length: Math.round((to - from) / 5) + 1 }, (_, index) => from + index * 5);
  if (Number.isFinite(extra) && extra > 0 && extra < 500 && extra % 1 === .5) lines.push(extra);
  return [...new Set(lines)].sort((a, b) => a - b);
}

export function selectOverviewMarkets(markets, { group = 'all', direction = 'both', line } = {}) {
  const total = ['total', 'q1-total', 'ht-total'].includes(group);
  const selected = markets.filter(market => (group === 'all' || market.group === group) &&
    (!total || market.spec?.line === Number(line) && (direction === 'both' || market.spec.direction === direction)));
  if (total) return selected; // Keep both sides when requested; never silently replace an under.
  return selected.sort((a, b) => (a.evidence?.level ?? 4) - (b.evidence?.level ?? 4) || b.probability - a.probability).slice(0, 1);
}
