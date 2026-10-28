import { jsonRequest } from './api-client.js';
import { evidenceSampleLabel } from './basketball-evidence.js';
const node=(tag,text='',cls='')=>{const el=document.createElement(tag);el.textContent=text;el.className=cls;return el;};
const num=value=>value==null?'s/d':Number(value).toLocaleString('es-EC',{maximumFractionDigits:2});
const time=value=>value?new Date(value).toLocaleString('es-EC',{timeZone:'America/Guayaquil',hourCycle:'h23'}):'s/d';
const pct=value=>value==null?'s/d':`${num(value)} %`;
const names={points:'Puntos',rebounds:'Rebotes',assists:'Asistencias',pra:'PRA',threes:'Triples'};
const api=(path,body)=>jsonRequest(`/api/basketball/${path}`,body);
function field(form,key,label,type='text') {const wrap=node('label','','field'),input=node('input');input.type=type;input.name=key;wrap.append(node('span',label),input);form.append(wrap);return input;}
function select(form,label,choices) {const wrap=node('label','','field'),input=node('select');for(const [value,text]of choices){const op=node('option',text);op.value=value;input.append(op);}wrap.append(node('span',label),input);form.append(wrap);return input;}
function link(url,text) {const el=node('a',text);el.href=url;el.target='_blank';el.rel='noopener noreferrer';return el;}
function grid(items) {const root=node('div','','overview-cards');for(const [label,value]of items){const card=node('article','','overview-card');card.append(node('p',label),node('strong',value));root.append(card);}return root;}

export function mountBasketballAnalysis(root,{onAvailability}={}) {
  root.className='basket-decision';
  const form=node('form','','overview-filters'),target=select(form,'Analizar equipo o jugador',[['team','Condicion del encuentro seleccionada arriba']]);
  const metric=select(form,'Estadistica individual',Object.entries(names)),direction=select(form,'Condicion individual',[['over','Over (mas de)'],['under','Under (menos de)']]);
  const line=field(form,'playerLine','Linea individual (.5)','number');line.min='.5';line.max='199.5';line.step='1';line.value='20.5';
  const quotes=node('details','','analysis-quotes'),quotesFields=node('div','','overview-filters');quotes.append(node('summary','Comparar con una cuota (opcional)'),quotesFields);form.append(quotes);
  const odds=field(quotesFields,'odds','Cuota decimal de esta condicion','number');odds.step='.01';odds.min='1.01';odds.placeholder='Ej. 1.90';
  const bookmaker=field(quotesFields,'bookmaker','Casa de la cuota');bookmaker.maxLength=100;
  const opposite=field(quotesFields,'opposite','Cuota de la otra opcion (opcional)','number');opposite.step='.01';opposite.min='1.01';
  const draw=field(quotesFields,'draw','Cuota de la tercera opcion','number');draw.step='.01';draw.min='1.01';
  const quoted=field(quotesFields,'quoted','Hora de la cuota / Guayaquil','datetime-local');
  const submit=node('button','Comparar esta cuota','button button-secondary');submit.type='submit';quotesFields.append(submit);
  const message=node('p','','app-message');message.setAttribute('role','status');
  const body=node('div'),save=node('button','Guardar simulacion antes del partido','button button-primary');save.type='button';save.disabled=true;
  const journal=node('details'),journalSummary=node('summary','Seguimiento de simulaciones NBA'),journalBody=node('div');
  const refreshJournal=node('button','Leer seguimiento','button button-secondary');refreshJournal.type='button';journal.append(journalSummary,refreshJournal,journalBody);
  const exportJournal=node('button','Descargar seguimiento JSON','button button-secondary');exportJournal.type='button';journal.append(exportJournal);
  const official=node('details'),officialSummary=node('summary','Parte oficial NBA: lesiones y disponibilidad'),officialBody=node('div'),updateOfficial=node('button','Actualizar parte oficial NBA','button button-secondary');updateOfficial.type='button';official.append(officialSummary,updateOfficial,officialBody);
  root.append(node('h3','Ficha de decision NBA'),node('p','Selecciona una condicion arriba o un jugador aqui. Las cuotas se anotan manualmente para la misma linea y periodo.','calendar-note'),form,message,body,save,official,journal);
  let context,spec,analysis,version=0,busy=false,sealKey;
  const selection=()=>({league:'nba',season:context.meta.season,lookback:context.meta.lookback,fixtureId:context.meta.fixture.id,
    spec:target.value==='team'?spec:{type:'player',period:'ft',metric:metric.value,direction:direction.value,line:Number(line.value),playerKey:target.value}});
  const resetQuote=()=>{odds.value=opposite.value=draw.value=bookmaker.value=quoted.value='';};
  function controls(){const individual=target.value!=='team';for(const el of[metric,direction,line])el.parentElement.hidden=!individual;
    draw.parentElement.hidden=individual||spec?.type!=='winner'||spec?.period==='ft';submit.disabled=busy;save.disabled=busy||analysis?.market.probability==null;}
  function render(value) {
    analysis=value;sealKey=crypto.randomUUID();body.replaceChildren();
    const labels={'datos-insuficientes':'Datos insuficientes','esperar-confirmacion':'Esperar confirmacion','sin-ventaja-estimada':'Sin ventaja estimada',analizable:'Analizable'};
    body.append(node('h4',value.market.label),node('p',labels[value.status]||value.status,'basket-decision-status'),grid([
      ['Probabilidad experimental',pct(value.market.probability)],['Promedio del historial',num(value.distribution.average)],['Mediana / desviacion',`${num(value.distribution.median)} / ${num(value.distribution.sd)}`]
    ]),node('p',`Corte: ${time(value.cutoff)} · ${evidenceSampleLabel(value.evidence)}`,'calendar-note'));
    if(value.market.observed)body.append(node('p',Object.entries(value.market.observed).map(([key,row])=>`${key==='home'?'Local':key==='away'?'Visitante':'Jugador'}: ${row.hits} de ${row.n} cumplieron`).join(' · ')));
    if(value.projection)body.append(node('p',`Media de minutos jugados: ${num(value.projection.averageMinutes)}. Minutos proyectados por historial: ${num(value.projection.projectedMinutes)}. ${value.projection.note}`));
    else body.append(node('p','La distribucion resume totales de partidos anteriores de ambos equipos; los enfrentamientos directos pueden aparecer en ambas muestras.','calendar-note'));
    if(value.quote)body.append(grid([['Cuota anotada / cuota teorica',`${num(value.quote.odds)} / ${num(value.quote.fairOdds)}`],['Probabilidad implicita / sin margen',`${pct(value.quote.impliedProbability)} / ${pct(value.quote.noVigProbability)}`],['Retorno teorico por unidad',value.quote.theoreticalEV==null?'s/d':num(value.quote.theoreticalEV)]]),node('p',`${value.quote.bookmaker} · ${time(value.quote.quotedAt)} · ${value.quote.note}`,'calendar-note'));
    const reasons=node('details'),title=node('summary',`Que falta verificar (${value.reasons.length})`),list=node('ul');list.append(...value.reasons.map(text=>node('li',text)));reasons.append(title,list);body.append(reasons);controls();
  }
  async function calculate(withQuote=false) {
    if(!context?.meta.fixture||!spec&&target.value==='team')return;
    const revision=++version;busy=true;controls();message.textContent='Calculando con los datos guardados...';
    try {const request=selection();if(withQuote){if(!analysis)throw Error('Primero calcula esta condicion.');request.quote={marketKey:analysis.marketKey,odds:odds.value,bookmaker:bookmaker.value,quotedAt:quoted.value?`${quoted.value}:00-05:00`:null,oppositeOdds:opposite.value,drawOdds:draw.value};}
      const value=await api('analysis',request);if(revision!==version)return;render(value);message.textContent='Ficha calculada. Las bajas no ajustan automaticamente el modelo de equipo.';
    }catch(error){if(revision===version){analysis=null;body.replaceChildren();message.textContent=error.message;}}
    finally {if(revision===version){busy=false;controls();}}
  }
  async function showOfficial(){try{const value=await api('official');officialBody.replaceChildren(node('p',`Publicado: ${time(value.publishedAt)} · Leido: ${time(value.recordedAt)}${value.stale?' · Reporte antiguo o pendiente':''}. ${value.issue||value.note}`));
    if(value.sourceUrl)officialBody.append(link(value.sourceUrl,'Ver PDF oficial NBA'));
    const normalize=text=>text.toLowerCase().replace(/[^a-z]/g,'').replace('losangelesclippers','laclippers');
    const teams=context?.teams.map(t=>normalize(t.team))||[],day=context?.meta.fixture?.date;
    const rows=value.rows.filter(row=>teams.includes(normalize(row.team))&&(!day||Date.parse(row.start)===Date.parse(day)));
    for(const row of rows)officialBody.append(node('p',`${row.team} · ${row.name}: ${row.status} · ${row.reason}`));
    for(const row of value.submissions.filter(row=>!row.submitted&&teams.includes(normalize(row.team))))officialBody.append(node('p',`${row.team}: parte aun no presentado (${row.day}).`));
    if(!rows.length)officialBody.append(node('p','Sin filas aplicables a este encuentro en el parte guardado. No confirma que todos esten disponibles.'));
  }catch(error){officialBody.textContent=error.message;}}
  async function showJournal(){refreshJournal.disabled=true;try{const value=await api('analysis/journal');journalBody.replaceChildren(node('p',`${value.total} registros · ${value.pending} pendientes · ${value.invalid} con integridad invalida. ${value.note}`));
    journalBody.append(node('p',`Simulacion con cuota: n=${value.simulated.n}, ${num(value.simulated.units)} unidades, ROI simulado ${pct(value.simulated.roi)}.`));
    for(const [key,row]of Object.entries(value.groups))journalBody.append(node('p',`${key}: n=${row.n}; cumplidas ${pct(row.hitRate)}; Brier ${num(row.brier)}; log loss ${num(row.logLoss)}; devoluciones ${row.pushes}. ${row.note}`));
    for(const row of value.records.slice(0,30))journalBody.append(node('p',`${time(row.fixture.date)} · ${row.label} · ${pct(row.probability)} · ${row.state}${row.duplicate?' · excluida de evaluacion por mercado repetido':''}`));
  }catch(error){journalBody.textContent=error.message;}finally{refreshJournal.disabled=false;}}
  for(const input of[target,metric,direction,line])input.addEventListener('change',()=>{resetQuote();analysis=null;controls();void calculate();});
  for(const input of[odds,bookmaker,opposite,draw,quoted])input.addEventListener('input',()=>{sealKey=undefined;save.disabled=true;});
  form.addEventListener('submit',event=>{event.preventDefault();void calculate(true);});
  save.addEventListener('click',async()=>{if(!analysis||!sealKey)return;save.disabled=true;try {const request=selection();if(analysis.quote)request.quote={...analysis.quote,marketKey:analysis.marketKey};
    const result=await api('analysis/seal',{...request,idempotencyKey:sealKey});message.textContent=`Simulacion ${result.existing?'ya guardada':'guardada'} antes del inicio. No se ha realizado ninguna apuesta.`;await showJournal();
  }catch(error){message.textContent=error.message;}finally{save.disabled=false;}});
  updateOfficial.addEventListener('click',async()=>{updateOfficial.disabled=true;try{const result=await api('official/refresh',{});message.textContent=result.cached?'Parte guardado vigente o en pausa; se conserva la lectura.':`Parte actualizado: ${result.imported} filas.`;await showOfficial();await onAvailability?.();}catch(error){message.textContent=error.message;await showOfficial();}finally{updateOfficial.disabled=false;}});
  official.addEventListener('toggle',()=>{if(official.open)void showOfficial();});journal.addEventListener('toggle',()=>{if(journal.open)void showJournal();});refreshJournal.addEventListener('click',showJournal);
  exportJournal.addEventListener('click',async()=>{exportJournal.disabled=true;try{const value=await api('analysis/journal'),url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),anchor=node('a');anchor.href=url;anchor.download='seguimiento-nba.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){message.textContent=error.message;}finally{exportJournal.disabled=false;}});
  controls();root.hidden=true;
  return {setContext(report){version++;context=report;analysis=null;body.replaceChildren();resetQuote();root.hidden=report.meta.league!=='nba'||!report.meta.fixture;if(root.hidden)return;
    const old=target.value;target.replaceChildren();const opts=[['team','Condicion del encuentro seleccionada arriba'],...report.teams.flatMap(team=>team.players.map(player=>[player.playerKey,`${player.name} / ${player.team} / ${player.source.join(', ')}`]))];
    for(const [value,text]of opts){const option=node('option',text);option.value=value;target.append(option);}if(opts.some(([key])=>key===old))target.value=old;controls();},
    setMarket(market){spec=market?.spec;if(!root.hidden){analysis=null;resetQuote();void calculate();}}};
}
