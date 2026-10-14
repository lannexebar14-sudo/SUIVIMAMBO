alter table public.mambo_quiz_sessions add column if not exists weakest_link_enabled boolean not null default false, add column if not exists weakest_link_last_question integer, add column if not exists weakest_link_last_player_id uuid;
CREATE OR REPLACE FUNCTION public.mambo_quiz_finalize_question(p_question integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 rec record; n int:=0; sid uuid; mode text:='normal'; penalty int:=100; floor_zero boolean:=true;
 no_answer boolean:=false; effective_q int:=null; risk_questions integer[]:='{}'::integer[]; delta int:=0; active_before int:=0; active_after int:=0;
 weak_enabled boolean:=false; last_weak_q integer; weak_loser uuid;
 loser_ids uuid[]:='{}'::uuid[]; survivor uuid;
begin
 select current_session_id into sid from public.mambo_quiz_state where id=1 for update;
 if sid is null then return 0; end if;
 select coalesce(special_mode,'normal'),greatest(0,coalesce(penalty_points,100)),coalesce(min_score_zero,true),
        coalesce(penalize_no_answer,false),special_mode_effective_question,coalesce(special_question_indices,'{}'::integer[])
 into mode,penalty,floor_zero,no_answer,effective_q,risk_questions from public.mambo_quiz_sessions where id=sid;
 select weakest_link_enabled,weakest_link_last_question into weak_enabled,last_weak_q from public.mambo_quiz_sessions where id=sid for update;
 if weak_enabled and not exists(select 1 from public.mambo_quiz_state where id=1 and status='running' and phase='question' and question_index=p_question and question_started_at is not null and clock_timestamp()>=question_started_at+make_interval(secs=>(select question_duration from public.mambo_quiz_sessions where id=sid))) then return 0; end if;
 if effective_q is null or p_question<effective_q then mode:='normal'; end if;
 if mode in ('point_penalty','three_lives') and not (p_question=any(risk_questions)) then mode:='normal'; end if;
 select count(*) into active_before from public.mambo_quiz_players where session_id=sid and approval_status='approved' and not coalesce(eliminated,false);

 for rec in
   update public.mambo_quiz_answers
   set points_awarded=case when correct and coalesce(pending_points,0)>0 then pending_points else 0 end, finalized=true
   where session_id=sid and question_index=p_question and finalized=false
   returning id,player_id,correct,points_awarded
 loop
   delta:=coalesce(rec.points_awarded,0);
   if rec.correct then
     if delta>0 then update public.mambo_quiz_players set score=coalesce(score,0)+delta where id=rec.player_id; end if;
   elsif mode='point_penalty' then
     update public.mambo_quiz_players set score=case when floor_zero then greatest(0,coalesce(score,0)-penalty) else coalesce(score,0)-penalty end where id=rec.player_id and not coalesce(eliminated,false);
     delta:=-penalty;
   elsif mode='three_lives' then
     update public.mambo_quiz_players set special_lives=greatest(0,coalesce(special_lives,3)-1),
       eliminated=(coalesce(special_lives,3)-1)<=0,
       eliminated_at_question=case when (coalesce(special_lives,3)-1)<=0 then p_question else eliminated_at_question end
     where id=rec.player_id and not coalesce(eliminated,false);
     if exists(select 1 from public.mambo_quiz_players where id=rec.player_id and eliminated) then loser_ids:=array_append(loser_ids,rec.player_id); end if;
   elsif mode='sudden_death' then
     update public.mambo_quiz_players set eliminated=true,eliminated_at_question=p_question where id=rec.player_id and not coalesce(eliminated,false);
     loser_ids:=array_append(loser_ids,rec.player_id);
   end if;
   update public.mambo_quiz_answers set special_delta=delta,special_effect_applied=(mode<>'normal') where id=rec.id;
   n:=n+1;
 end loop;

 if no_answer and mode in ('three_lives','sudden_death') then
   for rec in select p.id from public.mambo_quiz_players p where p.session_id=sid and p.approval_status='approved' and not coalesce(p.eliminated,false)
     and not exists(select 1 from public.mambo_quiz_answers a where a.session_id=sid and a.question_index=p_question and a.player_id=p.id)
   loop
     if mode='three_lives' then
       update public.mambo_quiz_players set special_lives=greatest(0,coalesce(special_lives,3)-1),
        eliminated=(coalesce(special_lives,3)-1)<=0,eliminated_at_question=case when (coalesce(special_lives,3)-1)<=0 then p_question else eliminated_at_question end where id=rec.id;
       if exists(select 1 from public.mambo_quiz_players where id=rec.id and eliminated) then loser_ids:=array_append(loser_ids,rec.id); end if;
     else
       update public.mambo_quiz_players set eliminated=true,eliminated_at_question=p_question where id=rec.id;
       loser_ids:=array_append(loser_ids,rec.id);
     end if;
   end loop;
 elsif no_answer and mode='point_penalty' then
   update public.mambo_quiz_players p set score=case when floor_zero then greatest(0,coalesce(score,0)-penalty) else coalesce(score,0)-penalty end
   where p.session_id=sid and p.approval_status='approved' and not coalesce(p.eliminated,false)
   and not exists(select 1 from public.mambo_quiz_answers a where a.session_id=sid and a.question_index=p_question and a.player_id=p.id);
 end if;

 if mode in ('three_lives','sudden_death') then
   select count(*) into active_after from public.mambo_quiz_players where session_id=sid and approval_status='approved' and not coalesce(eliminated,false);
   if active_before>1 and active_after=0 and cardinality(loser_ids)>0 then
     update public.mambo_quiz_players set eliminated=false,eliminated_at_question=null,
       special_lives=case when mode='three_lives' then greatest(1,special_lives) else special_lives end
     where id=any(loser_ids);
     active_after:=cardinality(loser_ids);
   end if;
   if active_before>1 and active_after=1 then
     select id into survivor from public.mambo_quiz_players where session_id=sid and approval_status='approved' and not coalesce(eliminated,false) limit 1;
     update public.mambo_quiz_sessions set special_winner_id=survivor,special_winner_at=now() where id=sid;
     update public.mambo_quiz_state set phase='special_winner',phase_started_at=now(),updated_at=now() where id=1 and current_session_id=sid;
   end if;
 end if;
 if weak_enabled and p_question>=0 and (p_question+1)%15=0 and coalesce(last_weak_q,-1)<p_question then
   update public.mambo_quiz_sessions set weakest_link_last_question=p_question where id=sid;
   select count(*) into active_after from public.mambo_quiz_players where session_id=sid and approval_status='approved' and not coalesce(eliminated,false);
   if active_after>1 then
     select id into weak_loser from public.mambo_quiz_players where session_id=sid and approval_status='approved' and not coalesce(eliminated,false) order by score asc,joined_at desc,id desc limit 1;
     update public.mambo_quiz_players set eliminated=true,eliminated_at_question=p_question where id=weak_loser;
     update public.mambo_quiz_sessions set weakest_link_last_player_id=weak_loser where id=sid;
     if active_after=2 then
       select id into survivor from public.mambo_quiz_players where session_id=sid and approval_status='approved' and not coalesce(eliminated,false) limit 1;
       update public.mambo_quiz_sessions set special_winner_id=survivor,special_winner_at=clock_timestamp() where id=sid;
     end if;
   end if;
 end if;
 return n;
end;$function$
;
CREATE OR REPLACE FUNCTION public.mambo_quiz_assign_final_ranks(p_session uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin with ranked as (select id,row_number() over(order by case when (select weakest_link_enabled from public.mambo_quiz_sessions where id=p_session) then coalesce(eliminated,false)::int else 0 end asc, case when (select weakest_link_enabled from public.mambo_quiz_sessions where id=p_session) and eliminated then eliminated_at_question else null end desc nulls first, score desc,joined_at asc,id asc)::int as rk from public.mambo_quiz_players where session_id=p_session and approval_status='approved') update public.mambo_quiz_players p set final_rank=r.rk from ranked r where p.id=r.id; end; $function$
;
CREATE OR REPLACE FUNCTION public.mambo_quiz_advance_game()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  st public.mambo_quiz_state%rowtype;
  sess public.mambo_quiz_sessions%rowtype;
  t timestamptz := clock_timestamp();
  duration int := 60;
  intro_duration int := 60;
  between_duration int := 10;
  reveal_duration int := 8;
  is_last boolean := false;
  show_board boolean := false;
  winner uuid;
  rec record;
  rnk int := 0;
  mg_started jsonb;
begin
  select * into st from public.mambo_quiz_state where id=1 for update;
  if st.id is null or st.current_session_id is null then return; end if;
  if coalesce(st.status,'') <> 'running' then return; end if;

  select * into sess from public.mambo_quiz_sessions where id=st.current_session_id;
  if sess.id is null then return; end if;

  duration := greatest(1, coalesce(sess.question_duration,60));
  intro_duration := greatest(5, least(1800, coalesce(sess.intro_duration,60)));
  between_duration := greatest(0, least(120, coalesce(sess.between_question_duration,10)));

  if st.phase='minigame' then
    perform public.mambo_quiz_minigame_finalize();
    return;
  end if;

  if st.phase='minigame_result' then
    perform public.mambo_quiz_minigame_finish_result();
    return;
  end if;

  if st.phase='intro' and st.phase_started_at is not null
     and t >= st.phase_started_at + make_interval(secs=>intro_duration) then
    update public.mambo_quiz_state
       set phase='countdown', countdown_started_at=t, question_started_at=null,
           reveal_started_at=null, leaderboard_started_at=null,
           leaderboard_hidden=false, phase_started_at=t, updated_at=t
     where id=1 and phase='intro';
    return;
  end if;

  if st.phase='countdown' and st.countdown_started_at is not null
     and t >= st.countdown_started_at + interval '5 seconds' then
    update public.mambo_quiz_state
       set phase='question', question_started_at=t, phase_started_at=t, updated_at=t
     where id=1 and phase='countdown';
    return;
  end if;

  if st.phase='question' and st.question_started_at is not null
     and t >= st.question_started_at + make_interval(secs=>duration) then
    perform public.mambo_quiz_finalize_question(st.question_index);
    update public.mambo_quiz_state
       set phase='reveal', reveal_started_at=t, phase_started_at=t, updated_at=t
     where id=1 and phase='question';
    return;
  end if;

  if st.phase='reveal' and coalesce(st.reveal_started_at,st.phase_started_at) is not null
     and t >= coalesce(st.reveal_started_at,st.phase_started_at) + make_interval(secs=>reveal_duration) then

    if sess.weakest_link_enabled and sess.special_winner_id is not null then
      perform public.mambo_quiz_assign_final_ranks(sess.id);
      update public.mambo_quiz_state set status='finished',phase='special_winner',winner_id=sess.special_winner_id,final_started_at=t,phase_started_at=t,updated_at=t where id=1;
      update public.mambo_quiz_sessions set status='finished',finished_at=t,winner_player_id=special_winner_id where id=sess.id;
      return;
    end if;
    mg_started := public.mambo_quiz_minigame_start_pending();
    if coalesce((mg_started->>'started')::boolean,false) then
      return;
    end if;

    if coalesce(sess.challenge_enabled,false)
       and sess.challenge_winner_id is null
       and sess.challenge_after_question = st.question_index + 1
       and st.question_index + 1 < coalesce(sess.question_count,0) then
      update public.mambo_quiz_state
         set phase='code_challenge',
             phase_started_at=t,
             leaderboard_started_at=null,
             leaderboard_hidden=true,
             updated_at=t
       where id=1 and phase='reveal';
      return;
    end if;

    is_last := (st.question_index + 1 >= coalesce(sess.question_count,0));
    show_board := is_last or ((st.question_index + 1) % 5 = 0);
    update public.mambo_quiz_state
       set phase='leaderboard', leaderboard_hidden=not show_board,
           leaderboard_started_at=t, phase_started_at=t, updated_at=t
     where id=1 and phase='reveal';
    return;
  end if;

  if st.phase='code_challenge' then
    if st.phase_started_at is not null
       and t >= st.phase_started_at + interval '90 seconds' then
      update public.mambo_quiz_state
         set phase='code_challenge_timeout',
             phase_started_at=t,
             updated_at=t
       where id=1 and phase='code_challenge';
    end if;
    return;
  end if;

  if st.phase in ('code_challenge_won','code_challenge_timeout')
     and st.phase_started_at is not null
     and t >= st.phase_started_at + interval '15 seconds' then
    update public.mambo_quiz_state
       set question_index=st.question_index+1,
           phase='countdown',
           countdown_started_at=t,
           question_started_at=null,
           reveal_started_at=null,
           leaderboard_started_at=null,
           leaderboard_hidden=false,
           phase_started_at=t,
           updated_at=t
     where id=1 and phase in ('code_challenge_won','code_challenge_timeout');
    return;
  end if;

  if st.phase='leaderboard' and coalesce(st.leaderboard_started_at,st.phase_started_at) is not null
     and t >= coalesce(st.leaderboard_started_at,st.phase_started_at) + make_interval(secs=>between_duration) then
    is_last := (st.question_index + 1 >= coalesce(sess.question_count,0));
    if is_last then
      if not coalesce(st.speed_bonus_applied,false) then
        perform public.mambo_quiz_apply_speed_bonus(st.current_session_id);
      end if;
      perform public.mambo_quiz_assign_final_ranks(st.current_session_id);
      select id into winner
        from public.mambo_quiz_players
       where session_id=st.current_session_id and approval_status='approved'
       order by case when sess.weakest_link_enabled then coalesce(eliminated,false)::int else 0 end, score desc, joined_at asc limit 1;
      update public.mambo_quiz_state
         set status='finished', phase='final', final_started_at=t, phase_started_at=t,
             winner_id=winner, speed_bonus_applied=true,
             speed_bonus_started_at=coalesce(speed_bonus_started_at,t), updated_at=t
       where id=1 and phase='leaderboard';
      update public.mambo_quiz_sessions
         set status='finished', finished_at=t, winner_player_id=winner
       where id=st.current_session_id;
    else
      rnk := 0;
      for rec in
        select id from public.mambo_quiz_players
         where session_id=st.current_session_id and approval_status='approved'
         order by score desc, joined_at asc
      loop
        rnk := rnk + 1;
        update public.mambo_quiz_players set previous_rank=rnk where id=rec.id;
      end loop;
      update public.mambo_quiz_state
         set question_index=st.question_index+1, phase='countdown',
             countdown_started_at=t, question_started_at=null,
             reveal_started_at=null, leaderboard_started_at=null,
             leaderboard_hidden=false, phase_started_at=t, updated_at=t
       where id=1 and phase='leaderboard';
    end if;
    return;
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.mambo_quiz_submit_code_challenge(p_player uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  st public.mambo_quiz_state%rowtype;
  sess public.mambo_quiz_sessions%rowtype;
  v_hash text;
  v_input_hash text;
  v_now timestamptz := clock_timestamp();
  v_player_name text;
  v_avatar text;
  v_last_attempt timestamptz;
begin
  select * into st
  from public.mambo_quiz_state
  where id=1
  for update;

  if st.id is null or st.current_session_id is null then
    return jsonb_build_object('won',false,'reason','inactive');
  end if;
  if st.status <> 'running' or st.phase <> 'code_challenge' then
    return jsonb_build_object('won',false,'reason','closed');
  end if;

  if st.phase_started_at is not null
     and v_now >= st.phase_started_at + interval '90 seconds' then
    update public.mambo_quiz_state
       set phase='code_challenge_timeout',
           phase_started_at=v_now,
           updated_at=v_now
     where id=1 and phase='code_challenge';
    return jsonb_build_object('won',false,'reason','timeout');
  end if;

  select * into sess
  from public.mambo_quiz_sessions
  where id=st.current_session_id
  for update;

  if sess.id is null or not coalesce(sess.challenge_enabled,false) then
    return jsonb_build_object('won',false,'reason','closed');
  end if;

  if sess.challenge_winner_id is not null then
    return jsonb_build_object('won',false,'reason','already_won');
  end if;

  select nickname,avatar
    into v_player_name,v_avatar
  from public.mambo_quiz_players
  where id=p_player
    and session_id=st.current_session_id
    and approval_status='approved'
    and not coalesce(eliminated,false)
  for update;

  if v_player_name is null then
    return jsonb_build_object('won',false,'reason','player');
  end if;

  select last_attempt_at into v_last_attempt
  from public.mambo_quiz_code_challenge_attempts
  where session_id=st.current_session_id and player_id=p_player
  for update;

  if v_last_attempt is not null and v_now < v_last_attempt + interval '1 second' then
    return jsonb_build_object('won',false,'reason','too_fast');
  end if;

  insert into public.mambo_quiz_code_challenge_attempts(session_id,player_id,last_attempt_at,attempts)
  values(st.current_session_id,p_player,v_now,1)
  on conflict(session_id,player_id) do update
    set last_attempt_at=excluded.last_attempt_at,
        attempts=public.mambo_quiz_code_challenge_attempts.attempts+1;

  select code_hash into v_hash
  from public.mambo_quiz_code_challenge_secrets
  where session_id=st.current_session_id;

  if v_hash is null then
    return jsonb_build_object('won',false,'reason','closed');
  end if;

  v_input_hash := encode(
    extensions.digest(convert_to(lower(trim(coalesce(p_code,''))),'UTF8'),'sha256'),
    'hex'
  );

  if v_input_hash <> v_hash then
    return jsonb_build_object('won',false,'reason','wrong');
  end if;

  update public.mambo_quiz_sessions
     set challenge_winner_id=p_player,
         challenge_won_at=v_now
   where id=st.current_session_id
     and challenge_winner_id is null;

  if not found then
    return jsonb_build_object('won',false,'reason','already_won');
  end if;

  update public.mambo_quiz_players
     set score=score+greatest(1,coalesce(sess.challenge_points,200))
   where id=p_player;

  update public.mambo_quiz_state
     set phase='code_challenge_won',
         phase_started_at=v_now,
         updated_at=v_now
   where id=1
     and phase='code_challenge';

  return jsonb_build_object(
    'won',true,
    'points',greatest(1,coalesce(sess.challenge_points,200)),
    'nickname',v_player_name,
    'avatar',coalesce(v_avatar,'😎')
  );
end;
$function$
;