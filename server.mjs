import { createServer } from 'node:http';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildReport } from './model.mjs';
import { handicapDefinitions } from './public/football-handicap.js';
import { createSportsService, SportsError } from './sports.mjs';
import { createProfilesService } from './profiles.mjs';
import { createBasketballService } from './basketball-service.mjs';
import { createBasketballResearch } from './basketball-research.mjs';
import { createBasketballDaily } from './basketball-daily.mjs';
import { createDailyOverview } from './daily-overview.mjs';
import { createNbaOfficial } from './nba-official.mjs';
import { createBasketballPanel } from './basketball-panel.mjs';
import { createBasketballPlayerAnalysis } from './basketball-player-analysis.mjs';
import { createBasketballPrematch } from './basketball-prematch.mjs';
import { createBasketballAnalysis } from './basketball-analysis.mjs';
import { createFootballPlayersService, restoreFootballPlayerSaves } from './football-players.mjs';
import { combineFootballHistory, canonicalTeam, footballSeasonAggregates } from './football-history.mjs';
import { createFootystatsService } from './footystats.mjs';
import { createTennisLab } from './tennis-lab.mjs';
import { createRequestBudget } from './request-budget.mjs';
import { createDataBackups } from './data-backups.mjs';
import { createDataControl } from './data-control.mjs';
import { createDataContext } from './data-context.mjs';
import { createBasketballReadiness } from './basketball-readiness.mjs';
import { createCredentialVault, defaultCredentialFile, CREDENTIAL_PROVIDERS } from './credentials.mjs';
import { createContextReader } from './context-data.mjs';
import { createResearchContext } from './research-context.mjs';
import { createFootballContext } from './football-context.mjs';
import basketballReferences from './research/euroleague-2026-10-11.json' with { type: 'json' };

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.OBSERVATORIO_DATA_DIR || path.join(ROOT, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const API_BASE = 'https://v3.football.api-sports.io';
const EUROPE_BASE = 'https://www.football-data.co.uk/mmz4281';
const EUROPE_FIXTURES_URL = 'https://www.football-data.co.uk/fixtures.csv';
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
let credentialVault = createCredentialVault({ file: defaultCredentialFile(ROOT), enabled: PORT !== 0 && process.env.OBSERVATORIO_DISABLE_CREDENTIALS !== '1' });
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);
const STAT_FIELDS = ['shots', 'shotsOnTarget', 'corners', 'fouls', 'yellow', 'red', 'offsides'];
const EUROPE_DIVISIONS = {
  E0: { name: 'Premier League', country: 'England' },
  E1: { name: 'Championship', country: 'England', aliases: ['Segunda liga de Inglaterra', 'Segunda división de Inglaterra', 'EFL Championship'] },
  SP1: { name: 'La Liga', country: 'Spain' },
  D1: { name: 'Bundesliga', country: 'Germany' },
  I1: { name: 'Serie A', country: 'Italy' },
  F1: { name: 'Ligue 1', country: 'France' },
  N1: { name: 'Eredivisie', country: 'Netherlands', aliases: ['Liga holandesa', 'Liga de Holanda', 'Everdise', 'Eredivise'] },
  P1: { name: 'Primeira Liga', country: 'Portugal', aliases: ['Liga portuguesa', 'Liga de Portugal', 'Liga Portugal', 'Liga Portugal Betclic'] },
};
const EUROPE_SEASONS = ['2324', '2425', '2526', '2627'];
const EXTRA_LEAGUES = {
  USA: { name: 'MLS', country: 'USA', sourcePage: 'https://football-data.co.uk/usa.php', seasons: ['2026', '2025', '2024'], aliases: ['Major League Soccer', 'Estados Unidos'] },
  MEX: { name: 'Liga MX', country: 'Mexico', sourcePage: 'https://football-data.co.uk/mexico.php', seasons: ['2026/2027', '2025/2026', '2024/2025'], aliases: ['Liga Mexicana', 'Liga de Mexico', 'México'] },
  BRA: { name: 'Brasileirão Serie A', country: 'Brazil', sourcePage: 'https://football-data.co.uk/brazil.php', seasons: ['2026', '2025', '2024'], aliases: ['Brasil', 'Liga Brasileña', 'Brasileirao', 'Brazil Serie A'] },
  ARG: { name: 'Liga Profesional Argentina', country: 'Argentina', sourcePage: 'https://football-data.co.uk/argentina.php', seasons: ['2026', '2025', '2024'], aliases: ['Liga Argentina', 'Primera División Argentina'] },
};
const ESPN_LEAGUES = {
  PER: { name: 'Liga 1 Perú', country: 'Peru', slug: 'per.1', seasons: ['2026', '2025'], aliases: ['Liga Peruana', 'Liga 1 Peru', 'Perú', 'Primera División Perú'], counts: true },
  CHL: { name: 'Primera División Chile', country: 'Chile', slug: 'chi.1', seasons: ['2026', '2025'], aliases: ['Liga Chilena', 'Chile', 'Primera División Chilena'], counts: true },
  PAR1: { name: 'Primera División Paraguay', country: 'Paraguay', slug: 'par.1', seasons: ['2026', '2025'], aliases: ['Liga Paraguaya', 'Paraguay', 'División Profesional Paraguay'], counts: false },
};
const OPEN_LEAGUES = {
  PAR: {
    name: 'Primera División Paraguay', country: 'Paraguay', aliases: ['Liga Paraguaya', 'Paraguay', 'División Profesional Paraguay'],
    seasons: ['2025'], timeZone: 'America/Asuncion', format: 'football-txt',
    sourcePage: 'https://github.com/openfootball/south-america/blob/master/paraguay/2025_py1.txt',
    url: 'https://raw.githubusercontent.com/openfootball/south-america/master/paraguay/2025_py1.txt',
    datasetName: 'Paraguay Primera Division 2025', phase: 'Apertura: archivo parcial',
  },
  BRA2: {
    name: 'Brasileirão Serie B', country: 'Brazil', aliases: ['Serie B Brasil', 'Serie B de Brasil', 'Segunda división de Brasil'],
    seasons: ['2025'], timeZone: 'America/Sao_Paulo', format: 'json',
    sourcePage: 'https://github.com/openfootball/football.json/blob/master/2025/br.2.json',
    url: 'https://raw.githubusercontent.com/openfootball/football.json/master/2025/br.2.json',
    datasetName: 'Brasileiro Série B 2025', phase: 'primeras jornadas de la fase regular',
  },
  COL: {
    name: 'Primera A Colombia', country: 'Colombia', aliases: ['Liga Colombiana', 'Liga BetPlay'],
    seasons: ['2025'], timeZone: 'America/Bogota', format: 'json',
    sourcePage: 'https://github.com/openfootball/football.json/blob/master/2025/co.1.json',
    url: 'https://raw.githubusercontent.com/openfootball/football.json/master/2025/co.1.json',
    datasetName: 'Colombia Primera A 2025', phase: 'Apertura: fase regular',
  },
  ECU: {
    name: 'LigaPro Ecuador', country: 'Ecuador', aliases: ['Liga Pro', 'Liga Ecuatoriana', 'Serie A Ecuador'],
    seasons: ['2025'], timeZone: 'America/Guayaquil', format: 'football-txt',
    sourcePage: 'https://github.com/openfootball/south-america/blob/master/ecuador/2025_ec1.txt',
    url: 'https://raw.githubusercontent.com/openfootball/south-america/master/ecuador/2025_ec1.txt',
    datasetName: 'Ecuador Serie A 2025', phase: 'fase regular',
  },
};
const API_LEAGUES = [
  { key: 'api-preset:per', name: 'Liga 1 Perú', country: 'Peru', apiNames: ['Primera División'], aliases: ['Liga Peruana', 'Liga 1 Peru', 'Perú', 'Primera División Perú'] },
  { key: 'api-preset:chl', name: 'Primera División Chile', country: 'Chile', apiNames: ['Primera División'], aliases: ['Liga Chilena', 'Chile', 'Primera División Chilena'] },
  { key: 'api-preset:ecu2', name: 'LigaPro Serie B Ecuador', country: 'Ecuador', apiNames: ['Liga Pro Serie B'], aliases: ['Serie B Ecuador', 'Serie B de Ecuador', 'Liga Pro Serie B', 'Segunda división Ecuador'] },
  { key: 'api-preset:col2', name: 'Primera B Colombia', country: 'Colombia', apiNames: ['Primera B'], aliases: ['Serie B Colombia', 'Serie B de Colombia', 'Torneo BetPlay', 'Segunda división Colombia'] },
  { key: 'api-preset:bol', name: 'Primera División Bolivia', country: 'Bolivia', apiNames: ['Primera División'], aliases: ['Liga Boliviana', 'Bolivia'] },
  { key: 'api-preset:uru', name: 'Primera División Uruguay', country: 'Uruguay', apiNames: ['Primera División', 'Primera División - Clausura'], aliases: ['Liga Uruguaya', 'Uruguay'] },
  { key: 'api-preset:ned', name: 'Eredivisie', country: 'Netherlands', apiNames: ['Eredivisie'], aliases: ['Liga holandesa', 'Liga de Holanda', 'Everdise', 'Eredivise'] },
  { key: 'api-preset:por', name: 'Primeira Liga', country: 'Portugal', apiNames: ['Primeira Liga'], aliases: ['Liga portuguesa', 'Liga de Portugal', 'Liga Portugal', 'Liga Portugal Betclic'] },
  { key: 'api-preset:ucl', name: 'Champions League', country: 'World', apiNames: ['UEFA Champions League'], aliases: ['Champions', 'UEFA Champions League', 'Liga de Campeones'] },
  { key: 'api-preset:uel', name: 'Europa League', country: 'World', apiNames: ['UEFA Europa League'], aliases: ['UEFA Europa League', 'Liga Europa'] },
  { key: 'api-preset:uecl', name: 'Conference League', country: 'World', apiNames: ['UEFA Europa Conference League', 'UEFA Conference League'], aliases: ['Conference', 'UEFA Europa Conference League', 'UEFA Conference League'] },
  { key: 'api-preset:lib', name: 'Copa Libertadores', country: 'World', apiNames: ['CONMEBOL Libertadores'], aliases: ['Libertadores', 'CONMEBOL Libertadores'] },
  { key: 'api-preset:sud', name: 'Copa Sudamericana', country: 'World', apiNames: ['CONMEBOL Sudamericana'], aliases: ['Sudamericana', 'CONMEBOL Sudamericana'] },
];
const COUNTRY_SEARCH = {
  ecuador: 'Ecuador', peru: 'Peru', chile: 'Chile', uruguay: 'Uruguay', bolivia: 'Bolivia',
  paraguay: 'Paraguay', ligaparaguaya: 'Paraguay', brasil: 'Brazil', brazil: 'Brazil',
  argentina: 'Argentina', colombia: 'Colombia', ligacolombiana: 'Colombia',
  ligapro: 'Ecuador', ligaecuatoriana: 'Ecuador', mls: 'USA', usa: 'USA', estadosunidos: 'USA',
  mexico: 'Mexico', ligamx: 'Mexico', ligamexicana: 'Mexico',
  inglaterra: 'England', england: 'England', espana: 'Spain', spain: 'Spain',
  alemania: 'Germany', germany: 'Germany', italia: 'Italy', italy: 'Italy',
  francia: 'France', france: 'France',
  holanda: 'Netherlands', paisesbajos: 'Netherlands', netherlands: 'Netherlands',
  portugal: 'Portugal', world: 'World', internacional: 'World',
};
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

let apiKey = process.env.API_FOOTBALL_KEY?.trim() || null;
let basketballKey = process.env.API_BASKETBALL_KEY?.trim() || null;
let basketballRemember = true;
let quota = null;
let footballConnection = { verified: false, plan: null, allowedSeasons: null, checkedAt: null, lastIssue: null };
let connectingFootball = false;
let store = { version: 1, leagues: {}, matches: [], cache: {} };
let footballReadView = null, footballReadAt = 0;
function combinedFootballStore() {
  if (!footballReadView || Date.now() - footballReadAt >= 30000) {
    footballReadView = combineFootballHistory(store); footballReadAt = Date.now();
  }
  return footballReadView;
}
let saveQueue = Promise.resolve();
let cloudStorage = null;
let footballRequestQueue = Promise.resolve(), activeMutations = 0, footballRequestsActive = 0, maintenance = false;
let stopServer = null;
const footballBudget = createRequestBudget({ getStore: () => store, getQuota: () => (store.footballQuota ||= {}), persist, name: 'football' });
const sports = createSportsService({ getStore: () => store, persist, parseCsvRows, parseCsvDateTime });
const tennisLab = createTennisLab({ getStore: () => store, persist, sports });
const basketball = createBasketballService({ getStore: () => store, persist, getApiKey: () => basketballKey,
  sports, parseCsvRows, parseCsvDateTime, references: basketballReferences });
const basketballResearch = createBasketballResearch({ getStore: () => store, persist, basketball, externalAvailability: () => nbaOfficial.availability() });
const nbaOfficial = createNbaOfficial({getStore:()=>store,persist,read:basketballResearch.playerData});
const basketballPanel = createBasketballPanel({ basketball, research: basketballResearch });
const basketballPlayers = createBasketballPlayerAnalysis({ read: basketballResearch.playerData });
const basketballPrematch = createBasketballPrematch({ read: basketballResearch.prematchData, playerAnalysis: basketballPlayers });
const basketballAnalysis = createBasketballAnalysis({getStore:()=>store,persist,read:basketballResearch.prematchData,prematch:basketballPrematch,playerAnalysis:basketballPlayers});
const basketballDaily = createBasketballDaily({ getStore: () => store, research: basketballResearch });
const dailyOverview = createDailyOverview({ getStore: () => store, basketballResearch, basketballDaily, tennisLab });
const profiles = createProfilesService({ getStore: () => store, persist, parseCsvRows, parseCsvDateTime,
  getFootballStore: key => store.leagues[key] ? store : combinedFootballStore(),
  footballCatalog: key => store.leagues[key] ? [catalogEntry(store.leagues[key])] : competitionCatalog(), sportsState: () => sports.state(),
  enrichFootball: (league, history) => enrichHistory(store.leagues[league.key] || league, history, []) });
const footballPlayers = createFootballPlayersService({ getStore: () => store, persist, request: apiRequest,
  seasonAggregates: (body, league) => footballSeasonAggregates(store, league, body),
  getReadStore: key => key && store.leagues[key] ? store : combinedFootballStore(),
  resolveLoad: resolvePlayerLoad,
  getPresets: apiLeaguePresets,
  connected: () => Boolean(apiKey), getQuota: () => quota, getPolicy: footballBudget.policy, getConnection: () => footballConnection });

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const footystats = createFootystatsService({ getStore: () => store, persist,
  errorFactory: (status, message) => new HttpError(status, message) });
function dataControlConnections() {
  return { basketballConnected: Boolean(basketballKey), footballConnected: Boolean(apiKey), footystatsConnected: footystats.state().connected };
}
async function rememberCredential(provider, key, remember = true) {
  if (!credentialVault.state().supported) return credentialVault.state();
  try { await credentialVault.save(provider, remember ? String(key || '').trim() : null); } catch { /* Connection remains usable in memory; the UI exposes the storage error. */ }
  return credentialVault.state();
}
async function verifyBasketballAccess() {
  const wasPaid=basketball.requestPolicy().paid;
  const access = await basketballResearch.verify();
  // A newly verified paid session is evidence to recheck seasons denied on Free.
  if(!wasPaid&&basketball.requestPolicy().paid) await dataControl.reconnect('basketball');
  if (basketballKey) await rememberCredential('basketball', basketballKey, basketballRemember);
  return access;
}
const backups = createDataBackups({ directory: path.join(DATA_DIR, 'backups'), getStore: () => store, replaceStore: value => { store = value; }, persist });
const dataContext = createDataContext({ getStore: () => store, persist, basketballData: basketballResearch.prematchData });
const footballContext = createFootballContext({ getStore: () => store, persist, request: apiRequest,
  connected: () => Boolean(apiKey), getConnection: () => footballConnection });
const researchContext = createResearchContext({ getStore: () => store, persist,
  footballContext,
  read: createContextReader({ getStore: () => store, footballPlayers, basketballPrematch, basketballPlayers,
    readBasketball: basketballResearch.prematchData, tennisLab }) });
const basketballReadiness = createBasketballReadiness({ getStore: () => store, persist, read: basketballResearch.prematchData,
  policy: basketball.requestPolicy, trial: () => basketball.state().trial, researchEvaluation: basketballResearch.evaluation });
const dataControl = createDataControl({ getStore: () => store, persist, backups,
  basketballReadiness: basketballReadiness.state,
  contextReports: dataContext.current,
  trialAudit: basketball.audit,
  connections: dataControlConnections,
  policies: () => ({ basketball: { ...basketball.requestPolicy(), quota: store.basketball?.quota || {} }, football: { ...footballBudget.policy(), quota: store.footballQuota || {} },
    footystats: { providerLimit: footystats.state().quota?.limit ?? null, quota: { ...footystats.state().quota, used: footystats.state().dailyUsed, cooldownUntil: footystats.state().cooldownUntil },
      resetsAt: footystats.state().quota?.resetAt ? new Date(footystats.state().quota.resetAt * 1000).toISOString() : null } }),
  basketballData: basketballResearch.prematchData,
  handlers: {
    'basketball-access': verifyBasketballAccess,
    'basketball-calendar': body => basketballResearch.sync({ ...body, details: false }),
    'basketball-details': body => basketballResearch.syncBalanced(body),
    'nba-free': body => sports.load(body),
    'nba-free-players': body => sports.loadNbaDailyPlayers(body),
    'nba-official': () => nbaOfficial.refresh(),
    'football-calendar': body => loadLeague(body),
    'football-players': body => footballPlayers.load(body),
    'football-free': body => loadFree(body),
    'footystats-access': () => footystats.loadCatalog({ all: false }),
    footystats: body => footystats.sync({ ...body, background: true }),
    'tennis-free': body => tennisLab.refresh(body),
  } });

function emptyStats() {
  return Object.fromEntries(STAT_FIELDS.map((field) => [field, null]));
}

function numeric(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const clean = typeof value === 'string' ? value.trim() : value;
  if (clean === '' || clean === '-' || (typeof clean === 'string' && clean.toUpperCase() === 'N/A')) return null;
  const result = Number(clean);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function normalizeName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function slug(value) {
  return normalizeName(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'liga';
}

function cutoffValue(value) {
  if (value === null || value === undefined || value === '') return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new HttpError(400, 'La fecha de corte no es válida.');
  return parsed.toISOString();
}

function parseDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const uk = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})(?:\s+.*)?$/);
  if (uk) {
    const shortYear = Number(uk[3]);
    const year = shortYear < 100 ? (shortYear >= 70 ? 1900 : 2000) + shortYear : shortYear;
    const day = Number(uk[1]);
    const month = Number(uk[2]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
    return parsed.toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function parseCsvDateTime(dateValue, timeValue, timeZone) {
  const raw = String(dateValue ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    return parseDate(raw);
  }
  const uk = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})(?:\s+(\d{1,2}[:.]\d{2}(?::\d{2})?))?$/);
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}[:.]\d{2}(?::\d{2})?))?$/);
  if (!uk && !iso) return null;
  const shortYear = uk ? Number(uk[3]) : null;
  const year = uk ? (shortYear < 100 ? (shortYear >= 70 ? 1900 : 2000) + shortYear : shortYear) : Number(iso[1]);
  const month = uk ? Number(uk[2]) : Number(iso[2]);
  const day = uk ? Number(uk[1]) : Number(iso[3]);
  const valid = new Date(Date.UTC(year, month - 1, day));
  if (valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== day) return null;
  const rawTime = String(timeValue ?? '').trim() || uk?.[4] || iso?.[4] || '';
  const time = rawTime.match(/^(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/);
  if (rawTime && !time) return null;
  if (!time) {
    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) + 5 * 60 * 60 * 1000).toISOString();
  }
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = Number(time[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const localAsUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const zone = offsetFormatter(timeZone).formatToParts(localAsUtc).find((part) => part.type === 'timeZoneName')?.value || 'GMT';
  const offset = zone.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  const offsetMinutes = offset ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3] || 0)) : 0;
  return new Date(localAsUtc.getTime() - offsetMinutes * 60 * 1000).toISOString();
}

const offsetFormatters = new Map();
function offsetFormatter(timeZone) {
  if (!offsetFormatters.has(timeZone)) {
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'shortOffset' });
    if (offsetFormatters.size >= 16) offsetFormatters.delete(offsetFormatters.keys().next().value);
    offsetFormatters.set(timeZone, formatter);
  }
  return offsetFormatters.get(timeZone);
}

function parseCsvRows(csv) {
  const source = String(csv ?? '').replace(/^\uFEFF/, '');
  const headerLine = source.split(/\r?\n/, 1)[0] || '';
  const delimiters = [',', ';', '\t'];
  const delimiter = delimiters.sort((a, b) => headerLine.split(b).length - headerLine.split(a).length)[0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new HttpError(400, 'El CSV contiene comillas sin cerrar.');
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

const ALIASES = {
  date: ['date', 'fecha', 'matchdate'],
  time: ['time', 'hora', 'matchtime'],
  home: ['hometeam', 'home', 'local', 'equipolocal', 'teamhome'],
  away: ['awayteam', 'away', 'visitante', 'equipovisitante', 'teamaway'],
  homeGoals: ['fthg', 'hg', 'homegoals', 'goalshome', 'goleslocal', 'homegoalcount', 'homescore', 'scorehome'],
  awayGoals: ['ftag', 'ag', 'awaygoals', 'goalsaway', 'golesvisitante', 'awaygoalcount', 'awayscore', 'scoreaway'],
  homeHalfGoals: ['hthg', 'homehalfgoals', 'homehtgoals', 'goleslocal1t'],
  awayHalfGoals: ['htag', 'awayhalfgoals', 'awayhtgoals', 'golesvisitante1t'],
  homeHalfCorners: ['homehalfcorners', 'homehtcorners', 'hthc', 'hcht', 'cornerslocal1t'],
  awayHalfCorners: ['awayhalfcorners', 'awayhtcorners', 'htac', 'acht', 'cornersvisitante1t'],
  homeShots: ['hs', 'homeshots', 'shotshome', 'tiroslocal'],
  awayShots: ['as', 'awayshots', 'shotsaway', 'tirosvisitante'],
  homeShotsOnTarget: ['hst', 'homeshotsontarget', 'shotsontargethome', 'tirosalarcolocal'],
  awayShotsOnTarget: ['ast', 'awayshotsontarget', 'shotsontargetaway', 'tirosalarcovisitante'],
  homeFouls: ['hf', 'homefouls', 'foulshome', 'faltaslocal'],
  awayFouls: ['af', 'awayfouls', 'foulsaway', 'faltasvisitante'],
  homeCorners: ['hc', 'homecorners', 'cornershome', 'cornerslocal'],
  awayCorners: ['ac', 'awaycorners', 'cornersaway', 'cornersvisitante'],
  homeOffsides: ['homeoffsides', 'homeoffside', 'offsideshome', 'offsideslocal', 'fueradejuegolocal', 'fuerasdejuegolocal'],
  awayOffsides: ['awayoffsides', 'awayoffside', 'offsidesaway', 'offsidesvisitante', 'fueradejuegovisitante', 'fuerasdejuegovisitante'],
  homeYellow: ['hy', 'homeyellow', 'homeyellowcards', 'amarillaslocal'],
  awayYellow: ['ay', 'awayyellow', 'awayyellowcards', 'amarillasvisitante'],
  homeRed: ['hr', 'homered', 'homeredcards', 'rojaslocal'],
  awayRed: ['ar', 'awayred', 'awayredcards', 'rojasvisitante'],
};

function headerKey(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

function seasonValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new HttpError(400, 'Indica la temporada del archivo.');
  return /^\d{4}$/.test(raw) ? Number(raw) : raw;
}

export function parseFootballCsv(csv, { leagueName, season, timeZone = 'auto' } = {}) {
  const name = normalizeName(leagueName);
  if (!name) throw new HttpError(400, 'Indica el nombre de la liga.');
  const selectedSeason = seasonValue(season);
  const rows = parseCsvRows(csv);
  if (rows.length < 2) throw new HttpError(400, 'El CSV no contiene partidos.');
  const header = rows.shift().map(headerKey);
  const footballDataHeader = (header.includes('fthg') && header.includes('hometeam')) || ['country', 'league', 'season', 'hg', 'ag'].every((field) => header.includes(field));
  const sourceTimeZone = timeZone === 'auto' ? (footballDataHeader ? 'Europe/London' : 'America/Guayaquil') : timeZone;
  if (!['America/Guayaquil', 'America/Bogota', 'America/Sao_Paulo', 'America/Asuncion', 'Europe/London', 'UTC'].includes(sourceTimeZone)) throw new HttpError(400, 'Selecciona una zona horaria válida.');
  const indexes = Object.fromEntries(Object.entries(ALIASES).map(([field, names]) => [field, names.map((candidate) => header.indexOf(candidate)).find((index) => index >= 0) ?? -1]));
  for (const field of ['date', 'home', 'away', 'homeGoals', 'awayGoals']) {
    if (indexes[field] < 0) throw new HttpError(400, `Falta la columna requerida: ${field}.`);
  }
  const leagueKey = `csv:${slug(name)}`;
  const matches = [];
  let skipped = 0;
  for (const cells of rows) {
    const get = (field) => indexes[field] < 0 ? null : cells[indexes[field]];
    const date = parseCsvDateTime(get('date'), get('time'), sourceTimeZone);
    const home = normalizeName(get('home'));
    const away = normalizeName(get('away'));
    const homeGoals = numeric(get('homeGoals'));
    const awayGoals = numeric(get('awayGoals'));
    if (!date || !home || !away || !Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) {
      skipped += 1;
      continue;
    }
    const stat = (side, field) => numeric(get(`${side}${field}`));
    matches.push({
      id: `csv:${slug(name)}:${selectedSeason}:${date.slice(0, 10)}:${slug(home)}:${slug(away)}`,
      leagueKey,
      season: selectedSeason,
      date,
      home,
      away,
      homeId: null,
      awayId: null,
      homeLogo: null,
      awayLogo: null,
      homeGoals,
      awayGoals,
      halfTime: {
        homeGoals: stat('home', 'HalfGoals'), awayGoals: stat('away', 'HalfGoals'),
        homeCorners: stat('home', 'HalfCorners'), awayCorners: stat('away', 'HalfCorners'),
      },
      stats: {
        home: { shots: stat('home', 'Shots'), shotsOnTarget: stat('home', 'ShotsOnTarget'), corners: stat('home', 'Corners'), fouls: stat('home', 'Fouls'), yellow: stat('home', 'Yellow'), red: stat('home', 'Red'), offsides: stat('home', 'Offsides') },
        away: { shots: stat('away', 'Shots'), shotsOnTarget: stat('away', 'ShotsOnTarget'), corners: stat('away', 'Corners'), fouls: stat('away', 'Fouls'), yellow: stat('away', 'Yellow'), red: stat('away', 'Red'), offsides: stat('away', 'Offsides') },
      },
      source: 'csv',
      statsChecked: true,
    });
  }
  if (!matches.length) throw new HttpError(400, 'No se encontraron partidos terminados con fecha y marcador válidos.');
  const fixtures = parseUpcomingCsv(csv, { leagueKey, season: selectedSeason, timeZone: sourceTimeZone });
  return { leagueKey, name, season: selectedSeason, matches, fixtures, skipped };
}

export function parseUpcomingCsv(csv, { leagueKey, season, division = null, timeZone = 'America/Guayaquil' } = {}) {
  const rows = parseCsvRows(csv);
  if (!rows.length) throw new HttpError(400, 'El calendario CSV está vacío.');
  const header = rows.shift().map(headerKey);
  const index = (names) => names.map((name) => header.indexOf(name)).find((found) => found >= 0) ?? -1;
  const columns = {
    div: index(['div', 'division']), date: index(['date', 'fecha']),
    time: index(['time', 'hora']), home: index(ALIASES.home), away: index(ALIASES.away),
    homeGoals: index(ALIASES.homeGoals), awayGoals: index(ALIASES.awayGoals),
  };
  if (columns.date < 0 || columns.home < 0 || columns.away < 0 || (division && columns.div < 0)) {
    throw new HttpError(400, 'El calendario CSV no contiene columnas de división, fecha y equipos.');
  }
  const fixtures = [];
  for (const cells of rows) {
    const get = (field) => columns[field] < 0 ? null : cells[columns[field]];
    if (division && String(get('div') ?? '').trim().toUpperCase() !== division) continue;
    if (numeric(get('homeGoals')) !== null && numeric(get('awayGoals')) !== null) continue;
    const date = parseCsvDateTime(get('date'), get('time'), timeZone);
    const home = normalizeName(get('home'));
    const away = normalizeName(get('away'));
    if (!date || !home || !away || new Date(date).getTime() <= Date.now()) continue;
    fixtures.push({
      id: `csv-fixture:${leagueKey}:${season}:${date}:${slug(home)}:${slug(away)}`,
      leagueKey, season, date, home, away,
      homeId: null, awayId: null, homeLogo: null, awayLogo: null, status: 'NS',
    });
  }
  return fixtures.sort((a, b) => a.date.localeCompare(b.date));
}

function statsFromProvider(block) {
  const stats = emptyStats();
  const fieldByType = {
    'Total Shots': 'shots',
    'Shots on Goal': 'shotsOnTarget',
    'Corner Kicks': 'corners',
    Fouls: 'fouls',
    'Yellow Cards': 'yellow',
    'Red Cards': 'red',
    Offsides: 'offsides',
  };
  for (const item of block?.statistics || []) {
    const field = fieldByType[item.type];
    if (field) stats[field] = numeric(item.value);
  }
  return stats;
}

export function normalizeFixture(fixture, leagueKey, { statsChecked = false } = {}) {
  const homeTeam = fixture?.teams?.home;
  const awayTeam = fixture?.teams?.away;
  const status = fixture?.fixture?.status?.short;
  const date = parseDate(fixture?.fixture?.date);
  if (!fixture?.fixture?.id || !homeTeam?.name || !awayTeam?.name || !date || !FINISHED_STATUSES.has(status)) return null;
  const extraTime = status === 'AET' || status === 'PEN';
  const score = extraTime ? fixture?.score?.fulltime : fixture?.goals;
  const homeGoals = numeric(score?.home);
  const awayGoals = numeric(score?.away);
  if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) return null;
  const blocks = !extraTime && Array.isArray(fixture.statistics) ? fixture.statistics : [];
  const findBlock = (team) => blocks.find((block) => Number(block?.team?.id) === Number(team?.id))
    || blocks.find((block) => normalizeName(block?.team?.name).toLowerCase() === normalizeName(team?.name).toLowerCase());
  return {
    id: String(fixture.fixture.id),
    leagueKey,
    season: fixture.league?.season ?? null,
    date,
    home: normalizeName(homeTeam.name),
    away: normalizeName(awayTeam.name),
    homeId: homeTeam.id ?? null,
    awayId: awayTeam.id ?? null,
    homeLogo: homeTeam.logo || null,
    awayLogo: awayTeam.logo || null,
    homeGoals,
    awayGoals,
    halfTime: {
      homeGoals: numeric(fixture.score?.halftime?.home),
      awayGoals: numeric(fixture.score?.halftime?.away),
      homeCorners: null, awayCorners: null,
    },
    stats: { home: statsFromProvider(findBlock(homeTeam)), away: statsFromProvider(findBlock(awayTeam)) },
    source: 'api-football',
    status,
    statsChecked: extraTime || statsChecked || blocks.length > 0,
  };
}

async function initializeStore() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const saved = cloudStorage ? await cloudStorage.load() : JSON.parse(await readFile(DATA_FILE, 'utf8'));
    if (saved?.version === 1 && saved.leagues && Array.isArray(saved.matches)) {
      store = { ...saved, version: 1, leagues: saved.leagues, matches: saved.matches, cache: saved.cache || {}, sports: saved.sports || {}, playerLogs: saved.playerLogs || [] };
      if (restoreFootballPlayerSaves(store)) await persist();
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function persist() {
  footballReadView = null;
  dailyOverview.invalidate();
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    if (cloudStorage) return cloudStorage.save(store);
    const serialized = JSON.stringify(store);
    const temporary = `${DATA_FILE}.tmp`;
    await writeFile(temporary, serialized, 'utf8');
    await rename(temporary, DATA_FILE);
  });
  return saveQueue;
}

function apiErrorText(errors) {
  if (!errors || (Array.isArray(errors) && !errors.length) || (typeof errors === 'object' && !Array.isArray(errors) && !Object.keys(errors).length)) return null;
  if (Array.isArray(errors)) return errors.map(String).join('; ');
  if (typeof errors === 'object') return Object.values(errors).map(String).join('; ');
  return String(errors);
}

function footballApiError(status, detail, requestQuota, key) {
  const safe = String(detail || '').replaceAll(key, '[clave protegida]').slice(0, 600);
  const range = safe.match(/try from (\d{4}) to (\d{4})/i);
  let code = 'provider_error', message = safe || `API-Football respondio ${status}.`, allowedSeasons = null;
  if (/free plans do not have access to this season/i.test(safe)) {
    code = 'season_restricted'; status = 403;
    if (range && Number(range[2]) >= Number(range[1]) && Number(range[2]) - Number(range[1]) <= 25) {
      allowedSeasons = Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i);
    }
    message = `La clave funciona, pero el plan gratuito no permite esta temporada.${allowedSeasons ? ` El proveedor permite ${allowedSeasons[0]} a ${allowedSeasons.at(-1)} (ano de inicio).` : ''} Selecciona un historico disponible; no se sustituye por datos de la temporada actual.`;
  } else if (status === 429 || /rate.?limit|request limit|quota|too many requests/i.test(safe)) {
    code = 'quota_exceeded'; status = 429;
    message = requestQuota?.remaining === 0 ? 'Se agoto la cuota diaria de API-Football. Los datos guardados siguen disponibles.' : 'API-Football alcanzo el limite de consultas. Espera antes de volver a cargar; no se reintenta automaticamente.';
  } else if (status === 401 || /api.?key|token|authentication|unauthoriz/i.test(safe)) {
    code = 'invalid_key'; status = 401;
    message = 'API-Football no acepto esta clave. Usa la clave de Account / My Access en dashboard.api-football.com, no una clave de otro proveedor o de RapidAPI.';
  }
  const error = new HttpError(status >= 400 ? status : 403, message);
  error.code = code; error.allowedSeasons = allowedSeasons;
  return error;
}

async function fetchFootball(endpoint, params, key) {
  const result = footballRequestQueue.catch(() => {}).then(async () => {
    if (maintenance) throw new HttpError(409, 'Restauracion en curso; se conserva lo guardado.');
    footballRequestsActive++;
    try { return await fetchFootballExclusive(endpoint, params, key); } finally { footballRequestsActive--; }
  });
  footballRequestQueue = result; return result;
}
async function fetchFootballExclusive(endpoint, params, key) {
  await footballBudget.before(endpoint, params);
  const url = new URL(endpoint, API_BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let response;
  try {
    response = await fetch(url, {
      headers: { 'x-apisports-key': key },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    const error = new HttpError(502, 'No se pudo contactar con API-Football. Comprueba la conexion a Internet e intentalo de nuevo; se conserva lo guardado.');
    error.code = 'network_error'; throw error;
  }
  const requestQuota = {
    limit: numeric(response.headers.get('x-ratelimit-requests-limit')),
    remaining: numeric(response.headers.get('x-ratelimit-requests-remaining')),
    minuteLimit: numeric(response.headers.get('x-ratelimit-limit')),
    minuteRemaining: numeric(response.headers.get('x-ratelimit-remaining')),
    checkedAt: new Date().toISOString(),
  };
  await footballBudget.observe(response);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError(502, 'API-Football devolvió una respuesta no válida.');
  }
  const detail = apiErrorText(payload.errors);
  if (!response.ok || detail) {
    const error = footballApiError(response.status, detail, requestQuota, key);
    error.quota = requestQuota; throw error;
  }
  return { data: payload.response, quota: requestQuota };
}

async function connectFootballKey(value) {
  if (connectingFootball) throw new HttpError(409, 'Ya se esta verificando una clave de API-Football.');
  const candidate = String(value ?? '').trim();
  if (!candidate) {
    apiKey = null; quota = null;
    footballBudget.reset();
    footballConnection = { verified: false, plan: null, allowedSeasons: null, checkedAt: null, lastIssue: null };
    return;
  }
  if (candidate.length > 160 || /\s/.test(candidate)) throw new HttpError(400, 'La clave contiene espacios o tiene un formato no valido.');
  connectingFootball = true;
  try {
    // /status contains account details: only the plan and quota leave this function, never the raw payload.
    const result = await fetchFootball('/status', {}, candidate), subscription = result.data?.subscription;
    if (!subscription || typeof subscription.plan !== 'string' || typeof subscription.active !== 'boolean') throw new HttpError(502, 'El proveedor no devolvio un estado de suscripcion valido.');
    if (!subscription.active) throw new HttpError(403, 'La suscripcion de API-Football no esta activa. Revisa tu cuenta; no se cambio ningun plan.');
    footballBudget.verify(result.data);
    const limit = numeric(result.data.requests?.limit), used = numeric(result.data.requests?.current);
    quota = { ...result.quota, limit: result.quota.limit ?? limit,
      remaining: result.quota.remaining ?? (limit !== null && used !== null ? Math.max(0, limit - used) : null) };
    const samePlan = candidate === apiKey && subscription.plan === footballConnection.plan;
    footballConnection = { verified: true, plan: subscription.plan.slice(0, 60), checkedAt: new Date().toISOString(),
      allowedSeasons: samePlan ? footballConnection.allowedSeasons : null, lastIssue: null };
    apiKey = candidate;
    await dataControl.reconnect('football');
  } catch (error) {
    footballConnection.lastIssue = { code: error.code || 'connection_error', message: error.message };
    throw error;
  } finally { connectingFootball = false; }
}

async function apiRequest(endpoint, params = {}, ttlMs = 6 * 60 * 60 * 1000) {
  if (!apiKey) throw new HttpError(401, 'Conecta una clave gratuita de API-Football para consultar esta fuente.');
  if (!footballConnection.verified) await connectFootballKey(apiKey);
  const allowed = footballConnection.allowedSeasons;
  if (params.season !== undefined && allowed && !allowed.includes(Number(params.season))) {
    throw footballApiError(403, `Free plans do not have access to this season, try from ${allowed[0]} to ${allowed.at(-1)}.`, quota, apiKey);
  }
  const url = new URL(endpoint, API_BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const cacheKey = url.pathname + url.search;
  const cached = store.cache[cacheKey];
  if (cached && cached.plan === footballConnection.plan && Date.now() - cached.savedAt < ttlMs) return cached.data;
  let result;
  try { result = await fetchFootball(endpoint, params, apiKey); }
  catch (error) {
    if (error.quota) quota = error.quota;
    if (error.allowedSeasons) footballConnection.allowedSeasons = error.allowedSeasons;
    footballConnection.lastIssue = { code: error.code || 'provider_error', message: error.message };
    if (error.code === 'invalid_key') footballConnection.verified = false;
    if (error.code === 'invalid_key') footballBudget.reset();
    throw error;
  }
  if (!Array.isArray(result.data)) throw new HttpError(502, 'API-Football devolvio datos con un formato inesperado.');
  quota = result.quota; footballConnection.lastIssue = null;
  store.cache[cacheKey] = { savedAt: Date.now(), data: result.data, plan: footballConnection.plan };
  await persist();
  return store.cache[cacheKey].data;
}

function addMatches(matches) {
  const byId = new Map(store.matches.map((match) => [`${match.leagueKey}|${match.season}|${match.id}`, match]));
  for (const match of matches) {
    const key = `${match.leagueKey}|${match.season}|${match.id}`;
    const old = byId.get(key);
    byId.set(key, old?.statsChecked && !match.statsChecked ? { ...match, stats: old.stats, statsChecked: true } : match);
  }
  store.matches = [...byId.values()];
}

function catalogEntry(league, allMatches = store.matches) {
  const matches = allMatches.filter((match) => match.leagueKey === league.key);
  const teamNames = new Set();
  for (const names of Object.values(league.teamsBySeason || {})) {
    for (const name of names) teamNames.add(name);
  }
  for (const match of matches) {
    teamNames.add(match.home);
    teamNames.add(match.away);
  }
  return {
    key: league.key,
    name: league.name,
    country: league.country || null,
    seasons: league.seasons || [],
    teams: [...teamNames].sort((a, b) => a.localeCompare(b, 'es')),
    teamsBySeason: league.teamsBySeason || {},
    matchCount: matches.length,
    fixtureCount: (league.seasons || []).reduce((count, season) => count + fixturesFor(league, season).length, 0),
    fixtureCountBySeason: Object.fromEntries((league.seasons || []).map(season => [season, fixturesFor(league, season).length])),
    logo: league.logo || null,
    source: league.source || null,
    sourceUrl: league.sourceUrl || null,
    coverageNote: league.coverageNote || null,
    ...(league.sourceKeys ? { sourceKeys: league.sourceKeys, sources: league.sources, sourceSeasons: league.sourceSeasons,
      firstResult: league.firstResult, lastResult: league.lastResult, duplicateCount: league.duplicateCount, conflicts: league.conflicts, supplemented: league.supplemented } : {}),
  };
}

function competitionCatalog() {
  const view = combinedFootballStore();
  return Object.values(view.leagues).map(league => catalogEntry(league, view.matches)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function leagueMatches(league) {
  return (league.source === 'combined' ? combinedFootballStore().matches : store.matches).filter(match => match.leagueKey === league.key);
}

function resolvePlayerLoad(body) {
  if (store.leagues[body.leagueKey]) return body;
  const league = combinedFootballStore().leagues[body.leagueKey];
  const ref = league?.sourceSeasons?.[body.season]?.find(item => store.leagues[item.leagueKey]?.source === 'api-football');
  if (!ref) throw new SportsError(400, 'Esta temporada no tiene partidos API-Football guardados. Carga primero esa temporada con un plan que permita acceder a ella; los jugadores no se deducen del total del equipo.');
  const native = store.leagues[ref.leagueKey];
  const team = body.team ? (native.teamsBySeason?.[ref.season] || []).find(name => slug(canonicalTeam(name, native.country)) === slug(body.team)) : '';
  if (body.team && !team) throw new SportsError(400, 'El equipo no tiene una identidad API verificada en esta temporada.');
  return { ...body, leagueKey: ref.leagueKey, season: ref.season, team };
}

function freeLeagues() {
  return [
    ...Object.entries(EUROPE_DIVISIONS).map(([division, league]) => ({
      ...league, division, key: `football-data:${division}`, sourceType: 'free',
      sourcePage: 'https://football-data.co.uk/downloadm.php',
      seasons: [...EUROPE_SEASONS].reverse().map((value) => ({ value, label: europeSeasonLabel(value) })),
    })),
    ...Object.entries(EXTRA_LEAGUES).map(([division, league]) => ({
      ...league, division, key: `football-data:${division}`, sourceType: 'free',
      seasons: league.seasons.map((value) => ({ value, label: value })),
    })),
    ...Object.entries(ESPN_LEAGUES).map(([division, league]) => ({
      name: league.name, country: league.country, aliases: league.aliases,
      division, key: `espn:${division}`, sourceType: 'free', sourceName: 'ESPN',
      sourcePage: `https://www.espn.com/soccer/scoreboard/_/league/${league.slug}`,
      seasons: league.seasons.map(value => ({ value, label: value })),
    })),
    ...Object.entries(OPEN_LEAGUES).map(([division, league]) => ({
      name: league.name, country: league.country, aliases: league.aliases,
      division, key: `openfootball:${division}`, sourceType: 'free', sourceName: 'OpenFootball',
      sourcePage: league.sourcePage, historical: true,
      seasons: league.seasons.map((value) => ({ value, label: value })),
    })),
  ];
}

async function searchLeagues(query) {
  const normalized = slug(query);
  const presets = API_LEAGUES.filter(league => [league.name, ...league.aliases].some(name => slug(name) === normalized));
  const country = presets.length === 1 ? presets[0].country : COUNTRY_SEARCH[normalized.replace(/-/g, '')];
  const exactPreset = presets.length === 1 && normalized !== slug(presets[0].country);
  const matchesPreset = (league, preset) => [preset.name, ...preset.apiNames].some(name => slug(name) === slug(league.name));
  const matchesQuery = (league) => country ? league.country === country || (!league.country &&
    (slug(league.name).includes(normalized) || presets.some(preset => matchesPreset(league, preset)))) :
    [league.name, league.country, ...(league.aliases || [])].some((value) => slug(value).includes(normalized));
  const results = freeLeagues().filter(league => (!exactPreset || matchesPreset(league, presets[0])) && matchesQuery(league));
  const seen = new Set(results.map((league) => league.key));
  const current = state();
  for (const league of current.catalog.filter(league => matchesQuery(league) && (!exactPreset || matchesPreset(league, presets[0])))) {
    if (!seen.has(league.key)) results.push({ ...league, sourceType: 'saved' });
  }
  let note = null;
  if (apiKey) {
    try {
      const remote = await apiRequest('/leagues', country ? { country } : { search: query }, 24 * 60 * 60 * 1000);
      results.push(...remote.filter(item => !exactPreset || presets[0].apiNames.some(name => slug(name) === slug(item.league?.name))).map((item) => ({
        id: item.league.id, name: item.league.name, country: item.country?.name || null,
        logo: item.league.logo || null, sourceType: 'api',
        seasons: (item.seasons || []).map((entry) => entry.year).sort((a, b) => b - a),
      })));
    } catch (error) { note = `La consulta de API-Football no se completó: ${error.message}`; }
  } else if (presets.length) {
    const missing = presets.filter(league => !current.apiLeagues.find(item => item.key === league.key)?.loadedKeys.length &&
      !results.some(result => result.sourceType === 'free' && matchesPreset(result, league)));
    results.push(...missing.map(league => ({ ...league, sourceType: 'api-required', seasons: [] })));
    if (missing.length) note = 'Competición configurada, sin historial gratuito conectado. Requiere clave propia de API-Football o importar CSV; la cuenta gratuita limita las temporadas disponibles.';
  } else if (!results.length) {
    note = 'No hay una liga gratuita o guardada con ese nombre. La búsqueda de otras competiciones requiere tu clave de API-Football.';
  }
  return { results, note, requiresKey: !apiKey && (!results.length || results.some(league => league.sourceType === 'api-required')) };
}

function apiLeaguePresets() {
  return API_LEAGUES.map(({ apiNames, ...league }) => ({ ...league, loadedKeys: Object.values(store.leagues)
    .filter(saved => saved.source !== 'FootyStats' && (slug(saved.name) === slug(league.name) || (saved.country === league.country && apiNames.some(name => slug(name) === slug(saved.name)))))
    .map(saved => saved.key) }));
}

function state() {
  return {
    app: 'observatorio-futbol',
    appDirectory: ROOT,
    connected: Boolean(apiKey),
    connection: footballConnection,
    quota,
    freeLeagues: freeLeagues(),
    apiLeagues: apiLeaguePresets(),
    catalog: Object.values(store.leagues).map(league => catalogEntry(league)).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    competitions: competitionCatalog(),
  };
}

function selectedLeague(leagueKey, season) {
  const league = store.leagues[String(leagueKey ?? '')] || combinedFootballStore().leagues[String(leagueKey ?? '')];
  if (!league) throw new HttpError(404, 'Carga o importa la liga primero.');
  const selectedSeason = season ?? league.seasons?.[0];
  if (!league.seasons?.some((available) => String(available) === String(selectedSeason))) {
    throw new HttpError(400, 'Selecciona una temporada cargada.');
  }
  return { league, selectedSeason };
}

function scheduledFixture(fixture, leagueKey) {
  if (!['NS', 'TBD', 'PST'].includes(fixture?.fixture?.status?.short)) return null;
  const date = parseDate(fixture?.fixture?.date);
  const home = normalizeName(fixture?.teams?.home?.name);
  const away = normalizeName(fixture?.teams?.away?.name);
  if (!fixture?.fixture?.id || !date || !home || !away) return null;
  return {
    id: String(fixture.fixture.id), leagueKey, season: fixture.league?.season ?? null,
    date, home, away,
    homeId: fixture.teams.home.id ?? null, awayId: fixture.teams.away.id ?? null,
    homeLogo: fixture.teams.home.logo || null, awayLogo: fixture.teams.away.logo || null,
    status: fixture.fixture.status.short,
  };
}

function fixturesFor(league, season) {
  const combined = [...(league.fixturesBySeason?.[season] || []), ...(league.manualFixturesBySeason?.[season] || [])];
  const unique = new Map(combined.map(fixture => [`${fixture.date}:${fixture.home}:${fixture.away}`, fixture]));
  return [...unique.values()]
    .filter((fixture) => fixture?.id && fixture?.date && fixture?.home && fixture?.away)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function loadLeague({ id, season, freshness = false }) {
  const leagueId = Number(id);
  const selectedSeason = Number(season);
  if (!Number.isInteger(leagueId) || leagueId <= 0 || !Number.isInteger(selectedSeason) || selectedSeason < 1900) {
    throw new HttpError(400, 'Indica una liga y temporada válidas.');
  }
  const found = await apiRequest('/leagues', { id: leagueId }, 24 * 60 * 60 * 1000);
  const source = found.find((item) => Number(item.league?.id) === leagueId);
  if (!source) throw new HttpError(404, 'La liga no aparece en API-Football.');
  const fixtures = await apiRequest('/fixtures', { league: leagueId, season: selectedSeason }, freshness ? 15 * 60000 : 6 * 60 * 60 * 1000);
  if (!fixtures.length) throw new HttpError(404, 'No hay partidos disponibles para esa temporada en el plan conectado.');
  const key = `api:${leagueId}`;
  const seasonInfo = source.seasons?.find((item) => Number(item.year) === selectedSeason);
  const statisticsCovered = seasonInfo?.coverage?.fixtures?.statistics_fixtures !== false;
  const normalized = fixtures.map((fixture) => normalizeFixture(fixture, key, { statsChecked: !statisticsCovered })).filter(Boolean);
  const scheduled = fixtures.map((fixture) => scheduledFixture(fixture, key)).filter(Boolean);
  addMatches(normalized);
  const previous = store.leagues[key];
  const teams = new Set();
  for (const fixture of fixtures) {
    if (fixture.teams?.home?.name) teams.add(normalizeName(fixture.teams.home.name));
    if (fixture.teams?.away?.name) teams.add(normalizeName(fixture.teams.away.name));
  }
  store.leagues[key] = {
    key,
    id: leagueId,
    name: source.league.name,
    country: source.country?.name || null,
    logo: source.league.logo || null,
    seasons: [...new Set([...(previous?.seasons || []), selectedSeason])].sort((a, b) => Number(b) - Number(a)),
    teamsBySeason: { ...(previous?.teamsBySeason || {}), [selectedSeason]: [...teams] },
    fixturesBySeason: { ...(previous?.fixturesBySeason || {}), [selectedSeason]: scheduled },
    manualFixturesBySeason: previous?.manualFixturesBySeason || {},
    coverageBySeason: { ...(previous?.coverageBySeason || {}), [selectedSeason]: seasonInfo?.coverage || null },
    source: 'api-football',
    loadedAt: new Date().toISOString(),
  };
  await persist();
  const current = state();
  return { league: catalogEntry(store.leagues[key]), imported: normalized.length, catalog: current.catalog, state: current };
}

async function importCsv({ csv, leagueName, season, timeZone: inputTimeZone }, { source = 'csv', sourceUrl = null, leagueKey = null, country = null, timeZone = inputTimeZone || 'auto' } = {}) {
  if (typeof csv !== 'string') throw new HttpError(400, 'Envía el contenido del archivo CSV.');
  const parsed = parseFootballCsv(csv, { leagueName, season, timeZone });
  const key = leagueKey || parsed.leagueKey;
  const importedMatches = parsed.matches.map((match) => ({ ...match, leagueKey: key, source }));
  store.matches = store.matches.filter((match) => !(match.leagueKey === key && String(match.season) === String(parsed.season)));
  addMatches(importedMatches);
  const previous = store.leagues[key];
  const importedFixtures = parsed.fixtures.map((fixture) => ({ ...fixture, leagueKey: key }));
  const teams = [...new Set([...importedMatches, ...importedFixtures].flatMap((match) => [match.home, match.away]))];
  store.leagues[key] = {
    key,
    name: parsed.name,
    country: country || previous?.country || null,
    logo: null,
    seasons: [...new Set([...(previous?.seasons || []), parsed.season])].sort((a, b) => String(b).localeCompare(String(a))),
    teamsBySeason: { ...(previous?.teamsBySeason || {}), [parsed.season]: teams },
    fixturesBySeason: {
      ...(previous?.fixturesBySeason || {}),
      [parsed.season]: importedFixtures.length ? importedFixtures : previous?.fixturesBySeason?.[parsed.season] || [],
    },
    manualFixturesBySeason: previous?.manualFixturesBySeason || {},
    source,
    sourceUrl: sourceUrl || previous?.sourceUrl || null,
  };
  await persist();
  const current = state();
  return { league: catalogEntry(store.leagues[key]), imported: importedMatches.length, skipped: parsed.skipped, catalog: current.catalog, state: current };
}

async function fetchEuropeCsv(division, season, freshness = false) {
  const url = `${EUROPE_BASE}/${season}/${division}.csv`;
  const cacheKey = `europe:${season}:${division}`;
  const cached = store.cache[cacheKey];
  const ttl = season === '2627' ? freshness ? 15 * 60000 : 6 * 60 * 60 * 1000 : 90 * 24 * 60 * 60 * 1000;
  if (cached && Date.now() - cached.savedAt < ttl) return { csv: cached.data, url };
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (error) {
    throw new HttpError(502, `No se pudo descargar ${division} ${season} de Football-Data.co.uk: ${error.message}`);
  }
  if (!response.ok) throw new HttpError(502, `Football-Data.co.uk respondió ${response.status} para ${division} ${season}.`);
  const csv = await response.text();
  if (Buffer.byteLength(csv, 'utf8') > MAX_BODY_BYTES) throw new HttpError(502, 'El archivo de Football-Data.co.uk es demasiado grande.');
  const header = parseCsvRows(csv)[0]?.map(headerKey) || [];
  if (!['date', 'hometeam', 'awayteam', 'fthg', 'ftag'].every((name) => header.includes(name))) {
    throw new HttpError(502, 'Football-Data.co.uk no devolvió un CSV de resultados válido.');
  }
  store.cache[cacheKey] = { savedAt: Date.now(), data: csv };
  await persist();
  return { csv, url };
}

async function fetchEuropeFixturesCsv(freshness = false) {
  const cacheKey = 'europe:fixtures';
  const cached = store.cache[cacheKey];
  if (cached && Date.now() - cached.savedAt < (freshness ? 15 * 60000 : 6 * 60 * 60 * 1000)) return cached.data;
  let response;
  try {
    response = await fetch(EUROPE_FIXTURES_URL, { signal: AbortSignal.timeout(15000) });
  } catch (error) {
    throw new HttpError(502, `No se pudo descargar el calendario europeo: ${error.message}`);
  }
  if (!response.ok) throw new HttpError(502, `El calendario europeo respondió ${response.status}.`);
  const csv = await response.text();
  if (Buffer.byteLength(csv, 'utf8') > MAX_BODY_BYTES) throw new HttpError(502, 'El calendario europeo es demasiado grande.');
  const header = parseCsvRows(csv)[0]?.map(headerKey) || [];
  if (!['div', 'date', 'hometeam', 'awayteam'].every((name) => header.includes(name))) {
    throw new HttpError(502, 'Football-Data.co.uk no devolvió un calendario CSV válido.');
  }
  store.cache[cacheKey] = { savedAt: Date.now(), data: csv };
  await persist();
  return csv;
}

function europeSeasonLabel(code) {
  const firstYear = 2000 + Number(code.slice(0, 2));
  return `${firstYear}/${firstYear + 1}`;
}

async function loadExtra({ division, season, freshness = false }) {
  const selection = EXTRA_LEAGUES[division];
  const selectedSeason = String(season || selection.seasons[0]);
  if (!selection.seasons.includes(selectedSeason)) throw new HttpError(400, 'Selecciona una temporada disponible de la liga.');
  const url = `https://www.football-data.co.uk/new/${division}.csv`;
  const cacheKey = `extra:${division}`;
  let csv = store.cache[cacheKey]?.data;
  if (!csv || Date.now() - store.cache[cacheKey].savedAt >= (freshness ? 15 * 60000 : 6 * 60 * 60 * 1000)) {
    let response;
    try { response = await fetch(url, { signal: AbortSignal.timeout(15000) }); }
    catch (error) { throw new HttpError(502, `No se pudo descargar ${selection.name}: ${error.message}`); }
    if (!response.ok) throw new HttpError(502, `Football-Data.co.uk respondió ${response.status} para ${selection.name}.`);
    csv = await response.text();
    if (Buffer.byteLength(csv, 'utf8') > MAX_BODY_BYTES) throw new HttpError(502, 'El archivo es demasiado grande.');
    const header = parseCsvRows(csv)[0]?.map(headerKey) || [];
    if (!['season', 'date', 'home', 'away', 'hg', 'ag'].every((field) => header.includes(field))) {
      throw new HttpError(502, 'La fuente no devolvió un CSV de resultados válido.');
    }
    store.cache[cacheKey] = { data: csv, savedAt: Date.now() };
    await persist();
  }
  const rows = parseCsvRows(csv);
  const header = rows.shift();
  const seasonIndex = header.map(headerKey).indexOf('season');
  const available = [...new Set(rows.map((row) => row[seasonIndex]?.trim()).filter(Boolean))].sort().reverse();
  if (!available.includes(selectedSeason)) throw new HttpError(404, 'La fuente aún no contiene esa temporada.');
  const selectedIndex = available.indexOf(selectedSeason);
  const chosen = [selectedSeason, available[selectedIndex + 1]].filter(Boolean);
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const key = `football-data:${division}`;
  const counts = [];
  for (const selected of chosen) {
    const filtered = [header, ...rows.filter((row) => row[seasonIndex]?.trim() === selected)];
    const filteredCsv = filtered.map((row) => row.map(quote).join(',')).join('\n');
    const imported = await importCsv({ csv: filteredCsv, leagueName: selection.name, season: selected }, {
      source: 'Football-Data.co.uk', sourceUrl: url, leagueKey: key,
      country: selection.country, timeZone: 'Europe/London',
    });
    counts.push(imported.imported);
  }
  const warning = 'Esta fuente gratuita incluye resultados y goles, pero no córners, tarjetas, faltas ni tiros al arco. Tampoco incluye un calendario de próximos partidos.';
  store.leagues[key].coverageNote = warning;
  await persist();
  const current = state();
  return { league: catalogEntry(store.leagues[key]), selectedSeason, imported: counts[0], previousImported: counts[1] || 0, warning, catalog: current.catalog, state: current };
}

async function loadFree(body) {
  const division = String(body.division || '').toUpperCase();
  if (ESPN_LEAGUES[division]) return loadEspnFootball({ ...body, division });
  if (EXTRA_LEAGUES[division]) return loadExtra({ ...body, division });
  if (OPEN_LEAGUES[division]) return loadOpenFootball({ ...body, division });
  return loadEurope({ ...body, division });
}

export function parseEspnFootball(data, { division, season, counts = true }) {
  const leagueKey = `espn:${division}`;
  const matches = [];
  const fixtures = [];
  const seen = new Set();
  let provisional = 0;
  for (const event of data.events || []) {
    if (String(event.season?.year) !== String(season)) continue;
    const game = event.competitions?.[0];
    const home = game?.competitors?.find(team => team.homeAway === 'home');
    const away = game?.competitors?.find(team => team.homeAway === 'away');
    const status = game?.status?.type || event.status?.type;
    const date = parseDate(game?.date || event.date);
    const homeName = normalizeName(home?.team?.displayName);
    const awayName = normalizeName(away?.team?.displayName);
    if (!event.id || seen.has(String(event.id)) || !date || !homeName || !awayName || homeName === awayName) continue;
    seen.add(String(event.id));
    const base = { id: `espn:${division}:${event.id}`, leagueKey, season: String(season), date,
      home: homeName, away: awayName, homeId: home.id || null, awayId: away.id || null,
      homeLogo: home.team.logo || null, awayLogo: away.team.logo || null, source: 'ESPN' };
    if (status?.name === 'STATUS_SCHEDULED' && !status.completed) {
      if (game.timeValid !== true) { provisional += 1; continue; }
      fixtures.push({ ...base, status: 'NS', homeGoals: null, awayGoals: null });
      continue;
    }
    if (status?.name !== 'STATUS_FULL_TIME' || status.completed !== true) continue;
    const homeGoals = numeric(home.score);
    const awayGoals = numeric(away.score);
    if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) continue;
    const stats = { home: emptyStats(), away: emptyStats() };
    const fields = { shots: 'totalShots', shotsOnTarget: 'shotsOnTarget', corners: 'wonCorners', fouls: 'foulsCommitted' };
    if (counts) {
      for (const [side, team] of [['home', home], ['away', away]]) {
        for (const [field, name] of Object.entries(fields)) {
          const record = team.statistics?.find(item => item.name === name);
          const value = numeric(record?.value ?? record?.displayValue);
          stats[side][field] = Number.isInteger(value) ? value : null;
        }
      }
      // ESPN sometimes supplies a complete zero-filled statistics block despite scored goals.
      const zeroBlock = ['home', 'away'].every(side => Object.keys(fields).every(field => stats[side][field] === 0));
      if (zeroBlock) { stats.home = emptyStats(); stats.away = emptyStats(); }
    }
    matches.push({ ...base, homeGoals, awayGoals, status: 'FT', stats, statsChecked: true,
      halfTime: { homeGoals: null, awayGoals: null, homeCorners: null, awayCorners: null } });
  }
  return { matches, fixtures, provisional };
}

async function loadEspnFootball({ division, season }) {
  const config = ESPN_LEAGUES[division];
  const selectedSeason = String(season || config.seasons[0]);
  const index = config.seasons.indexOf(selectedSeason);
  if (index < 0) throw new HttpError(400, 'Selecciona una temporada disponible de ESPN.');
  const seasons = config.seasons.slice(index, index + 2);
  const parsed = [];
  for (const year of seasons) {
    const key = `espn-football:${division}:${year}`;
    let cached = store.cache[key];
    if (!cached || Date.now() - cached.savedAt >= 6 * 60 * 60 * 1000) {
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${config.slug}/scoreboard?dates=${year}&limit=1000`;
      let response;
      try { response = await fetch(url, { signal: AbortSignal.timeout(20000) }); }
      catch (error) { throw new HttpError(502, `No se pudo descargar ${config.name}: ${error.message}`); }
      if (!response.ok) throw new HttpError(502, `ESPN respondió ${response.status} para ${config.name}.`);
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new HttpError(502, 'El archivo de ESPN es demasiado grande.');
      let data;
      try { data = JSON.parse(text); } catch { throw new HttpError(502, 'ESPN no devolvió JSON válido.'); }
      if (!Array.isArray(data.events) || !data.leagues?.some(league => league.slug === config.slug)) {
        throw new HttpError(502, 'La respuesta de ESPN no corresponde a esta competición.');
      }
      cached = { data, savedAt: Date.now() };
      store.cache[key] = cached;
    }
    parsed.push({ year, ...parseEspnFootball(cached.data, { division, season: year, counts: config.counts }) });
  }
  if (!parsed[0].matches.length) throw new HttpError(502, 'ESPN no tiene resultados terminados para esta temporada.');
  const key = `espn:${division}`;
  const previous = store.leagues[key] || {};
  store.matches = store.matches.filter(match => match.leagueKey !== key || !seasons.includes(String(match.season)));
  addMatches(parsed.flatMap(result => result.matches));
  const warning = `Fuente pública ESPN, sin clave y sin garantía de disponibilidad. ${config.counts ? 'Córners, faltas y tiros solo cuando el proveedor informa datos; bloques de ceros sospechosos se descartan.' : 'Solo marcadores: los conteos de Paraguay no tienen cobertura verificable y se omiten.'} Sin tarjetas ni datos del primer tiempo. Calendario limitado a horarios confirmados; partidos aplazados o con hora por confirmar no se incluyen.`;
  store.leagues[key] = { ...previous, key, name: config.name, country: config.country, source: 'ESPN',
    sourceUrl: `https://www.espn.com/soccer/scoreboard/_/league/${config.slug}`, coverageNote: warning,
    seasons: [...new Set([...(previous.seasons || []), ...seasons])].sort().reverse(),
    teamsBySeason: { ...(previous.teamsBySeason || {}), ...Object.fromEntries(parsed.map(result => [result.year,
      [...new Set([...result.matches, ...result.fixtures].flatMap(match => [match.home, match.away]))]])) },
    fixturesBySeason: { ...(previous.fixturesBySeason || {}), ...Object.fromEntries(parsed.map(result => [result.year, result.fixtures])) },
  };
  await persist();
  const current = state();
  return { league: catalogEntry(store.leagues[key]), selectedSeason, imported: parsed[0].matches.length,
    previousImported: parsed[1]?.matches.length || 0, provisionalFixtures: parsed[0].provisional,
    warning, catalog: current.catalog, state: current };
}

export function parseOpenFootball(raw, { format, datasetName, season, leagueName, timeZone }) {
  let records;
  if (format === 'json') {
    let data;
    try { data = JSON.parse(raw); }
    catch { throw new HttpError(502, 'OpenFootball no devolvió un archivo JSON válido.'); }
    if (data.name !== datasetName || !Array.isArray(data.matches)) {
      throw new HttpError(502, 'El archivo de OpenFootball no corresponde a la liga y temporada elegidas.');
    }
    records = data.matches;
  } else if (format === 'football-txt') {
    const lines = String(raw).split(/\r?\n/);
    if (lines.find(line => line.trim())?.trim() !== `= ${datasetName}`) {
      throw new HttpError(502, 'El archivo histórico no corresponde a la liga y temporada elegidas.');
    }
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let date = null;
    records = [];
    // These archives use dated fixture rows; unscored rows are not current fixtures.
    for (const line of lines) {
      const day = line.match(/^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([A-Z][a-z]{2}) (\d{1,2})(?: (\d{4}))?\s*$/);
      if (day) {
        const month = months.indexOf(day[1]) + 1;
        const year = day[3] || String(season);
        if (!month || year !== String(season)) throw new HttpError(502, 'Fecha inesperada en el archivo histórico.');
        date = `${year}-${String(month).padStart(2, '0')}-${day[2].padStart(2, '0')}`;
        continue;
      }
      if (!/\s+v\s+/.test(line)) continue;
      const game = line.match(/^\s*(?:(\d{1,2}:\d{2})\s+)?(.+?)\s+v\s+(.+?)\s+(\d+)-(\d+)(?:\s+\((\d+)-(\d+)\))?\s*$/);
      // A scoreless archive row is an unknown result, not a future fixture.
      if (!game) {
        if (/\d+-\d+/.test(line)) throw new HttpError(502, 'Formato de marcador inesperado en el archivo histórico.');
        continue;
      }
      if (!date) throw new HttpError(502, 'Partido sin fecha en el archivo histórico.');
      records.push({ date, time: game[1], team1: game[2], team2: game[3], score: {
        ft: [game[4], game[5]], ht: game[6] === undefined ? null : [game[6], game[7]],
      } });
    }
  } else {
    throw new TypeError('Formato de OpenFootball no admitido');
  }
  const complete = records.filter(record => record && String(record.date).startsWith(`${season}-`) &&
    Array.isArray(record.score?.ft) && record.score.ft.length === 2 &&
    record.score.ft.every(value => numeric(value) !== null && Number.isInteger(numeric(value))));
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['date', 'time', 'home', 'away', 'home_goals', 'away_goals', 'home_half_goals', 'away_half_goals'],
    ...complete.map(record => {
      const half = Array.isArray(record.score.ht) && record.score.ht.length === 2 ? record.score.ht : [];
      return [record.date, record.time, record.team1, record.team2, ...record.score.ft, half[0], half[1]];
    })];
  const parsed = parseFootballCsv(rows.map(row => row.map(quote).join(',')).join('\n'), { leagueName, season, timeZone });
  return { ...parsed, skipped: parsed.skipped + records.length - complete.length };
}

async function loadOpenFootball({ division, season }) {
  const selection = OPEN_LEAGUES[division];
  const selectedSeason = String(season || selection.seasons[0]);
  if (!selection.seasons.includes(selectedSeason)) throw new HttpError(400, 'Este archivo solo contiene el histórico parcial de 2025.');
  const cacheKey = `openfootball:${division}:${selectedSeason}`;
  const cached = store.cache[cacheKey];
  let raw = cached?.data;
  let savedAt = cached?.savedAt;
  if (!raw || Date.now() - savedAt >= 6 * 60 * 60 * 1000) {
    let response;
    try { response = await fetch(selection.url, { signal: AbortSignal.timeout(15000) }); }
    catch (error) { throw new HttpError(502, `No se pudo descargar ${selection.name}: ${error.message}`); }
    if (!response.ok) throw new HttpError(502, `OpenFootball respondió ${response.status} para ${selection.name}.`);
    raw = await response.text();
    savedAt = Date.now();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new HttpError(502, 'El archivo es demasiado grande.');
  }
  const parsed = parseOpenFootball(raw, { ...selection, season: selectedSeason, leagueName: selection.name });
  if (!parsed.matches.length) throw new HttpError(502, 'El archivo no contiene resultados utilizables.');
  const key = `openfootball:${division}`;
  const matches = parsed.matches.map(match => ({ ...match, leagueKey: key, source: 'OpenFootball' }));
  const lastDate = new Intl.DateTimeFormat('en-CA', { timeZone: selection.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(matches.map(match => match.date).sort().at(-1)));
  const warning = `Archivo histórico parcial de ${selectedSeason} (${selection.phase}). Último resultado: ${lastDate}. No incluye la temporada 2026 ni un calendario actual; sin córners, tarjetas, faltas ni tiros al arco. Solo algunos partidos incluyen goles al descanso.`;
  store.matches = store.matches.filter(match => !(match.leagueKey === key && String(match.season) === selectedSeason));
  addMatches(matches);
  const teams = [...new Set(matches.flatMap(match => [match.home, match.away]))];
  const previous = store.leagues[key] || {};
  store.leagues[key] = {
    ...previous, key, name: selection.name, country: selection.country, source: 'OpenFootball',
    sourceUrl: selection.sourcePage, coverageNote: warning,
    seasons: [...new Set([...(previous.seasons || []), selectedSeason])].sort().reverse(),
    teamsBySeason: { ...(previous.teamsBySeason || {}), [selectedSeason]: teams },
    fixturesBySeason: { ...(previous.fixturesBySeason || {}), [selectedSeason]: [] },
  };
  store.cache[cacheKey] = { data: raw, savedAt };
  await persist();
  const current = state();
  return { league: catalogEntry(store.leagues[key]), selectedSeason, imported: matches.length, previousImported: 0,
    skipped: parsed.skipped, warning, catalog: current.catalog, state: current };
}

async function loadEurope({ division, season, freshness = false }) {
  const code = String(division ?? '').toUpperCase();
  const seasonCode = String(season ?? '');
  const selection = EUROPE_DIVISIONS[code];
  const index = EUROPE_SEASONS.indexOf(seasonCode);
  if (!selection || index < 0) throw new HttpError(400, 'Selecciona una liga europea configurada y una temporada disponible.');
  const key = `football-data:${code}`;
  const current = await fetchEuropeCsv(code, seasonCode, freshness);
  let imported;
  try {
    imported = await importCsv(
      { csv: current.csv, leagueName: selection.name, season: europeSeasonLabel(seasonCode) },
      { source: 'Football-Data.co.uk', sourceUrl: current.url, leagueKey: key, country: selection.country, timeZone: 'Europe/London' },
    );
  } catch (error) {
    throw new HttpError(502, `El archivo de Football-Data.co.uk no pudo importarse: ${error.message}`);
  }
  let previousImported = 0;
  let warning = null;
  if (index > 0) {
    const previousCode = EUROPE_SEASONS[index - 1];
    try {
      const previous = await fetchEuropeCsv(code, previousCode);
      const result = await importCsv(
        { csv: previous.csv, leagueName: selection.name, season: europeSeasonLabel(previousCode) },
        { source: 'Football-Data.co.uk', sourceUrl: current.url, leagueKey: key, country: selection.country, timeZone: 'Europe/London' },
      );
      previousImported = result.imported;
    } catch (error) {
      warning = `La temporada anterior no se pudo cargar: ${error.message}`;
    }
  }
  if (index === EUROPE_SEASONS.length - 1) {
    try {
      const calendar = await fetchEuropeFixturesCsv(freshness);
      const upcoming = parseUpcomingCsv(calendar, {
        division: code, leagueKey: key, season: europeSeasonLabel(seasonCode), timeZone: 'Europe/London',
      });
      store.leagues[key].fixturesBySeason[europeSeasonLabel(seasonCode)] = upcoming;
      await persist();
      if (!upcoming.length) {
        warning = [warning, 'El calendario gratuito no muestra próximos encuentros de esta liga en este momento.'].filter(Boolean).join(' ');
      }
    } catch (error) {
      warning = [warning, `No se pudo actualizar el calendario: ${error.message}`].filter(Boolean).join(' ');
    }
  }
  const stateNow = state();
  return {
    league: catalogEntry(store.leagues[key]), imported: imported.imported, previousImported,
    selectedSeason: europeSeasonLabel(seasonCode),
    warning, catalog: stateNow.catalog, state: stateNow,
  };
}

async function enrichHistory(league, homeHistory, awayHistory) {
  if (league.source === 'combined') {
    let changed = false; const warnings = [];
    for (const sourceKey of league.sourceKeys) {
      const source = store.leagues[sourceKey];
      if (source?.source !== 'api-football') continue;
      const ids = new Set([...homeHistory, ...awayHistory].flatMap(match => match.sourceRefs || []).filter(ref => ref.leagueKey === sourceKey).map(ref => String(ref.id)));
      const result = await enrichHistory(source, store.matches.filter(match => match.leagueKey === sourceKey && ids.has(String(match.id))), []);
      changed ||= result.changed; if (result.warning) { warnings.push(result.warning); break; }
    }
    return { changed, warning: warnings.join(' ') || null };
  }
  if (league.source !== 'api-football' || !apiKey) return { warning: null, changed: false };
  const selected = [...new Map([...homeHistory, ...awayHistory].map((match) => [match.id, match])).values()];
  const pending = selected.filter((match) => {
    const legacyStats = match.statsChecked && match.status !== 'AET' && match.status !== 'PEN' &&
      league.coverageBySeason?.[match.season]?.fixtures?.statistics_fixtures !== false &&
      ['home', 'away'].some(side => match.stats?.[side]?.offsides === undefined);
    return (!match.statsChecked || legacyStats) && /^\d+$/.test(String(match.id));
  });
  let warning = null;
  let changed = false;
  for (let offset = 0; offset < pending.length; offset += 20) {
    const batch = pending.slice(offset, offset + 20);
    try {
      const details = await apiRequest('/fixtures', { ids: batch.map((match) => match.id).join('-') }, 30 * 24 * 60 * 60 * 1000);
      const normalized = details.map((fixture) => normalizeFixture(fixture, league.key, { statsChecked: true })).filter(Boolean);
      addMatches(normalized);
      const returned = new Set(normalized.map((match) => match.id));
      for (const match of batch) if (!returned.has(String(match.id))) {
        match.statsChecked = true;
        for (const side of ['home', 'away']) {
          match.stats ||= {};
          match.stats[side] ||= emptyStats();
          match.stats[side].offsides ??= null;
        }
      }
      await persist();
      changed = true;
    } catch (error) {
      warning = error.message;
      break;
    }
  }
  return { warning, changed };
}

async function report({ leagueKey, season, home, away, lookback = 10, cutoff = null, thresholds = {} }) {
  try { handicapDefinitions(thresholds); } catch (error) { throw new HttpError(400, error.message); }
  const { league, selectedSeason } = selectedLeague(leagueKey, season);
  const selectedCutoff = cutoffValue(cutoff);
  const homeName = normalizeName(home);
  const awayName = normalizeName(away);
  const available = new Set(catalogEntry(league, leagueMatches(league)).teams);
  if (!available.has(homeName) || !available.has(awayName) || homeName.toLocaleLowerCase('es') === awayName.toLocaleLowerCase('es')) throw new HttpError(400, 'Selecciona dos equipos distintos de la liga.');
  const window = [5, 10, 15, 20, 25, 30].includes(Number(lookback)) ? Number(lookback) : 10;
  const args = {
    matches: leagueMatches(league),
    leagueKey: league.key,
    leagueName: league.name,
    season: selectedSeason,
    home: homeName,
    away: awayName,
    lookback: window,
    cutoff: selectedCutoff,
    thresholds,
  };
  const initial = buildReport(args);
  const enriched = await enrichHistory(league, initial.history.home, initial.history.away);
  const result = enriched.changed ? buildReport({ ...args, matches: leagueMatches(league) }) : initial;
  const warning = [enriched.warning, league.coverageNote].filter(Boolean).join(' ');
  if (warning) result.meta = { ...result.meta, providerWarning: warning };
  return result;
}

function fixtureList({ leagueKey, season, lookback = 10, cutoff = null }) {
  const { league, selectedSeason } = selectedLeague(leagueKey, season);
  const selectedCutoff = cutoffValue(cutoff);
  const window = [5, 10, 15, 20, 25, 30].includes(Number(lookback)) ? Number(lookback) : 10;
  const matches = leagueMatches(league);
  const calendar = fixturesFor(league, selectedSeason);
  const fixtures = calendar
    .filter((fixture) => fixture.date > selectedCutoff)
    .map((fixture) => {
      const result = buildReport({
        matches, leagueKey: league.key, leagueName: league.name, season: selectedSeason,
        home: fixture.home, away: fixture.away, lookback: window, cutoff: selectedCutoff,
      });
      return {
        id: fixture.id, date: fixture.date, home: fixture.home, away: fixture.away,
        manual: Boolean(fixture.manual), analysisCutoff: selectedCutoff,
        homeLogo: fixture.homeLogo, awayLogo: fixture.awayLogo,
        markets: result.markets, quality: result.quality,
      };
    });
  const emptyReason = fixtures.length ? null : calendar.length ? 'no-upcoming' : 'calendar-empty';
  const note = emptyReason === 'calendar-empty'
    ? 'No hay calendario de encuentros guardado para esta temporada. No significa 0% de probabilidad: los resultados históricos siguen disponibles para el análisis de equipos.'
    : emptyReason === 'no-upcoming'
      ? 'Hay calendario guardado, pero ningún encuentro posterior a la fecha de corte seleccionada.'
      : `${fixtures.length} encuentros calculados. El escenario elegido ordena la lista; no filtra ni crea partidos.`;
  return { leagueKey: league.key, season: selectedSeason, cutoff: selectedCutoff, lookback: window, fixtures, emptyReason,
    note, calendar: { saved: calendar.length, upcoming: fixtures.length }, coverageNote: league.coverageNote || null };
}

async function addManualFixture({ leagueKey, season, home, away, date, time, cutoff }) {
  const { league, selectedSeason } = selectedLeague(leagueKey, season);
  const homeName = normalizeName(home);
  const awayName = normalizeName(away);
  const teams = new Set(league.teamsBySeason?.[selectedSeason] || catalogEntry(league, leagueMatches(league)).teams);
  if (!teams.has(homeName) || !teams.has(awayName) || homeName.toLocaleLowerCase('es') === awayName.toLocaleLowerCase('es')) {
    throw new HttpError(400, 'Selecciona dos equipos distintos de la temporada cargada.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{2}:\d{2}$/.test(String(time))) {
    throw new HttpError(400, 'Indica fecha y hora del encuentro en Guayaquil.');
  }
  const kickoff = parseCsvDateTime(date, time, 'America/Guayaquil');
  if (!kickoff || kickoff <= cutoffValue(cutoff)) throw new HttpError(400, 'El encuentro debe tener una fecha válida posterior al corte.');
  const years = String(selectedSeason).match(/(?:19|20)\d{2}/g) || [];
  if (years.length && !years.includes(String(date).slice(0, 4))) throw new HttpError(400, `La fecha no pertenece a la temporada ${selectedSeason}.`);
  const duplicate = fixturesFor(league, selectedSeason).some(fixture => fixture.date === kickoff && fixture.home === homeName && fixture.away === awayName);
  if (duplicate) throw new HttpError(409, 'Ese encuentro ya está guardado.');
  const fixture = { id: `manual:${league.key}:${selectedSeason}:${kickoff}:${slug(homeName)}:${slug(awayName)}`,
    leagueKey: league.key, season: selectedSeason, date: kickoff, home: homeName, away: awayName, status: 'NS', manual: true };
  const ref = league.sourceSeasons?.[selectedSeason]?.[0];
  const destination = ref ? store.leagues[ref.leagueKey] : league;
  const destinationSeason = ref?.season ?? selectedSeason;
  const savedFixture = { ...fixture, leagueKey: destination.key, season: destinationSeason };
  destination.manualFixturesBySeason ||= {};
  destination.manualFixturesBySeason[destinationSeason] = [...(destination.manualFixturesBySeason[destinationSeason] || []), savedFixture];
  await persist();
  return { fixture, state: state() };
}

async function removeManualFixture({ leagueKey, season, id }) {
  const { league, selectedSeason } = selectedLeague(leagueKey, season);
  if (league.source === 'combined') {
    const fixture = fixturesFor(league, selectedSeason).find(item => item.id === id && item.manual);
    const ref = fixture?.sourceRefs?.[0];
    if (!ref) throw new HttpError(404, 'No hay un encuentro manual con ese identificador.');
    return removeManualFixture({ leagueKey: ref.leagueKey, season: ref.season, id: ref.id });
  }
  const fixtures = league.manualFixturesBySeason?.[selectedSeason] || [];
  if (!fixtures.some(fixture => fixture.id === id)) throw new HttpError(404, 'No hay un encuentro manual con ese identificador.');
  league.manualFixturesBySeason[selectedSeason] = fixtures.filter(fixture => fixture.id !== id);
  await persist();
  return { state: state() };
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'El archivo supera el límite de 10 MB.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Envía un cuerpo JSON válido.');
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(data));
}

function validateLocalRequest(request) {
  const port = request.socket.localPort;
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const host = String(request.headers.host || '').toLowerCase();
  if (!hosts.has(host)) throw new HttpError(403, 'Solo se aceptan solicitudes al servidor local.');
  if (request.headers.origin) {
    const origin = String(request.headers.origin).toLowerCase();
    const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
    if (!origins.has(origin)) throw new HttpError(403, 'Origen no permitido.');
  }
  if (request.method === 'POST' && !/^application\/json(?:\s*;|\s*$)/i.test(String(request.headers['content-type'] || ''))) {
    throw new HttpError(415, 'Envía JSON con Content-Type: application/json.');
  }
}

async function serveStatic(pathname, response) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Ruta no válida.');
  }
  const target = path.resolve(PUBLIC_DIR, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (!target.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Archivo no encontrado.');
  try {
    const bytes = await readFile(target);
    response.writeHead(200, { 'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    response.end(bytes);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') throw new HttpError(404, 'Archivo no encontrado.');
    throw error;
  }
}

async function route(request, response) {
  let counted = false;
  try {
    validateLocalRequest(request);
    if (maintenance) throw new HttpError(409, 'Restauracion en curso. Espera antes de consultar o actualizar.');
    if (request.method === 'POST') { activeMutations++; counted = true; }
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    if (request.method === 'GET' && url.pathname === '/api/daily-overview') return sendJson(response, 200, dailyOverview.state(Object.fromEntries(url.searchParams)));
    if (request.method === 'GET' && url.pathname === '/api/daily-overview/evaluation') {
      const sport = url.searchParams.get('sport') || 'basketball', league = url.searchParams.get('league') || 'nba';
      if (sport === 'tennis') return sendJson(response, 200, { sport, ...tennisLab.evaluation() });
      if (sport !== 'basketball' || !['nba', 'euroleague'].includes(league)) throw new HttpError(400, 'Selecciona NBA, Euroliga o tenis para leer su evaluacion guardada.');
      return sendJson(response, 200, { sport, league, ...basketballResearch.evaluation(league) });
    }
    if (request.method === 'POST' && url.pathname === '/api/server/stop') {
      await readBody(request);
      if (activeMutations > 1 || dataControl.running() || basketball.isUpdating() || footystats.state().busy || footballRequestsActive) throw new HttpError(409, 'Espera a que terminen las actualizaciones antes de reiniciar.');
      sendJson(response, 200, { stopping: true });
      setTimeout(() => stopServer?.(), 150); return;
    }
    if (request.method === 'GET' && url.pathname === '/api/data/state') return sendJson(response, 200, await dataControl.state());
    if (request.method === 'POST' && url.pathname === '/api/context/summary') return sendJson(response, 200, researchContext.summary(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/context/football') return sendJson(response, 200, await researchContext.refreshFootball(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/context/news') return sendJson(response, 200, await researchContext.refresh(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/context/report') return sendJson(response, 200, await researchContext.saveNote(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/context/review') return sendJson(response, 200, await researchContext.reviewNote(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/credentials/state') return sendJson(response, 200, { ...credentialVault.state(), connections: dataControlConnections() });
    if (request.method === 'POST' && url.pathname === '/api/credentials/forget') {
      const { provider } = await readBody(request);
      if (!CREDENTIAL_PROVIDERS.includes(provider)) throw new HttpError(400, 'Proveedor no valido.');
      if (basketball.isUpdating() || footystats.state().busy || footballRequestsActive || dataControl.running()) throw new HttpError(409, 'Espera a que termine la actualizacion antes de olvidar una clave.');
      if (credentialVault.state().saved[provider]) await credentialVault.save(provider, null);
      if (provider === 'football') await connectFootballKey('');
      else if (provider === 'basketball') { basketballKey = null; basketball.resetAccess(); }
      else footystats.restoreKey(null);
      await dataControl.reconnect(provider === 'footystats' ? 'football' : provider);
      return sendJson(response, 200, { ...credentialVault.state(), connections: dataControlConnections() });
    }
    if (request.method === 'GET' && url.pathname === '/api/data/basketball-readiness') return sendJson(response, 200, basketballReadiness.state());
    if (request.method === 'POST' && url.pathname === '/api/data/basketball-check') return sendJson(response, 200, await basketballReadiness.saveCheck(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/data/progress') return sendJson(response, 200, dataControl.progress());
    if (request.method === 'POST' && url.pathname === '/api/data/visit') { await readBody(request); return sendJson(response, 202, await dataControl.visit()); }
    if (request.method === 'GET' && url.pathname === '/api/data/context/entities') return sendJson(response, 200, dataContext.entities(Object.fromEntries(url.searchParams)));
    if (request.method === 'POST' && url.pathname === '/api/data/context') return sendJson(response, 200, await dataContext.save(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/data/settings') return sendJson(response, 200, await dataControl.settings(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/data/refresh') {
      const body = await readBody(request);
      void dataControl.cycle({ automatic: body.automatic === true }).catch(error => console.error('Centro de datos:', error.status || 'update_failed'));
      return sendJson(response, 202, { started: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/data/pause') { await readBody(request); await dataControl.pause(); return sendJson(response, 200, { paused: true }); }
    if (request.method === 'POST' && url.pathname === '/api/data/verify') {
      const body = await readBody(request);
      if (body.provider === 'basketball') { const access = await verifyBasketballAccess(); await dataControl.reconnect('basketball'); return sendJson(response, 200, { access, policy: basketball.requestPolicy() }); }
      if (body.provider === 'football') { await connectFootballKey(apiKey); return sendJson(response, 200, { access: footballConnection, policy: footballBudget.policy() }); }
      throw new HttpError(400, 'Selecciona un proveedor verificable conectado.');
    }
    if (request.method === 'POST' && url.pathname === '/api/data/backup') { await readBody(request); return sendJson(response, 200, await backups.create('manual')); }
    if (request.method === 'POST' && url.pathname === '/api/data/backup/verify') return sendJson(response, 200, await backups.verify((await readBody(request)).id));
    if (request.method === 'POST' && url.pathname === '/api/data/backup/restore') {
      const body = await readBody(request);
      if (activeMutations > 1 || dataControl.running() || basketball.isUpdating() || footballRequestsActive) throw new HttpError(409, 'Pausa las actualizaciones y espera a que terminen antes de restaurar.');
      maintenance = true;
      try { return sendJson(response, 200, await backups.restore(body.id, body.confirmation)); } finally { maintenance = false; }
    }
    if (request.method === 'GET' && url.pathname === '/api/footystats/state') return sendJson(response, 200, footystats.state());
    if (request.method === 'POST' && url.pathname === '/api/footystats/key') {
      const body = await readBody(request), result = await footystats.connect(body);
      return sendJson(response, 200, { ...result, credentials: await rememberCredential('footystats', body.key, body.remember !== false) });
    }
    if (request.method === 'POST' && url.pathname === '/api/footystats/catalog') return sendJson(response, 200, await footystats.loadCatalog(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/footystats/audit') return sendJson(response, 200, await footystats.audit(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/footystats/sync') return sendJson(response, 200, await footystats.sync(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/football/players/state') return sendJson(response, 200, footballPlayers.state(Object.fromEntries(url.searchParams)));
    if (request.method === 'POST' && url.pathname === '/api/football/players') return sendJson(response, 200, footballPlayers.directory(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/football/players/profile') return sendJson(response, 200, footballPlayers.profile(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/football/players/assist-leaders') return sendJson(response, 200, await footballPlayers.assistLeaders(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/football/players/load') return sendJson(response, 200, await footballPlayers.load(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/basketball/daily') return sendJson(response, 200, basketballDaily.state(Object.fromEntries(url.searchParams)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/daily/prepare') return sendJson(response, 200, await basketballDaily.prepare(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/basketball/research/state') return sendJson(response, 200, basketballResearch.state(Object.fromEntries(url.searchParams)));
    if (request.method === 'GET' && url.pathname === '/api/basketball/research/export') return sendJson(response, 200, basketballResearch.exportData());
    if (request.method === 'POST' && url.pathname === '/api/basketball/research/access') return sendJson(response, 200, await verifyBasketballAccess());
    if (request.method === 'POST' && url.pathname === '/api/basketball/research/sync') return sendJson(response, 200, await basketballResearch.sync(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/research/player-sync') return sendJson(response, 200, await basketballResearch.syncPlayers(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/basketball/players/catalog') return sendJson(response, 200, basketballPlayers.catalog(Object.fromEntries(url.searchParams)));
    if (request.method === 'GET' && url.pathname === '/api/basketball/official') return sendJson(response,200,nbaOfficial.state());
    if (request.method === 'POST' && url.pathname === '/api/basketball/analysis') return sendJson(response,200,basketballAnalysis.analyze(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/analysis/seal') return sendJson(response,200,await basketballAnalysis.seal(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/basketball/analysis/journal') return sendJson(response,200,basketballAnalysis.journal());
    if (request.method === 'POST' && url.pathname === '/api/basketball/analysis/price') return sendJson(response,200,await basketballAnalysis.recordPrice(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/official/refresh') {await readBody(request);return sendJson(response,200,await nbaOfficial.refresh());}
    if (request.method === 'POST' && url.pathname === '/api/basketball/players/analysis') return sendJson(response, 200, basketballPlayers.analyze(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/research/availability') return sendJson(response, 200, await basketballResearch.saveAvailability(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/research/forecast') return sendJson(response, 200, await basketballResearch.seal(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/research/backtest') return sendJson(response, 200, await basketballResearch.backtest(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/basketball/state') return sendJson(response, 200, basketballPanel.state());
    if (request.method === 'GET' && url.pathname === '/api/basketball/prematch/catalog') return sendJson(response, 200, basketballPrematch.catalog(Object.fromEntries(url.searchParams)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/prematch') return sendJson(response, 200, basketballPrematch.report(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/basketball/teams/catalog') return sendJson(response, 200, basketballPrematch.teamCatalog(Object.fromEntries(url.searchParams)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/teams/analysis') return sendJson(response, 200, basketballPrematch.teamReport(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/basketball/trial') return sendJson(response, 200, basketball.trialSummary());
    if (request.method === 'GET' && url.pathname === '/api/basketball/audit') return sendJson(response, 200, basketball.audit());
    if (request.method === 'GET' && url.pathname === '/api/basketball/evaluation') return sendJson(response, 200, basketballPanel.evaluation(url.searchParams.get('league')));
    if (request.method === 'POST' && url.pathname === '/api/basketball/key') {
      const body = await readBody(request);
      if (basketball.isUpdating()) throw new HttpError(409, 'Espera a que termine la consulta de baloncesto antes de cambiar la clave.');
      const value = String(body.key || '').trim();
      if (value && !/^[a-zA-Z0-9_-]{16,160}$/.test(value)) throw new HttpError(400, 'Formato de clave no valido.');
      basketballKey = value || null;
      basketballRemember = body.remember !== false;
      basketball.resetAccess();
      await dataControl.reconnect('basketball');
      if (!value || !basketballRemember) await rememberCredential('basketball', null);
      return sendJson(response, 200, { connected: Boolean(basketballKey), credentials: credentialVault.state(), note: 'La clave se guarda cifrada solo despues de verificar el acceso. Nunca en CSV, base de partidos ni navegador.' });
    }
    if (request.method === 'POST' && url.pathname === '/api/basketball/report') return sendJson(response, 200, basketballPanel.report(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/list') return sendJson(response, 200, basketballPanel.list(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/week') return sendJson(response, 200, basketballPanel.week(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/player') return sendJson(response, 200, basketballPanel.player(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/refresh') return sendJson(response, 200, await basketballPanel.refresh(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/backtest') return sendJson(response, 200, await basketballPanel.backtest(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/basketball/trial/start') return sendJson(response, 200, await basketball.startTrial());
    if (request.method === 'POST' && url.pathname === '/api/basketball/trial/stop') return sendJson(response, 200, await basketball.stopTrial());
    if (request.method === 'POST' && url.pathname === '/api/basketball/import') return sendJson(response, 200, await basketballPanel.importCsv(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/profiles/state') return sendJson(response, 200, { football: competitionCatalog(), footballRaw: Object.values(store.leagues).map(league => catalogEntry(league)), sports: sports.state() });
    if (request.method === 'POST' && url.pathname === '/api/profiles/catalog') return sendJson(response, 200, profiles.catalog(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/profiles/report') return sendJson(response, 200, await profiles.report(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/profiles/import') return sendJson(response, 200, await profiles.importPlayers(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/profiles/nba-load') return sendJson(response, 200, await sports.loadNbaPlayers(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/tennis/state') return sendJson(response, 200, tennisLab.coverage(Object.fromEntries(url.searchParams)));
    if (request.method === 'POST' && url.pathname === '/api/tennis/refresh') return sendJson(response, 200, await tennisLab.refresh(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/tennis/player') return sendJson(response, 200, tennisLab.profile(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/tennis/comparison') return sendJson(response, 200, tennisLab.comparison(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/tennis/availability') return sendJson(response, 200, await tennisLab.saveAvailability(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/tennis/fixtures') return sendJson(response, 200, await tennisLab.addFixture(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/tennis/fixtures/remove') return sendJson(response, 200, await tennisLab.removeFixture(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/tennis/daily') return sendJson(response, 200, tennisLab.daily(Object.fromEntries(url.searchParams)));
    if (request.method === 'POST' && url.pathname === '/api/tennis/daily/prepare') return sendJson(response, 200, await tennisLab.prepare(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/tennis/evaluation') return sendJson(response, 200, tennisLab.evaluation());
    if (request.method === 'POST' && url.pathname === '/api/tennis/backtest') return sendJson(response, 200, await tennisLab.backtest(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/sports/state') return sendJson(response, 200, sports.state());
    if (request.method === 'POST' && url.pathname === '/api/sports/load') return sendJson(response, 200, await sports.load(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/sports/import') return sendJson(response, 200, await sports.importCsv(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/sports/report') return sendJson(response, 200, sports.report(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/sports/list') return sendJson(response, 200, sports.list(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/sports/fixtures/manual') return sendJson(response, 200, await sports.addFixture(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/sports/fixtures/manual/remove') return sendJson(response, 200, await sports.removeFixture(await readBody(request)));
    if (request.method === 'GET' && url.pathname === '/api/state') return sendJson(response, 200, state());
    if (request.method === 'POST' && url.pathname === '/api/key') {
      const body = await readBody(request);
      await connectFootballKey(body.key);
      return sendJson(response, 200, { ...state(), credentials: await rememberCredential('football', body.key, body.remember !== false) });
    }
    if (request.method === 'POST' && url.pathname === '/api/football/connection') {
      if (!apiKey) throw new HttpError(401, 'Conecta API-Football en Fuentes de datos.');
      await connectFootballKey(apiKey);
      return sendJson(response, 200, state());
    }
    if (request.method === 'GET' && url.pathname === '/api/search') {
      const query = normalizeName(url.searchParams.get('q'));
      if (query.length < 2) throw new HttpError(400, 'Escribe al menos dos caracteres para buscar.');
      return sendJson(response, 200, await searchLeagues(query));
    }
    if (request.method === 'GET' && url.pathname === '/api/fixtures') {
      const { league, selectedSeason } = selectedLeague(url.searchParams.get('leagueKey'), url.searchParams.get('season'));
      return sendJson(response, 200, { leagueKey: league.key, season: selectedSeason, fixtures: fixturesFor(league, selectedSeason) });
    }
    if (request.method === 'POST' && url.pathname === '/api/load') return sendJson(response, 200, await loadLeague(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/fixtures/manual') return sendJson(response, 200, await addManualFixture(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/fixtures/manual/remove') return sendJson(response, 200, await removeManualFixture(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/europe') return sendJson(response, 200, await loadEurope(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/free') return sendJson(response, 200, await loadFree(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/import') return sendJson(response, 200, await importCsv(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/report') return sendJson(response, 200, await report(await readBody(request)));
    if (request.method === 'POST' && url.pathname === '/api/list') return sendJson(response, 200, fixtureList(await readBody(request)));
    if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Ruta API no encontrada.');
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Método no permitido.');
    await serveStatic(url.pathname, response);
  } catch (error) {
    const status = error instanceof HttpError || error instanceof SportsError ? error.status : 500;
    if (status === 500) console.error(error);
    sendJson(response, status, { error: status === 500 ? 'Ocurrió un error interno.' : error.message,
      ...(error.code ? { code: error.code } : {}), ...(error.allowedSeasons ? { allowedSeasons: error.allowedSeasons } : {}) });
  } finally { if (counted) activeMutations--; }
}

export async function startServer({ vault, storage } = {}) {
  if (vault && PORT === 0) credentialVault = vault;
  if (storage && PORT === 0) cloudStorage = storage;
  await initializeStore();
  await basketball.stopTrial();
  await credentialVault.check();
  try {
    const saved = await credentialVault.load();
    apiKey ||= saved.football || null; basketballKey ||= saved.basketball || null;
    if (saved.footystats) footystats.restoreKey(saved.footystats);
  } catch { /* A different Windows profile or damaged vault never triggers plaintext recovery. */ }
  const server = createServer(route);
  stopServer = () => { server.close(); server.closeIdleConnections(); };
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, resolve);
  });
  console.log(`Observatorio de fútbol: http://${HOST}:${server.address().port}`);
  if (process.env.OBSERVATORIO_DISABLE_SCHEDULER !== '1') {
    const updates = setInterval(() => { if (!maintenance) dataControl.cycle({ automatic: true }).catch(error => console.error('Centro de datos:', error.status || 'update_failed')); }, 5 * 60000);
    updates.unref(); server.once('close', () => { clearInterval(updates); });
  }
  return server;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
