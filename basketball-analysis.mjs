import { createHash,randomUUID } from 'node:crypto';
import { SportsError } from './sports.mjs';
import { forecastPlayer,marketOutcome,priorGames,MODEL_VERSION } from './basketball-model.mjs';
import { buildBasketballScenarios } from './basketball-scenarios.mjs';
import { basketballEvidence,basketballTeamEvidence,basketballPeriodPair } from './public/basketball-evidence.js';
import { evaluate } from './basketball-evaluation.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const fail=message=>{throw new SportsError(400,message);};
const round=value=>finite(value)?Math.round(value*10000)/10000:null;
const norm=value=>String(value||'').trim().slice(0,100);
const summary=values=>{const v=values.filter(finite).sort((a,b)=>a-b),average=v.length?v.reduce((a,b)=>a+b,0)/v.length:null;return {n:v.length,average:round(average),median:v.length?round((v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2):null,sd:v.length>1?round(Math.sqrt(v.reduce((sum,x)=>sum+(x-average)**2,0)/(v.length-1))):null};};
export function compareOdds(probability,pushProbability,quote,now) {
  if(!quote) return null;
  const odds=Number(quote.odds),opposite=quote.oppositeOdds===''||quote.oppositeOdds==null?null:Number(quote.oppositeOdds),draw=quote.drawOdds===''||quote.drawOdds==null?null:Number(quote.drawOdds);
  if(![odds,...[opposite,draw].filter(x=>x!==null)].every(x=>finite(x)&&x>1&&x<=1000)) fail('Cuotas decimales mayores que 1 y hasta 1000.');
  if(!norm(quote.bookmaker)||!Number.isFinite(Date.parse(quote.quotedAt))||Date.parse(quote.quotedAt)>Date.parse(now)) fail('Indica casa y hora de la cuota, sin fechas futuras.');
  const p=finite(probability)?probability/100:null,push=(pushProbability||0)/100,implied=1/odds;
  const sum=opposite?implied+1/opposite+(draw?1/draw:0):null;
  return {odds,oppositeOdds:opposite,drawOdds:draw,bookmaker:norm(quote.bookmaker),quotedAt:new Date(quote.quotedAt).toISOString(),
    stale:Date.parse(now)-Date.parse(quote.quotedAt)>30*60000,impliedProbability:round(implied*100),overround:sum===null?null:round((sum-1)*100),
    noVigProbability:sum===null?null:round(implied/sum*100),fairOdds:p>0?round((1-push)/p):null,
    theoreticalEV:finite(probability)?round(p*(odds-1)-(1-p-push)):null,
    note:'Comparacion teorica del modelo; no acredita ventaja rentable. El margen solo se retira con todas las opciones del mismo mercado.'};
}
export function createBasketballAnalysis({getStore,persist,read,prematch,playerAnalysis,official,now=()=>new Date()}) {
  const data=()=>getStore().basketballAnalysis || {schema:1,snapshots:[],contexts:{},observations:[]};
  const writable=()=>getStore().basketballAnalysis ||= {schema:1,snapshots:[],contexts:{},observations:[]};
  function analyze(body={}) {
    if(body.league&&body.league!=='nba') fail('La ficha de decision comienza con NBA; otras ligas conservan sus paneles.');
    const cutoff=now().toISOString(),config={league:'nba',season:body.season||'2026/2027',lookback:Number(body.lookback||20),cutoff,fixtureId:body.fixtureId};
    if(!body.fixtureId) fail('Selecciona un encuentro futuro del calendario.');
    const report=prematch.report(config),fixture=report.meta.fixture;
    if(!fixture||Date.parse(fixture.date)<now().getTime()+5*60000) fail('El analisis requiere al menos cinco minutos antes del inicio.');
    const stored=read(),spec={...body.spec},reasons=[];let market,evidence,history,projection=null,playerRecords=[];
    if(spec.type==='player') {
      if(spec.period&&spec.period!=='ft') fail('Sin modelo individual por cuarto verificado.');
      if(!['points','rebounds','assists','pra','threes'].includes(spec.metric)||!['over','under'].includes(spec.direction)) fail('Condicion individual no valida.');
      playerRecords=playerAnalysis.records(config).filter(row=>row.playerKey===spec.playerKey&&[report.meta.home,report.meta.away].includes(row.team));
      const player=playerRecords.sort((a,b)=>b.date.localeCompare(a.date))[0];if(!player) fail('Jugador sin identidad e historial para estos equipos.');
      const reports=stored.availability.filter(row=>row.league==='nba'&&row.playerKey===spec.playerKey&&row.team===player.team&&(!row.fixtureId||row.fixtureId===fixture.id)&&Date.parse(row.publishedAt)<=Date.parse(cutoff)&&Date.parse(row.recordedAt)<=Date.parse(cutoff))
        .sort((a,b)=>a.publishedAt.localeCompare(b.publishedAt)||a.recordedAt.localeCompare(b.recordedAt));
      const latest=reports.at(-1),status=latest&&Date.parse(latest.expiresAt)>Date.parse(fixture.date)?latest.status:'unknown';
      projection=forecastPlayer({records:playerRecords,league:'nba',season:config.season,team:player.team,player:player.name,cutoff,lookback:config.lookback,
        projectedMinutes:status==='minutes_limit'?latest.minutesLimit:undefined,status:status==='minutes_limit'?'active':status,line:Number(spec.line),metric:spec.metric});
      Object.assign(spec,{line:Number(spec.line),period:'ft',team:player.team,player:player.name});
      history=projection.history;
      playerRecords=history;
      market={id:'player',spec,label:`${player.name}: ${spec.direction==='over'?'Over':'Under'} ${spec.line} ${spec.metric}`,probability:projection[spec.direction],pushProbability:0,calibrated:false};
      evidence=basketballEvidence({history,validHistory:history.filter(row=>finite(row.values?.[spec.metric])),...config,kind:'player',availability:status});
      market.observed={player:{n:evidence.n,hits:history.filter(row=>finite(row.values?.[spec.metric])&&(spec.direction==='over'?row.values[spec.metric]>spec.line:row.values[spec.metric]<spec.line)).length}};
      if(status!=='active'&&status!=='minutes_limit') reasons.push(status==='out'?'Baja reportada: sin proyeccion individual.':'Participacion o minutos sin confirmar.');
      if(status==='minutes_limit') reasons.push('Proyeccion condicionada al limite reportado; participacion sujeta a cambios.');
    } else {
      if(!['total','winner','spread'].includes(spec.type)||!['ft','q1','ht'].includes(spec.period)) fail('Condicion de equipo no valida.');
      if(spec.type==='spread'&&spec.period!=='ft') fail('Handicap disponible para partido completo.');
      const options={matches:stored.games,...config,home:report.meta.home,away:report.meta.away,date:fixture.date};
      if(spec.type==='spread') options.spreadLine=spec.side==='away'?-Number(spec.line):Number(spec.line);
      const scenarios=buildBasketballScenarios(options,spec.type==='total'?{line:spec.line,period:spec.period}:{});
      market=scenarios.markets.find(row=>row.spec.type===spec.type&&row.spec.period===spec.period&&
        (spec.type==='total'?row.spec.line===Number(spec.line)&&row.spec.direction===spec.direction:row.spec.side===spec.side&&(spec.type!=='spread'||row.spec.line===Number(spec.line))));
      if(!market) fail('La condicion no corresponde a un escenario del modelo.');
      Object.assign(spec,market.spec);history=scenarios.history;evidence=basketballTeamEvidence(history,market.spec,scenarios.meta);
      reasons.push('El parte de lesiones no confirma toda la plantilla ni la alineacion titular.');
      if(report.teams.some(team=>team.availability.some(row=>row.current&&['out','questionable','minutes_limit'].includes(row.status)))) reasons.push('Hay bajas o dudas; el modelo de equipo no ajusta su impacto automaticamente.');
    }
    const marketKey=hash({fixtureId:fixture.id,...spec});
    if(body.quote&&body.quote.marketKey!==marketKey) fail('La cuota pertenece a otra condicion. Vuelve a introducirla para esta linea y periodo.');
    if(body.quote&&spec.type==='winner'&&spec.period!=='ft'&&!body.quote.drawOdds&&body.quote.oppositeOdds) fail('El ganador de este periodo tiene tres opciones: incluye tambien la cuota del empate.');
    const quote=body.quote?compareOdds(market.probability,market.pushProbability,body.quote,cutoff):null;
    if(quote&&Date.parse(quote.quotedAt)>=Date.parse(fixture.date)) fail('La cuota debe ser anterior al inicio.');
    const missing=!finite(market.probability)||evidence.level>=3||evidence.n<10;
    if(evidence.currentSeasonN<5) reasons.push('Menos de cinco partidos con datos de esta temporada; el historial anterior puede reflejar otro rol o plantilla.');
    if(!quote) reasons.push('Falta una cuota para la misma condicion.');else if(quote.stale) reasons.push('La cuota anotada tiene mas de 30 minutos.');
    if(!market.calibrated) reasons.push('Modelo experimental sin calibracion suficiente para esta linea.');
    const status=missing?'datos-insuficientes':reasons.length?'esperar-confirmacion':quote?.theoreticalEV<=0?'sin-ventaja-estimada':'analizable';
    const values=spec.type==='player'?history.map(row=>row.values?.[spec.metric]):[...history.home,...history.away].map(row=>basketballPeriodPair(row,spec.period)).filter(pair=>pair.every(finite)).map(pair=>pair[0]+pair[1]);
    return {cutoff,fixture:{...fixture,home:report.meta.home,away:report.meta.away,season:config.season},league:'nba',lookback:config.lookback,marketKey,market,evidence,quote,projection,
      distribution:summary(values),status,reasons:[...new Set([...reasons,...evidence.reasons])],
      availability:report.teams.flatMap(team=>team.availability),playerRecords,
      note:'Analisis experimental. Frecuencia historica, estimacion, cuota y disponibilidad son medidas distintas. No se realizan apuestas desde esta app.'};
  }
  async function seal(body) {
    const key=norm(body.idempotencyKey);if(!/^[\w-]{8,100}$/.test(key)) fail('Identificador de guardado no valido.');
    const requestHash=hash({...body,idempotencyKey:undefined}),existing=data().snapshots.find(row=>row.idempotencyKey===key);
    if(existing) {if(existing.requestHash!==requestHash) throw new SportsError(409,'Ese guardado corresponde a otra seleccion.');return {id:existing.id,existing:true};}
    const analysis=analyze(body);if(!finite(analysis.market.probability)) fail('No hay probabilidad utilizable para sellar.');
    const context=priorGames(read().games,analysis.cutoff,'nba').filter(row=>row.season<=analysis.fixture.season).slice(-800),contextHash=hash(context);
    if(data().snapshots.length>=300) fail('Archivo de simulaciones completo; exporta y revisa el almacenamiento antes de ampliar.');
    const inputs={contextHash,players:analysis.playerRecords,availability:analysis.availability};
    const snapshot={id:randomUUID(),idempotencyKey:key,requestHash,createdAt:analysis.cutoff,fixture:analysis.fixture,spec:analysis.market.spec,
      label:analysis.market.label,probability:analysis.market.probability,pushProbability:analysis.market.pushProbability||0,quote:analysis.quote,marketKey:analysis.marketKey,version:MODEL_VERSION,lookback:analysis.lookback,
      status:analysis.status,evidence:analysis.evidence,inputs,inputHash:hash(inputs)};
    snapshot.integrity=hash(snapshot);const archive=writable();
    const extra=(archive.contexts[contextHash]?0:Buffer.byteLength(JSON.stringify(context)))+Buffer.byteLength(JSON.stringify(snapshot));
    if(Buffer.byteLength(JSON.stringify(archive))+extra>12*1024*1024) fail('Limite de archivo alcanzado; exporta y revisa el almacenamiento antes de ampliarlo.');
    archive.contexts[contextHash] ||= context;archive.snapshots.push(snapshot);await persist();return {id:snapshot.id,existing:false};
  }
  function valid(snapshot) {try {const {integrity,...value}=snapshot;return integrity===hash(value)&&snapshot.inputHash===hash(snapshot.inputs)&&hash(data().contexts[snapshot.inputs.contextHash])===snapshot.inputs.contextHash;}catch{return false;}}
  function journal() {
    const stored=read(),seen=new Set(),records=data().snapshots.map(snapshot=>{
      const game=stored.games.find(game=>game.league==='nba'&&game.id===snapshot.fixture.id);
      let outcome=null,state='pendiente';
      if(!valid(snapshot)) state='integridad-invalida';
      else if(game&&(Date.parse(game.date)!==Date.parse(snapshot.fixture.date)||/postpon|cancel|PST|CANC/i.test(game.status||''))) state='anulado';
      else if(game?.finished) {outcome=marketOutcome({spec:snapshot.spec},game,stored.players.filter(row=>snapshot.spec.type!=='player'||row.playerKey===snapshot.spec.playerKey));state=outcome===null?'sin-resultado-individual':outcome==='push'?'devolucion':outcome===1?'cumplido':'no-cumplido';}
      const unitProfit=snapshot.quote&&outcome!==null?(outcome==='push'?0:outcome===1?snapshot.quote.odds-1:-1):null;
      const grouping=hash({fixture:snapshot.fixture.id,type:snapshot.spec.type,period:snapshot.spec.period,line:snapshot.spec.type==='spread'&&snapshot.spec.side==='away'?-snapshot.spec.line:snapshot.spec.line,player:snapshot.spec.playerKey,metric:snapshot.spec.metric});
      const duplicate=seen.has(grouping);seen.add(grouping);
      const observation=(data().observations||[]).filter(row=>row.id===snapshot.id).sort((a,b)=>a.quotedAt.localeCompare(b.quotedAt)).at(-1);
      return {...snapshot,inputs:undefined,state,outcome,duplicate,unitProfit:round(unitProfit),lastRecordedOdds:observation||null,
        recordedPriceChange:observation&&snapshot.quote?round((snapshot.quote.odds/observation.odds-1)*100):null};
    });
    const evaluable=records.filter(row=>!row.duplicate&&[0,1,'push'].includes(row.outcome)),groups={};
    for(const row of evaluable) {const key=row.spec.type==='player'?`player-${row.spec.metric}`:`${row.spec.type}-${row.spec.period}`;(groups[key] ||= []).push({probability:row.probability/(100-row.pushProbability),outcome:row.outcome});}
    const priced=evaluable.filter(row=>row.unitProfit!==null);
    return {records:records.reverse().slice(0,300),total:records.length,groups:Object.fromEntries(Object.entries(groups).map(([key,rows])=>[key,{...evaluate(rows),hitRate:rows.filter(r=>r.outcome!=='push').length?100*rows.filter(r=>r.outcome===1).length/rows.filter(r=>r.outcome!=='push').length:null}])),
      pending:records.filter(row=>row.state==='pendiente').length,invalid:records.filter(row=>row.state==='integridad-invalida').length,
      simulated:{n:priced.length,units:round(priced.reduce((sum,row)=>sum+row.unitProfit,0)),roi:priced.length?round(priced.reduce((sum,row)=>sum+row.unitProfit,0)/priced.length*100):null},
      note:'Simulacion con una unidad fija por seleccion y cuotas anotadas manualmente. Se usa la primera seleccion de cada mercado equivalente; distintos mercados del mismo partido siguen correlacionados. No demuestra rentabilidad futura ni representa apuestas realizadas.'};
  }
  async function recordPrice(body) {
    const snapshot=data().snapshots.find(row=>row.id===body.id);if(!snapshot||!valid(snapshot)) fail('Registro no disponible.');
    if(Date.parse(snapshot.fixture.date)<=now().getTime()) fail('No se anotan cuotas retrospectivas despues del inicio.');
    if(body.marketKey!==snapshot.marketKey) fail('La cuota no corresponde a la condicion sellada.');
    if(data().observations.length>=3000) fail('Limite de anotaciones de cuota alcanzado.');
    const quote=compareOdds(snapshot.probability,snapshot.pushProbability,body,now().toISOString());
    if(quote.bookmaker!==snapshot.quote?.bookmaker||Date.parse(quote.quotedAt)<Date.parse(snapshot.createdAt)) fail('Usa la misma casa y una cuota posterior al sellado.');
    writable().observations.push({id:snapshot.id,odds:quote.odds,bookmaker:quote.bookmaker,quotedAt:quote.quotedAt,recordedAt:now().toISOString()});await persist();return {saved:true};
  }
  return {analyze,seal,journal,recordPrice};
}
