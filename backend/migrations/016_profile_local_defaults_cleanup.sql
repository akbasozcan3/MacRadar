update users
set
  bio = '',
  updated_at = now()
where auth_provider = 'local'
  and coalesce(bio, '') <> '';

update users
set
  avatar_url = '',
  updated_at = now()
where auth_provider = 'local'
  and avatar_url in (
    'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&w=200&q=80'
  );
