-- 008: a move-log entry may be rewritten, but never silently, and never removed with its node alive.
--
-- 007 refused every UPDATE. Real handler writes do rewrite stored entries: the move-log guard
-- restores dropped fields and keeps the client's key order (SCHEDULE_MAP #567), so a lossless
-- repair still changes the stored entry. Refusing that would turn today's 200s into 500s, and
-- phase 1 must not change behaviour. So: rewrites are allowed and every one lands in change_log
-- (before and after); removing an entry while its node exists is still refused. Strict
-- append-only comes back in phase 2, once #567 is fixed.

create or replace function traqs_move_log_append_only() returns trigger language plpgsql as $$
begin
  if exists (select 1 from nodes where org_code = old.org_code and id = old.node_id) then
    raise exception 'node_move_log entries are only removed with their node (% / % seq %)', old.org_code, old.node_id, old.seq using errcode = 'check_violation';
  end if;
  return old;
end $$;

drop trigger node_move_log_append_only on node_move_log;
create trigger node_move_log_append_only before delete on node_move_log
  for each row execute function traqs_move_log_append_only();

create trigger node_move_log_change_log after insert or update or delete on node_move_log
  for each row execute function traqs_change_log();
