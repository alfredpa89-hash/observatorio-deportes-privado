export const FOOTYSTATS_COMPETITIONS = [
  ['premier', 'Premier League', 'England', ['Premier League']],
  ['championship', 'Championship', 'England', ['Championship']],
  ['spain', 'La Liga', 'Spain', ['La Liga']],
  ['germany', 'Bundesliga', 'Germany', ['Bundesliga']],
  ['italy', 'Serie A Italia', 'Italy', ['Serie A']],
  ['france', 'Ligue 1', 'France', ['Ligue 1']],
  ['netherlands', 'Eredivisie', 'Netherlands', ['Eredivisie']],
  ['portugal', 'Primeira Liga Portugal', 'Portugal', ['Liga NOS', 'Primeira Liga', 'Liga Portugal']],
  ['mls', 'MLS', 'USA', ['MLS', 'Major League Soccer']],
  ['mexico', 'Liga MX', 'Mexico', ['Liga MX']],
  ['argentina', 'Liga Profesional Argentina', 'Argentina', ['Primera Division', 'Liga Profesional Argentina']],
  ['brazil', 'Serie A Brasil', 'Brazil', ['Serie A']],
  ['brazil-b', 'Serie B Brasil', 'Brazil', ['Serie B']],
  ['ecuador', 'LigaPro Ecuador', 'Ecuador', ['Primera Categoria Serie A', 'Liga Pro']],
  ['ecuador-b', 'Serie B Ecuador', 'Ecuador', ['Primera Categoria Serie B', 'Liga Pro Serie B']],
  ['colombia', 'Primera A Colombia', 'Colombia', ['Categoria Primera A', 'Primera A']],
  ['colombia-b', 'Primera B Colombia', 'Colombia', ['Categoria Primera B', 'Primera B']],
  ['peru', 'Liga 1 Peru', 'Peru', ['Primera Division']],
  ['chile', 'Primera Division Chile', 'Chile', ['Primera Division']],
  ['bolivia', 'Primera Division Bolivia', 'Bolivia', ['LFPB', 'Primera Division']],
  ['uruguay', 'Primera Division Uruguay', 'Uruguay', ['Primera Division']],
  ['paraguay', 'Primera Division Paraguay', 'Paraguay', ['Division Profesional']],
  ['champions', 'Champions League', 'Europe', ['UEFA Champions League']],
  ['europa', 'Europa League', 'Europe', ['UEFA Europa League']],
  ['conference', 'Conference League', 'Europe', ['UEFA Europa Conference League', 'UEFA Conference League']],
  ['libertadores', 'Copa Libertadores', 'South America', ['Copa Libertadores', 'CONMEBOL Libertadores']],
  ['sudamericana', 'Copa Sudamericana', 'South America', ['Copa Sudamericana', 'CONMEBOL Sudamericana']],
].map(([id, name, country, names]) => ({ id, key: `footystats:${id}`, name, country, names }));

const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function footystatsCompetition(league) {
  return FOOTYSTATS_COMPETITIONS.find(target => norm(target.country) === norm(league.country) &&
    target.names.some(name => norm(league.name) === norm(name) || norm(league.name) === norm(`${target.country} ${name}`))) || null;
}

export function footystatsSeason(value) {
  const text = String(value ?? '');
  if (/^\d{8}$/.test(text)) return text.slice(0, 4) === text.slice(4) ? text.slice(0, 4) : `${text.slice(0, 4)}/${text.slice(4)}`;
  return text;
}
