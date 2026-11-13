// Deploys the built app to the Cloudflare account in CLOUDFLARE_ACCOUNT_ID:
// creates the D1 database on first run, applies drizzle/ migrations, then
// publishes the Worker with its settings. Run after `npm run build`.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';

const WORKER=process.env.WORKER_NAME||'oblaka';
const DB_NAME=process.env.D1_DATABASE_NAME||'oblaka';
const CONFIG='dist/server/wrangler.json';

function fail(message){console.error('\n✖ '+message+'\n');process.exit(1)}
for(const name of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID'])if(!process.env[name])fail(`Не задан секрет ${name} (GitHub → Settings → Secrets and variables → Actions → Secrets).`);
if(!process.env.OBLAKA_OWNER_EMAIL)fail('Не задана переменная OBLAKA_OWNER_EMAIL — email владельца (GitHub → Settings → Secrets and variables → Actions → Variables).');

const wrangler=(args,capture=false)=>execFileSync('npx',['wrangler',...args],{encoding:'utf8',stdio:capture?['ignore','pipe','inherit']:'inherit'});
const findDatabase=()=>JSON.parse(wrangler(['d1','list','--json'],true)).find(db=>db.name===DB_NAME);

let database=findDatabase();
if(!database){console.log(`Создаём базу D1 «${DB_NAME}»…`);wrangler(['d1','create',DB_NAME]);database=findDatabase()}
const databaseId=database?.uuid??database?.database_id;
if(!databaseId)fail('Не удалось получить идентификатор базы D1.');

// Migrations use a minimal config; migrations_dir is relative to the config file.
writeFileSync('dist/d1-migrations.json',JSON.stringify({name:WORKER,compatibility_date:'2026-05-15',d1_databases:[{binding:'DB',database_name:DB_NAME,database_id:databaseId,migrations_dir:'../drizzle'}]},null,1));
wrangler(['d1','migrations','apply',DB_NAME,'--remote','--config','dist/d1-migrations.json']);

const config=JSON.parse(readFileSync(CONFIG,'utf8'));
config.name=WORKER;config.topLevelName=WORKER;config.workers_dev=true;
config.d1_databases=[{binding:'DB',database_name:DB_NAME,database_id:databaseId}];
const vars={};
for(const name of ['OBLAKA_OWNER_EMAIL','ACCESS_TEAM_DOMAIN','ACCESS_AUD','OBLAKA_LOGIN_EMAIL_ALIASES']){const value=process.env[name]?.trim();if(value)vars[name]=value}
config.vars=vars;
writeFileSync(CONFIG,JSON.stringify(config));
if(!vars.ACCESS_TEAM_DOMAIN||!vars.ACCESS_AUD)console.warn('\n⚠ ACCESS_TEAM_DOMAIN или ACCESS_AUD не заданы: сайт будет опубликован, но закрыт для всех, пока вы не включите Cloudflare Access и не добавите эти переменные.\n');
wrangler(['deploy','--config',CONFIG]);
