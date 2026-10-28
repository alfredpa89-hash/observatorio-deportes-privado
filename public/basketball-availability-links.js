const node = (tag, text = '') => { const el = document.createElement(tag); el.textContent = text; return el; };
export function mountBasketballAvailabilityLinks(root) {
  const section = node('aside'); section.className = 'overview-status'; section.hidden = true;
  const links = node('p');
  for (const [label, url] of [
    ['RotoWire: alineaciones y bajas NBA', 'https://www.rotowire.com/basketball/nba-lineups.php'],
    ['NBA: fuente oficial', 'https://official.nba.com/'],
  ]) { const link = node('a', label); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; links.append(link, document.createTextNode(' · ')); }
  section.append(node('strong', 'Comprobar disponibilidad NBA'), links,
    node('p', 'RotoWire es una referencia externa: las alineaciones previstas pueden cambiar. El feed de RotoWire no esta conectado; estos enlaces no actualizan lesiones ni minutos dentro de la app.'),
    node('p', 'Para incorporar una novedad verificada, usa Contexto prepartido > Registrar reporte con fuente: jugador, enlace, fecha de publicacion y vigencia. Los historiales de rendimiento no confirman que un jugador vaya a participar.'));
  root.append(section);
  return { setLeague(league) { section.hidden = league !== 'nba'; } };
}
