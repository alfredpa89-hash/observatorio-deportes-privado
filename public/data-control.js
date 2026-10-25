const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 's/d';
const number = value => value == null ? 's/d' : Number(value).toLocaleString('es-EC');
const names = { basketball: 'Baloncesto', football: 'Futbol', tennis: 'Tenis' };
let state = null, selected = null, entities = null, busy = false, contextToken = 0;
const dialog = document.createElement('dialog'); dialog.className = 'data-control'; dialog.id = 'data-control'; dialog.setAttribute('aria-labelledby', 'dc-title');
dialog.innerHTML = `<header class="dc-header"><div><h2 id="dc-title">Centro de datos</h2><p id="dc-cycle-status">Baloncesto prioritario / Guayaquil</p></div><div class="dc-actions"><button id="dc-reload" class="button button-secondary icon-button" title="Consultar estado guardado" aria-label="Consultar estado guardado">${icon('refresh-cw')}</button><button id="dc-close" class="button button-secondary icon-button" title="Cerrar Centro de datos" aria-label="Cerrar Centro de datos">${icon('x')}</button></div></header>
<nav class="dc-tabs" role="tablist" aria-label="Centro de datos"><button role="tab" id="dc-tab-coverage" aria-controls="dc-coverage" aria-selected="true" data-view="coverage">Cobertura</button><button role="tab" id="dc-tab-updates" aria-controls="dc-updates" aria-selected="false" tabindex="-1" data-view="updates">Actualizaciones</button><button role="tab" id="dc-tab-checks" aria-controls="dc-checks" aria-selected="false" tabindex="-1" data-view="checks">Validacion</button><button role="tab" id="dc-tab-backups" aria-controls="dc-backups" aria-selected="false" tabindex="-1" data-view="backups">Respaldos</button></nav>
<div class="dc-body"><p id="dc-message" class="dc-message" role="status" aria-live="polite"></p>
<section id="dc-coverage" role="tabpanel" aria-labelledby="dc-tab-coverage"><div class="dc-toolbar"><label>Deporte<select id="dc-sport"><option value="basketball">Baloncesto</option><option value="football">Futbol</option><option value="tennis">Tenis</option></select></label><span class="dc-note">Datos observados, no promesas de cobertura</span></div><div class="dc-table-scroll"><table class="dc-coverage-table"><thead><tr><th>Competicion / temporada</th><th>Fuente</th><th>Partidos / registros individuales</th><th>Ultimo partido</th><th>Descarga</th><th></th></tr></thead><tbody id="dc-coverage-rows"></tbody></table></div><div id="dc-detail" class="dc-detail" hidden></div></section>
<section id="dc-updates" role="tabpanel" aria-labelledby="dc-tab-updates" hidden><div class="dc-toolbar"><div class="dc-actions"><button id="dc-run" class="button button-primary">${icon('cloud-download')}Actualizar lote</button><button id="dc-stop" class="button button-secondary">${icon('pause')}Detener lote</button></div><span id="dc-running" class="dc-note"></span></div><form id="dc-settings"><div class="dc-setting-row">${Object.entries(names).map(([key, label]) => `<label class="dc-check"><input type="checkbox" id="dc-auto-${key}">${label}: automatico</label>`).join('')}</div><div class="dc-form-grid"><label>Presupuesto diario local / API-Basketball<input id="dc-budget-basketball" type="number" min="20" max="7500" step="1" required></label><label>Presupuesto diario local / API-Football<input id="dc-budget-football" type="number" min="20" max="7500" step="1" required></label></div><button class="button button-secondary" type="submit">${icon('save')}Guardar limites</button></form><div id="dc-providers"></div><h3>Cola de tareas</h3><div class="dc-table-scroll"><table class="dc-job-table"><thead><tr><th>Tarea</th><th>Estado</th><th>Pendientes</th><th>Siguiente intento</th><th>Observacion</th></tr></thead><tbody id="dc-jobs"></tbody></table></div><p class="dc-note">Cuotas independientes por proveedor. Pro solo se activa con una suscripcion verificada; no se compra desde la app. Equipo y servidor deben permanecer encendidos.</p></section>
<section id="dc-checks" role="tabpanel" aria-labelledby="dc-tab-checks" hidden><h3>Comprobacion antes de ampliar datos</h3><div id="dc-check-results"></div><h3>Integridad e identidades</h3><div id="dc-integrity"></div><h3>Actividad reciente</h3><ul id="dc-events" class="dc-evidence"></ul></section>
<section id="dc-backups" role="tabpanel" aria-labelledby="dc-tab-backups" hidden><div class="dc-toolbar"><button id="dc-backup-create" class="button button-primary">${icon('archive')}Crear respaldo</button><span class="dc-note">Doce copias locales comprimidas / SHA-256</span></div><label>Respaldo<select id="dc-backup-select"></select></label><div class="dc-actions" style="margin-top:14px"><button id="dc-backup-verify" class="button button-secondary">${icon('shield-check')}Verificar integridad</button></div><div class="dc-backup-restore"><h3>Restaurar datos</h3><p>Reemplaza los datos por la copia elegida y crea un respaldo previo. Se bloquea si altera los registros congelados de octubre.</p><label>Confirmacion<input id="dc-restore-confirm" type="text" placeholder="RESTAURAR" autocomplete="off"></label><button id="dc-backup-restore" class="button button-secondary" style="margin-top:12px">${icon('rotate-ccw')}Restaurar respaldo</button></div></section></div>`;
document.body.append(dialog);
const quotaOptions = document.createElement('div'); quotaOptions.className = 'dc-setting-row';
for (const [name, label] of [['basketball', 'API-Basketball'], ['football', 'API-Football']]) {
  const wrapper = document.createElement('label'); wrapper.className = 'dc-check';
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = `dc-maximize-${name}`;
  wrapper.append(checkbox, document.createTextNode(`Usar cuota gratuita completa / ${label}`)); quotaOptions.append(wrapper);
}
$('dc-settings').prepend(quotaOptions);
const readinessPanel = document.createElement('div'); readinessPanel.id = 'dc-basketball-readiness';
$('dc-checks').prepend(readinessPanel);
const icons = () => window.lucide?.createIcons();
async function api(path, body) {
  const response = await fetch(`/api/data/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'No se pudo completar la operacion.'); return result;
}
function message(text, error = false) { $('dc-message').textContent = text; $('dc-message').dataset.error = String(error); }
async function action(fn) {
  if (busy) return; busy = true; dialog.setAttribute('aria-busy', 'true');
  try { await fn(); } catch (error) { message(error.message, true); }
  finally { busy = false; dialog.setAttribute('aria-busy', 'false'); icons(); }
}
const table = fields => `<table><thead><tr><th>Dato</th><th>Con datos / muestra</th><th>Estado</th></tr></thead><tbody>${fields.map(field => `<tr><td>${esc(field.label)}</td><td>${number(field.n)} / ${number(field.total)}</td><td class="${field.status === 'completo' ? 'dc-good' : field.n ? 'dc-warn' : 'dc-missing'}">${esc(field.status.replaceAll('_', ' '))}</td></tr>`).join('')}</tbody></table>`;
function coverage() {
  const sport = $('dc-sport').value;
  $('dc-coverage-rows').innerHTML = state.coverage.map((row, index) => ({ row, index })).filter(({ row }) => row.sport === sport).map(({ row, index }) => `<tr><td><strong>${esc(row.name)}</strong><small>${esc(row.season)}${row.historical ? ' / historico' : ''}</small></td><td>${esc(row.sources.join(', ') || 'Sin descargar')}</td><td>${number(row.matches)} / ${number(row.records)}${row.seasonAggregates ? `<small>${number(row.seasonAggregates)} acumulados de temporada, no participaciones</small>` : ''}</td><td>${esc(date(row.latestMatch))}<small>Individuales: ${esc(date(row.latestPlayer))}</small></td><td>${esc(date(row.downloadedAt))}</td><td><button class="button button-secondary icon-button" data-detail="${index}" title="Ver cobertura de ${esc(row.name)} ${esc(row.season)}" aria-label="Ver cobertura de ${esc(row.name)} ${esc(row.season)}">${icon('list-filter')}</button></td></tr>`).join('') || '<tr><td colspan="6">Sin fuentes guardadas para este deporte.</td></tr>';
  if (sport === 'tennis') {
    const rows = state.coverage.filter(row => row.sport === sport);
    [...$('dc-coverage-rows').children].forEach((element, index) => {
      const row = rows[index];
      if (!row || row.datePrecision === 'exacta') return;
      const cell = element.children[3]; cell.textContent = row.latestMatch ? `${row.latestMatch.slice(0, 10)} / semana o fecha de fuente` : 's/d';
    });
  }
  if (selected && selected.sport !== sport) { selected = null; contextToken++; $('dc-detail').hidden = true; }
  icons();
}
function detail(row) {
  selected = row; const element = $('dc-detail'); element.hidden = false;
  const reports = state.reports.filter(report => report.sport === row.sport && report.key === row.key && String(report.season) === String(row.season));
  element.innerHTML = `<h3>${esc(row.name)} / ${esc(row.season)}</h3><p class="dc-note">${number(row.fixtures)} encuentros futuros guardados. Historial de participaciones; no confirma la plantilla ni disponibilidad actual.</p><div class="dc-split"><div><h4>Equipos / partidos</h4>${table(row.fields)}</div><div><h4>Jugadores / participaciones</h4>${table(row.playerFields)}</div></div>${row.teams.length ? `<details><summary>Historial por equipo / hasta 30 partidos disponibles</summary><div class="dc-table-scroll"><table><thead><tr><th>Equipo</th><th>Partidos guardados</th><th>Con individuales</th><th>Identidades registradas</th></tr></thead><tbody>${row.teams.map(team => `<tr><td>${esc(team.team)}</td><td>${team.games} / ${team.target}</td><td>${team.playerGames} / ${team.games}</td><td>${team.players}</td></tr>`).join('')}</tbody></table></div></details>` : ''}<h4>Reportes de disponibilidad</h4><div>${reports.length ? reports.map(report => `<p><strong>${esc(report.name)}</strong> / ${esc(report.status)}${report.expired ? ' / VENCIDO' : ''}${report.minutesLimit == null ? '' : ` / limite reportado ${number(report.minutesLimit)} min`}<br><a href="${esc(report.sourceUrl)}" target="_blank" rel="noopener noreferrer">Fuente</a> / publicacion ${esc(date(report.publishedAt))} / vence ${esc(date(report.expiresAt))}</p>`).join('') : '<p class="dc-note">Sin reportes registrados para esta seleccion.</p>'}</div><details><summary>Registrar reporte con fuente</summary><form id="dc-context-form"><div class="dc-form-grid"><label>Equipo<select id="dc-context-team"></select></label><label>Jugador<select id="dc-context-player"></select></label><label>Estado<select id="dc-context-status"><option value="questionable">En duda</option><option value="out">Baja reportada</option><option value="active">Disponible segun fuente</option><option value="minutes_limit">Restriccion de minutos</option></select></label><label>Limite de minutos reportado<input id="dc-context-minutes" type="number" min="0" max="120" step="0.5"></label><label>Fuente HTTPS<input id="dc-context-url" type="url" required></label><label>Publicacion / Guayaquil<input id="dc-context-published" type="datetime-local" required></label><label>Vence / Guayaquil<input id="dc-context-expires" type="datetime-local" required></label><label>Nota<input id="dc-context-note" type="text" maxlength="500"></label></div><button type="submit" class="button button-secondary">${icon('file-plus')}Guardar reporte</button></form><p class="dc-note">Registro manual de contexto, sin ajuste automatico de probabilidades. No sustituye una confirmacion de plantilla actual.</p></details>`;
  const token = ++contextToken;
  if (row.accessIssue || row.datePrecision === 'semana_o_fecha_de_fuente') {
    const note = document.createElement('p'); note.className = 'dc-note';
    note.textContent = row.accessIssue || 'Las fechas de este archivo incluyen semana del torneo: no confirman la hora ni el dia exacto del ultimo partido.';
    element.insertBefore(note, element.children[1]);
  }
  api(`context/entities?${new URLSearchParams({ sport: row.sport, key: row.key, season: row.season })}`).then(result => {
    if (token !== contextToken) return; entities = result;
    $('dc-context-team').innerHTML = row.sport === 'tennis' ? '<option value="">Individual</option>' : result.teams.map(team => `<option>${esc(team)}</option>`).join('');
    contextPlayers();
  }).catch(error => message(error.message, true));
  icons();
}
function contextPlayers() {
  const rows = (entities?.players || []).filter(row => selected.sport === 'tennis' || row.team === $('dc-context-team').value);
  $('dc-context-player').innerHTML = (selected.sport === 'tennis' ? '' : '<option value="">Equipo completo</option>') + rows.map(row => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
}
function render() {
  const selectedBackup = $('dc-backup-select').value;
  $('dc-cycle-status').textContent = `Baloncesto prioritario / ultimo lote ${date(state.lastCycle)}`;
  $('dc-running').textContent = state.running ? 'Actualizando: los datos guardados siguen disponibles' : 'Sin lote en curso';
  $('dc-run').disabled = state.running; $('dc-stop').disabled = !state.running;
  for (const sport of Object.keys(names)) $('dc-auto-' + sport).checked = state.automatic[sport];
  for (const name of ['basketball', 'football']) $('dc-budget-' + name).value = state.budgets[name].dailyBudget;
  for (const name of ['basketball', 'football']) $('dc-maximize-' + name).checked = state.budgets[name].maximizeFree === true;
  $('dc-providers').innerHTML = ['basketball', 'football'].map(name => {
    const policy = state.policies[name], connected = state.connections[name + 'Connected'];
    return `<div class="dc-provider"><div class="dc-actions"><strong>API-${name === 'basketball' ? 'Basketball' : 'Football'} / ${esc(policy.plan)}</strong><button class="button button-secondary" data-verify="${name}" ${connected ? '' : 'disabled'}>${icon('badge-check')}Verificar plan</button></div><p>${connected ? 'Clave conectada en memoria' : 'Clave no conectada'} / presupuesto ${number(policy.dailyBudget)} / reserva ${number(policy.reserve)} / utilizable ${number(policy.usable)}</p><p>Consultas locales: ${number(policy.quota.used || 0)} / detalles: ${number(policy.quota.detailUsed || 0)} de ${number(policy.detailLimit)} / remanente informado: ${number(policy.quota.remaining)}</p>${name === 'basketball' && policy.paid ? `<p>Detalles de jugadores: hasta ${number(policy.playerLimit)} / equipos: hasta ${number(policy.teamLimit)}. No es necesario agotar la cuota.</p>` : ''}<p class="dc-note">Verificado: ${esc(date(policy.verifiedAt))} / reinicio de cuota: ${esc(date(policy.resetsAt))}</p></div>`;
  }).join('');
  const fs = state.policies.footystats;
  if (fs) {
    const section = document.createElement('div'); section.className = 'dc-provider';
    section.append(Object.assign(document.createElement('strong'), { textContent: 'FootyStats / cuota independiente' }),
      Object.assign(document.createElement('p'), { textContent: `${state.connections.footystatsConnected ? 'Clave conectada' : 'Clave no conectada'} / consultas locales de hoy: ${number(fs.quota.used)} / limite informado del periodo: ${number(fs.providerLimit)} / remanente: ${number(fs.quota.remaining)}` }),
      Object.assign(document.createElement('p'), { className: 'dc-note', textContent: `Reinicio informado: ${date(fs.resetsAt)} / pausa: ${date(fs.quota.cooldownUntil)}` }));
    $('dc-providers').append(section);
  }
  const focus = state.policies.basketball.focus;
  if (focus && state.policies.basketball.paid) {
    const note = document.createElement('p'); note.className = 'dc-note';
    note.textContent = `Enfoque Pro: hoy ${focus.today} y manana ${focus.tomorrow} / Guayaquil. Historial solo de los equipos participantes. Calendario y verificacion necesarios incluidos; sin objetivo de agotar las consultas. El archivo gratuito sigue disponible.`;
    $('dc-providers').append(note);
  }
  const status = { pending: 'Pendiente', running: 'En curso', partial: 'Parcial', complete: 'Completa', blocked: 'Acceso bloqueado', quota: 'Cuota / reserva', retry: 'Reintento programado' };
  $('dc-jobs').innerHTML = state.jobs.map(job => `<tr><td>${esc(job.label)}</td><td>${esc(status[job.status] || job.status)}</td><td>${number(job.result?.pending)}</td><td>${job.status === 'blocked' ? 'Requiere cambio de acceso y reconexion' : esc(date(job.nextAt))}</td><td>${esc(job.issue?.message || job.result?.warning || '')}</td></tr>`).join('') || '<tr><td colspan="5">La cola se prepara en la siguiente actualizacion.</td></tr>';
  $('dc-backup-select').innerHTML = state.backups.map(backup => `<option value="${esc(backup.id)}">${esc(date(backup.createdAt))} / ${esc(backup.reason)} / ${number(Math.round(backup.bytes / 1024 / 1024))} MB originales</option>`).join('') || '<option value="">Sin respaldos</option>';
  if (state.backups.some(backup => backup.id === selectedBackup)) $('dc-backup-select').value = selectedBackup;
  for (const id of ['dc-backup-verify', 'dc-backup-restore']) $(id).disabled = !state.backups.length || state.running;
  $('dc-check-results').innerHTML = `<p>Una muestra historica comprueba campos y formato, pero no confirma acceso a la temporada actual. Lesiones y cuartos individuales requieren evidencia propia.</p><div class="dc-table-scroll"><table><thead><tr><th>Competicion</th><th>Muestra actual</th><th>Periodos / servicio</th><th>Individuales</th><th>Estado</th></tr></thead><tbody>${state.coverage.filter(row => !row.historical && (row.sport !== 'football' || row.matches)).map(row => { const period = row.fields.find(field => ['quarters', 'halfGoals', 'games'].includes(field.id)), individuals = row.playerFields.some(field => field.n > 0); return `<tr><td>${esc(row.name)} ${esc(row.season)}</td><td>${number(row.matches)} partidos</td><td>${period ? `${number(period.n)} / ${number(period.total)}` : 's/d'}</td><td>${individuals ? `${number(row.records)} participaciones` : 'Sin muestra'}</td><td class="dc-warn">${!row.matches ? 'Pendiente de acceso y muestra' : !period?.n || !individuals ? 'Faltan campos' : 'Muestra parcial: revisar detalle'}</td></tr>`; }).join('')}</tbody></table></div>`;
  $('dc-integrity').innerHTML = `<p>Duplicados por identidad de partido de futbol: ${number(state.integrity.footballDuplicates)}. Duplicados de registros individuales: ${number(state.integrity.playerDuplicates)}.</p><p>${esc(state.integrity.identityRule)}</p><p>${esc(state.integrity.contextRule)}</p><p>Los nuevos lotes no cambian el modelo, las lineas ni la calibracion congelada de octubre.</p>`;
  if (state.trialAudit) {
    const audit = document.createElement('p'); audit.className = state.trialAudit.valid ? 'dc-good' : 'dc-missing';
    audit.textContent = `Integridad de la prueba: ${state.trialAudit.valid ? 'correcta' : 'REVISAR'}. ${state.trialAudit.snapshots} sellos / ${state.trialAudit.inputs} entradas. Modelo ${state.trialAudit.version}.`;
    $('dc-integrity').append(audit);
  }
  $('dc-events').innerHTML = state.events.map(event => `<li>${esc(date(event.at))}: ${esc(event.message)}</li>`).join('') || '<li>Sin tareas ejecutadas.</li>';
  readiness(); coverage(); icons();
}
function readiness() {
  const report = state.basketballReadiness; if (!report) return;
  const oldLeague = $('dc-check-league')?.value;
  const openSections = [...readinessPanel.querySelectorAll('details[open] > summary')].map(element => element.textContent);
  const oldGame = $('dc-check-game')?.selectedOptions[0]?.dataset.matchId;
  const values = Object.fromEntries(['dc-check-field', 'dc-check-player', 'dc-check-expected', 'dc-check-url', 'dc-check-published']
    .filter(id => $(id)).map(id => [id, $(id).value]));
  const evaluationRows = report.leagues.flatMap(row => ['trial', 'research'].flatMap(origin => Object.entries(row.evaluation[origin]?.summary || {}).map(([group, result]) =>
    `<tr><td>${esc(row.name)}<small>${origin === 'trial' ? 'Octubre congelado' : 'Investigacion separada'}</small></td><td>${esc(group)}</td><td>${number(result.n)}</td><td>${number(result.accuracy)}${result.accuracy == null ? '' : '%'}</td><td>${number(result.brier)}</td><td>${number(result.logLoss)}</td><td>${number(result.missing)}</td></tr>`)));
  const evaluationDetails = report.leagues.map(row => {
    const origins = [['trial', 'Octubre congelado'], ['research', 'Investigacion'], ['historical', 'Historico / no prospectivo']];
    return `<details><summary>${esc(row.name)} / errores, referencia y calibracion</summary><div class="dc-table-scroll"><table><thead><tr><th>Prueba</th><th>Partidos evaluados</th><th>Error absoluto de puntos FT</th><th>Brier de referencia</th><th>N de referencia</th></tr></thead><tbody>${origins.map(([key, label]) => {
      const result = row.evaluation[key], baseline = result?.baseline;
      return `<tr><td>${label}</td><td>${number(result?.completed ?? result?.n)}</td><td>${number(key === 'historical' ? result?.mae?.ft : result?.mae?.ft?.value)}${key === 'historical' ? '' : `<small>n=${number(result?.mae?.ft?.n)}</small>`}</td><td>${number(baseline?.brier)}</td><td>${number(baseline?.n)}</td></tr>`;
    }).join('')}</tbody></table></div>${origins.flatMap(([key, label]) => Object.entries(row.evaluation[key]?.summary || {}).flatMap(([group, result]) => {
      const bins = (result.bins || []).filter(bin => bin.n);
      return bins.length ? [`<h4>${label} / ${esc(group)}</h4><div class="dc-table-scroll"><table><thead><tr><th>Rango</th><th>N</th><th>Estimado</th><th>Observado</th><th>Intervalo 95%</th></tr></thead><tbody>${bins.map(bin => `<tr><td>${bin.from}-${bin.to}%</td><td>${bin.n}</td><td>${number(bin.predicted)}%</td><td>${number(bin.observed)}%</td><td>${number(bin.low)}-${number(bin.high)}%</td></tr>`).join('')}</tbody></table></div>`] : [];
    })).join('')}<p class="dc-note">Cada escenario conserva su muestra. Mercados del mismo partido no son observaciones independientes. Sin muestra no se concluye eficacia ni rentabilidad.</p></details>`;
  }).join('');
  readinessPanel.innerHTML = `<div class="dc-toolbar"><h3>Preparacion de baloncesto / ${esc(report.season)}</h3><button id="dc-readiness-export" class="button button-secondary" title="Descargar informe de preparacion">${icon('download')}Informe</button></div>
    <div class="dc-table-scroll"><table class="dc-coverage-table"><thead><tr><th>Competicion</th><th>Muestra actual</th><th>Individuales</th><th>Hoy y manana</th><th>Evaluacion futura</th></tr></thead><tbody>${report.leagues.map(row => `<tr><td><strong>${esc(row.name)}</strong><small>${row.league === 'endesa' ? 'Descriptivo / modelo pendiente' : 'Modelo de octubre conservado'}</small></td><td>${row.sampleSize} / ${row.sampleTarget}<small>Ultimo: ${esc(date(row.latestMatch))}</small></td><td>${row.knownCurrentPlayers} identidades con participacion<small>Plantilla actual sin confirmar</small></td><td>${row.fixtures.length} encuentros<small>${row.availability.filter(player => player.status !== 'unknown').length} / ${row.availability.length} reportes que cubren el inicio</small></td><td>${row.evaluation.trial?.completed || 0} partidos / octubre<small>${row.evaluation.research?.completed || 0} / investigacion</small></td></tr>`).join('')}</tbody></table></div>
    ${report.leagues.map(row => `<details><summary>${esc(row.name)} / pendientes y cobertura</summary><ul class="dc-evidence">${row.blockers.map(text => `<li>${esc(text)}</li>`).join('')}</ul><div class="dc-split"><div><h4>Ultimos ${row.sampleSize} partidos de la temporada actual</h4>${table(row.fields.map(field => ({ ...field, status: !field.total ? 'sin_muestra' : field.n === field.total ? 'completo' : 'parcial' })))}</div><div><h4>Participaciones en esa misma muestra</h4>${table(row.playerFields.map(field => ({ ...field, status: !field.total ? 'sin_muestra' : field.n === field.total ? 'completo' : 'parcial' })))}</div></div>${row.availability.length ? `<div class="dc-table-scroll"><table><thead><tr><th>Jugador</th><th>Equipo</th><th>Disponibilidad al inicio</th></tr></thead><tbody>${row.availability.map(player => `<tr><td>${esc(player.name)}</td><td>${esc(player.team)}</td><td>${esc({ unknown: 'Sin confirmar', out: 'Baja reportada', questionable: 'En duda', active: 'Disponible segun reporte', minutes_limit: 'Limite de minutos' }[player.status] || player.status)}</td></tr>`).join('')}</tbody></table></div>` : ''}</details>`).join('')}
    <h4>Resultados prospectivos por escenario</h4><div class="dc-table-scroll"><table><thead><tr><th>Competicion / prueba</th><th>Escenario</th><th>N</th><th>Acierto</th><th>Brier</th><th>Log loss</th><th>Faltantes</th></tr></thead><tbody>${evaluationRows.join('') || '<tr><td colspan="7">Sin escenarios evaluados. No hay eficacia prospectiva demostrada.</td></tr>'}</tbody></table></div>
    ${evaluationDetails}<details><summary>Contraste manual con Game Center oficial</summary><form id="dc-check-form"><div class="dc-form-grid"><label>Competicion<select id="dc-check-league">${report.leagues.map(row => `<option value="${row.league}">${esc(row.name)}</option>`).join('')}</select></label><label>Partido / temporada de la muestra<select id="dc-check-game" required></select></label><label>Dato<select id="dc-check-field">${Object.entries(report.fields).map(([id, label]) => `<option value="${id}">${id.startsWith('player:') ? 'Jugador / ' : ''}${esc(label)}</option>`).join('')}</select></label><label>Jugador<select id="dc-check-player"></select></label><label>Valor oficial<input id="dc-check-expected" type="number" min="0" step="any" required></label><label>Enlace oficial / sin parametros<input id="dc-check-url" type="url" required></label><label>Fecha de referencia / Guayaquil<input id="dc-check-published" type="datetime-local" required></label></div><button class="button button-secondary" type="submit">${icon('clipboard-check')}Registrar contraste</button></form></details>
    <h4>Contrastes registrados</h4><div class="dc-table-scroll"><table><thead><tr><th>Competicion / temporada</th><th>Dato</th><th>Oficial / guardado</th><th>Resultado</th><th>Fuente</th></tr></thead><tbody>${report.checks.map(row => `<tr><td>${esc(row.league)} ${esc(row.season)}</td><td>${esc(report.fields[row.field])}</td><td>${number(row.expected)} / ${number(row.observed)}</td><td class="${row.status === 'match' ? 'dc-good' : 'dc-missing'}">${{ match: 'Coincide', mismatch: 'Diferencia', missing: 'Falta en la app' }[row.status]}</td><td><a href="${esc(row.sourceUrl)}" target="_blank" rel="noopener noreferrer">Oficial</a><small>${esc(date(row.recordedAt))} / manual</small></td></tr>`).join('') || '<tr><td colspan="5">Sin contrastes registrados.</td></tr>'}</tbody></table></div><p class="dc-note">${esc(report.note)}</p>`;
  if (report.leagues.some(row => row.league === oldLeague)) $('dc-check-league').value = oldLeague;
  checkGames();
  const option = [...$('dc-check-game').options].find(option => option.dataset.matchId === oldGame);
  if (option) { $('dc-check-game').value = option.value; checkPlayers(); }
  for (const [id, value] of Object.entries(values)) if ($(id).tagName !== 'SELECT' || [...$(id).options].some(option => option.value === value)) $(id).value = value;
  $('dc-check-player').disabled = !$('dc-check-field').value.startsWith('player:');
  for (const element of readinessPanel.querySelectorAll('details')) if (openSections.includes(element.querySelector('summary')?.textContent)) element.open = true;
}
function checkGames() {
  const league = state.basketballReadiness.leagues.find(row => row.league === $('dc-check-league').value);
  $('dc-check-game').innerHTML = league.sampleGames.map((game, index) => `<option value="${index}" data-match-id="${esc(game.id)}">${esc(game.home)} - ${esc(game.away)} / ${esc(game.season)} / ${esc(date(game.date))}</option>`).join('') || '<option value="">Sin partidos guardados</option>';
  checkPlayers();
}
function checkPlayers() {
  const league = state.basketballReadiness.leagues.find(row => row.league === $('dc-check-league').value), game = league.sampleGames[Number($('dc-check-game').value)];
  $('dc-check-player').innerHTML = game?.players.map(row => `<option value="${esc(row.key)}">${esc(row.name)} / ${esc(row.team)}</option>`).join('') || '<option value="">Sin individuales</option>';
  $('dc-check-player').disabled = !$('dc-check-field').value.startsWith('player:');
}
async function reload() { state = await api('state'); render(); }
function view(name) {
  for (const button of dialog.querySelectorAll('[data-view]')) { const active = button.dataset.view === name; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; $('dc-' + button.dataset.view).hidden = !active; }
}
$('open-data-control').addEventListener('click', () => { dialog.showModal(); action(reload); });
$('dc-close').addEventListener('click', () => dialog.close()); $('dc-reload').addEventListener('click', () => action(reload));
$('dc-sport').addEventListener('change', coverage);
dialog.addEventListener('keydown', event => {
  const button = event.target.closest('[data-view]'); if (!button || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const buttons = [...dialog.querySelectorAll('[data-view]')], index = buttons.indexOf(button);
  const target = buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]; view(target.dataset.view); target.focus();
});
dialog.addEventListener('click', event => {
  if (event.target.closest('#dc-readiness-export')) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state.basketballReadiness, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'preparacion-baloncesto.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const tab = event.target.closest('[data-view]'); if (tab) view(tab.dataset.view);
  const selection = event.target.closest('[data-detail]'); if (selection) { detail(state.coverage[Number(selection.dataset.detail)]); $('dc-detail').scrollIntoView({ block: 'start' }); }
  const verify = event.target.closest('[data-verify]'); if (verify) action(async () => { await api('verify', { provider: verify.dataset.verify }); await reload(); message('Plan comprobado; los presupuestos siguen sujetos al proveedor.'); });
});
$('dc-settings').addEventListener('submit', event => { event.preventDefault(); action(async () => {
  await api('settings', { automatic: Object.fromEntries(Object.keys(names).map(sport => [sport, $('dc-auto-' + sport).checked])), budgets: Object.fromEntries(['basketball', 'football'].map(name => [name, Number($('dc-budget-' + name).value)])),
    maximizeFree: Object.fromEntries(['basketball', 'football'].map(name => [name, $('dc-maximize-' + name).checked])) });
  await reload(); message('Limites y actualizacion automatica guardados. No se ha cambiado ninguna suscripcion.');
}); });
$('dc-run').addEventListener('click', () => action(async () => { await api('refresh', {}); await reload(); message('Lote solicitado. El historial completo no se vuelve a descargar.'); }));
$('dc-stop').addEventListener('click', () => action(async () => { await api('pause', {}); await reload(); message('Lote detenido al terminar la consulta en curso.'); }));
$('dc-backup-create').addEventListener('click', () => action(async () => { await api('backup', {}); await reload(); message('Respaldo local creado.'); }));
$('dc-backup-verify').addEventListener('click', () => action(async () => { const result = await api('backup/verify', { id: $('dc-backup-select').value }); message(`Integridad SHA-256 correcta. ${result.frozenCompatible ? 'Compatible con la prueba congelada actual.' : 'No restaurable sobre los nuevos registros congelados.'}`); }));
$('dc-backup-restore').addEventListener('click', () => action(async () => {
  if ($('dc-restore-confirm').value !== 'RESTAURAR') throw new Error('Escribe RESTAURAR para confirmar el reemplazo por la copia seleccionada.');
  await api('backup/restore', { id: $('dc-backup-select').value, confirmation: 'RESTAURAR' }); $('dc-restore-confirm').value = ''; await reload(); message('Respaldo restaurado; se creo una copia previa de seguridad.');
}));
dialog.addEventListener('change', event => {
  if (event.target.id === 'dc-context-team') contextPlayers();
  if (event.target.id === 'dc-check-league') checkGames();
  if (['dc-check-game', 'dc-check-field'].includes(event.target.id)) checkPlayers();
});
dialog.addEventListener('submit', event => {
  if (event.target.id === 'dc-check-form') {
    event.preventDefault(); action(async () => {
      const league = state.basketballReadiness.leagues.find(row => row.league === $('dc-check-league').value), game = league.sampleGames[Number($('dc-check-game').value)];
      if (!game) throw new Error('No hay partido guardado para contrastar.');
      const result = await api('basketball-check', { league: league.league, season: game.season, matchId: game.id, field: $('dc-check-field').value,
        playerKey: $('dc-check-player').value, expected: $('dc-check-expected').value, sourceUrl: $('dc-check-url').value,
        publishedAt: new Date($('dc-check-published').value + '-05:00').toISOString() });
      await reload(); message(`Contraste registrado: ${{ match: 'coincide', mismatch: 'hay una diferencia', missing: 'falta ese dato en la app' }[result.status]}.`);
    }); return;
  }
  if (event.target.id !== 'dc-context-form') return; event.preventDefault(); action(async () => {
    const local = id => new Date($(id).value + '-05:00').toISOString();
    await api('context', { sport: selected.sport, key: selected.key, season: selected.season, team: $('dc-context-team').value, playerKey: $('dc-context-player').value,
      status: $('dc-context-status').value, minutesLimit: $('dc-context-minutes').value, sourceUrl: $('dc-context-url').value,
      publishedAt: local('dc-context-published'), expiresAt: local('dc-context-expires'), note: $('dc-context-note').value });
    const saved = selected; await reload(); detail(saved); message('Reporte guardado con fuente y vigencia. No cambia automaticamente los pronosticos.');
  });
});
setInterval(() => { if (dialog.open && !busy && !dialog.querySelector('form:focus-within')) action(reload); }, 15000);
icons();
