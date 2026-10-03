import { expandCatalog } from './catalog-expansion.js';
import type { Category } from './types.js';
import { EXTRA_CATEGORIES } from './extra-categories.js';

export const CATEGORIES_DATA: Category[] = expandCatalog([
  // 1. БАЗА (Identity)
  {
    id: 'base',
    name: 'База',
    icon: 'user-check',
    order: 10,
    role: 'base',
    subs: [
      {
        id: 'gender',
                name: 'Пол',
                type: 'grid',
                mode: 'single',
                lock: true,
                variantSize: 'icon',
                variants: [
          { id: '1girl', name: 'Девушка', tag: '1girl', icon: 'venus', layer: 'base' },
          { id: '1boy', name: 'Парень', tag: '1boy', icon: 'mars', layer: 'base' },
          { id: '1other', name: 'Другое', tag: '1other', icon: 'help-circle', layer: 'base' }
        ]
      },
      {
        id: 'age',
        name: 'Возраст',
        type: 'grid',
        mode: 'single',
        lock: true,
        variantSize: 'pill',
        variants: [
          { id: 'teen', name: 'Подросток', tag: 'teenager' },
          { id: 'adult', name: 'Взрослая / Взрослый', tag: 'adult' },
          { id: 'mature', name: 'Зрелая / Зрелый', tag: 'mature_female' }
        ]
      },
      {
        id: 'species',
        name: 'Раса / Вид',
        type: 'grid',
        mode: 'single',
        variantSize: 'pill',
        searchable: true,
        groups: [
          { name: 'Люди', variantIds: ['human', 'elf', 'dark_elf'] },
          { name: 'Демоны', variantIds: ['demon', 'succubus'] },
          { name: 'Небеса', variantIds: ['angel'] },
          { name: 'Звери', variantIds: ['cat_girl', 'fox_girl'] },
          { name: 'Драконы', variantIds: ['western_dragon'] }
        ],
        variants: [
          { id: 'human', name: 'Человек', tag: '' },
          { id: 'elf', name: 'Эльф', tag: 'elf' },
          { id: 'dark_elf', name: 'Тёмный эльф', tag: 'dark_elf' },
          { id: 'demon', name: 'Демон', tag: 'demon' },
          { id: 'succubus', name: 'Суккуб', tag: 'succubus' },
          { id: 'angel', name: 'Ангел', tag: 'angel' },
          { id: 'cat_girl', name: 'Кошко-девочка', tag: 'cat_girl' },
          { id: 'fox_girl', name: 'Лисица (Кицунэ)', tag: 'fox_girl' },
          {
            id: 'western_dragon',
            name: 'Драконид',
            tag: 'dragon_horns',
            parts: [
              { name: 'Крылья', tags: [{ name: 'Драконьи', tag: 'dragon_wings' }, { name: 'Кожаные', tag: 'bat_wings' }] },
              { name: 'Хвост', tags: [{ name: 'Чешуйчатый', tag: 'dragon_tail' }, { name: 'С шипами', tag: 'spiked_tail' }] }
            ]
          }
        ]
      }
    ]
  },

  // 2. ГЕНЕТИКА И ТЕЛО
  {
    id: 'genetics',
    name: 'Генетика',
    icon: 'dna',
    order: 20,
    subs: [
      {
        id: 'skin',
        name: 'Кожа',
        type: 'grid',
        mode: 'single',
        variantSize: 'swatch',
        variants: [
          { id: 'pale', name: 'Бледная', tag: 'pale_skin', colorHex: '#fbe8df', layer: 'skin' },
          { id: 'fair', name: 'Светлая', tag: 'fair_skin', colorHex: '#f5d5c5', layer: 'skin' },
          { id: 'tan', name: 'Загорелая', tag: 'tan', colorHex: '#c68b59', layer: 'skin' },
          { id: 'dark', name: 'Тёмная', tag: 'dark_skin', colorHex: '#66432b', layer: 'skin' }
        ]
      },
      {
        id: 'breast_size',
        name: 'Размер груди',
        type: 'slider',
        mode: 'single',
        ifGender: 'girl',
        sliderSteps: [
          { label: 'Плоская', tag: 'flat_chest' },
          { label: 'Маленькая', tag: 'small_breasts' },
          { label: 'Средняя', tag: 'medium_breasts' },
          { label: 'Большая', tag: 'large_breasts' },
          { label: 'Огромная', tag: 'huge_breasts' },
          { label: 'Гигантская', tag: 'gigantic_breasts' }
        ]
      },
      {
        id: 'body_build',
        name: 'Телосложение',
        type: 'grid',
        mode: 'single',
        variantSize: 'pill',
        variants: [
          { id: 'slim', name: 'Стройное', tag: 'slim' },
          { id: 'curvy', name: 'Пышное', tag: 'curvy' },
          { id: 'muscular', name: 'Мускулистое', tag: 'muscular_female' },
          { id: 'petite', name: 'Миниатюрное', tag: 'petite' }
        ]
      }
    ]
  },

  // 3. ВОЛОСЫ
  {
    id: 'hair',
    name: 'Волосы',
    icon: 'sparkles',
    order: 30,
    subs: [
      {
        id: 'hair_length',
        name: 'Длина',
        type: 'slider',
        mode: 'single',
        sliderSteps: [
          { label: 'Очень короткие', tag: 'very_short_hair' },
          { label: 'Короткие', tag: 'short_hair' },
          { label: 'Средние', tag: 'medium_hair' },
          { label: 'Длинные', tag: 'long_hair' },
          { label: 'Очень длинные', tag: 'very_long_hair' },
          { label: 'До пят', tag: 'absurdly_long_hair' }
        ]
      },
      {
        id: 'hair_color',
        name: 'Цвет волос',
        type: 'grid',
        mode: 'single',
        variantSize: 'swatch',
        variants: [
          { id: 'blonde_hair', name: 'Блонд', tag: 'blonde_hair', colorHex: '#fcbf49', layer: 'hair-front',
            modifiers: [
              { name: 'Градиент', tag: 'gradient_hair', needsColor: true, conflictsWith: ['two-tone_hair'] },
              { name: 'Двухтонные', tag: 'two-tone_hair', needsColor: true, conflictsWith: ['gradient_hair'] },
              { name: 'Цветные кончики', tag: 'colored_tips', needsColor: true },
              { name: 'Внутренний слой', tag: 'colored_inner_hair', needsColor: true },
              { name: 'Пряди', tag: 'streaked_hair' }
            ]
          },
          { id: 'black_hair', name: 'Чёрные', tag: 'black_hair', colorHex: '#1e1e24', layer: 'hair-front',
            modifiers: [
              { name: 'Градиент', tag: 'gradient_hair', needsColor: true },
              { name: 'Внутренний слой', tag: 'colored_inner_hair', needsColor: true }
            ]
          },
          { id: 'blue_hair', name: 'Синие', tag: 'blue_hair', colorHex: '#0077b6', layer: 'hair-front' },
          { id: 'pink_hair', name: 'Розовые', tag: 'pink_hair', colorHex: '#f72585', layer: 'hair-front' },
          { id: 'silver_hair', name: 'Серебряные / Белые', tag: 'white_hair', colorHex: '#e9ecef', layer: 'hair-front' },
          { id: 'red_hair', name: 'Рыжие / Красные', tag: 'red_hair', colorHex: '#e63946', layer: 'hair-front' },
          { id: 'green_hair', name: 'Зелёные', tag: 'green_hair', colorHex: '#2a9d8f', layer: 'hair-front' },
          { id: 'purple_hair', name: 'Фиолетовые', tag: 'purple_hair', colorHex: '#7209b7', layer: 'hair-front' },
          { id: 'orange_hair', name: 'Оранжевые', tag: 'orange_hair', colorHex: '#f77f00', layer: 'hair-front' },
          { id: 'aqua_hair', name: 'Бирюзовые', tag: 'aqua_hair', colorHex: '#48cae4', layer: 'hair-front' }
        ]
      },
      {
        id: 'hair_color_wheel',
        name: 'Палитра',
        type: 'color-wheel',
        mode: 'single',
        paletteKey: 'hair'
      },
      {
        id: 'hair_blend',
        name: 'Микс',
        type: 'blend',
        mode: 'single',
        paletteKey: 'hair'
      },
      {
        id: 'hair_style',
        name: 'Причёска',
        type: 'grid',
        mode: 'single',
        variantSize: 'pill',
        searchable: true,
        groups: [
          { name: 'Распущенные', variantIds: ['straight', 'wavy', 'bob_cut', 'hime_cut'] },
          { name: 'Собранные', variantIds: ['ponytail', 'twintails', 'braid'] },
          { name: 'Особые', variantIds: ['dreadlocks'] }
        ],
        variants: [
          { id: 'straight', name: 'Прямые', tag: 'straight_hair', layer: 'hair-back' },
          { id: 'wavy', name: 'Волнистые', tag: 'wavy_hair', layer: 'hair-back' },
          { id: 'twintails', name: 'Хвостики', tag: 'twintails', layer: 'hair-back' },
          { id: 'ponytail', name: 'Хвост', tag: 'ponytail', layer: 'hair-back' },
          {
            id: 'braid', name: 'Коса', tag: 'braid', layer: 'hair-back',
            quantity: [
              { label: '1', tag: 'braid' },
              { label: '2', tag: 'twin_braids' },
              { label: '3+', tag: 'multiple_braids' }
            ]
          },
          { id: 'bob_cut', name: 'Каре', tag: 'bob_cut', layer: 'hair-back' },
          { id: 'hime_cut', name: 'Химэ', tag: 'hime_cut', layer: 'hair-back' },
          { id: 'dreadlocks', name: 'Дреды', tag: 'dreadlocks', layer: 'hair-back' }
        ]
      }
    ]
  },

  // 4. ЛИЦО И ГЛАЗА
  {
    id: 'face',
    name: 'Лицо',
    icon: 'eye',
    order: 40,
    subs: [
      {
        id: 'eye_color',
        name: 'Цвет глаз',
        type: 'grid',
        mode: 'single',
        variantSize: 'swatch',
        variants: [
          { id: 'blue_eyes', name: 'Синие', tag: 'blue_eyes', colorHex: '#0077b6' },
          { id: 'red_eyes', name: 'Красные', tag: 'red_eyes', colorHex: '#e63946' },
          { id: 'green_eyes', name: 'Зелёные', tag: 'green_eyes', colorHex: '#2a9d8f' },
          { id: 'purple_eyes', name: 'Фиолетовые', tag: 'purple_eyes', colorHex: '#7209b7' },
          { id: 'amber_eyes', name: 'Янтарные', tag: 'yellow_eyes', colorHex: '#fcbf49' },
          { id: 'pink_eyes', name: 'Розовые', tag: 'pink_eyes', colorHex: '#f72585' },
          { id: 'heterochromia', name: 'Гетерохромия', tag: 'heterochromia' }
        ]
      },
      {
        id: 'eye_color_wheel',
        name: 'Палитра',
        type: 'color-wheel',
        mode: 'single',
        paletteKey: 'eyes'
      },
      {
        id: 'eye_blend',
        name: 'Микс',
        type: 'blend',
        mode: 'single',
        paletteKey: 'eyes'
      },
      {
        id: 'pupil_shape',
        name: 'Зрачки',
        type: 'grid',
        mode: 'single',
        variantSize: 'pill',
        variants: [
          { id: 'normal_pupils', name: 'Обычные', tag: '' },
          { id: 'slit_pupils', name: 'Кошачьи (Slit)', tag: 'slit_pupils' },
          { id: 'heart_pupils', name: 'Сердечки', tag: 'heart-shaped_pupils' },
          { id: 'star_pupils', name: 'Звёздочки', tag: 'star-shaped_pupils' }
        ]
      }
    ]
  },

  // 5. ВЕРХНЯЯ ОДЕЖДА
  {
    id: 'tops',
    name: 'Верх',
    icon: 'shirt',
    order: 50,
    subs: [
      {
        id: 'top_type',
        name: 'Тип верха',
        type: 'grid',
        mode: 'single',
        variantSize: 'pill',
        searchable: true,
        groups: [
          { name: 'Рубашки', variantIds: ['shirt', 't_shirt', 'blouse'] },
          { name: 'Кофты', variantIds: ['hoodie', 'sweater', 'crop_top'] },
          { name: 'Прочее', variantIds: ['corset', 'tank_top'] }
        ],
        variants: [
          {
            id: 'shirt', name: 'Рубашка', tag: 'shirt', layer: 'tops', colorHex: '#e8e8e8',
            modifiers: [
              { name: 'Без рукавов', tag: 'sleeveless' },
              { name: 'Закатанные рукава', tag: 'sleeves_rolled_up' }
            ]
          },
          { id: 't_shirt', name: 'Футболка', tag: 't-shirt', layer: 'tops', colorHex: '#cccccc' },
          { id: 'blouse', name: 'Блузка', tag: 'blouse', layer: 'tops', colorHex: '#f0e6d3' },
          { id: 'hoodie', name: 'Худи', tag: 'hoodie', layer: 'tops', colorHex: '#4a4a6a' },
          { id: 'sweater', name: 'Свитер', tag: 'sweater', layer: 'tops', colorHex: '#6b8e7b' },
          { id: 'crop_top', name: 'Кроп-топ', tag: 'crop_top', layer: 'tops', colorHex: '#ff6b6b' },
          { id: 'corset', name: 'Корсет', tag: 'corset', layer: 'tops' },
          { id: 'tank_top', name: 'Майка', tag: 'tank_top', layer: 'tops', colorHex: '#e0e0e0' }
        ]
      },
      {
        id: 'top_material',
        name: 'Материал',
        type: 'grid',
        mode: 'single',
        variantSize: 'pill',
        variants: [
          { id: 'cotton_top', name: 'Хлопок', tag: 'cotton' },
          { id: 'leather_top', name: 'Кожа', tag: 'leather' },
          { id: 'denim_top', name: 'Деним', tag: 'denim' },
          { id: 'silk_top', name: 'Шёлк', tag: 'silk' },
          { id: 'lace_top', name: 'Кружево', tag: 'lace' },
          { id: 'velvet_top', name: 'Бархат', tag: 'velvet' }
        ]
      }
    ]
  },

  // 6. НИЖНЯЯ ОДЕЖДА
  {
    id: 'bottoms',
    name: 'Низ',
    icon: 'columns-2',
    order: 60,
    subs: [
      {
        id: 'bottom_type',
        name: 'Тип низа',
        type: 'grid',
        mode: 'single',
        variantSize: 'pill',
        groups: [
          { name: 'Юбки', variantIds: ['pleated_skirt', 'miniskirt', 'long_skirt'] },
          { name: 'Штаны', variantIds: ['jeans', 'pants', 'shorts'] }
        ],
        variants: [
          { id: 'pleated_skirt', name: 'Плиссированная юбка', tag: 'pleated_skirt', layer: 'bottoms', colorHex: '#4a4a6a' },
          { id: 'miniskirt', name: 'Мини-юбка', tag: 'miniskirt', layer: 'bottoms', colorHex: '#6b4a7b' },
          { id: 'long_skirt', name: 'Длинная юбка', tag: 'long_skirt', layer: 'bottoms', colorHex: '#3a5a7a' },
          { id: 'shorts', name: 'Шорты', tag: 'shorts', layer: 'bottoms', colorHex: '#5a5a5a' },
          { id: 'jeans', name: 'Джинсы', tag: 'jeans', layer: 'bottoms', colorHex: '#2a4a6a' },
          { id: 'pants', name: 'Брюки', tag: 'pants', layer: 'bottoms', colorHex: '#3a3a4a' }
        ]
      },
      {
        id: 'legwear',
        name: 'Чулки / Носки',
        type: 'slider',
        mode: 'single',
        sliderSteps: [
          { label: 'Без чулок', tag: 'bare_legs' },
          { label: 'Носки', tag: 'socks' },
          { label: 'До колен', tag: 'kneehighs' },
          { label: 'Ботфорты', tag: 'thighhighs' },
          { label: 'Колготки', tag: 'pantyhose' }
        ]
      }
    ]
  },

  // 7. ПЛАТЬЯ И КОСТЮМЫ
  {
    id: 'dresses',
    name: 'Платья',
    icon: 'gem',
    order: 70,
    subs: [
      {
        id: 'dress_type',
        name: 'Комплект',
        type: 'grid',
        mode: 'single',
        variantSize: 'pill',
        searchable: true,
        variants: [
          { id: 'maid_dress', name: 'Горничная', tag: 'maid_dress', layer: 'fullbody', colorHex: '#1a1a2e' },
          { id: 'sundress', name: 'Сарафан', tag: 'sundress', layer: 'fullbody', colorHex: '#7ec8e3' },
          { id: 'gothic_lolita', name: 'Готик-лолита', tag: 'gothic_lolita', layer: 'fullbody', colorHex: '#2a1a3a' },
          { id: 'evening_dress', name: 'Вечернее', tag: 'evening_dress', layer: 'fullbody', colorHex: '#8b0000' },
          { id: 'school_uniform', name: 'Школьная форма', tag: 'school_uniform', layer: 'fullbody', colorHex: '#2a4a6a' },
          { id: 'kimono', name: 'Кимоно', tag: 'kimono', layer: 'fullbody', colorHex: '#c42b56' },
          { id: 'swimsuit', name: 'Купальник', tag: 'swimsuit', layer: 'fullbody', colorHex: '#ff69b4' },
          { id: 'naked', name: 'Обнажённая', tag: 'naked', layer: 'fullbody' }
        ]
      }
    ]
  },

  // 8. ЭМОЦИИ
  {
    id: 'expression',
    name: 'Эмоции',
    icon: 'smile',
    order: 80,
    subs: [
      {
        id: 'emotions',
        name: 'Выражение лица',
        type: 'grid',
        mode: 'multi',
        variantSize: 'pill',
        variants: [
          { id: 'smile', name: 'Улыбка', tag: 'smile', colorHex: '#f72585' },
          { id: 'light_smile', name: 'Лёгкая улыбка', tag: 'light_smile' },
          { id: 'smug', name: 'Ухмылка', tag: 'smug' },
          { id: 'blush', name: 'Румянец', tag: 'blush', colorHex: '#ff6b6b' },
          { id: 'open_mouth', name: 'Приоткрытый рот', tag: 'open_mouth' },
          { id: 'pout', name: 'Надутые щёчки', tag: 'pout' },
          { id: 'expressionless', name: 'Хладнокровие', tag: 'expressionless' }
        ]
      }
    ]
  },
  ...EXTRA_CATEGORIES,
]);
CATEGORIES_DATA.sort((a, b) => a.order - b.order);
