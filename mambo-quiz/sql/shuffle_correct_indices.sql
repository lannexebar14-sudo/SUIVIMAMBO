create or replace function public.mambo_quiz_randomize_answer_positions() returns trigger language plpgsql as $fn$
declare a jsonb; corrects integer[]; shuffled jsonb; indices jsonb; new_idx integer;
begin
 a:=new.answers;
 if a is null or jsonb_typeof(a)<>'array' or jsonb_array_length(a)<2 then return new; end if;
 if new.correct_index is null or new.correct_index<0 or new.correct_index>=jsonb_array_length(a) then return new; end if;
 if new.question_type='multi' and new.correct_indices is not null then
   select array_agg(value::integer) into corrects from jsonb_array_elements_text(new.correct_indices);
 else corrects:=array[new.correct_index]; end if;
 with shuffled as materialized (
   select value,(ordinality-1)::integer as old_idx,random() as rnd from jsonb_array_elements(a) with ordinality
 ), positioned as (
   select value,old_idx,(row_number() over(order by rnd)-1)::integer as idx from shuffled
 )
 select jsonb_agg(value order by idx),jsonb_agg(idx order by idx) filter(where old_idx=any(corrects)),max(idx) filter(where old_idx=new.correct_index)
 into shuffled,indices,new_idx from positioned;
 new.answers:=shuffled;new.correct_index:=new_idx;new.correct_indices:=indices;
 return new;
end;$fn$;