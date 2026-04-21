alter table if exists user_map_preferences
  alter column map_filter_mode set default 'street_friends';

alter table if exists user_map_preferences
  alter column tracking_enabled set default false;

alter table if exists user_profile_app_settings
  alter column show_license_plate set default false;
