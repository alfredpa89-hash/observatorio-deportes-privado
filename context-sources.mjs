const source = (name, url, purpose) => ({ name, url, purpose, access: 'external', status: 'Enlace oficial; no sincronizado' });
const football = [
  source('UEFA', 'https://www.uefa.com/', 'Previas, comunicados y competiciones europeas'),
  source('CONMEBOL', 'https://www.conmebol.com/', 'Competiciones sudamericanas y comunicados disciplinarios'),
  source('API-Football / cobertura', 'https://api-sports.io/documentation/football/v3', 'Disponibilidad y estadisticas: requieren acceso y cobertura verificados'),
];
const countries = {
  England: ['Premier League', 'https://www.premierleague.com/'], Spain: ['LaLiga', 'https://www.laliga.com/'],
  Germany: ['Bundesliga', 'https://www.bundesliga.com/'], France: ['Ligue 1', 'https://www.ligue1.com/'],
  Italy: ['Lega Serie A', 'https://www.legaseriea.it/'],
  Ecuador: ['LigaPro', 'https://ligapro.ec/'], Peru: ['Liga 1', 'https://liga1.pe/'], Colombia: ['DIMAYOR', 'https://dimayor.com.co/'],
  Chile: ['ANFP', 'https://www.anfp.cl/'], Uruguay: ['AUF', 'https://www.auf.org.uy/'], Paraguay: ['APF', 'https://www.apf.org.py/'],
  Bolivia: ['FBF', 'https://fbf.com.bo/'], Argentina: ['Liga Profesional / AFA', 'https://www.ligaprofesional.ar/'],
  Brazil: ['CBF', 'https://www.cbf.com.br/'], USA: ['MLS', 'https://www.mlssoccer.com/'], Mexico: ['Liga MX', 'https://ligamx.net/'],
  Portugal: ['Liga Portugal', 'https://www.ligaportugal.pt/'], Netherlands: ['Eredivisie', 'https://eredivisie.nl/'],
};
export function contextSources(scope) {
  if (scope.sport === 'football') {
    const local = countries[scope.country], identity = `${scope.key} ${scope.country}`;
    return local ? [source(...local, 'Noticias de la competicion; contrastar con clubes y actas oficiales'), football[2]] :
      /europe|champions|europa|conference/i.test(identity) ? [football[0], football[2]] :
        /south.america|libertadores|sudamericana/i.test(identity) ? [football[1], football[2]] : football;
  }
  if (scope.sport === 'basketball') {
    const sources = {
      nba: [source('NBA Official', 'https://official.nba.com/', 'Buscar el parte de disponibilidad vigente de la temporada y el encuentro'), source('NBA / noticias', 'https://www.nba.com/news', 'Comunicados, previas y novedades'),
        { ...source('RotoWire / alineaciones NBA', 'https://www.rotowire.com/basketball/nba-lineups.php', 'Consultar alineaciones previstas o confirmadas y dudas de participacion. Feed API independiente, sin conectar.'), status: 'Referencia externa; sin sincronizacion automatica' }],
      euroleague: [source('Euroliga / noticias', 'https://www.euroleaguebasketball.net/euroleague/news/', 'Partes de bajas, previas y comunicados')],
      endesa: [source('ACB / noticias', 'https://www.acb.com/', 'Parte medico de la jornada y novedades de Liga Endesa')],
    };
    return sources[scope.key] || Object.values(sources).flat();
  }
  return [source('ATP / notas de partido', 'https://www.atptour.com/en/media/daily-media-notes', 'Previas, antecedentes y datos de los jugadores'),
    source('ATP / noticias', 'https://www.atptour.com/en/news/', 'Comunicados y novedades del circuito'),
    source('WTA / notas de partido', 'https://www.wtatennis.com/match-notes', 'Fuente externa complementaria; no acredita cobertura WTA en el historial de la app'),
    source('WTA / noticias', 'https://www.wtatennis.com/news', 'Retiros y novedades publicadas por el circuito'),
    source('ITF / Grand Slam', 'https://www.itftennis.com/en/itf-tours/grand-slam-tournaments/', 'Acceso a las fuentes de cada Grand Slam')];
}
export function contextNewsDomains(scope) {
  return [...new Set(contextSources(scope).filter(row => !row.url.includes('api-sports.io') && !row.url.includes('rotowire.com')).map(row => new URL(row.url).hostname.replace(/^www\./, '')))];
}
