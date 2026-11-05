import test from 'node:test';
import assert from 'node:assert/strict';
import {easternInstant,officialPdfTime,parseOfficialInjuries,createNbaOfficial} from './nba-official.mjs';
const url='https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-10-28_01_00PM.pdf';
const pdfText=`Injury Report: 10/28/26 01:00 PM
Page 1 of 2
Game Date Game Time Matchup Team Player Name Current Status Reason
10/28/2026 08:00 (ET) BOS@NYK Boston Celtics Brown, Jaylen Questionable Injury/Illness - Knee
Page 2 of 2
Injury Report: 10/28/26 01:00 PM
Game Date Game Time Matchup Team Player Name Current Status Reason
Soreness
New York Knicks NOT YET SUBMITTED`;
test('official report parses page continuation, submissions and Eastern daylight/standard time',()=>{
  const parsed=parseOfficialInjuries(pdfText);assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0].name,'Jaylen Brown');assert.match(parsed.rows[0].reason,/Knee Soreness/);assert.equal(parsed.rows[0].start,'2026-10-29T00:00:00.000Z');assert.equal(parsed.submissions[1].submitted,false);
  assert.equal(easternInstant('2026-12-10',20,0),'2026-12-11T01:00:00.000Z');assert.equal(officialPdfTime(url),'2026-10-28T17:00:00.000Z');assert.equal(officialPdfTime('https://evil.test/Injury-Report_2026-10-28_01_00PM.pdf'),null);assert.throws(()=>parseOfficialInjuries('new format'),/formato/);
});
test('official refresh selects one past PDF, coalesces, maps exact fixture identities and retains old data after failure',async()=>{
  let instant=new Date('2026-10-28T18:00:00Z'),calls=0,broken=false;const store={};
  const data={games:[{id:'x',league:'nba',season:'2026/2027',date:'2026-10-29T00:00:00Z',home:'Boston Celtics',away:'New York Knicks',finished:false}],players:[{league:'nba',season:'2026/2027',team:'Boston Celtics',name:'Jaylen Brown',playerKey:'api:1'}]};
  const service=createNbaOfficial({getStore:()=>store,persist:async()=>{},read:()=>data,now:()=>instant,parse:async()=>pdfText,request:async link=>{calls++;if(broken)throw Error('failed');return new Response(link.endsWith('.pdf')?'%PDF test':`<a href="${url}">past</a><a href="${url.replace('01_00PM','11_00PM')}">future</a>`);}});
  const results=await Promise.all([service.refresh(),service.refresh()]);assert.equal(calls,2);assert.equal(results[0].imported,1);await service.refresh();assert.equal(calls,2);
  assert.equal(service.availability()[0].playerKey,'api:1');assert.equal(service.availability()[0].status,'questionable');data.players[0].name='Another Brown';assert.equal(service.availability().length,0);
  instant=new Date('2026-10-29T02:00:00Z');broken=true;await assert.rejects(service.refresh());assert.equal(store.nbaOfficial.rows.length,1);assert.equal(service.state().stale,true);await service.refresh();assert.equal(calls,3);
});
test('official PDF timestamp mismatch is rejected without replacing the last report',async()=>{
  const store={nbaOfficial:{rows:[{name:'retained'}]}};const service=createNbaOfficial({getStore:()=>store,persist:async()=>{},read:()=>({games:[],players:[]}),now:()=>new Date('2026-10-28T18:00:00Z'),parse:async()=>pdfText.replace('01:00 PM','02:00 PM'),request:async link=>new Response(link.endsWith('.pdf')?'%PDF test':`<a href="${url}">report</a>`)});
  await assert.rejects(service.refresh());assert.equal(store.nbaOfficial.rows[0].name,'retained');
});
