// Default prompt templates and the studio's style, scene and camera presets
// (settings.js uses them as defaults). Written for photographs that read as
// real: name the medium first, say what replaces each reference's look, and
// describe light sources and real texture rather than "the AI look", following
// OpenAI's and Google's image prompting guides. One text suits both gpt-image
// and Nano Banana. PREVIOUS keeps the 1.7 texts they replaced: migration 14
// updates stored copies that still match.

export const PROMPT = {
  intro: "Create one photorealistic photograph from the reference images described below, as if taken on a real fashion shoot: real adults with individual, natural-looking faces, photographed in real light. If a visual style other than photography is named further down, use that style instead of a photograph.",
  textOnlyIntro: "Create one photorealistic photograph, as if taken on a real fashion shoot; any people in it are real adults with individual, natural-looking faces, photographed in real light. If a visual style other than photography is named further down, use that style instead of a photograph.",
  pose: "Image {n} is the POSE reference: a line drawing of a figure (an artist's mannequin or a sketched character), used only as a guide to the pose. Match its body pose, limb positions, weight distribution, head direction, camera angle and framing; if the whole figure is shown, keep the full body in frame, feet included. The figure becomes the subject, a person with natural human anatomy and proportions, skin, hair and relaxed, natural hands. Take only the pose from the drawing; clothing, hair and face come from the other references and instructions. Its lines, a mannequin's blank egg-shaped head and ball joints, and the white background do not appear.",
  poseDuo: "Image {n} is the POSE reference for two people: a line drawing of two figures (artist's mannequins or sketched characters), used only as a guide to the poses. Match both figures' poses, their positions and distance relative to each other, where each one looks, the camera angle and framing. Each figure becomes a person with natural human anatomy and proportions, skin, hair and natural hands where they touch. Take only the poses from the drawing; clothing, hair and faces come from the other references and instructions. Its lines, blank egg-shaped heads, ball joints and white background do not appear.",
  poseDepth: "Image {n} is a DEPTH MAP of the same pose: lighter areas are nearer the camera, darker areas farther away. Use it for the body's three-dimensional placement, how far each limb comes forward or goes back, and the foreshortening. Do not copy its grey look.",
  outfit: "Image {n} is the OUTFIT reference: dress the subject in exactly this outfit, keeping its silhouette, cut, colours, fabrics, patterns, prints and accessories. Show it as it looks when worn in this pose: fitted to the body, hanging with gravity, creasing where the body bends and pulling slightly where it is under tension, with the fabric's real texture (weave, knit, sheen) under the scene's light. If the reference is a drawing and the result is a photograph, make the outfit from real fabrics. Ignore how the outfit is displayed in the reference (mannequin, hanger, flat lay, or a person wearing it, whose face, hair and pose are not used), along with its lighting and background.",
  person: "Image {n} is the PERSON reference: the subject is this exact person. Keep their identity unchanged: face shape, eyes, eyebrows, nose, lips, skin tone and real skin texture, freckles or moles, hairline, hairstyle and hair colour, apparent age and, where visible, body build, so that they are instantly recognisable. Use this image only for who the person is; take the clothing, pose, lighting and background from the other references and instructions. Ensure that this person's facial features remain completely unchanged.",
  personSafety: "Depict the person as an adult, fully clothed in the outfit, in a natural and non-sexualised way.",
  virtualPersonSafety: "Depict the person as an adult.",
  hair: "Image {n} is a HAIR reference ({name}): give the subject this hairstyle, hair colour or hair accessory, or these eyes, in place of their own, keeping the shape and colour shown; in a photograph they are real hair and real eyes. Take nothing else from this image: not its drawing style, the face, the clothing or the background.",
  sceneImage: "Image {n} is the SCENE reference: show the subject on location in this place, keeping its setting, architecture or landscape, time of day and mood. Light the subject with the scene's own light, matching its direction, softness and colour temperature, so the subject's shadows fall the same way as the scene's and a contact shadow sits where the feet meet the ground. Match the scene's perspective, camera height and scale so the subject stands in the space rather than in front of it, and give the background the depth of field the lens and distance would produce. Frame the shot to suit the output size and leave out any people shown in it.",
  item: "Image {n} is an ITEM reference ({name}): the subject wears or holds this item naturally, keeping its shape, colours, materials and details at a believable real-world size. Hands grip it, or straps rest on the body, as they would in life, and it is lit like everything else in the scene. Ignore how it is displayed in the reference.",
  style: "Visual style: {value}.",
  scene: "Setting and background: {value}.",
  camera: "Camera and lens: {value}.",
  realism: "It looks like an unstaged moment that someone actually photographed, not an overly enhanced or cinematic movie-poster image. Skin keeps its natural texture and slight variations in tone, with pores and fine facial hair resolved only as far as the camera distance allows. Faces keep their natural asymmetry, with a few flyaway hairs; clothes show real creases and fabric texture. Light comes from a clear source and shadows fall consistently; colours, saturation and white balance are true to life; sharpness and faint noise are those of a real camera file. Skin is left as the camera recorded it, with only light, natural retouching: no glamorisation and no beauty filter.",
  user: "Additional instructions from the user: {value}",
  outro: "Output a single finished image, not a collage, comparison sheet or reference board. Do not add text, captions, labels, frames or watermarks.",
  // Used on its own for 超分 (upscaling a finished work), not with the lines above.
  upscale: "Image 1 is a finished image. Recreate it at a higher resolution as a faithful, high-fidelity upscale. Keep the composition, framing, people, faces, expressions, pose, hands, clothing, colours, lighting and background exactly as they are. Only add the fine detail a higher-resolution camera would capture (skin texture, individual hair strands, fabric weave), keeping the original grain, noise and natural edge definition. Do not sharpen, smooth or add contrast, do not add, remove, move or restyle anything, and do not add text, borders or watermarks."
};

// photo: false marks illustration styles, which skip 真实感增强.
export const STYLES = [
  { id: "photo", label: "写实摄影", photo: true, prompt: "a photorealistic fashion photograph for a clothing brand's lookbook, with natural, unforced posing and true-to-life colour, lit by the light of the setting" },
  { id: "editorial", label: "时尚大片", photo: true, prompt: "a fashion magazine editorial photograph with confident, deliberate posing, one strong light source casting defined shadows, considered composition and light retouching that keeps real skin texture" },
  { id: "street", label: "街拍", photo: true, prompt: "a candid street-style photograph, caught mid-moment as if by a photographer passing by, in natural daylight" },
  { id: "anime", label: "日系动漫", photo: false, prompt: "clean anime illustration, crisp line art, cel shading, vivid colours" },
  { id: "3d", label: "3D 角色", photo: false, prompt: "stylised 3D character render, soft global illumination, high detail" },
  { id: "watercolor", label: "水彩插画", photo: false, prompt: "delicate watercolour fashion illustration, visible paper texture" }
];

// Time of day, where the light comes from and a few ordinary details, so the
// model doesn't fill in a generic, too-perfect place.
export const SCENES = [
  { id: "studio", label: "纯色影棚", prompt: "a seamless light grey paper backdrop curving into the floor, lit by a large softbox to one side, with a soft shadow on the floor around the feet" },
  { id: "city", label: "城市街道", prompt: "a real city street in late-afternoon light, with shopfronts, worn pavement and kerb markings, a few parked bicycles and low sun from one side" },
  { id: "cafe", label: "咖啡馆", prompt: "a small neighbourhood cafe with wooden tables, cups and a menu, warm afternoon daylight from a large window on one side and dimmer warm lamps inside" },
  { id: "beach", label: "海边", prompt: "a real beach in late-afternoon sun, with low light from one side, uneven sand with footprints, gentle waves and a slightly hazy horizon" },
  { id: "garden", label: "花园", prompt: "a spring garden with flowering shrubs and a gravel path, in soft overcast daylight" },
  { id: "home", label: "居家", prompt: "a lived-in, bright living room with a sofa and a throw, a few books and plants, and daylight from a window on one side" }
];

// Camera and lens looks. Naming real gear and its side effects (grain,
// depth of field, flash falloff) makes images read as photographs.
export const CAMERAS = [
  { id: "phone", label: "手机直出", prompt: "shot on a recent smartphone's main camera, natural HDR, slightly wide perspective, fine sensor noise in the shadows, unedited" },
  { id: "35mm", label: "35mm 纪实", prompt: "35mm lens at f/2.8 on a full-frame camera, documentary framing, natural perspective, available light" },
  { id: "50mm", label: "50mm 标准", prompt: "50mm f/1.8 lens on a full-frame camera, true-to-eye perspective, gentle background blur" },
  { id: "85mm", label: "85mm 人像", prompt: "85mm portrait lens at f/2 on a full-frame camera, the subject in focus throughout, the background softly out of focus, mild perspective compression" },
  { id: "135mm", label: "135mm 长焦", prompt: "135mm f/2 telephoto lens, strong background compression, subject cleanly separated from the background" },
  { id: "24mm", label: "24mm 广角", prompt: "24mm wide-angle lens, environmental portrait that shows the surroundings, mild perspective stretch at the edges" },
  { id: "film", label: "胶片", prompt: "shot on 35mm colour film (Kodak Portra 400), fine natural grain, soft highlight roll-off, true film colours" },
  { id: "flash", label: "直闪", prompt: "on-camera direct flash, hard shadow just behind the subject, bright skin highlights, candid snapshot feel" },
  { id: "studio-strobe", label: "影棚闪光", prompt: "medium-format camera, one studio strobe in a large softbox at 45 degrees to one side with a white reflector opposite, soft shadows on the far side of the face and on the floor, fine natural detail" },
  // On-model product photos, as shot for online shops.
  { id: "catalog", label: "电商棚拍", prompt: "85mm lens at f/8 for an on-model e-commerce photo, the whole outfit sharp from collar to hem, a large softbox at 45 degrees with soft fill from the other side, neutral white balance, true-to-life fabric colours" }
];

export const PREVIOUS = {
  prompt: {
    intro: "Create one finished, coherent image from the reference images described below.",
    textOnlyIntro: "Create one finished, coherent image.",
    pose: "Image {n} is the POSE reference: a neutral line-art mannequin. Match its body pose, limb positions, head direction, camera angle and framing. Do not copy the line-art style or the mannequin's body proportions.",
    poseDuo: "Image {n} is the POSE reference for two people: neutral line-art mannequins. Match both figures' poses, their positions relative to each other, the camera angle and framing. Do not copy the line-art style.",
    outfit: "Image {n} is the OUTFIT reference: dress the subject in exactly this outfit, keeping its silhouette, colours, fabrics, patterns and accessories. Ignore how the outfit is displayed in the reference.",
    person: "Image {n} is the PERSON reference: keep this person's facial features, skin tone and hairstyle recognisable. Do not copy their clothing, pose or background.",
    sceneImage: "Image {n} is the SCENE reference: place the subject in this location, keeping its setting, architecture or landscape, lighting and mood. Frame the shot to suit the output size and leave out any people shown in it.",
    item: "Image {n} is an ITEM reference ({name}): the subject wears or holds this item naturally, keeping its shape, colours and materials. Ignore how it is displayed in the reference.",
    realism: "Make it look like a real, unretouched photograph: natural skin texture with pores and fine hair, slight asymmetry, real fabric creases, physically plausible light and shadows. Avoid the smooth, glossy, over-sharpened or over-saturated look of AI images.",
    upscale: "Image 1 is a finished image. Recreate it at a higher resolution as a faithful, high-fidelity upscale. Keep the composition, framing, people, faces, expressions, pose, hands, clothing, colours, lighting and background exactly as they are. Only add the fine detail a higher-resolution camera would capture: skin texture, individual hair strands, fabric weave, crisp edges. Do not add, remove, move or restyle anything, and do not add text, borders or watermarks."
  },
  styles: {
    photo: "photorealistic fashion photography, natural skin texture, soft studio lighting, 85mm lens",
    editorial: "high-end fashion magazine editorial, dramatic lighting, polished retouching",
    street: "candid street-style photography, natural daylight, shallow depth of field"
  },
  scenes: {
    studio: "seamless light grey studio backdrop",
    city: "a lively city street with soft bokeh",
    cafe: "a cosy cafe interior with warm window light",
    beach: "a sunny beach with gentle waves",
    garden: "a blooming garden in spring",
    home: "a bright, minimal living room"
  },
  cameras: {
    "85mm": "85mm f/1.4 portrait lens on a full-frame camera, shallow depth of field with smooth bokeh, flattering compression",
    "studio-strobe": "medium-format camera with studio strobes and a large softbox, crisp detail, soft controlled shadows"
  }
};
