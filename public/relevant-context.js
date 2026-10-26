const node = (tag, text = '', className = '') => { const item = document.createElement(tag); item.textContent = text; item.className = className; return item; };
const date = value => value ? new Date(value).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short' }) : 'sin consulta';
const day = value => value ? new Date(value).toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil' }) : 'sin fecha';
const localInput = value => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(value);
  const get = key => parts.find(part => part.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
};
const link = (url, title) => {
  const item = node('a', title); let parsed;
  try { parsed = new URL(url); } catch { return node('span', title); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return node('span', title);
  item.href = parsed.href; item.target = '_blank'; item.rel = 'noopener noreferrer'; return item;
};
const iconButton = (name, title) => {
  const button = node('button', '', 'button button-secondary icon-button'), icon = node('i');
  button.type = 'button'; button.title = button.ariaLabel = title; icon.dataset.lucide = name; button.append(icon); return button;
};
const evidenceLabels = { historical: 'Historial', reported: 'Reporte con fuente', 'user-reviewed': 'Revisado por ti', unverified: 'Sin revisar' };
async function api(path, body) {
  const response = await fetch(`/api/context/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'No se pudo consultar el contexto.'); return result;
}
export function mountRelevantContext(root) {
  const section = node('section', '', 'relevant-context'); section.hidden = true;
  section.setAttribute('aria-label', 'Claves del partido');
  const heading = node('div', '', 'context-heading'), title = node('h3', 'Claves del partido'), toolbar = node('div', '', 'context-actions');
  const refresh = node('button', 'Buscar noticias oficiales', 'button button-secondary'); refresh.type = 'button';
  const reload = iconButton('refresh-cw', 'Actualizar resumen con los datos guardados');
  toolbar.append(reload); heading.append(title, toolbar);
  const referenceLabel = node('label', 'Referencia de puntos', 'context-reference'), reference = node('input');
  reference.type = 'number'; reference.min = '0'; reference.max = '100'; reference.step = '.5'; reference.value = '20'; referenceLabel.append(reference); referenceLabel.hidden = true; toolbar.prepend(referenceLabel);
  const status = node('p', '', 'context-status'); status.setAttribute('role', 'status');
  const coverage = node('div', '', 'context-coverage'), highlights = node('div', '', 'context-highlights');
  const football = node('section', '', 'context-football'); football.hidden = true;
  football.setAttribute('aria-label', 'Bajas y tarjetas de futbol');
  const footballTop = node('div', '', 'context-heading'), footballTitle = node('h4', 'Bajas, dudas y tarjetas'), footballLoad = node('button', 'Consultar bajas del encuentro', 'button button-secondary');
  footballLoad.type = 'button'; footballTop.append(footballTitle, footballLoad);
  const fixtureLabel = node('label', 'Encuentro para consultar', 'context-fixture'), fixtureSelect = node('select'); fixtureLabel.append(fixtureSelect);
  const footballStatus = node('p', '', 'context-date'), absences = node('div', '', 'context-highlights');
  const discipline = node('details', '', 'context-history'), disciplineTitle = node('summary', 'Jugadores con tarjetas en el historial'), disciplineRows = node('div', '', 'context-discipline');
  discipline.append(disciplineTitle, disciplineRows); football.append(footballTop, fixtureLabel, footballStatus, absences, discipline);
  const filters = node('fieldset', '', 'context-filters'); filters.append(node('legend', 'Tipo de informacion', 'sr-only'));
  const filterName = `context-filter-${crypto.randomUUID()}`;
  for (const [value, label] of [['all', 'Todo'], ['availability', 'Disponibilidad'], ['performance', 'Rendimiento'], ['competition', 'Competicion']]) {
    const wrapper = node('label'), input = node('input'); input.type = 'radio'; input.name = filterName; input.value = value; input.checked = value === 'all';
    input.addEventListener('change', () => renderBrief()); wrapper.append(input, node('span', label)); filters.append(wrapper);
  }
  const facts = node('div', '', 'context-facts'), historyDetail = node('details', '', 'context-history');
  historyDetail.append(node('summary', 'Historial detallado'), facts);
  const notes = node('div', '', 'context-reports'), noteArchive = node('details', '', 'context-note-archive'), noteHeading = node('summary', 'Reportes con fuente');
  const archiveLabel = node('label', '', 'context-archive-toggle'), archiveToggle = node('input'); archiveToggle.type = 'checkbox';
  archiveLabel.append(archiveToggle, node('span', 'Mostrar vencidos o retirados')); noteArchive.append(noteHeading, archiveLabel, notes);
  archiveToggle.addEventListener('change', () => renderNotes());
  const news = node('div', '', 'context-news'), newsDetail = node('details', '', 'context-news-detail');
  const newsActions = node('div', '', 'context-news-actions'); newsActions.append(node('span', 'GDELT / busqueda puntual'), refresh);
  newsDetail.append(node('summary', 'Titulares por contrastar'), newsActions, news);
  const detail = node('details', '', 'context-note-form'), summary = node('summary', 'Registrar reporte con fuente'), form = node('form'), controls = {};
  function field(key, label, type, values) {
    const wrapper = node('label', '', 'field'), input = node(type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input');
    if (!['select', 'textarea'].includes(type)) input.type = type;
    if (values) for (const [value, text] of values) { const option = node('option', text); option.value = value; input.append(option); }
    input.required = true; wrapper.append(node('span', label), input); controls[key] = input; form.append(wrapper); return input;
  }
  field('entityId', 'Equipo o jugador del reporte', 'select');
  field('category', 'Tipo de reporte', 'select');
  const subject = field('subject', 'Jugador o asunto (opcional)', 'text'); subject.required = false; subject.maxLength = 100;
  field('title', 'Titulo del reporte', 'text').maxLength = 120;
  field('sourceUrl', 'Fuente HTTPS', 'url').maxLength = 2000;
  field('publishedAt', 'Publicado / Guayaquil', 'datetime-local');
  field('expiresAt', 'Vigente hasta / Guayaquil', 'datetime-local');
  field('note', 'Resumen propio de la fuente', 'textarea').maxLength = 350;
  const save = node('button', 'Guardar reporte', 'button button-primary'); save.type = 'submit'; form.append(save); detail.append(summary, form);
  const sources = node('details', '', 'context-sources'), sourceList = node('div', '', 'context-source-links'), limits = node('ul');
  sources.append(node('summary', 'Fuentes y limites del contexto'), sourceList, limits);
  section.append(heading, status, football, coverage, filters, highlights, historyDetail, noteArchive, detail, sources, newsDetail);
  if (root.firstElementChild) root.firstElementChild.after(section); else root.append(section);
  let body, report, revision = 0, busy = false, retryTimer;
  const selection = () => ({ ...body, ...(referenceLabel.hidden ? {} : { referencePoints: Number(reference.value) }),
    ...(!football.hidden && fixtureSelect.value ? { contextFixtureId: fixtureSelect.value } : {}) });
  function currentSelection() {
    if (body?.cutoff && Date.now() - Date.parse(body.cutoff) < 86400000) body = { ...body, cutoff: new Date().toISOString() };
    return selection();
  }
  function constraints() {
    clearTimeout(retryTimer);
    const wait = Math.max(0, Date.parse(report?.news.nextAttemptAt || '') - Date.now()) || 0;
    refresh.disabled = busy || !report?.news.availableForCutoff || wait > 0;
    refresh.title = refresh.ariaLabel = busy ? 'Consultando noticias oficiales' : wait ? `Proxima consulta permitida: ${date(report.news.nextAttemptAt)}` : 'Consultar noticias oficiales / ultimos siete dias';
    if (wait && !section.hidden) retryTimer = setTimeout(constraints, Math.min(wait + 100, 2147483647));
    save.disabled = busy; reference.disabled = busy; reload.disabled = busy || !report;
    footballLoad.disabled = busy || !report?.football?.canRefresh || Boolean(report?.football?.nextRefreshAt);
    fixtureSelect.disabled = busy || !report?.football?.fixtures?.length;
    for (const control of Object.values(controls)) control.disabled = busy;
    for (const button of notes.querySelectorAll('button')) button.disabled = busy;
  }
  function renderFootball() {
    const data = report?.football; football.hidden = !data;
    if (!data) return;
    fixtureSelect.replaceChildren(...data.fixtures.map(row => {
      const option = node('option', `${row.home} - ${row.away} / ${date(row.date)}`); option.value = row.id; return option;
    }));
    if (data.selectedFixtureId) fixtureSelect.value = data.selectedFixtureId;
    fixtureLabel.hidden = !data.fixtures.length;
    footballLoad.textContent = data.nextRefreshAt ? 'Reporte guardado (cache de 4 h)' : 'Consultar bajas del encuentro';
    footballStatus.textContent = [data.blockedReason, data.warning,
      data.checkedAt ? `Consulta al proveedor: ${date(data.checkedAt)}${data.stale ? ' / reporte antiguo: requiere actualizar' : ''}. El proveedor no informa fecha de publicacion.` : 'Sin consulta de bajas guardada para este encuentro.',
      data.nextRefreshAt ? `Proxima consulta desde ${date(data.nextRefreshAt)}.` : ''].filter(Boolean).join(' ');
    absences.replaceChildren();
    for (const row of data.absences) {
      const entry = node('article', '', 'context-highlight'), badge = node('span', data.stale ? 'Reporte antiguo' : 'Reporte del proveedor', 'context-evidence');
      const top = node('div', '', 'context-highlight-top'); top.append(node('strong', row.team), badge);
      const state = { out: 'Baja para este encuentro', suspended: 'Suspension reportada', questionable: 'En duda para este encuentro' }[row.status] || 'Estado sin confirmar';
      entry.append(top, node('h4', row.name), node('strong', state, `context-player-state context-player-state-${row.status}`),
        node('p', `Motivo del proveedor: ${row.reason}`), node('small', `Consultado ${date(row.checkedAt)} / ${row.source}`), link(row.sourceUrl, 'Acerca de esta fuente'));
      absences.append(entry);
    }
    if (!data.absences.length) absences.append(node('p', data.checkedAt ? 'El reporte no contiene bajas de esta seleccion. No confirma que todos puedan jugar.' : 'Lesiones y suspensiones actuales pendientes de consultar o confirmar con una fuente.', 'context-date'));
    disciplineTitle.textContent = `Jugadores con tarjetas en el historial (${data.discipline.length})`;
    disciplineRows.replaceChildren(...data.discipline.map(row => {
      const entry = node('article', '', 'context-entry');
      entry.append(node('strong', `${row.name} / ${row.team}`), node('p', `${row.yellow.total} amarillas en ${row.yellow.games} de ${row.yellow.n} participaciones con dato; ${row.red.total} rojas en ${row.red.games} de ${row.red.n} con dato.`),
        node('small', `Ventana: ${row.appearances} participaciones guardadas / ${day(row.oldest)} a ${day(row.latest)}${row.stale ? ' / historial antiguo' : ''} / ${row.source}`));
      return entry;
    }));
    if (!data.discipline.length) disciplineRows.append(node('p', 'Sin tarjetas individuales registradas en esta muestra. Los datos ausentes no cuentan como cero.', 'context-date'));
    disciplineRows.append(node('p', data.notice, 'context-date'));
  }
  function renderBrief() {
    const brief = report?.brief, filter = filters.querySelector('input:checked')?.value || 'all';
    coverage.replaceChildren(); highlights.replaceChildren();
    if (!brief) { highlights.append(node('p', 'Resumen ampliado pendiente de actualizar el servidor.', 'context-date')); return; }
    for (const row of brief.coverage) {
      const item = node('div', '', 'context-coverage-row');
      item.append(node('strong', row.name), node('span', `${row.history} registros${row.stale ? ' / muestra parcial o antigua' : ''}`),
        node('span', row.availability ? `${row.availability} reportes vigentes de disponibilidad` : 'Disponibilidad sin confirmar'),
        node('span', `${row.reviewed} notas revisadas / ${row.pending} pendientes`)); coverage.append(item);
    }
    const selected = brief.items.filter(item => filter === 'all' || item.category === filter);
    for (const item of selected) {
      const entry = node('article', '', 'context-highlight'), top = node('div', '', 'context-highlight-top');
      const badge = node('span', evidenceLabels[item.evidence] || 'Sin verificar', 'context-evidence'); badge.dataset.evidence = item.evidence;
      const state = { active: 'Disponible segun reporte', out: 'Baja reportada', questionable: 'En duda', minutes_limit: 'Limite de minutos reportado' }[item.status];
      top.append(node('strong', item.name), badge); entry.append(top, node('h4', item.title), ...(state ? [node('strong', state, 'context-availability-state')] : []), node('p', item.detail));
      const meta = node('div', '', 'context-highlight-meta');
      if (item.evidence === 'historical') meta.append(node('small', `n=${item.n}${item.missing ? ` / ${item.missing} sin dato` : ''} / ultimo ${day(item.latest)} / ${item.source}`));
      else meta.append(node('small', `Publicado ${date(item.publishedAt)} / vence ${date(item.expiresAt)}`), link(item.sourceUrl, 'Fuente'));
      entry.append(meta); highlights.append(entry);
    }
    if (!selected.length) highlights.append(node('p', 'Sin informacion vigente de este tipo para la seleccion. No confirma ausencia de bajas o novedades.', 'context-date'));
    highlights.append(node('p', brief.notice, 'context-date'));
  }
  function renderNotes() {
    notes.replaceChildren(); if (!report) return;
    noteHeading.textContent = `Reportes con fuente (${report.notes.length + report.availability.length})`;
    for (const record of report.availability.filter(row => archiveToggle.checked || !row.expired)) {
      const item = node('article', '', 'context-entry');
      item.append(node('strong', `${record.name || record.team} / ${record.expired ? 'Reporte vencido' : ({ active: 'Disponible segun reporte', out: 'Baja reportada', questionable: 'En duda', minutes_limit: 'Limite de minutos reportado' }[record.status] || 'Estado no confirmado')}`),
        node('p', record.note || 'Sin observacion adicional.'), node('small', `Publicado ${date(record.publishedAt)} / vence ${date(record.expiresAt)} / `), link(record.sourceUrl, 'Fuente del reporte'));
      notes.append(item);
    }
    for (const record of report.notes.filter(row => archiveToggle.checked || !row.expired && !row.withdrawn)) {
      const item = node('article', '', 'context-entry');
      item.append(node('strong', `${record.name}${record.subject ? ` / ${record.subject}` : ''} / ${record.categoryLabel}${record.withdrawn ? ' / retirado' : record.expired ? ' / vencido' : ''}`), node('p', `${record.title}. ${record.note}`),
        node('small', `${record.review?.action === 'reviewed' ? 'Fuente revisada por ti; no verificada automaticamente' : 'Sin revision de la fuente'} / publicado ${date(record.publishedAt)} / vence ${date(record.expiresAt)}${record.fixtureId ? ' / solo este encuentro' : ''}`), link(record.sourceUrl, 'Abrir fuente'));
      if (record.review) item.append(node('small', `Ultima accion ${date(record.review.recordedAt)}`));
      if (!report.historicalCutoff) {
        const actions = node('div', '', 'context-review-actions');
        const reviewAction = record.review?.action === 'reviewed' || record.withdrawn ? 'unreviewed' : 'reviewed';
        const review = iconButton(reviewAction === 'reviewed' ? 'check-check' : 'undo-2', reviewAction === 'reviewed' ? 'Marcar fuente como revisada por ti' : 'Volver a pendiente');
        review.addEventListener('click', () => updateReview(record.id, reviewAction)); actions.append(review);
        if (!record.withdrawn) { const withdraw = iconButton('archive', 'Retirar reporte sin borrar el historial'); withdraw.addEventListener('click', () => updateReview(record.id, 'withdrawn')); actions.append(withdraw); }
        item.append(actions);
      }
      notes.append(item);
    }
    if (!notes.children.length) notes.append(node('p', 'Sin reportes vigentes aplicables. Disponibilidad y sanciones sin confirmar.', 'context-date'));
  }
  function updateReview(noteId, action) {
    act(async () => { const scope = currentSelection(); await api('review', { ...scope, noteId, action }); return api('summary', currentSelection()); });
  }
  function render(data) {
    report = data;
    detail.hidden = data.historicalCutoff;
    status.textContent = `Corte ${date(data.cutoff)} / Resumen ${date(data.asOf)} / Ultima consulta exitosa de titulares: ${date(data.news.checkedAt)}`;
    renderFootball(); renderBrief(); renderNotes();
    facts.replaceChildren(...data.entities.map(entity => {
      const group = node('article', '', 'context-entity'), list = node('dl');
      const newest = entity.latestPrecision === 'tournament-week' ? `${entity.latest.slice(0, 10)} (semana del torneo)` : day(entity.latest);
      group.append(node('h4', entity.name), node('p', `${entity.n} registros / ultimo ${newest}${entity.partial ? ' / muestra parcial o antigua' : ''}`, 'context-date'));
      for (const fact of entity.facts) {
        const value = node('dd', `${fact.text}${fact.n === null ? '' : ` / n=${fact.n}`}`); value.title = fact.source || 'Historial guardado';
        list.append(node('dt', fact.label), value);
      }
      if (!entity.facts.length) group.append(node('p', 'Sin observaciones admisibles para este corte.'));
      group.append(list); return group;
    }));
    news.replaceChildren(node('h4', 'Noticias por contrastar'));
    for (const item of data.news.items) {
      const entry = node('article', '', 'context-entry');
      entry.append(link(item.url, item.title), node('small', `${item.domain} / detectado ${date(item.seenAt)} / no es la fecha de publicacion`)); news.append(entry);
    }
    if (!data.news.items.length) news.append(node('p', data.historicalCutoff ? 'Corte historico: no se consultan noticias actuales.' : data.news.checkedAt ? 'Sin titulares encontrados en la muestra consultada. No implica ausencia de novedades.' : data.news.attemptedAt ? 'Sin una consulta exitosa de noticias para esta seleccion.' : 'Sin consulta de noticias para esta seleccion.', 'context-date'));
    const diagnostic = data.news.blockedReason === 'provider_pause' ? data.news.providerHealth || data.news.diagnostic : data.news.diagnostic;
    if (diagnostic) news.append(node('p', `${data.news.provider}: ${diagnostic.label}${diagnostic.httpStatus ? ` / HTTP ${diagnostic.httpStatus}` : ''}${Number.isFinite(diagnostic.durationMs) ? ` / ${(diagnostic.durationMs / 1000).toFixed(1)} s` : ''}`, 'context-date'));
    if (data.news.nextAttemptAt) news.append(node('p', `${data.news.blockedReason === 'daily_limit' ? 'Limite diario preventivo alcanzado. ' : ''}Proxima consulta permitida: ${date(data.news.nextAttemptAt)}.`, 'context-date'));
    news.append(node('p', data.news.warning || data.news.note, 'context-date'));
    const previousEntity = controls.entityId.value;
    controls.entityId.replaceChildren(...data.entities.map(entity => { const option = node('option', entity.name); option.value = entity.id; return option; }));
    if (data.entities.some(row => row.id === previousEntity)) controls.entityId.value = previousEntity;
    const previous = controls.category.value;
    controls.category.replaceChildren(...Object.entries(data.categories).map(([value, label]) => { const option = node('option', label); option.value = value; return option; }));
    if (previous) controls.category.value = previous;
    sourceList.replaceChildren(...data.sources.map(source => {
      const row = node('div', '', 'context-source-row'); row.append(link(source.url, source.name));
      if (source.purpose) row.append(node('span', source.purpose)); row.append(node('small', source.status || 'Enlace externo; no sincronizado')); return row;
    }));
    limits.replaceChildren(...data.limits.map(text => node('li', text)));
    constraints(); window.lucide?.createIcons();
  }
  async function act(action) {
    if (busy) return; const token = revision; busy = true; constraints(); status.textContent = 'Consultando contexto...';
    try { const data = await action(); if (token === revision) render(data); }
    catch (error) { if (token === revision) status.textContent = error.message; }
    finally { busy = false; constraints(); }
  }
  refresh.addEventListener('click', () => act(() => api('news', currentSelection())));
  footballLoad.addEventListener('click', () => act(() => api('football', currentSelection())));
  fixtureSelect.addEventListener('change', () => act(() => api('summary', currentSelection())));
  reload.addEventListener('click', () => act(() => api('summary', currentSelection())));
  reference.addEventListener('change', () => { if (reference.reportValidity()) act(() => api('summary', selection())); });
  form.addEventListener('submit', event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    act(async () => {
      await api('report', { ...selection(), ...Object.fromEntries(Object.entries(controls).map(([key, input]) => [key,
        ['publishedAt', 'expiresAt'].includes(key) ? `${input.value}:00-05:00` : input.value])) });
      detail.open = false; controls.title.value = ''; controls.note.value = ''; controls.sourceUrl.value = ''; controls.subject.value = '';
      return api('summary', currentSelection());
    });
  });
  return {
    async show(scope) {
      const token = ++revision; body = scope; report = null; section.hidden = false;
      fixtureSelect.replaceChildren(); football.hidden = true;
      newsDetail.open = scope.sport === 'football';
      referenceLabel.hidden = !['basketball', 'nba'].includes(scope.sport) || scope.kind !== 'player';
      controls.publishedAt.value = localInput(new Date()); controls.expiresAt.value = localInput(new Date(Date.now() + 24 * 3600000));
      status.textContent = 'Leyendo contexto guardado...'; facts.replaceChildren(); notes.replaceChildren(); news.replaceChildren(); highlights.replaceChildren(); coverage.replaceChildren(); sourceList.replaceChildren(); limits.replaceChildren(); constraints();
      try { const data = await api('summary', selection()); if (token === revision) render(data); }
      catch (error) { if (token === revision) { status.textContent = error.message; detail.hidden = true; } }
    },
    hide() { revision++; body = null; report = null; section.hidden = true; clearTimeout(retryTimer); },
  };
}
