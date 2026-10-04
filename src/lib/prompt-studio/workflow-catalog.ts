import type { Choice } from './studio.svelte.js';
import type { StudioKind } from './presets.js';

export type WorkflowOption = { tag: string; labelKey: string };
export type WorkflowGroup = {
  id: string;
  labelKey: string;
  mode: StudioKind;
  multi?: boolean;
  optional?: boolean;
  options: WorkflowOption[];
};
type Dictionary = Record<string, string>;
type OptionDefinition = [tag: string, russian: string, english?: string];
const key = (name: string) => `prompt_studio.v2.guided.${name}`;
export const WORKFLOW_LOCALES: { en: Dictionary; ru: Dictionary } = { en: {}, ru: {} };
function label(name: string, english: string, russian: string) {
  const id = key(name);
  WORKFLOW_LOCALES.en[id] = english;
  WORKFLOW_LOCALES.ru[id] = russian;
  return id;
}
function group(mode: StudioKind, name: string, english: string, russian: string, options: OptionDefinition[], extra: Pick<WorkflowGroup, 'multi' | 'optional'> = {}): WorkflowGroup {
  return {
    id: `recipe:${mode}:${name}`, mode,
    labelKey: label(`group.${mode}.${name}`, english, russian),
    ...extra,
    options: options.map(([tag, ru, en]) => ({ tag, labelKey: label(`tag.${tag}`, en ?? tag.replaceAll('_', ' ').replaceAll('-', ' '), ru) })),
  };
}

/** Original starter recipes. These never populate or modify the user's catalog. */
export const WORKFLOW_CATALOG: WorkflowGroup[] = [
  group('character', 'subject', 'Subject', 'Персонаж', [
    ['1girl', 'Одна девушка', 'One girl'], ['1boy', 'Один парень', 'One boy'], ['1other', 'Другой персонаж', 'Other subject'], ['2girls', 'Две девушки', 'Two girls'], ['2boys', 'Два парня', 'Two boys'], ['multiple_girls', 'Несколько девушек'], ['multiple_boys', 'Несколько парней'], ['group', 'Группа'],
  ]),
  group('character', 'hair_length', 'Hair length', 'Длина волос', [
    ['short_hair', 'Короткие'], ['medium_hair', 'Средние'], ['long_hair', 'Длинные'], ['very_long_hair', 'Очень длинные'], ['buzz_cut', 'Коротко стриженные'], ['bald', 'Без волос'],
  ]),
  group('character', 'hair_style', 'Hair style', 'Причёска', [
    ['straight_hair', 'Прямые'], ['wavy_hair', 'Волнистые'], ['curly_hair', 'Кудрявые'], ['ponytail', 'Хвост'], ['twintails', 'Два хвоста'], ['braid', 'Коса'], ['bob_cut', 'Каре'], ['hair_bun', 'Пучок'],
  ]),
  group('character', 'hair_color', 'Hair colour', 'Цвет волос', [
    ['black_hair', 'Чёрные'], ['brown_hair', 'Каштановые'], ['blonde_hair', 'Светлые'], ['white_hair', 'Белые'], ['red_hair', 'Рыжие'], ['blue_hair', 'Синие'], ['purple_hair', 'Фиолетовые'], ['pink_hair', 'Розовые'],
  ]),
  group('character', 'eyes', 'Eye colour', 'Цвет глаз', [
    ['brown_eyes', 'Карие'], ['blue_eyes', 'Голубые'], ['green_eyes', 'Зелёные'], ['gray_eyes', 'Серые'], ['amber_eyes', 'Янтарные'], ['purple_eyes', 'Фиолетовые'], ['red_eyes', 'Красные'], ['heterochromia', 'Разные глаза'],
  ]),
  group('character', 'expression', 'Expression', 'Выражение лица', [
    ['smile', 'Улыбка'], ['grin', 'Широкая улыбка'], ['neutral_expression', 'Нейтральное'], ['serious', 'Серьёзное'], ['determined', 'Решительное'], ['embarrassed', 'Смущение'], ['surprised', 'Удивление'], ['sad', 'Грусть'],
  ]),
  group('character', 'pose', 'Pose', 'Поза', [
    ['standing', 'Стоя'], ['sitting', 'Сидя'], ['kneeling', 'На коленях'], ['lying', 'Лёжа'], ['walking', 'В движении'], ['running', 'Бег'], ['leaning_forward', 'Наклон вперёд'], ['arms_crossed', 'Руки скрещены'],
  ]),
  group('character', 'features', 'Distinctive details', 'Особые черты', [
    ['freckles', 'Веснушки'], ['glasses', 'Очки'], ['pointy_ears', 'Острые уши'], ['horns', 'Рога'], ['wings', 'Крылья'], ['tail', 'Хвост'], ['halo', 'Нимб'], ['tattoo', 'Татуировка'],
  ], { multi: true, optional: true }),
  group('wardrobe', 'style', 'Outfit style', 'Стиль одежды', [
    ['casual_clothes', 'Повседневный'], ['formal', 'Официальный'], ['streetwear', 'Уличный'], ['athletic_wear', 'Спортивный'], ['traditional_clothes', 'Традиционный'], ['military_uniform', 'Военная форма'], ['school_uniform', 'Школьная форма'], ['work_clothes', 'Рабочий'],
  ]),
  group('wardrobe', 'top', 'Top', 'Верх', [
    ['shirt', 'Рубашка'], ['blouse', 'Блузка'], ['sweater', 'Свитер'], ['hoodie', 'Худи'], ['turtleneck', 'Водолазка'], ['vest', 'Жилет'], ['tank_top', 'Майка'], ['tunic', 'Туника'],
  ]),
  group('wardrobe', 'bottom', 'Bottom', 'Низ', [
    ['pants', 'Брюки'], ['jeans', 'Джинсы'], ['skirt', 'Юбка'], ['long_skirt', 'Длинная юбка'], ['shorts', 'Шорты'], ['leggings', 'Леггинсы'], ['pleated_skirt', 'Юбка в складку'], ['wide_pants', 'Широкие брюки'],
  ]),
  group('wardrobe', 'outerwear', 'Outerwear', 'Верхняя одежда', [
    ['coat', 'Пальто'], ['jacket', 'Куртка'], ['blazer', 'Пиджак'], ['cardigan', 'Кардиган'], ['cape', 'Накидка'], ['poncho', 'Пончо'], ['raincoat', 'Плащ'], ['fur_trimmed_coat', 'Пальто с меховой отделкой'],
  ], { optional: true }),
  group('wardrobe', 'footwear', 'Footwear', 'Обувь', [
    ['sneakers', 'Кроссовки'], ['boots', 'Ботинки'], ['knee_boots', 'Высокие сапоги'], ['loafers', 'Лоферы'], ['high_heels', 'Туфли на каблуке'], ['sandals', 'Сандалии'], ['slippers', 'Тапочки'], ['lace-up_boots', 'Ботинки со шнуровкой'],
  ]),
  group('wardrobe', 'material', 'Material', 'Материал', [
    ['silk', 'Шёлк'], ['satin', 'Атлас'], ['leather', 'Кожа'], ['denim', 'Деним'], ['wool', 'Шерсть'], ['velvet', 'Бархат'], ['lace', 'Кружево'], ['linen', 'Лён'],
  ]),
  group('wardrobe', 'palette', 'Palette', 'Палитра', [
    ['black_clothes', 'Чёрная'], ['white_clothes', 'Белая'], ['blue_clothes', 'Синяя'], ['red_clothes', 'Красная'], ['green_clothes', 'Зелёная'], ['pastel_colors', 'Пастельная'], ['earth_tones', 'Природные оттенки'], ['monochrome', 'Монохромная'],
  ]),
  group('wardrobe', 'accessories', 'Accessories', 'Аксессуары', [
    ['belt', 'Ремень'], ['scarf', 'Шарф'], ['gloves', 'Перчатки'], ['hat', 'Шляпа'], ['beret', 'Берет'], ['necklace', 'Ожерелье'], ['earrings', 'Серьги'], ['bag', 'Сумка'],
  ], { multi: true, optional: true }),
  group('scene', 'location', 'Location', 'Место', [
    ['forest', 'Лес'], ['city', 'Город'], ['beach', 'Пляж'], ['mountains', 'Горы'], ['garden', 'Сад'], ['bedroom', 'Спальня'], ['cafe', 'Кафе'], ['library', 'Библиотека'],
  ]),
  group('scene', 'time', 'Time of day', 'Время суток', [
    ['sunrise', 'Рассвет'], ['morning', 'Утро'], ['noon', 'Полдень'], ['afternoon', 'После полудня'], ['sunset', 'Закат'], ['night', 'Ночь'], ['blue_hour', 'Синий час'], ['twilight', 'Сумерки'],
  ]),
  group('scene', 'weather', 'Weather', 'Погода', [
    ['clear_sky', 'Ясное небо'], ['cloudy_sky', 'Облачно'], ['rain', 'Дождь'], ['snow', 'Снег'], ['fog', 'Туман'], ['storm', 'Гроза'], ['wind', 'Ветер'], ['partly_cloudy', 'Переменная облачность'],
  ], { optional: true }),
  group('scene', 'lighting', 'Lighting', 'Освещение', [
    ['soft_lighting', 'Мягкое'], ['backlighting', 'Контровое'], ['rim_lighting', 'По контуру'], ['volumetric_lighting', 'Объёмное'], ['neon_lights', 'Неон'], ['candlelight', 'Свечи'], ['studio_lighting', 'Студийное'], ['dramatic_lighting', 'Драматическое'],
  ]),
  group('scene', 'framing', 'Framing', 'Кадрирование', [
    ['portrait', 'Портрет'], ['upper_body', 'По пояс'], ['cowboy_shot', 'До бёдер'], ['full_body', 'В полный рост'], ['close-up', 'Крупный план'], ['wide_shot', 'Общий план'], ['panorama', 'Панорама'], ['detail', 'Деталь'],
  ]),
  group('scene', 'viewpoint', 'Camera angle', 'Ракурс', [
    ['front_view', 'Спереди'], ['side_view', 'Сбоку'], ['three-quarter_view', 'В три четверти'], ['from_above', 'Сверху'], ['from_below', 'Снизу'], ['from_behind', 'Сзади'], ['dutch_angle', 'Наклонённый кадр'], ['over_the_shoulder', 'Через плечо'],
  ]),
  group('scene', 'mood', 'Atmosphere', 'Атмосфера', [
    ['peaceful', 'Спокойная'], ['melancholic', 'Меланхоличная'], ['mysterious', 'Таинственная'], ['joyful', 'Радостная'], ['tense', 'Напряжённая'], ['dreamlike', 'Сказочная'], ['romantic', 'Романтичная'], ['epic', 'Эпичная'],
  ]),
  group('scene', 'details', 'Scene details', 'Детали сцены', [
    ['flowers', 'Цветы'], ['leaves', 'Листья'], ['lantern', 'Фонарь'], ['books', 'Книги'], ['water', 'Вода'], ['particles', 'Частицы'], ['reflections', 'Отражения'], ['bokeh', 'Боке'],
  ], { multi: true, optional: true }),
];

const ui: [string, string, string][] = [
  ['search', 'Find a group or detail…', 'Найти раздел или деталь…'],
  ['random_all', 'Randomize unlocked', 'Случайные незакреплённые'],
  ['random_group', 'Randomize this group', 'Случайный выбор в разделе'],
  ['reset', 'Clear this mode', 'Очистить этот режим'],
  ['hint', 'Choose one detail per group. Locks and pinned tags survive randomize and reset.', 'Выберите по детали в разделе. Закреплённые разделы и теги сохраняются при случайном выборе и сбросе.'],
  ['lock', 'Lock group', 'Закрепить раздел'], ['unlock', 'Unlock group', 'Открепить раздел'],
  ['locked', 'Locked', 'Закреплён'], ['multi', 'Choose several', 'Можно выбрать несколько'],
  ['optional', 'Optional', 'Необязательно'], ['none', 'None', 'Без выбора'],
  ['no_results', 'No matching details. Try another search.', 'Нет подходящих деталей. Измените запрос.'],
  ['selected', 'Selected', 'Выбрано'], ['clear_search', 'Clear search', 'Очистить поиск'],
  ['storage_error', 'Group locks could not be saved on this device.', 'Не удалось сохранить закреплённые разделы на этом устройстве.'],
];
for (const [name, en, ru] of ui) label(name, en, ru);

export function workflowGroups(mode: StudioKind): WorkflowGroup[] {
  return WORKFLOW_CATALOG.filter(group => group.mode === mode);
}

export type RandomizeOptions = {
  locked: readonly string[];
  pinned: readonly string[];
  banned: readonly string[];
  random?: () => number;
};

/** Produces replacements only for unlocked groups; no store or browser dependencies. */
export function randomizeWorkflow(selected: readonly Choice[], groups: readonly WorkflowGroup[], options: RandomizeOptions): { categories: string[]; entries: Choice[] } {
  const random = options.random ?? Math.random;
  const targets = groups.filter(group => !options.locked.includes(group.id));
  const categories = targets.map(group => group.id);
  const targetIds = new Set(categories);
  const pinned = selected.filter(choice => targetIds.has(choice.category) && options.pinned.includes(choice.tag));
  const used = new Set(selected.filter(choice => !targetIds.has(choice.category)).map(choice => choice.tag));
  for (const choice of pinned) used.add(choice.tag);
  const entries: Choice[] = [];
  const pick = (length: number) => Math.min(length - 1, Math.max(0, Math.floor(random() * length)));
  for (const group of targets) {
    const kept = pinned.filter(choice => choice.category === group.id);
    entries.push(...kept);
    // A pinned single selection defines the group even if it is now banned.
    if (!group.multi && kept.length) continue;
    const available = group.options.filter(option => option.tag && !used.has(option.tag) && !options.banned.includes(option.tag));
    if (!available.length || (group.optional && !kept.length && random() < 0.25)) continue;
    const count = group.multi ? Math.min(available.length, Math.max(0, 2 - kept.length)) : 1;
    for (let index = 0; index < count && available.length; index++) {
      const [option] = available.splice(pick(available.length), 1);
      used.add(option.tag);
      entries.push({ tag: option.tag, name: option.tag.replaceAll('_', ' '), category: group.id, weight: 1 });
    }
  }
  return { categories, entries };
}

export function resetWorkflow(selected: readonly Choice[], groups: readonly WorkflowGroup[], options: Pick<RandomizeOptions, 'locked' | 'pinned'>): { categories: string[]; entries: Choice[] } {
  const categories = groups.filter(group => !options.locked.includes(group.id)).map(group => group.id);
  const targetIds = new Set(categories);
  return { categories, entries: selected.filter(choice => targetIds.has(choice.category) && options.pinned.includes(choice.tag)) };
}
