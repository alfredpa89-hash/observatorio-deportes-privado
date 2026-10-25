const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const countryNames = { England: 'Inglaterra', Spain: 'Espana', Italy: 'Italia', France: 'Francia', Germany: 'Alemania', Brazil: 'Brasil', USA: 'Estados Unidos', Netherlands: 'Holanda Paises Bajos', Portugal: 'Portugal', World: 'Internacional' };
const aliases = [
  { country: 'England', name: 'Premier League', aliases: ['Premier', 'Premier League', 'Liga inglesa'] },
  { country: 'England', name: 'Championship', aliases: ['Championship', 'Segunda liga de Inglaterra'] },
  { country: 'Spain', name: 'La Liga', aliases: ['LaLiga', 'La Liga', 'Liga espanola', 'Primera Division Espana'] },
  { country: 'Italy', name: 'Serie A', aliases: ['Serie A', 'Liga italiana', 'Serie A Italia'] },
  { country: 'France', name: 'Ligue 1', aliases: ['Ligue 1', 'Liga francesa'] },
  { country: 'Germany', name: 'Bundesliga', aliases: ['Bundesliga', 'Liga alemana'] },
  { country: 'USA', name: 'Major League Soccer', aliases: ['MLS', 'Major League Soccer'] },
  { country: 'Mexico', name: 'Liga MX', aliases: ['Liga MX', 'Liga mexicana'] },
  { country: 'Brazil', name: 'Serie A', aliases: ['Brasileirao Serie A', 'Liga brasilena', 'Serie A Brasil'] },
  { country: 'Brazil', name: 'Serie B', aliases: ['Brasileirao Serie B', 'Serie B Brasil', 'Serie B de Brasil'] },
  { country: 'Netherlands', name: 'Eredivisie', aliases: ['Eredivisie', 'Liga holandesa', 'Liga de Holanda', 'Everdise', 'Eredivise'] },
  { country: 'Portugal', name: 'Primeira Liga', aliases: ['Primeira Liga', 'Liga portuguesa', 'Liga de Portugal', 'Liga Portugal', 'Liga Portugal Betclic'] },
  { country: 'Ecuador', name: 'Liga Pro Serie B', aliases: ['LigaPro Serie B Ecuador', 'Serie B Ecuador', 'Serie B de Ecuador', 'Liga Pro Serie B'] },
  { country: 'Colombia', name: 'Primera B', aliases: ['Primera B Colombia', 'Serie B Colombia', 'Serie B de Colombia', 'Torneo BetPlay'] },
  { country: 'Chile', name: 'Primera Division', apiNames: ['Primera Division', 'Primera División'], aliases: ['Primera Division Chile', 'Liga Chilena', 'Liga de Chile'] },
  { country: 'Uruguay', name: 'Primera Division', apiNames: ['Primera Division', 'Primera División', 'Primera Division - Clausura', 'Primera División - Clausura'], aliases: ['Primera Division Uruguay', 'Liga Uruguaya', 'Liga de Uruguay'] },
  { country: 'World', name: 'UEFA Champions League', aliases: ['Champions League', 'Champions', 'UEFA Champions League', 'Liga de Campeones'] },
  { country: 'World', name: 'UEFA Europa League', aliases: ['Europa League', 'UEFA Europa League', 'Liga Europa'] },
  { country: 'World', name: 'UEFA Europa Conference League', apiNames: ['UEFA Europa Conference League', 'UEFA Conference League'], aliases: ['Conference League', 'Conference', 'UEFA Europa Conference League', 'UEFA Conference League'] },
  { country: 'World', name: 'CONMEBOL Libertadores', aliases: ['Copa Libertadores', 'Libertadores', 'CONMEBOL Libertadores'] },
  { country: 'World', name: 'CONMEBOL Sudamericana', aliases: ['Copa Sudamericana', 'Sudamericana', 'CONMEBOL Sudamericana'] },
];
export function leagueSearch(query) {
  const found = aliases.find(item => item.aliases.some(alias => normalize(alias) === normalize(query)));
  return found ? { query: found.country, country: found.country, name: found.name, ...(found.apiNames ? { apiNames: found.apiNames } : {}) } : { query: String(query).trim() };
}
export function searchApiLeagues(results, target) {
  return results.filter(item => item.sourceType === 'api' && (!target.country || item.country === target.country && (target.apiNames || [target.name]).some(name => normalize(item.name) === normalize(name))));
}
export function matchesLeague(league, query) {
  const match = aliases.find(item => item.country === league.country && [...(item.apiNames || [item.name]), ...item.aliases].some(name => normalize(name) === normalize(league.name)));
  return [league.name, league.country, countryNames[league.country], ...(match?.aliases || [])].some(value => normalize(value).includes(normalize(query)));
}
export function individualLeagues(catalog, mode = 'players') {
  const hasApi = league => league.source === 'api-football' || league.sourceKeys?.some(key => key.startsWith('api:'));
  return catalog.filter(league => mode === 'all' || hasApi(league) || Object.values(league.seasonsInfo || {}).some(season => season.records > 0))
    .sort((a, b) => Number(Boolean(hasApi(b))) - Number(Boolean(hasApi(a))) || a.name.localeCompare(b.name, 'es'));
}
