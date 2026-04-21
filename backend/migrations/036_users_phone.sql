-- Turkish mobile digits only (10 chars), empty string when unset.
alter table users add column if not exists phone text not null default '';
