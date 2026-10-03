import { locale } from '../stores/locale.svelte.js';
import type { Category } from './types.js';

/** Curated standard Danbooru tags, checked against the bundled tag library. No fabricated counts. */
export const EXTRA_CATEGORIES: Category[] = [
  {
    "id": "pose",
    get name() { return locale.t("prompt_studio.extra_pose"); },
    "icon": "move",
    "order": 90,
    "subs": [
      {
        "id": "posture",
        get name() { return locale.t("prompt_studio.extra_posture"); },
        "type": "grid",
        "mode": "single",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "standing",
            "name": "standing",
            "tag": "standing"
          },
          {
            "id": "sitting",
            "name": "sitting",
            "tag": "sitting"
          },
          {
            "id": "kneeling",
            "name": "kneeling",
            "tag": "kneeling"
          },
          {
            "id": "lying",
            "name": "lying",
            "tag": "lying"
          },
          {
            "id": "squatting",
            "name": "squatting",
            "tag": "squatting"
          },
          {
            "id": "leaning_forward",
            "name": "leaning forward",
            "tag": "leaning_forward"
          },
          {
            "id": "leaning_back",
            "name": "leaning back",
            "tag": "leaning_back"
          },
          {
            "id": "on_back",
            "name": "on back",
            "tag": "on_back"
          },
          {
            "id": "on_side",
            "name": "on side",
            "tag": "on_side"
          },
          {
            "id": "on_stomach",
            "name": "on stomach",
            "tag": "on_stomach"
          }
        ]
      },
      {
        "id": "gestures",
        get name() { return locale.t("prompt_studio.extra_gestures"); },
        "type": "grid",
        "mode": "multi",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "arms_up",
            "name": "arms up",
            "tag": "arms_up"
          },
          {
            "id": "arms_behind_back",
            "name": "arms behind back",
            "tag": "arms_behind_back"
          },
          {
            "id": "crossed_arms",
            "name": "crossed arms",
            "tag": "crossed_arms"
          },
          {
            "id": "outstretched_arms",
            "name": "outstretched arms",
            "tag": "outstretched_arms"
          },
          {
            "id": "waving",
            "name": "waving",
            "tag": "waving"
          },
          {
            "id": "pointing",
            "name": "pointing",
            "tag": "pointing"
          },
          {
            "id": "holding_hands",
            "name": "holding hands",
            "tag": "holding_hands"
          }
        ]
      },
      {
        "id": "gaze",
        get name() { return locale.t("prompt_studio.extra_gaze"); },
        "type": "grid",
        "mode": "single",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "looking_at_viewer",
            "name": "looking at viewer",
            "tag": "looking_at_viewer"
          },
          {
            "id": "looking_back",
            "name": "looking back",
            "tag": "looking_back"
          },
          {
            "id": "looking_up",
            "name": "looking up",
            "tag": "looking_up"
          },
          {
            "id": "looking_down",
            "name": "looking down",
            "tag": "looking_down"
          },
          {
            "id": "closed_eyes",
            "name": "closed eyes",
            "tag": "closed_eyes"
          },
          {
            "id": "half-closed_eyes",
            "name": "half-closed eyes",
            "tag": "half-closed_eyes"
          }
        ]
      }
    ]
  },
  {
    "id": "composition",
    get name() { return locale.t("prompt_studio.extra_composition"); },
    "icon": "scan",
    "order": 100,
    "subs": [
      {
        "id": "framing",
        get name() { return locale.t("prompt_studio.extra_framing"); },
        "type": "grid",
        "mode": "single",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "portrait",
            "name": "portrait",
            "tag": "portrait"
          },
          {
            "id": "upper_body",
            "name": "upper body",
            "tag": "upper_body"
          },
          {
            "id": "cowboy_shot",
            "name": "cowboy shot",
            "tag": "cowboy_shot"
          },
          {
            "id": "full_body",
            "name": "full body",
            "tag": "full_body"
          },
          {
            "id": "close-up",
            "name": "close-up",
            "tag": "close-up"
          },
          {
            "id": "wide_shot",
            "name": "wide shot",
            "tag": "wide_shot"
          }
        ]
      },
      {
        "id": "viewpoint",
        get name() { return locale.t("prompt_studio.extra_viewpoint"); },
        "type": "grid",
        "mode": "single",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "from_above",
            "name": "from above",
            "tag": "from_above"
          },
          {
            "id": "from_below",
            "name": "from below",
            "tag": "from_below"
          },
          {
            "id": "from_side",
            "name": "from side",
            "tag": "from_side"
          },
          {
            "id": "from_behind",
            "name": "from behind",
            "tag": "from_behind"
          },
          {
            "id": "profile",
            "name": "profile",
            "tag": "profile"
          },
          {
            "id": "dutch_angle",
            "name": "dutch angle",
            "tag": "dutch_angle"
          }
        ]
      },
      {
        "id": "layout",
        get name() { return locale.t("prompt_studio.extra_layout"); },
        "type": "grid",
        "mode": "multi",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "solo",
            "name": "solo",
            "tag": "solo"
          },
          {
            "id": "multiple_girls",
            "name": "multiple girls",
            "tag": "multiple_girls"
          },
          {
            "id": "multiple_boys",
            "name": "multiple boys",
            "tag": "multiple_boys"
          },
          {
            "id": "depth_of_field",
            "name": "depth of field",
            "tag": "depth_of_field"
          },
          {
            "id": "foreshortening",
            "name": "foreshortening",
            "tag": "foreshortening"
          }
        ]
      }
    ]
  },
  {
    "id": "environment",
    get name() { return locale.t("prompt_studio.extra_environment"); },
    "icon": "mountain",
    "order": 110,
    "subs": [
      {
        "id": "location",
        get name() { return locale.t("prompt_studio.extra_location"); },
        "type": "grid",
        "mode": "single",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "indoors",
            "name": "indoors",
            "tag": "indoors"
          },
          {
            "id": "outdoors",
            "name": "outdoors",
            "tag": "outdoors"
          },
          {
            "id": "bedroom",
            "name": "bedroom",
            "tag": "bedroom"
          },
          {
            "id": "classroom",
            "name": "classroom",
            "tag": "classroom"
          },
          {
            "id": "library",
            "name": "library",
            "tag": "library"
          },
          {
            "id": "kitchen",
            "name": "kitchen",
            "tag": "kitchen"
          },
          {
            "id": "cafe",
            "name": "cafe",
            "tag": "cafe"
          },
          {
            "id": "city",
            "name": "city",
            "tag": "city"
          },
          {
            "id": "street",
            "name": "street",
            "tag": "street"
          },
          {
            "id": "alley",
            "name": "alley",
            "tag": "alley"
          },
          {
            "id": "rooftop",
            "name": "rooftop",
            "tag": "rooftop"
          },
          {
            "id": "balcony",
            "name": "balcony",
            "tag": "balcony"
          },
          {
            "id": "garden",
            "name": "garden",
            "tag": "garden"
          },
          {
            "id": "forest",
            "name": "forest",
            "tag": "forest"
          },
          {
            "id": "beach",
            "name": "beach",
            "tag": "beach"
          },
          {
            "id": "mountain",
            "name": "mountain",
            "tag": "mountain"
          },
          {
            "id": "lake",
            "name": "lake",
            "tag": "lake"
          },
          {
            "id": "river",
            "name": "river",
            "tag": "river"
          },
          {
            "id": "underwater",
            "name": "underwater",
            "tag": "underwater"
          },
          {
            "id": "space",
            "name": "space",
            "tag": "space"
          }
        ]
      },
      {
        "id": "weather",
        get name() { return locale.t("prompt_studio.extra_weather"); },
        "type": "grid",
        "mode": "multi",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "rain",
            "name": "rain",
            "tag": "rain"
          },
          {
            "id": "snow",
            "name": "snow",
            "tag": "snow"
          },
          {
            "id": "fog",
            "name": "fog",
            "tag": "fog"
          },
          {
            "id": "cloudy_sky",
            "name": "cloudy sky",
            "tag": "cloudy_sky"
          },
          {
            "id": "blue_sky",
            "name": "blue sky",
            "tag": "blue_sky"
          },
          {
            "id": "sunset",
            "name": "sunset",
            "tag": "sunset"
          },
          {
            "id": "sunrise",
            "name": "sunrise",
            "tag": "sunrise"
          },
          {
            "id": "night",
            "name": "night",
            "tag": "night"
          },
          {
            "id": "starry_sky",
            "name": "starry sky",
            "tag": "starry_sky"
          }
        ]
      }
    ]
  },
  {
    "id": "lighting",
    get name() { return locale.t("prompt_studio.extra_lighting"); },
    "icon": "sun",
    "order": 120,
    "subs": [
      {
        "id": "light",
        get name() { return locale.t("prompt_studio.extra_light"); },
        "type": "grid",
        "mode": "multi",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "backlighting",
            "name": "backlighting",
            "tag": "backlighting"
          },
          {
            "id": "sunlight",
            "name": "sunlight",
            "tag": "sunlight"
          },
          {
            "id": "moonlight",
            "name": "moonlight",
            "tag": "moonlight"
          },
          {
            "id": "dappled_sunlight",
            "name": "dappled sunlight",
            "tag": "dappled_sunlight"
          },
          {
            "id": "lens_flare",
            "name": "lens flare",
            "tag": "lens_flare"
          },
          {
            "id": "bloom",
            "name": "bloom",
            "tag": "bloom"
          },
          {
            "id": "glowing",
            "name": "glowing",
            "tag": "glowing"
          }
        ]
      },
      {
        "id": "effects",
        get name() { return locale.t("prompt_studio.extra_effects"); },
        "type": "grid",
        "mode": "multi",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "bokeh",
            "name": "bokeh",
            "tag": "bokeh"
          },
          {
            "id": "light_particles",
            "name": "light particles",
            "tag": "light_particles"
          },
          {
            "id": "reflection",
            "name": "reflection",
            "tag": "reflection"
          },
          {
            "id": "water_drop",
            "name": "water drop",
            "tag": "water_drop"
          },
          {
            "id": "wind",
            "name": "wind",
            "tag": "wind"
          },
          {
            "id": "motion_blur",
            "name": "motion blur",
            "tag": "motion_blur"
          }
        ]
      }
    ]
  },
  {
    "id": "accessories",
    get name() { return locale.t("prompt_studio.extra_accessories"); },
    "icon": "gem",
    "order": 75,
    "subs": [
      {
        "id": "headwear",
        get name() { return locale.t("prompt_studio.extra_headwear"); },
        "type": "grid",
        "mode": "multi",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "hat",
            "name": "hat",
            "tag": "hat"
          },
          {
            "id": "beret",
            "name": "beret",
            "tag": "beret"
          },
          {
            "id": "baseball_cap",
            "name": "baseball cap",
            "tag": "baseball_cap"
          },
          {
            "id": "sun_hat",
            "name": "sun hat",
            "tag": "sun_hat"
          },
          {
            "id": "witch_hat",
            "name": "witch hat",
            "tag": "witch_hat"
          },
          {
            "id": "hood",
            "name": "hood",
            "tag": "hood"
          },
          {
            "id": "hairband",
            "name": "hairband",
            "tag": "hairband"
          },
          {
            "id": "hair_ribbon",
            "name": "hair ribbon",
            "tag": "hair_ribbon"
          },
          {
            "id": "hairclip",
            "name": "hairclip",
            "tag": "hairclip"
          },
          {
            "id": "hair_bow",
            "name": "hair bow",
            "tag": "hair_bow"
          }
        ]
      },
      {
        "id": "jewelry",
        get name() { return locale.t("prompt_studio.extra_jewelry"); },
        "type": "grid",
        "mode": "multi",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "earrings",
            "name": "earrings",
            "tag": "earrings"
          },
          {
            "id": "hoop_earrings",
            "name": "hoop earrings",
            "tag": "hoop_earrings"
          },
          {
            "id": "necklace",
            "name": "necklace",
            "tag": "necklace"
          },
          {
            "id": "choker",
            "name": "choker",
            "tag": "choker"
          },
          {
            "id": "pendant",
            "name": "pendant",
            "tag": "pendant"
          },
          {
            "id": "bracelet",
            "name": "bracelet",
            "tag": "bracelet"
          },
          {
            "id": "ring",
            "name": "ring",
            "tag": "ring"
          },
          {
            "id": "brooch",
            "name": "brooch",
            "tag": "brooch"
          }
        ]
      },
      {
        "id": "extras",
        get name() { return locale.t("prompt_studio.extra_extras"); },
        "type": "grid",
        "mode": "multi",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "glasses",
            "name": "glasses",
            "tag": "glasses"
          },
          {
            "id": "sunglasses",
            "name": "sunglasses",
            "tag": "sunglasses"
          },
          {
            "id": "scarf",
            "name": "scarf",
            "tag": "scarf"
          },
          {
            "id": "necktie",
            "name": "necktie",
            "tag": "necktie"
          },
          {
            "id": "bowtie",
            "name": "bowtie",
            "tag": "bowtie"
          },
          {
            "id": "belt",
            "name": "belt",
            "tag": "belt"
          },
          {
            "id": "gloves",
            "name": "gloves",
            "tag": "gloves"
          },
          {
            "id": "fingerless_gloves",
            "name": "fingerless gloves",
            "tag": "fingerless_gloves"
          },
          {
            "id": "bag",
            "name": "bag",
            "tag": "bag"
          },
          {
            "id": "backpack",
            "name": "backpack",
            "tag": "backpack"
          },
          {
            "id": "shoulder_bag",
            "name": "shoulder bag",
            "tag": "shoulder_bag"
          }
        ]
      }
    ]
  },
  {
    "id": "footwear",
    get name() { return locale.t("prompt_studio.extra_footwear"); },
    "icon": "footprints",
    "order": 76,
    "subs": [
      {
        "id": "shoes",
        get name() { return locale.t("prompt_studio.extra_shoes"); },
        "type": "grid",
        "mode": "single",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "shoes",
            "name": "shoes",
            "tag": "shoes"
          },
          {
            "id": "sneakers",
            "name": "sneakers",
            "tag": "sneakers"
          },
          {
            "id": "boots",
            "name": "boots",
            "tag": "boots"
          },
          {
            "id": "ankle_boots",
            "name": "ankle boots",
            "tag": "ankle_boots"
          },
          {
            "id": "knee_boots",
            "name": "knee boots",
            "tag": "knee_boots"
          },
          {
            "id": "high_heels",
            "name": "high heels",
            "tag": "high_heels"
          },
          {
            "id": "sandals",
            "name": "sandals",
            "tag": "sandals"
          },
          {
            "id": "loafers",
            "name": "loafers",
            "tag": "loafers"
          },
          {
            "id": "mary_janes",
            "name": "mary janes",
            "tag": "mary_janes"
          },
          {
            "id": "slippers",
            "name": "slippers",
            "tag": "slippers"
          },
          {
            "id": "barefoot",
            "name": "barefoot",
            "tag": "barefoot"
          }
        ]
      },
      {
        "id": "shoe_details",
        get name() { return locale.t("prompt_studio.extra_shoe_details"); },
        "type": "grid",
        "mode": "multi",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "lace-up_boots",
            "name": "lace-up boots",
            "tag": "lace-up_boots"
          },
          {
            "id": "platform_footwear",
            "name": "platform footwear",
            "tag": "platform_footwear"
          },
          {
            "id": "thigh_boots",
            "name": "thigh boots",
            "tag": "thigh_boots"
          },
          {
            "id": "high_heel_boots",
            "name": "high heel boots",
            "tag": "high_heel_boots"
          }
        ]
      }
    ]
  },
  {
    "id": "props",
    get name() { return locale.t("prompt_studio.extra_props"); },
    "icon": "package",
    "order": 130,
    "subs": [
      {
        "id": "held_props",
        get name() { return locale.t("prompt_studio.extra_held_props"); },
        "type": "grid",
        "mode": "multi",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "holding_book",
            "name": "holding book",
            "tag": "holding_book"
          },
          {
            "id": "holding_flower",
            "name": "holding flower",
            "tag": "holding_flower"
          },
          {
            "id": "holding_umbrella",
            "name": "holding umbrella",
            "tag": "holding_umbrella"
          },
          {
            "id": "holding_cup",
            "name": "holding cup",
            "tag": "holding_cup"
          },
          {
            "id": "holding_phone",
            "name": "holding phone",
            "tag": "holding_phone"
          },
          {
            "id": "holding_bag",
            "name": "holding bag",
            "tag": "holding_bag"
          },
          {
            "id": "holding_sword",
            "name": "holding sword",
            "tag": "holding_sword"
          },
          {
            "id": "holding_food",
            "name": "holding food",
            "tag": "holding_food"
          }
        ]
      },
      {
        "id": "scene_props",
        get name() { return locale.t("prompt_studio.extra_scene_props"); },
        "type": "grid",
        "mode": "multi",
        "searchable": true,
        "variantSize": "pill",
        "variants": [
          {
            "id": "book",
            "name": "book",
            "tag": "book"
          },
          {
            "id": "flower",
            "name": "flower",
            "tag": "flower"
          },
          {
            "id": "umbrella",
            "name": "umbrella",
            "tag": "umbrella"
          },
          {
            "id": "cup",
            "name": "cup",
            "tag": "cup"
          },
          {
            "id": "teacup",
            "name": "teacup",
            "tag": "teacup"
          },
          {
            "id": "cellphone",
            "name": "cellphone",
            "tag": "cellphone"
          },
          {
            "id": "camera",
            "name": "camera",
            "tag": "camera"
          },
          {
            "id": "bicycle",
            "name": "bicycle",
            "tag": "bicycle"
          },
          {
            "id": "bench",
            "name": "bench",
            "tag": "bench"
          },
          {
            "id": "chair",
            "name": "chair",
            "tag": "chair"
          },
          {
            "id": "table",
            "name": "table",
            "tag": "table"
          },
          {
            "id": "window",
            "name": "window",
            "tag": "window"
          },
          {
            "id": "door",
            "name": "door",
            "tag": "door"
          },
          {
            "id": "tree",
            "name": "tree",
            "tag": "tree"
          },
          {
            "id": "potted_plant",
            "name": "potted plant",
            "tag": "potted_plant"
          }
        ]
      }
    ]
  }
];
