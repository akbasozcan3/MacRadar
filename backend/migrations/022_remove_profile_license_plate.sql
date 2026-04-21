alter table if exists user_profile_app_settings
  drop column if exists license_plate;

alter table if exists user_profile_app_settings
  drop column if exists show_license_plate;
