import { h, replace } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy } from "../../core/ui.js";
import { pageHead, section, form } from "../kit.js";

const FIELDS = [
  ["intro", "开头（有参考图时）", "提示词第一行。"],
  ["textOnlyIntro", "开头（纯文字生成时）", ""],
  ["pose", "姿势参考说明", "{n} 会替换成图片序号。参考图按 姿势、服装、人物 的顺序发送。"],
  ["poseDuo", "双人姿势参考说明", ""],
  ["outfit", "服装参考说明", "素材库服装还会自动附上英文关键词。"],
  ["person", "人物参考说明", ""],
  ["personSafety", "人物照片附加约束", "有人物照片时追加在人物说明之后，建议保留。"],
  ["style", "风格行", "{value} 替换为所选风格预设的描述。"],
  ["scene", "场景行", "{value} 替换为所选场景预设的描述。"],
  ["user", "用户补充描述", "{value} 替换为用户输入的文字。"],
  ["outro", "结尾", "约束输出为单张成片。"]
];

export async function render() {
  const root = h("div");
  let data;
  try { data = await api.get("/api/admin/settings/prompt"); } catch (err) { toastError(err); return root; }
  const defaults = data.defaults;
  let f = form(FIELDS.map(([key, label, help]) => ({ key, label, help, type: "textarea", rows: 3, wide: true })), data.value);
  const box = h("div", f.node);
  const preview = h("pre.prompt-preview");
  const updatePreview = () => {
    const v = f.value;
    const fill = (t, vals) => String(t || "").replace(/\{(\w+)\}/g, (a, k) => (k in vals ? vals[k] : a));
    preview.textContent = [v.intro, fill(v.pose, { n: 1 }), `${fill(v.outfit, { n: 2 })} Key pieces: ivory frill knit, denim mini skirt.`,
      fill(v.person, { n: 3 }), v.personSafety, fill(v.style, { value: "photorealistic fashion photography" }),
      fill(v.scene, { value: "a lively city street with soft bokeh" }), fill(v.user, { value: "黄昏的天台，逆光，微笑看向镜头" }), v.outro]
      .filter(Boolean).join("\n");
  };
  box.addEventListener("input", updatePreview);
  updatePreview();
  replace(root,
    pageHead("提示词模板", "发给模型的提示词由下面几段拼成。英文提示词对 gpt-image-2 的约束更精确，用户的中文描述会原样附在后面。",
      [h("button.btn", { type: "button", onclick: () => { f = form(FIELDS.map(([key, label, help]) => ({ key, label, help, type: "textarea", rows: 3, wide: true })), defaults); replace(box, f.node); updatePreview(); toast("已恢复默认，保存后生效"); } }, "恢复默认"),
        h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
          try { await api.put("/api/admin/settings/prompt", { value: f.value }); toast("已保存", { type: "success" }); } catch (err) { toastError(err); }
        }) }, "保存")]),
    h("div.prompt-layout", section(null, null, box), section("拼接示例", "姿势 + 服装 + 人物照片 + 风格 + 场景 + 补充描述时，实际发送的内容：", preview)));
  return root;
}
