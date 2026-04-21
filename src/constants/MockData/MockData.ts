import type {
  ActionOption,
  ExploreCard,
  ExploreSegment,
  MapHotspot,
  MessagePreview,
  NearbyAction,
  ProfileStat,
  SearchSection,
  TabItem,
  VehicleHighlight,
} from '../../types/AppTypes/AppTypes';

export const TAB_ITEMS: TabItem[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'explore', label: 'Keşfet', icon: 'compass' },
  { key: 'messages', label: 'Mesajlar', icon: 'message-square' },
  { key: 'profile', label: 'Profil', icon: 'user' },
];

export const ACTION_OPTIONS: ActionOption[] = [
  {
    id: 'live-status',
    label: '📍 Canlı Durum',
    description: 'Anlık konumunu premium bir kart ile paylaş.',
    icon: 'navigation',
  },
  {
    id: 'instant-trace',
    label: '📸 Anlık İz',
    description: 'Kısa bir iz düşür ve ekibi aksiyona davet et.',
    icon: 'camera',
  },
  {
    id: 'meet-point',
    label: '🏁 Buluşma Noktası',
    description: 'Konvoy için net bir buluşma noktası sabitle.',
    icon: 'flag',
  },
];

export const MAP_HOTSPOTS: MapHotspot[] = [
  {
    id: '1',
    name: 'Mert GT',
    district: 'Bebek sahil hattı',
    eta: '3 dk önce',
    top: '24%',
    left: '24%',
    accentColor: '#3b82f6',
  },
  {
    id: '2',
    name: 'Leyla RS',
    district: 'Kuruçeşme tünele giriş',
    eta: 'Şimdi',
    top: '38%',
    left: '72%',
    accentColor: '#8b5cf6',
  },
  {
    id: '3',
    name: 'Can V8',
    district: 'Galataport üst kot',
    eta: '7 dk önce',
    top: '58%',
    left: '46%',
    accentColor: '#22c55e',
  },
];

export const NEARBY_ACTIONS: NearbyAction[] = [
  {
    id: '1',
    title: 'Boğaz Night Roll',
    subtitle: '6 araç aktif, rota Ortaköy - Emirgan',
    eta: '2.4 km',
    icon: 'map-pin',
  },
  {
    id: '2',
    title: 'Tunnel Sound Check',
    subtitle: 'Akustik nokta şimdi doluyor',
    eta: '6 dk',
    icon: 'activity',
  },
  {
    id: '3',
    title: 'Sunrise Meet Preview',
    subtitle: 'Buluşma noktası oylaması açık',
    eta: '14 dk',
    icon: 'flag',
  },
];

export const EXPLORE_SEGMENTS: ExploreSegment[] = [
  'Takipte',
  'Sizin İçin',
  'Keşfet',
];

export const EXPLORE_FEED: Record<ExploreSegment, ExploreCard[]> = {
  Takipte: [
    {
      id: '1',
      eyebrow: 'Takipte',
      title: 'Beşiktaş dusk cruise',
      description: 'Takip ettiğin ekip soğuk başlangıç sonrası rotayı açıyor.',
      badge: 'Canlı',
      location: 'Beşiktaş',
      participants: '12 sürücü',
    },
    {
      id: '2',
      eyebrow: 'Takipte',
      title: 'Levent roofline check-in',
      description: 'İki profil yeni buluşma noktası açıp mekan oylaması istiyor.',
      badge: 'Trend',
      location: 'Levent',
      participants: '8 sürücü',
    },
  ],
  'Sizin İçin': [
    {
      id: '3',
      eyebrow: 'Size Özel',
      title: 'Midnight Neon convoy',
      description: 'İlgi alanına göre seçilen premium gece sürüşü daveti.',
      badge: 'Öneri',
      location: 'Sarıyer',
      participants: '18 sürücü',
    },
    {
      id: '4',
      eyebrow: 'Size Özel',
      title: 'Trackside coffee stop',
      description: 'Araç sohbeti ve kısa foto rotası için seçilen yeni mekan.',
      badge: 'Yeni',
      location: 'Maslak',
      participants: '5 sürücü',
    },
  ],
  Keşfet: [
    {
      id: '5',
      eyebrow: 'Keşfet',
      title: 'Tunnel echoes',
      description: 'Ses denemeleri ile öne çıkan spontan gece aksiyonu.',
      badge: 'Sıcak',
      location: 'Bomonti',
      participants: '21 sürücü',
    },
    {
      id: '6',
      eyebrow: 'Keşfet',
      title: 'Blue hour lineup',
      description: 'Haftanın seçilen araçları burada vitrine çıkıyor.',
      badge: 'Editör',
      location: 'Kadıköy',
      participants: '14 sürücü',
    },
  ],
};

export const SEARCH_SECTIONS: SearchSection[] = [
  {
    title: 'Son Aramalar',
    items: ['Mert GT', 'Galataport', 'Sunrise convoy'],
  },
  {
    title: 'Popüler Mekanlar',
    items: ['Ortaköy sahil', 'Maslak oto lounge', 'Kalamış marina line'],
  },
  {
    title: 'Haftanın Araçları',
    items: ['911 Turbo S', 'M4 Competition', 'RS6 Performance'],
  },
];

export const MESSAGE_PREVIEWS: MessagePreview[] = [
  {
    id: '1',
    name: 'Ece Turbo',
    message: 'Tunnel rota sabitlendi, 15 dakikaya çıkıyoruz.',
    time: 'Şimdi',
    status: 'Yazıyor',
    accentColor: '#3b82f6',
  },
  {
    id: '2',
    name: 'Mert GT',
    message: 'Canlı durumunu gördüm, mekana çok yakınım.',
    time: '2 dk',
    status: 'Okundu',
    accentColor: '#22c55e',
  },
  {
    id: '3',
    name: 'Gece Ekibi',
    message: 'Buluşma noktası için yeni anket açıldı.',
    time: '12 dk',
    status: '6 yeni',
    accentColor: '#8b5cf6',
  },
  {
    id: '4',
    name: 'Barış V12',
    message: 'Haftanın araçları listesinde sen de varsın.',
    time: '1 sa',
    status: 'Yeni',
    accentColor: '#f59e0b',
  },
];

export const PROFILE_STATS: ProfileStat[] = [
  { id: '1', label: 'Takipçi', value: '24.8K', icon: 'users' },
  { id: '2', label: 'Rota', value: '128', icon: 'navigation' },
  { id: '3', label: 'Buluşma', value: '36', icon: 'flag' },
];

export const VEHICLE_HIGHLIGHTS: VehicleHighlight[] = [
  {
    id: '1',
    nickname: 'Midnight Blue',
    model: 'BMW M4 Competition',
    detail: '650 hp stage map, carbon aero kit',
    tag: 'Ana Araç',
  },
  {
    id: '2',
    nickname: 'City Hunter',
    model: 'Porsche Taycan 4S',
    detail: 'Sessiz gece buluşmaları için ikinci tercih',
    tag: 'Günlük',
  },
];