// Initial category tree, inserted once by migration 2. Admins edit it later in
// 后台 → 素材分类. Each minor category carries an English hint that the asset
// generator adds to its prompt.
//   [key, 中文名, English name, hint, rating?]
// Pose keys reuse the imported catalog's series/category keys so imported and
// generated poses share one tree. Restricted (explicit) series are not seeded.

export const POSE_TREE = [
  {
    key: "全身1人・標準系", zh: "单人全身 · 常规姿势", en: "Solo · classic full body",
    children: [
      ["立ち", "站姿", "Standing", "standing upright, weight on one or both legs"],
      ["座り", "坐姿", "Sitting", "sitting on the floor or on a low box"],
      ["膝立ち", "跪姿", "Kneeling", "kneeling on one or both knees"],
      ["横座り・女の子座り", "侧坐与少女坐", "Side sitting", "sitting on the floor with both legs folded to one side"],
      ["寝そべり", "躺卧", "Lying down", "lying on the floor, on the back, side or front"],
      ["しゃがみ", "蹲姿", "Squatting", "squatting low with knees bent"],
      ["前かがみ", "前倾姿势", "Leaning forward", "bending or leaning forward from the hips"],
      ["のけぞり・反り", "后仰与反弓", "Arching backward", "leaning or arching the upper body backward"],
      ["ひねり", "扭转姿势", "Twisting", "upper body twisted relative to the hips"],
      ["walk", "行走", "Walking", "mid-stride walking pose, like a fashion runway or street snap"],
      ["dance", "舞蹈与动态", "Dance & motion", "dynamic dance or jumping pose with clear motion"]
    ]
  },
  {
    key: "上半身1人", zh: "单人上半身", en: "Solo · upper body",
    children: [
      ["かわいい系", "可爱风", "Playful poses", "upper body only, playful hand gestures near the face"],
      ["portrait", "半身肖像", "Portrait", "upper body only, calm portrait pose, hands resting or arms crossed"]
    ]
  }
];

const S = "suggestive";

export const OUTFIT_TREE = [
  {
    key: "daily", zh: "日常与四季", en: "Everyday & seasons",
    children: [
      ["spring", "春季", "Spring", "light spring layers: soft knitwear, a light trench coat or cardigan, blouse, skirt or straight trousers, pastel and neutral tones"],
      ["summer", "夏季", "Summer", "breathable summer pieces: a sundress, or a short-sleeved top with shorts or a flowing skirt, sandals, straw bag, bright or white tones"],
      ["autumn", "秋季", "Autumn", "autumn layers: wool blazer or leather jacket, knit sweater, midi skirt or wide-leg trousers, ankle boots, warm earth tones"],
      ["winter", "冬季", "Winter", "winter outfit: long wool coat or puffer jacket, chunky knit, scarf, opaque tights, knee-high or ankle boots"],
      ["campus", "学院风", "Preppy", "preppy style for a young adult woman: blazer, collared shirt, knit vest, pleated midi skirt, loafers"],
      ["commute", "通勤", "Smart casual", "smart-casual commute: tailored trousers or a pencil skirt, silk blouse, light blazer, low heels, tote bag"],
      ["athleisure", "运动休闲", "Athleisure", "athleisure: zip hoodie or sweatshirt, leggings or joggers, sneakers, cap"],
      ["loungewear", "居家服", "Loungewear", "soft cotton loungewear set: long-sleeved top with matching trousers, cardigan, slippers"]
    ]
  },
  {
    key: "historical", zh: "古装 · 历代服饰", en: "Chinese historical dress",
    children: [
      ["pre-qin", "先秦服饰", "Pre-Qin (Shang & Zhou)", "Shang and Zhou dynasty dress: cross-collared yi top over a chang skirt, wide belt with jade pendants, muted natural dyes"],
      ["qin", "秦朝服饰", "Qin dynasty", "Qin dynasty hanfu: dark quju shenyi robe wrapping spirally around the body, black and deep red, wide sleeves, simple sash"],
      ["han", "汉朝服饰", "Han dynasty", "Han dynasty hanfu: layered quju or zhiju shenyi robe with crossed collar, long trailing hem, wide sleeves, cloud-pattern embroidery"],
      ["wei-jin", "魏晋服饰", "Wei & Jin dynasties", "Wei and Jin dynasty dress: loose wide-sleeved robe, flowing ribbons, layered skirt with pointed hanging streamers (zaju chuishao), airy silk"],
      ["tang", "唐朝服饰", "Tang dynasty", "Tang dynasty hanfu: high-waisted qixiong ruqun skirt tied above the bust, short wide-sleeved jacket, long translucent pibo shawl, floral brocade, rich colours"],
      ["song", "宋朝服饰", "Song dynasty", "Song dynasty hanfu: slim long beizi jacket with straight front opening over a songmo top and pleated baidie skirt, soft elegant colours"],
      ["yuan", "元朝服饰", "Yuan dynasty", "Yuan dynasty dress: wide-sleeved robe with gold brocade trim, sash at the waist, deep reds and golds"],
      ["ming", "明朝服饰", "Ming dynasty", "Ming dynasty hanfu: standing-collar aoqun jacket, pleated mamian skirt with a gold woven hem band, optional long bijia vest"],
      ["qing", "清朝服饰", "Qing dynasty", "Qing dynasty Manchu dress: long straight changyi robe with wide contrast trim, frog buttons, embroidered flowers, flower-pot platform shoes"],
      ["republic", "民国服饰", "Republic era", "Republic of China era (1920s–1940s): fitted silk qipao with mandarin collar and frog buttons, or a short jacket with a black skirt, pearls, T-strap heels"]
    ]
  },
  {
    key: "ethnic", zh: "民族与传统服饰", en: "Ethnic & traditional dress",
    children: [
      ["miao", "苗族服饰", "Miao", "Miao dress: richly embroidered jacket and pleated skirt, layered silver neck rings and silver headdress, indigo and red"],
      ["tibetan", "藏族服饰", "Tibetan", "Tibetan dress: long wrapped chuba robe, colourful striped apron, coral and turquoise jewellery, felt boots"],
      ["mongolian", "蒙古族服饰", "Mongolian", "Mongolian deel robe with high collar and side fastening, silk sash, embroidered trim, riding boots"],
      ["dai", "傣族服饰", "Dai", "Dai dress: fitted short top with a long slim tube skirt, silver belt, soft tropical colours"],
      ["kimono", "和服", "Kimono", "Japanese kimono with a wide obi sash, obiage and obijime, tabi socks and zori sandals"],
      ["hanbok", "韩服", "Hanbok", "Korean hanbok: short jeogori jacket with a goreum ribbon and a full high-waisted chima skirt, pastel silk"],
      ["ao-dai", "越南奥黛", "Áo dài", "Vietnamese áo dài: long fitted silk tunic with side slits over wide trousers"],
      ["sari", "印度纱丽", "Sari", "Indian sari: long draped silk sari with the pallu over one shoulder, fitted choli blouse, gold border, bangles"]
    ]
  },
  {
    key: "western", zh: "西式复古", en: "Western vintage",
    children: [
      ["medieval", "中世纪", "Medieval", "medieval European gown: long-sleeved kirtle with laced bodice, floor-length skirt, cloak, belt with a pouch"],
      ["rococo", "洛可可", "Rococo", "18th-century rococo court gown with panniers, lace sleeves, ribbons and floral silk, pastel colours"],
      ["regency", "摄政时期", "Regency", "Regency empire-waist gown: high waist, short puffed sleeves, light muslin, long gloves, spencer jacket"],
      ["victorian", "维多利亚", "Victorian", "Victorian dress: high-neck blouse, fitted bodice, bustle skirt, buttoned boots, lace and dark velvet"],
      ["1920s", "1920 年代", "1920s", "1920s flapper dress: drop waist, beaded fringe, cloche hat or headband, Mary Jane heels, pearls"],
      ["1950s", "1950 年代", "1950s", "1950s vintage: fitted bodice with a full circle skirt and petticoat, polka dots or gingham, kitten heels"]
    ]
  },
  {
    key: "professional", zh: "职业服装", en: "Professional uniforms",
    children: [
      ["office", "职业白领", "Office", "business attire: tailored blazer with a pencil skirt or trousers, silk shirt, classic pumps, structured handbag"],
      ["doctor", "医生", "Doctor", "doctor: long white coat over smart clothes, stethoscope, blank ID badge, comfortable flat shoes"],
      ["nurse", "护士", "Nurse", "nurse: modest professional scrubs or nurse dress, comfortable white shoes, fob watch"],
      ["flight-attendant", "空乘", "Flight attendant", "flight attendant: fitted uniform jacket and skirt, silk scarf, small hat, low pumps; no real airline logos"],
      ["pilot", "飞行员", "Pilot", "airline pilot: navy uniform jacket with gold sleeve stripes, white shirt, tie, pilot cap; no real airline logos"],
      ["police", "警察", "Police", "generic police-style uniform: dark blue shirt and trousers, duty belt, cap; no real agency insignia or badge text"],
      ["firefighter", "消防员", "Firefighter", "firefighter turnout gear: jacket and trousers with reflective stripes, helmet, gloves, boots"],
      ["chef", "厨师", "Chef", "chef: white double-breasted chef jacket, apron, toque, checked trousers, kitchen clogs"],
      ["barista", "咖啡师", "Barista", "barista: casual shirt with rolled sleeves, canvas apron, jeans, sneakers"],
      ["engineer", "工程师", "Engineer", "site engineer: high-visibility vest over a work shirt, cargo trousers, hard hat, safety boots"],
      ["scientist", "科研人员", "Scientist", "lab scientist: white lab coat, safety goggles, gloves, smart casual clothes underneath"],
      ["teacher", "教师", "Teacher", "teacher: knit cardigan or blazer, blouse, midi skirt or chinos, low heels"],
      ["astronaut", "宇航员", "Astronaut", "astronaut: white space suit with helmet and life-support backpack, patches without text"],
      ["concierge", "酒店礼宾", "Hotel concierge", "hotel concierge: tailored vest or jacket, scarf or tie, blank name badge, polished shoes"]
    ]
  },
  {
    key: "formal", zh: "礼服", en: "Formal wear",
    children: [
      ["party", "派对", "Party", "party outfit: sequinned or satin mini dress, statement earrings, clutch, heeled sandals"],
      ["evening-gown", "晚礼服", "Evening gown", "floor-length evening gown in satin or chiffon, elegant draping, sleek heels, minimal jewellery"],
      ["cocktail", "小礼服", "Cocktail dress", "knee-length cocktail dress with a structured silhouette, pumps, clutch"],
      ["wedding", "婚纱", "Wedding dress", "white wedding gown: lace bodice, full tulle skirt, long veil, satin heels"],
      ["chinese-wedding", "中式婚服", "Chinese wedding attire", "Chinese wedding attire: red xiuhe outfit with gold phoenix and peony embroidery, red embroidered shoes"],
      ["tuxedo", "女士礼服西装", "Women's tuxedo", "women's tuxedo: black satin-lapel jacket, tailored trousers, white shirt, bow tie, pointed heels"]
    ]
  },
  {
    key: "sports", zh: "运动户外", en: "Sports & outdoor",
    children: [
      ["yoga", "瑜伽", "Yoga", "yoga wear: fitted long-sleeved top and high-waisted leggings, grip socks"],
      ["running", "跑步", "Running", "running gear: lightweight jacket or tank top, running shorts or leggings, running shoes, cap"],
      ["tennis", "网球", "Tennis", "tennis outfit: polo or tank top with a pleated tennis skirt, visor, white tennis shoes"],
      ["golf", "高尔夫", "Golf", "golf outfit: polo shirt, pleated skort or slim trousers, cap, golf shoes, glove"],
      ["ski", "滑雪", "Skiing", "ski outfit: insulated ski jacket and trousers, goggles, helmet, gloves, ski boots"],
      ["hiking", "户外徒步", "Hiking", "hiking outfit: technical shell jacket, fleece, trekking trousers, hiking boots, backpack"]
    ]
  },
  {
    key: "stage", zh: "舞台表演", en: "Stage & performance",
    children: [
      ["ballet", "芭蕾", "Ballet", "ballet costume: leotard with a romantic tutu or chiffon skirt, tights, pointe shoes"],
      ["latin", "拉丁舞", "Latin dance", "Latin dance dress with fringe or ruffles, dance heels"],
      ["chinese-dance", "中国古典舞", "Chinese classical dance", "Chinese classical dance costume: long flowing water sleeves, layered chiffon skirt, silk sash"],
      ["peking-opera", "京剧戏服", "Peking opera", "Peking opera costume for a qingyi or huadan role: embroidered robe with water sleeves, ornate headdress with pompoms and pearls"],
      ["idol", "偶像打歌服", "Idol stage outfit", "K-pop idol stage outfit: coordinated cropped jacket, pleated skirt or shorts, boots, glitter details"]
    ]
  },
  {
    key: "fantasy", zh: "幻想角色", en: "Fantasy & cosplay",
    children: [
      ["xianxia", "仙侠", "Xianxia", "xianxia fantasy hanfu: ethereal layered white and pale blue silk robes, flowing ribbons, jade hair ornaments"],
      ["wuxia", "武侠", "Wuxia", "wuxia martial artist: fitted practical robe, arm guards, sash belt, cloak, sword at the hip, boots"],
      ["knight", "骑士铠甲", "Knight", "fantasy knight: polished plate armour over a tabard, cape, gauntlets, armoured boots"],
      ["elf", "精灵", "Elf", "fantasy elf: leaf-green layered tunic dress, leather bracers, cloak, circlet"],
      ["witch", "魔女", "Witch", "witch: long dark dress with a cape, pointed hat, boots, small potion pouch"],
      ["cyberpunk", "赛博朋克", "Cyberpunk", "cyberpunk techwear: jacket with neon accents, cargo trousers or shorts, platform boots, visor glasses"],
      ["steampunk", "蒸汽朋克", "Steampunk", "steampunk: corset vest with brass buckles, high-low skirt, goggles, gloves, lace-up boots"]
    ]
  },
  {
    key: "style", zh: "风格穿搭", en: "Style",
    children: [
      ["french", "法式优雅", "French chic", "French chic: striped Breton top, high-waisted trousers or midi skirt, trench coat, ballet flats, beret"],
      ["minimal", "极简", "Minimalist", "minimalist: clean-cut neutral pieces, oversized shirt, straight trousers, simple leather shoes"],
      ["street", "街头潮流", "Streetwear", "streetwear: oversized hoodie or plain tee, cargo trousers, chunky sneakers, cap, crossbody bag"],
      ["y2k", "Y2K 千禧风", "Y2K", "Y2K: low-rise flared jeans or a mini skirt, baby tee, platform sneakers, small shoulder bag"],
      ["gothic", "暗黑哥特", "Gothic", "gothic: black lace and velvet dress, corset belt, platform boots, silver jewellery"],
      ["boho", "波西米亚", "Bohemian", "bohemian: flowing floral maxi dress, fringe bag, layered jewellery, sandals, wide-brim hat"],
      ["mori", "森系", "Mori girl", "mori girl: loose layered linen dress, knitted cardigan, earthy tones, flat shoes"],
      ["sexy", "性感风格", "Sexy", "bold body-conscious fashion: fitted mini dress, sheer tights, high heels", S]
    ]
  },
  {
    key: "intimate", zh: "内衣与睡衣", en: "Intimates & sleepwear",
    children: [
      ["lingerie", "内衣", "Lingerie", "lingerie set", S],
      ["sleepwear", "睡衣", "Sleepwear", "modest sleepwear: satin pyjama shirt and trousers or a long nightgown, robe, slippers"]
    ]
  },
  {
    key: "swim", zh: "泳装与度假", en: "Swim & resort",
    children: [
      ["swimwear", "泳装", "Swimwear", "swimsuit", S],
      ["resort", "度假沙滩", "Resort wear", "resort wear: linen cover-up shirt, flowing maxi skirt or sundress, straw hat, sandals, beach bag"]
    ]
  }
];

// Where the imported outfit categories sit in the tree.
export const UPSTREAM_OUTFIT_SERIES = {
  spring: "daily", summer: "daily", autumn: "daily", winter: "daily",
  party: "formal", lingerie: "intimate", swimwear: "swim", sexy: "style"
};

export function seedCategories(db, now = Date.now()) {
  const insert = db.prepare(`INSERT INTO asset_categories (type, parent_id, key, name_zh, name_en, hint, rating,
    gen_enabled, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [type, tree] of [["pose", POSE_TREE], ["outfit", OUTFIT_TREE]]) {
    tree.forEach((major, i) => {
      const parent = insert.run(type, null, major.key, major.zh, major.en, "", "general", 1, (i + 1) * 10, now, now)
        .lastInsertRowid;
      major.children.forEach(([key, zh, en, hint, rating = "general"], j) => {
        // Suggestive categories start closed to generation; admins can open them.
        insert.run(type, parent, key, zh, en, hint, rating, rating === "general" ? 1 : 0, (j + 1) * 10, now, now);
      });
    });
  }
}
