// public/js/config.js
const GAME_CONFIG = {
  // المجلدات المخصصة للصور
  paths: {
    table: '/assets/images/table/',
    players: '/assets/images/players/',
    roles: '/assets/images/roles/',
    ui: '/assets/images/ui/'
  },
  
  // الملفات المحددة
  images: {
    defaultTable: '/assets/images/table/table_main.png',
    defaultAvatar: '/assets/images/players/default.png',
    deadAvatarOverlay: '/assets/images/ui/skull.png',
    
    // بطاقات الأدوار
    roles: {
      MAFIA: '/assets/images/roles/mafia.png',
      DOCTOR: '/assets/images/roles/doctor.png',
      DETECTIVE: '/assets/images/roles/detective.png',
      CITIZEN: '/assets/images/roles/citizen.png'
    }
  },

  // صورة احتياطية في حال تعذر تحميل الصورة المحددة
  fallbackSvg: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23333344'/><text x='50%' y='50%' fill='%23aaa' dominant-baseline='middle' text-anchor='middle'>لاعب</text></svg>"
};