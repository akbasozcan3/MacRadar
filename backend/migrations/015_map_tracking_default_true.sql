-- New rows: live map tracking on by default (users can turn off in map menu).
alter table user_map_preferences
  alter column tracking_enabled set default true;
