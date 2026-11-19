const {Pool} = require('pg');
const {createHmac,timingSafeEqual} = require('node:crypto');
let pool;
function db() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) fail(503,'Base du quiz indisponible');
  const url=new URL(process.env.DATABASE_URL);
  url.searchParams.set('sslmode','verify-full');
  pool=new Pool({connectionString:url.toString(),max:3,connectionTimeoutMillis:6500,statement_timeout:15000});
  pool.on('error',error=>console.error('BUZZQUIZ pool',error.code));
  return pool;
}
const query = (...args) => db().query(...args);
const one = async (run,...args) => (await run(...args)).rows[0];
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-z-]{24,128}$/i;
const fail = (status,message) => {throw Object.assign(new Error(message),{status});};
function equal(a,b) {
  const x=Buffer.from(String(a??'')), y=Buffer.from(String(b??''));
  return x.length===y.length && timingSafeEqual(x,y);
}
const password = () => process.env.QUIZ_STAFF_PASSWORD;
const signature = expiry => createHmac('sha256',password()).update(expiry).digest('base64url');
const cookie = (value,age) => 'mambo_quiz_staff='+value+'; Path=/; Max-Age='+age+'; HttpOnly; Secure; SameSite=Strict';
function isStaff(req) {
  const match=/(?:^|;\s*)mambo_quiz_staff=(\d{13})\.([\w-]+)(?:;|$)/.exec(req.headers.cookie||'');
  return !!(password() && match && Number(match[1])>Date.now() && equal(match[2],signature(match[1])));
}
async function transaction(work) {
  const client=await db().connect();
  const run=client.query.bind(client);
  try {
    await run('begin');
    const result=await work(run);
    await run('commit');
    return result;
  } catch(error) {
    await run('rollback');
    throw error;
  } finally {client.release();}
}
const stateJoin='public.mambo_quiz_state s left join public.mambo_quiz_sessions se on se.id=s.current_session_id';
const active='(select current_session_id from public.mambo_quiz_state where id=1)';
const deadline=`case s.phase
  when 'intro' then s.phase_started_at+make_interval(secs=>greatest(5,least(1800,coalesce(se.intro_duration,60))))
  when 'countdown' then s.countdown_started_at+interval '5 seconds'
  when 'question' then s.question_started_at+make_interval(secs=>coalesce(se.question_duration,60))
  when 'reveal' then coalesce(s.reveal_started_at,s.phase_started_at)+interval '8 seconds'
  when 'leaderboard' then coalesce(s.leaderboard_started_at,s.phase_started_at)+make_interval(secs=>coalesce(se.between_question_duration,10))
  when 'intermission' then coalesce(s.paused_at,s.phase_started_at)+make_interval(secs=>coalesce(s.paused_remaining,0))
  when 'code_challenge' then s.phase_started_at+interval '90 seconds'
  when 'code_challenge_won' then s.phase_started_at+interval '15 seconds'
  when 'code_challenge_timeout' then s.phase_started_at+interval '15 seconds'
  when 'minigame' then (select ends_at from public.mambo_quiz_minigame_runs where session_id=s.current_session_id and status in ('running','active') order by created_at desc limit 1)
  when 'minigame_result' then coalesce((select result_at from public.mambo_quiz_minigame_runs
    where session_id=s.current_session_id and status='result' order by created_at desc limit 1),s.phase_started_at)+interval '10 seconds'
  when 'special_winner' then s.phase_started_at
end`;
const due=`s.status='running' and clock_timestamp()>=coalesce(${deadline},
  case when s.phase='minigame' then clock_timestamp()-interval '1 second' end)`;
const lock=run=>run('select id from public.mambo_quiz_state where id=1 for update');
async function advance() {
  await transaction(async run=>{
    await lock(run);
    const s=await one(run,`select s.*,se.question_count,${due} as due from ${stateJoin} where s.id=1`);
    if (!s?.due) return;
    if (s.phase==='leaderboard' && s.paused_phase==='pending_break' && s.paused_remaining>0 && s.question_index+1<s.question_count) {
      await run(`update public.mambo_quiz_state set phase='intermission',paused_phase='resume_increment',
        paused_at=now(),phase_started_at=now(),leaderboard_hidden=false,updated_at=now() where id=1`);
    } else if (s.phase==='intermission') {
      const increment=s.paused_phase==='resume_same'?0:1;
      if (increment && s.question_index+1>=s.question_count) {
        await run(`update public.mambo_quiz_state set phase='leaderboard',leaderboard_started_at=now(),
          phase_started_at=now(),paused_remaining=null,paused_phase=null,paused_at=null,updated_at=now() where id=1`);
      } else {
        await run(`update public.mambo_quiz_state set phase='countdown',question_index=question_index+$1,
          countdown_started_at=now(),phase_started_at=now(),question_started_at=null,reveal_started_at=null,
          leaderboard_started_at=null,leaderboard_hidden=false,paused_remaining=null,paused_phase=null,
          paused_at=null,updated_at=now() where id=1`,[increment]);
      }
    } else {
      if (s.phase!=='special_winner') await run('select public.mambo_quiz_advance_game()');
      const winner=await one(run,`select se.id,se.special_winner_id from ${stateJoin}
        where s.id=1 and s.status='running' and s.phase='special_winner'`);
      if (winner?.special_winner_id) {
        await run('select public.mambo_quiz_assign_final_ranks($1)',[winner.id]);
        await run(`update public.mambo_quiz_sessions set status='finished',finished_at=now(),
          winner_player_id=$2 where id=$1`,[winner.id,winner.special_winner_id]);
        await run(`update public.mambo_quiz_state set status='finished',winner_id=$1,final_started_at=now(),
          updated_at=now() where id=1`,[winner.special_winner_id]);
      }
    }
  });
}
const snapshotSql=`select to_jsonb(s) as state,to_jsonb(se) as session,
  case when s.phase='countdown' then jsonb_build_object('category',q.category)
       when s.phase='question' then to_jsonb(q)-'correct_index'-'correct_indices'
       when s.phase='reveal' then to_jsonb(q) end as question,
  to_jsonb(p)-'device_token' as player,
  case when s.phase='question' then to_jsonb(a)-'correct'-'pending_points'-'points_awarded'-'special_delta'
       when a.finalized then to_jsonb(a) end as answer,
  floor(extract(epoch from clock_timestamp())*1000)::bigint as ms,${due} as due
  from ${stateJoin}
  left join public.mambo_quiz_session_questions sq on sq.session_id=se.id and sq.position=s.question_index
    and s.phase in ('countdown','question','reveal')
  left join public.mambo_quiz_question_bank q on q.id=sq.question_id
  left join public.mambo_quiz_players p on p.id=$1 and p.session_id=se.id and p.device_token=$2
  left join lateral (select * from public.mambo_quiz_answers where session_id=se.id and player_id=p.id
    and question_index=s.question_index and created_at>=coalesce(se.started_at,'-infinity')
    order by created_at desc limit 1) a on true where s.id=1`;
async function snapshot(player,device) {
  const args=[UUID.test(player||'')&&TOKEN.test(device||'')?player:null,device||null];
  let result=await one(query,snapshotSql,args);
  if (!result) fail(503,'État du quiz indisponible');
  if (result.due) {
    await advance();
    result=await one(query,snapshotSql,args);
  }
  delete result.due;
  return result;
}

const fields={
  players:'id nickname avatar score joined_at streak previous_rank approval_status approved_at session_id speed_bonus final_rank special_lives eliminated eliminated_at_question is_test',
  answers:'id player_id question_index answer_index correct created_at points_awarded session_id response_seconds pending_points finalized answer_indices special_delta special_effect_applied',
  sessions:'id title status game_code question_count question_duration created_at started_at finished_at',
  state:'id phase status updated_at'
};
const writable={
  players:'approval_status approved_at eliminated eliminated_at_question special_lives',
  sessions:'weakest_link_enabled weakest_link_interval weakest_link_last_question weakest_link_last_player_id special_winner_id special_winner_at special_mode pending_special_mode special_mode_effective_question special_question_indices penalty_points penalize_no_answer min_score_zero',
  state:'phase question_index countdown_started_at question_started_at reveal_started_at leaderboard_started_at leaderboard_hidden paused_remaining paused_phase paused_at phase_started_at updated_at'
};
async function table(path,method,body,staff,device) {
  const [resource,search='']=path.split('?');
  const name=resource.replace(/^mambo_quiz_/,'');
  if (!Object.hasOwn(fields,name)) fail(404,'Route inconnue');
  const params=new URLSearchParams(search), args=[];
  const bind=value=>{args.push(value);return '$'+args.length;};
  const cols=fields[name].split(' ');
  const select=params.get('select');
  const display=select && select!=='*'?select.split(','):cols;
  if (display.some(column=>!cols.includes(column))) fail(400,'Champ invalide');
  const conditions=[];
  if (['players','answers'].includes(name)) conditions.push('session_id='+active);
  if (name==='sessions') {
    if (!staff) fail(403,'Accès STAFF requis');
    if (method!=='GET') conditions.push('id='+active);
  }
  if (name==='state') conditions.push('id=1');
  for (const [key,value] of params) {
    if (['select','order','limit'].includes(key)) continue;
    const match=/^(eq|gte)\.(.+)$/.exec(value);
    if (!match) fail(400,'Filtre invalide');
    if (method==='GET' && key==='device_token' && name==='players') {
      if (!TOKEN.test(device||'') || !equal(device,match[2])) fail(403,'Appareil non reconnu');
      conditions.push('device_token='+bind(device));
      continue;
    }
    if (!cols.includes(key) || (method!=='GET' && (match[1]!=='eq' || !['id','phase','session_id','approval_status','eliminated'].includes(key)))) fail(400,'Filtre invalide');
    if (['id','session_id','player_id'].includes(key) && match[2]==='null') return [];
    conditions.push(key+(match[1]==='eq'?'=':'>=')+bind(match[2]));
  }
  if (!staff && name==='players' && !params.has('device_token')) conditions.push("approval_status='approved'");
  if (!staff && name==='answers') {
    conditions.push('finalized is true');
    if (display.some(key=>!['player_id','correct','created_at','response_seconds','question_index'].includes(key))) fail(403,'Données privées');
  }
  const where=conditions.length?' where '+conditions.join(' and '):'';
  const relation='public.mambo_quiz_'+name;
  if (method==='GET') {
    const order=(params.get('order')||'').split(',').filter(Boolean).map(spec=>{
      const [column,direction,nulls]=spec.split('.');
      if (!cols.includes(column)||!['asc','desc'].includes(direction)||(nulls&&nulls!=='nullslast')) fail(400,'Tri invalide');
      return column+' '+direction+(nulls?' nulls last':'');
    });
    const max=name==='answers'?12000:300;
    const limit=Math.floor(Math.max(1,Math.min(max,Number(params.get('limit'))||max)));
    return (await query('select '+display.join(',')+' from '+relation+where+(order.length?' order by '+order.join(','):'')+' limit '+bind(limit),args)).rows;
  }
  if (!staff) fail(403,'Accès STAFF requis');
  if (method!=='PATCH'||!Object.hasOwn(writable,name)) fail(405,'Action indisponible');
  const entries=Object.entries(body);
  if (!entries.length || entries.some(([key])=>!writable[name].split(' ').includes(key))) fail(400,'Modification invalide');
  if (name!=='state' && !params.has('id') && !(name==='players' && params.has('session_id') && Object.keys(body).join()==='special_lives')) fail(400,'Identifiant requis');
  const assignments=entries.map(([key,value])=>key+'='+bind(value));
  return (await query('update '+relation+' set '+assignments.join(',')+where+' returning '+display.join(','),args)).rows;
}

const procedures={
  category_counts:['rows',{}],tv_slides_meta:['rows',{}],tv_slides_get:['rows',{}],
  minigame_current:['public',{p_player:'uuid'}],
  submit_answers:['player',{p_player:'uuid',p_question:'integer',p_answers:'jsonb',p_base_points:'integer',p_seconds_left:'numeric'}],
  submit_code_challenge:['player',{p_player:'uuid',p_code:'text'}],
  minigame_action:['player',{p_player:'uuid',p_device:'text',p_value:'text'}],
  stop_game:['staff',{}],
  tv_slide_add:['staff',{p_staff_code:'text',p_file_name:'text',p_image_data:'text'}],
  tv_slide_delete:['staff',{p_staff_code:'text',p_slide_id:'uuid'}],
  tv_slides_clear:['staff',{p_staff_code:'text'}],
  minigame_queue:['staff',{p_staff_code:'text',p_game_type:'text',p_points:'integer',p_code:'text',p_location:'text'}],
  prepare_session_fast:['internal',{p_session:'uuid',p_count:'integer',p_duration:'integer',p_between:'integer',p_categories:'text[]',p_prize_first:'text',p_prize_second:'text',p_prize_third:'text'}],
  configure_code_challenge:['internal',{p_staff_code:'text',p_session:'uuid',p_enabled:'boolean',p_code:'text',p_location:'text',p_points:'integer',p_after_question:'integer'}]
};
async function call(run,name,body) {
  const [access,types]=procedures[name];
  const args=Object.entries(types).map(([key,type])=>key==='p_staff_code'?process.env.QUIZ_LEGACY_STAFF_CODE:
    type==='jsonb'?JSON.stringify(body[key]??null):body[key]??null);
  const sql='public.mambo_quiz_'+name+'('+Object.values(types).map((type,index)=>'$'+(index+1)+'::'+type).join(',')+')';
  const {rows}=await run(access==='rows'?'select * from '+sql:'select '+sql+' as result',args);
  return access==='rows'?rows:rows[0]?.result;
}
async function playerCommand(name,body,device) {
  if (!UUID.test(body.p_player||'')||!TOKEN.test(device||'')) fail(403,'Appareil non reconnu');
  return transaction(async run=>{
    // The code challenge can change the quiz phase. Lock it before checking the deadline.
    await run('select id from public.mambo_quiz_state where id=1 for '+(name==='submit_answers'?'share':'update'));
    const player=await one(run,`select s.status,s.phase,s.question_index,clock_timestamp()<(${deadline}) as on_time,
      p.approval_status,p.eliminated from ${stateJoin} join public.mambo_quiz_players p
      on p.session_id=s.current_session_id and p.id=$1 and p.device_token=$2 where s.id=1 for share of p`,[body.p_player,device]);
    if (!player || player.approval_status!=='approved' || player.eliminated) fail(403,'Participation non validée');
    const phase={submit_answers:'question',submit_code_challenge:'code_challenge',minigame_action:'minigame'}[name];
    if (player.status!=='running'||player.phase!==phase||!player.on_time) fail(409,'Le temps de réponse est écoulé');
    if (name==='submit_answers') {
      if (body.p_question!==player.question_index) fail(409,'La question a changé');
      const answers=body.p_answers;
      if (!Array.isArray(answers)||!answers.length||answers.length>4||new Set(answers).size!==answers.length||
          answers.some(index=>!Number.isInteger(index)||index<0||index>3)) fail(400,'Choix invalide');
      const result=await call(run,name,{...body,p_base_points:100,p_seconds_left:0});
      return Math.min(result,0);
    }
    if (String(body.p_code??body.p_value??'').length>100) fail(400,'Réponse trop longue');
    return call(run,name,{...body,p_device:device});
  });
}
async function join(body,device) {
  if (!TOKEN.test(device||'') || !/^\d{4}$/.test(body.code||'') || typeof body.nickname!=='string' ||
      !body.nickname.trim()||body.nickname.trim().length>18||
      !Array.from('😎🤠🥳🤩😈👻🤖👽🦁🐯🐸🐵🐼🦊🐷🦄').includes(body.avatar)) fail(400,'Code, pseudo ou avatar invalide');
  return transaction(async run=>{
    await run('select pg_advisory_xact_lock(hashtextextended($1,0))',[device]);
    const state=await one(run,'select current_session_id,game_code,status from public.mambo_quiz_state where id=1 for share');
    if (!state?.current_session_id||!equal(state.game_code,body.code)) fail(403,'Code incorrect');
    if (!['waiting','running'].includes(state.status)) fail(409,'Aucune partie ouverte');
    const existing=await one(run,`select id from public.mambo_quiz_players where session_id=$1 and device_token=$2
      and approval_status<>'rejected' order by joined_at desc limit 1`,[state.current_session_id,device]);
    return existing||one(run,`insert into public.mambo_quiz_players(nickname,avatar,approval_status,session_id,device_token)
      values($1,$2,'pending',$3,$4) returning id`,[body.nickname.trim(),body.avatar,state.current_session_id,device]);
  });
}
async function lobby(run) {
  await lock(run);
  const next=await one(run,`insert into public.mambo_quiz_sessions(title,status,game_code,question_count,question_duration)
    values('Grand Quiz','open',(floor(random()*9000)+1000)::int::text,50,30) returning id,game_code`);
  await run(`update public.mambo_quiz_sessions set status='finished',finished_at=coalesce(finished_at,now()) where id=${active} and status='live'`);
  await run(`update public.mambo_quiz_state set current_session_id=$1,game_code=$2,status='waiting',phase='lobby',
    question_index=0,question_started_at=null,countdown_started_at=null,reveal_started_at=null,leaderboard_started_at=null,
    final_started_at=null,phase_started_at=now(),winner_id=null,leaderboard_hidden=false,cancelled_question=false,
    tiebreaker_ids=null,tiebreak_started_at=null,speed_bonus_started_at=null,speed_bonus_applied=false,
    paused_remaining=null,paused_phase=null,paused_at=null,updated_at=now() where id=1`,[next.id,next.game_code]);
  return next;
}
async function start(body) {
  return transaction(async run=>{
    await lock(run);
    const state=await one(run,`select s.current_session_id,s.status,se.status as session_status,se.started_at from ${stateJoin} where s.id=1`);
    if (state?.status==='running') fail(409,'Une partie est en cours');
    const id=state?.started_at||state?.session_status!=='open'?(await lobby(run)).id:state.current_session_id;
    const result=await call(run,'prepare_session_fast',{...body.setup,p_session:id});
    const settings=Object.entries(body.settings||{});
    if (settings.some(([key])=>!writable.sessions.split(' ').includes(key))) fail(400,'Réglage invalide');
    if (settings.length) await run('update public.mambo_quiz_sessions set '+settings.map(([key],i)=>key+'=$'+(i+2)).join(',')+
      ' where id=$1',[id,...settings.map(([,value])=>value)]);
    if (!await call(run,'configure_code_challenge',{...body.challenge,p_session:id})) fail(400,'Défi refusé');
    return result;
  });
}
const attempts=new Map();
function login(req,res,body) {
  if (!password()||password().length<12) fail(503,'Connexion STAFF indisponible');
  const now=Date.now(),ip=req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown';
  if (attempts.size>=1000) {
    for (const [key,entry] of attempts) if (entry.until<=now) attempts.delete(key);
    if (attempts.size>=1000&&!attempts.has(ip)) fail(429,'Trop de tentatives');
  }
  let attempt=attempts.get(ip);
  if (!attempt||attempt.until<=now) attempts.set(ip,attempt={count:0,until:now+600000});
  if (++attempt.count>8) fail(429,'Trop de tentatives');
  if (!equal(body.password,password())) fail(403,'Code incorrect');
  attempts.delete(ip);
  const expiry=String(now+28800000);
  res.setHeader('Set-Cookie',cookie(expiry+'.'+signature(expiry),28800));
  return true;
}
module.exports=async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  try {
    const staff=isStaff(req),device=req.headers['x-quiz-device'];
    if (req.method==='GET') {
      if (req.query.action==='snapshot') return res.json(await snapshot(req.query.player,device));
      if (req.query.action==='staff') return res.json(staff);
      if (typeof req.query.path==='string') return res.json(await table(req.query.path,'GET',null,staff,device));
      fail(404,'Route inconnue');
    }
    if (req.method!=='POST') fail(405,'Méthode indisponible');
    if (req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host) fail(403,'Origine invalide');
    const {action,path,method,body={}}=req.body||{};
    if (!body||typeof body!=='object'||Array.isArray(body)) fail(400,'Corps de requête invalide');
    if (action==='login') return res.json(login(req,res,body));
    if (action==='logout') {
      res.setHeader('Set-Cookie',cookie('',0));
      return res.json(true);
    }
    if (action==='join') return res.json(await join(body,device));
    if (['reset','start'].includes(action)) {
      if (!staff) fail(403,'Accès STAFF requis');
      return res.json(await (action==='reset'?transaction(lobby):start(body)));
    }
    if (action==='table'&&typeof path==='string') return res.json(await table(path,method,body,staff,device));
    if (action!=='command'||typeof path!=='string') fail(404,'Route inconnue');
    const name=path.replace(/^mambo_quiz_/,'');
    if (!Object.hasOwn(procedures,name)||procedures[name][0]==='internal') fail(404,'Commande inconnue');
    const access=procedures[name][0];
    if (access==='staff'&&!staff) fail(403,'Accès STAFF requis');
    if (access==='player') return res.json(await playerCommand(name,body,device));
    if (name==='minigame_current'&&body.p_player) {
      if (!UUID.test(body.p_player)||!TOKEN.test(device||'')||!await one(query,`select id from public.mambo_quiz_players where id=$1 and device_token=$2 and session_id=${active}`,[body.p_player,device])) fail(403,'Appareil non reconnu');
    }
    if (name==='tv_slide_add'&&(typeof body.p_image_data!=='string'||body.p_image_data.length>1180000||
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.p_image_data))) fail(400,'Image invalide');
    return res.json(await call(query,name,body));
  } catch(error) {
    if (!error.status) console.error('BUZZQUIZ',error.code,error.message);
    const badInput=['22P02','22003','23514','P0001'].includes(error.code);
    res.status(error.status||(badInput?400:503)).json({message:error.status||error.code==='P0001'?error.message:
      badInput?'Paramètres invalides':'Service quiz momentanément indisponible'});
  }
};
