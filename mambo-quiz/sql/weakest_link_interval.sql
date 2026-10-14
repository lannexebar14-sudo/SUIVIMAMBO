alter table public.mambo_quiz_sessions add column if not exists weakest_link_interval integer not null default 15 check (weakest_link_interval between 1 and 100);
CREATE OR REPLACE FUNCTION public.mambo_quiz_finalize_question(p_question integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 rec record; n int:=0; sid uuid; mode text:='normal'; penalty int:=100; floor_zero boolean:=true;
 no_answer boolean:=false; effective_q int:=null; risk_questions integer[]:='{}'::integer[]; delta int:=0; active_before int:=0; active_after int:=0;
 weak_interval integer:=15; weak_enabled boolean:=false; last_weak_q integer; weak_loser uuid;
 loser_ids uuid[]:='{}'::uuid[]; survivor uuid;
begin
 select current_session_id into sid from public.mambo_quiz_state where id=1 for update;
 if sid is null then return 0; end if;
 select coalesce(special_mode,'normal'),greatest(0,coalesce(penalty_points,100)),coalesce(min_score_zero,true),
        coalesce(penalize_no_answer,false),special_mode_effective_question,coalesce(special_question_indices,'{}'::integer[])
 into mode,penalty,floor_zero,no_answer,effective_q,risk_questions from public.mambo_quiz_sessions where id=sid;
 select weakest_link_enabled,weakest_link_last_question,greatest(1,coalesce(weakest_link_interval,15)) into weak_enabled,last_weak_q,weak_interval from public.mambo_quiz_sessions where id=sid for update;
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
 if weak_enabled and p_question>=0 and (p_question+1)%weak_interval=0 and coalesce(last_weak_q,-1)<p_question then
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