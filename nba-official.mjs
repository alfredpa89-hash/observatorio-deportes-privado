import { Worker } from 'node:worker_threads';
import { SportsError } from './sports.mjs';
import { basketballFocus } from './basketball-focus.mjs';

const TEAMS = ['Atlanta Hawks','Boston Celtics','Brooklyn Nets','Charlotte Hornets','Chicago Bulls','Cleveland Cavaliers','Dallas Mavericks','Denver Nuggets','Detroit Pistons','Golden State Warriors','Houston Rockets','Indiana Pacers','LA Clippers','Los Angeles Lakers','Memphis Grizzlies','Miami Heat','Milwaukee Bucks','Minnesota Timberwolves','New Orleans Pelicans','New York Knicks','Oklahoma City Thunder','Orlando Magic','Philadelphia 76ers','Phoenix Suns','Portland Trail Blazers','Sacramento Kings','San Antonio Spurs','Toronto Raptors','Utah Jazz','Washington Wizards'];
export const nbaName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const teamKey = value => nbaName(value).replace(/^losangelesclippers$/, 'laclippers');
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone:'America/New_York', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' });
export function easternInstant(day, hour, minute) {
  const target = Date.parse(`${day}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00Z`);
  let instant = target;
  for (let i=0;i<2;i++) { const parts=eastern.formatToParts(new Date(instant)), p=Object.fromEntries(parts.map(row=>[row.type,row.value]));
    instant += target-Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`); }
  return new Date(instant).toISOString();
}
export function officialPdfTime(url) {
  const m=String(url).match(/^https:\/\/ak-static\.cms\.nba\.com\/referee\/injury\/Injury-Report_(\d{4}-\d{2}-\d{2})_(\d{2})_(\d{2})(AM|PM)\.pdf$/);
  return m ? easternInstant(m[1], Number(m[2])%12+(m[4]==='PM'?12:0),Number(m[3])) : null;
}
export function parseOfficialInjuries(text) {
  const rows=[], submissions=[]; let day=null, time=null, matchup=null, team=null, previous=null, unparsed=0;
  for (let line of String(text).split(/\r?\n/).map(row=>row.trim()).filter(Boolean)) {
    if (/^(Injury Report:|Page \d|Game Date|-- \d+ of)/.test(line)) continue;
    const date=line.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+/);
    if (date) { day=`${date[3]}-${date[1]}-${date[2]}`; line=line.slice(date[0].length); time=null; matchup=null; team=null; previous=null; }
    const at=line.match(/^(\d{2}):(\d{2}) \(ET\)\s+/);
    if(at) { time=[Number(at[1]),Number(at[2])]; line=line.slice(at[0].length); }
    const match=line.match(/^([A-Z]{2,3}@[A-Z]{2,3})\s+/);
    if(match) { matchup=match[1]; line=line.slice(match[0].length); team=null; previous=null; }
    const club=TEAMS.find(value=>line.startsWith(value+' '));
    if(club) { team=club; line=line.slice(club.length).trim(); previous=null; }
    if(line==='NOT YET SUBMITTED') { if(day&&team) submissions.push({day,team,matchup,submitted:false}); previous=null; continue; }
    const item=line.match(/^(.+?,\s*.+?)\s+(Out|Questionable|Doubtful|Probable|Available)\b\s*(.*)$/);
    if(item && day && team && matchup && time) {
      const comma=item[1].lastIndexOf(','), name=`${item[1].slice(comma+1).trim()} ${item[1].slice(0,comma).trim()}`;
      previous={day,team,matchup,name,status:item[2],reason:item[3],start:easternInstant(day,time[0]%12+12,time[1])}; rows.push(previous);
      if(!submissions.some(row=>row.day===day&&row.team===team)) submissions.push({day,team,matchup,submitted:true});
    } else if(previous && !item) previous.reason += ` ${line}`;
    else unparsed++;
  }
  if(!rows.length || unparsed>3) throw new SportsError(502,'El formato del parte NBA no se pudo verificar; se conserva el reporte anterior.');
  return {rows,submissions,unparsed};
}
async function parsePdf(bytes) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./nba-pdf-worker.mjs',import.meta.url),{workerData:bytes,resourceLimits:{maxOldGenerationSizeMb:96},execArgv:[]});
    let settled=false;
    const timer=setTimeout(()=>finish(new SportsError(504,'El parte NBA tardo demasiado en leerse.')),25000);
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(value);};
    worker.once('message',row=>finish(row.error?new SportsError(502,'No se pudo leer el PDF oficial.'):null,row.text));
    worker.once('error',()=>finish(new SportsError(502,'El lector del parte NBA no esta disponible.')));
    worker.once('exit',code=>{if(code) finish(new SportsError(502,'Lectura del parte NBA interrumpida.'));});
  });
}
export function createNbaOfficial({getStore,persist,read,now=()=>new Date(),request=fetch,parse=parsePdf}) {
  let running;
  const saved=()=>getStore().nbaOfficial || {};
  async function bounded(url,limit) {
    const response=await request(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok) throw new SportsError(502,'La fuente oficial NBA no respondio; se conserva el ultimo parte.');
    if(Number(response.headers.get('content-length'))>limit) throw new SportsError(502,'Parte oficial demasiado grande.');
    const chunks=[];let length=0;
    for await(const bytes of response.body) { length+=bytes.length;if(length>limit) throw new SportsError(502,'Parte oficial demasiado grande.');chunks.push(bytes); }
    return Buffer.concat(chunks);
  }
  async function refresh() {
    if(running) return running;
    if(Date.parse(saved().nextAt)>now().getTime()) return {cached:true,imported:0,warning:saved().issue||null};
    running=(async()=>{
      const stamp=now().toISOString(), season=Number(basketballFocus(now()).today.slice(0,4))-(Number(basketballFocus(now()).today.slice(5,7))<9?1:0);
      const page=`https://official.nba.com/nba-injury-report-${season}-${String(season+1).slice(2)}-season/`;
      try {
        const html=(await bounded(page,500000)).toString('utf8');
        const links=[...html.matchAll(/https:\/\/ak-static\.cms\.nba\.com\/referee\/injury\/Injury-Report_[^"'<>\s]+\.pdf/g)].map(row=>({url:row[0],publishedAt:officialPdfTime(row[0])}))
          .filter(row=>row.publishedAt&&Date.parse(row.publishedAt)<=now().getTime()).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
        const latest=links[0];if(!latest) throw new SportsError(502,'No hay un parte oficial verificable anterior a esta lectura.');
        if(saved().sourceUrl===latest.url) { Object.assign(saved(),{checkedAt:stamp,nextAt:new Date(now().getTime()+15*60000).toISOString(),issue:null});await persist();return {cached:true,imported:0}; }
        const bytes=await bounded(latest.url,3*1024*1024); if(bytes.subarray(0,4).toString()!=='%PDF') throw new SportsError(502,'La fuente no devolvio un PDF.');
        const text=await parse(bytes), header=text.match(/Injury Report:\s*(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s*(AM|PM)/);
        if(!header||easternInstant(`20${header[3]}-${header[1]}-${header[2]}`,Number(header[4])%12+(header[6]==='PM'?12:0),Number(header[5]))!==latest.publishedAt) throw new SportsError(502,'La fecha del PDF no coincide con su publicacion.');
        const parsed=parseOfficialInjuries(text);
        getStore().nbaOfficial={...parsed,sourceUrl:latest.url,sourcePage:page,publishedAt:latest.publishedAt,recordedAt:stamp,checkedAt:stamp,nextAt:new Date(now().getTime()+15*60000).toISOString(),issue:null};
        await persist();return {imported:parsed.rows.length,sourceUrl:latest.url,publishedAt:latest.publishedAt};
      } catch(error) {
        getStore().nbaOfficial={...saved(),checkedAt:stamp,nextAt:new Date(now().getTime()+60*60000).toISOString(),issue:'Parte NBA pendiente de actualizar. Se conserva la lectura anterior.'}; await persist();
        throw new SportsError(error.status||502,getStore().nbaOfficial.issue);
      }
    })();try{return await running;}finally{running=null;}
  }
  function availability() {
    const source=saved(); if(!source.publishedAt) return [];
    const data=read(), mapping={Out:'out',Questionable:'questionable',Doubtful:'questionable',Probable:'questionable',Available:'active'};
    return (source.rows||[]).flatMap(row=>{
      const fixture=data.games.find(game=>game.league==='nba'&&!game.finished&&Date.parse(game.date)===Date.parse(row.start)&&[game.home,game.away].some(team=>teamKey(team)===teamKey(row.team)));
      if(!fixture) return [];
      const team=[fixture.home,fixture.away].find(team=>teamKey(team)===teamKey(row.team));
      const identities=[...new Map(data.players.filter(log=>log.league==='nba'&&log.season===fixture.season&&teamKey(log.team)===teamKey(team)&&[nbaName(log.name),nbaName(log.name.split(' ').reverse().join(' '))].includes(nbaName(row.name))).map(log=>[log.playerKey||`${log.source}:${log.playerId||log.name}`,log])).values()];
      return identities.map(log=>({id:`nba-official:${row.start}:${row.team}:${log.playerKey}`,league:'nba',season:fixture.season,fixtureId:fixture.id,team,playerKey:log.playerKey,
        name:row.name,status:mapping[row.status],sourceStatus:row.status,minutesLimit:null,publishedAt:source.publishedAt,recordedAt:source.recordedAt,
        expiresAt:new Date(Math.min(Date.parse(row.start)+3*3600000,Date.parse(source.publishedAt)+6*3600000)).toISOString(),sourceUrl:source.sourceUrl,source:'NBA Official',note:`${row.status}: ${row.reason}`.slice(0,500)}));
    });
  }
  function state() {const source=saved();return {...source,rows:source.rows||[],submissions:source.submissions||[],stale:!source.publishedAt||now().getTime()-Date.parse(source.publishedAt)>6*3600000,note:'Parte oficial de disponibilidad, no convocatoria completa ni minutos proyectados. La ausencia del reporte no significa disponible.'};}
  return {refresh,availability,state};
}
