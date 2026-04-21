alter table users add column if not exists phone_dial_code text not null default '90';
update users set phone_dial_code = '90' where phone <> '' and (phone_dial_code is null or phone_dial_code = '');
