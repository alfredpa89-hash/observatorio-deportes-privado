import test from 'node:test';
import assert from 'node:assert/strict';
import {compareOdds,createBasketballAnalysis} from './basketball-analysis.mjs';
import {createBasketballPrematch} from './basketball-prematch.mjs';
import {createBasketballPlayerAnalysis} from './basketball-player-analysis.mjs';
const setup=()=>{let time=new Date('2026-10-28T18:00:00Z');const store={basketball:{trial:{snapshots:[{id:'frozen'}]}}};
  const games=Array.from({length:24},(_,i)=>({id:`g${i}`,league:'nba',season:i<16?'2025/2026':'2026/2027',date:i<16?`2026-04-${String(i+1).padStart(2,'0')}T00:00:00Z`:`2026-10-${String(i+4).padStart(2,'0')}T00:00:00Z`,home:'A',away:'B',homePoints:110+i%7,awayPoints:105+i%6,finished:true,status:'FT',stats:{home:{firstQuarterPoints:28,halfTimePoints:57},away:{firstQuarterPoints:25,halfTimePoints:53}}}));
  games.push({id:'next',league:'nba',season:'2026/2027',date:'2026-10-29T00:00:00Z',home:'A',away:'B',finished:false,status:'NS',fetchedAt:'2026-10-28T17:00:00Z'});
  const players=games.filter(g=>g.finished).map(g=>({id:`p-${g.id}`,playerKey:'p1',name:'Player',league:'nba',season:g.season,date:g.date,matchId:g.id,team:'A',opponent:'B',minutes:30,values:{points:20,rebounds:7,assists:4,threes:2}}));
  const data={games,players,availability:[]},read=()=>data,now=()=>time,playerAnalysis=createBasketballPlayerAnalysis({read,now}),prematch=createBasketballPrematch({read,playerAnalysis,now});
  return{api:createBasketballAnalysis({getStore:()=>store,persist:async()=>{},read,prematch,playerAnalysis,now}),store,data,setTime:value=>time=new Date(value)};};
const body={fixtureId:'next',season:'2026/2027',lookback:20,spec:{type:'total',period:'ft',direction:'over',line:220.5}};
test('odds distinguish implied, no-vig, fair and expected return; absent probability stays absent',()=>{
  const q=compareOdds(60,0,{odds:2,oppositeOdds:2,bookmaker:'Example',quotedAt:'2026-10-28T17:55:00Z'},'2026-10-28T18:00:00Z');assert.equal(q.impliedProbability,50);assert.equal(q.noVigProbability,50);assert.equal(q.theoreticalEV,.2);
  assert.equal(compareOdds(null,0,q,'2026-10-28T18:00:00Z').fairOdds,null);assert.throws(()=>compareOdds(50,0,{...q,odds:1},'2026-10-28T18:00:00Z'));assert.throws(()=>compareOdds(50,0,{...q,quotedAt:'2026-10-29T00:00:00Z'},'2026-10-28T18:00:00Z'));
});
test('decision uses historical counts, exact line quotes and player participation without leakage',()=>{
  const {api,data}=setup(),before=structuredClone(data);const result=api.analyze(body);assert.ok(Number.isFinite(result.market.probability));assert.equal(result.market.observed.home.n,20);assert.equal(result.status,'esperar-confirmacion');assert.deepEqual(data,before);
  assert.throws(()=>api.analyze({...body,quote:{marketKey:'wrong'}}),/otra condicion/);
  const p=api.analyze({...body,spec:{type:'player',playerKey:'p1',metric:'pra',direction:'over',line:30.5}});assert.equal(p.projection.average,31);assert.equal(p.market.observed.player.hits,20);assert.equal(p.projection.status,'unknown');
  data.availability.push({league:'nba',playerKey:'p1',team:'A',status:'out',publishedAt:'2026-10-28T17:00:00Z',recordedAt:'2026-10-28T17:00:00Z',expiresAt:'2026-10-29T01:00:00Z'});assert.equal(api.analyze({...body,spec:p.market.spec}).market.probability,null);
});
test('manual snapshots are idempotent, prestart only, integrity checked, settled without rewriting old trials',async()=>{
  const {api,store,data,setTime}=setup(),frozen=structuredClone(store.basketball);const analysis=api.analyze(body),request={...body,idempotencyKey:'test-123456',quote:{marketKey:analysis.marketKey,odds:1.9,bookmaker:'Example',quotedAt:'2026-10-28T17:55:00Z'}};
  const sealed=await api.seal(request);assert.equal((await api.seal(request)).existing,true);assert.equal(api.journal().pending,1);await assert.rejects(api.seal({...request,spec:{...body.spec,line:225.5}}),/otra seleccion/);
  assert.throws(()=>api.analyze({...body,fixtureId:'missing'}));setTime('2026-10-29T00:00:00Z');await assert.rejects(api.seal({...request,idempotencyKey:'another-key'}));
  Object.assign(data.games.at(-1),{finished:true,status:'FT',homePoints:120,awayPoints:110,date:'2026-10-29T00:00:00.000Z'});let j=api.journal();assert.equal(j.records[0].state,'cumplido');assert.equal(j.simulated.n,1);assert.equal(j.simulated.units,.9);assert.equal(j.groups['total-ft'].n,1);assert.deepEqual(store.basketball,frozen);
  store.basketballAnalysis.snapshots[0].probability=99;j=api.journal();assert.equal(j.invalid,1);assert.equal(j.simulated.n,0);assert.equal(j.records[0].id,sealed.id);
});
test('repeated complementary markets count once; altered schedule voids rather than re-forecasts',async()=>{
  const {api,data}=setup();await api.seal({...body,idempotencyKey:'first-key'});await api.seal({...body,spec:{...body.spec,direction:'under'},idempotencyKey:'second-key'});assert.equal(api.journal().records.filter(r=>r.duplicate).length,1);
  data.games.at(-1).date='2026-10-30T00:00:00Z';assert.ok(api.journal().records.every(r=>r.state==='anulado'));
});
test('a reported minute ceiling can lower a projection, never raise the player role',()=>{
 const {api,data}=setup(),spec={type:'player',playerKey:'p1',metric:'points',direction:'over',line:20.5};
 data.availability.push({league:'nba',playerKey:'p1',team:'A',status:'minutes_limit',minutesLimit:40,publishedAt:'2026-10-28T17:00:00Z',recordedAt:'2026-10-28T17:00:00Z',expiresAt:'2026-10-29T01:00:00Z'});
 assert.equal(api.analyze({...body,spec}).projection.projectedMinutes,30);data.availability[0].minutesLimit=20;assert.equal(api.analyze({...body,spec}).projection.projectedMinutes,20);
});
