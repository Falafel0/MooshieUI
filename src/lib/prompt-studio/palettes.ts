import type { ColorWheelEntry } from './types.js';

// Канонический цветовой круг (Hue-снаппинг)
export const DANBOORU_HUE_PALETTE: ColorWheelEntry[] = [
  { tag: 'red', hue: 0, hex: '#e63946', name: 'Красный' },
  { tag: 'orange', hue: 30, hex: '#f77f00', name: 'Оранжевый' },
  { tag: 'blonde', hue: 48, hex: '#fcbf49', name: 'Блонд / Жёлтый' },
  { tag: 'green', hue: 120, hex: '#2a9d8f', name: 'Зелёный' },
  { tag: 'aqua', hue: 175, hex: '#48cae4', name: 'Бирюзовый' },
  { tag: 'blue', hue: 215, hex: '#0077b6', name: 'Синий' },
  { tag: 'purple', hue: 275, hex: '#7209b7', name: 'Фиолетовый' },
  { tag: 'pink', hue: 325, hex: '#f72585', name: 'Розовый' }
];

export const NEUTRAL_PALETTE: ColorWheelEntry[] = [
  { tag: 'black', hue: -1, hex: '#1e1e24', name: 'Чёрный' },
  { tag: 'white', hue: -1, hex: '#f8f9fa', name: 'Белый' },
  { tag: 'grey', hue: -1, hex: '#6c757d', name: 'Серый' },
  { tag: 'brown', hue: -1, hex: '#6f4e37', name: 'Коричневый' }
];

// Цвета одежды (материалы)
export const CLOTHING_PALETTE: ColorWheelEntry[] = [
  { tag: 'red_clothing', hue: 0, hex: '#e63946', name: 'Красный' },
  { tag: 'orange_clothing', hue: 30, hex: '#f77f00', name: 'Оранжевый' },
  { tag: 'yellow_clothing', hue: 55, hex: '#fcbf49', name: 'Жёлтый' },
  { tag: 'green_clothing', hue: 120, hex: '#2a9d8f', name: 'Зелёный' },
  { tag: 'blue_clothing', hue: 215, hex: '#0077b6', name: 'Синий' },
  { tag: 'purple_clothing', hue: 275, hex: '#7209b7', name: 'Фиолетовый' },
  { tag: 'pink_clothing', hue: 325, hex: '#f72585', name: 'Розовый' },
  { tag: 'white_clothing', hue: -1, hex: '#f8f9fa', name: 'Белый' },
  { tag: 'black_clothing', hue: -1, hex: '#1e1e24', name: 'Чёрный' },
  { tag: 'grey_clothing', hue: -1, hex: '#6c757d', name: 'Серый' },
  { tag: 'brown_clothing', hue: -1, hex: '#6f4e37', name: 'Коричневый' }
];

// Материалы одежды
export const MATERIALS = [
  { tag: 'cotton', name: 'Хлопок' },
  { tag: 'leather', name: 'Кожа' },
  { tag: 'denim', name: 'Деним' },
  { tag: 'silk', name: 'Шёлк' },
  { tag: 'lace', name: 'Кружево' },
  { tag: 'velvet', name: 'Бархат' },
  { tag: 'knit', name: 'Трикотаж' },
  { tag: 'suede', name: 'Замша' }
];

// Автоматические импликации (A -> B)
export const TAG_IMPLICATIONS: Record<string, string[]> = {
  'elf': ['pointy_ears'],
  'dark_elf': ['pointy_ears', 'dark_skin'],
  'demon': ['demon_horns', 'demon_wings', 'demon_tail'],
  'succubus': ['demon_horns', 'demon_wings', 'demon_tail', 'heart-shaped_pupils', 'pointy_ears'],
  'angel': ['angel_wings', 'halo'],
  'cat_girl': ['cat_ears', 'cat_tail'],
  'fox_girl': ['fox_ears', 'fox_tail'],
  'wolf_girl': ['wolf_ears', 'wolf_tail'],
  'western_dragon': ['dragon_wings', 'dragon_tail'],
  'maid_dress': ['maid_headdress', 'apron'],
  'school_uniform': ['necktie'],
  'gothic_lolita': ['headbow', 'lace_trim'],
  'mature_female': ['mature'],
  'adult': [],
  'teenager': [],
  'shirt': [],
  'hoodie': [],
  'sweater': [],
};
