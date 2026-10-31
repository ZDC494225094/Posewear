import { h, replace, cicon } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy } from "../../core/ui.js";
import { selectMenu } from "../../core/select.js";
import { pageHead, section, form } from "../kit.js";

// Settings group "wedding": prices, the packages, the shot list and the
// prompt sections the wedding photos are built from.

const BASIC = [
  { key: "enabled", label: "开放婚纱影楼", type: "switch", help: "关闭后前台入口隐藏，已拍的相册仍可查看和下载。" },
  { key: "extraPhotoPrice", label: "每套造型加拍", type: "number", min: 0, suffix: "点 / 张" },
  { key: "retakePrice", label: "付费重拍", type: "number", min: 0, suffix: "点 / 张", help: "套系的免费重拍次数用完后收取。" },
  { key: "freeRetries", label: "失败免费重试", type: "number", min: 0, max: 10, suffix: "次 / 张", help: "生成失败时的免费重试次数，不占套系的重拍次数。" },
  { key: "retentionDays", label: "上传照片保留", type: "number", min: 1, max: 365, suffix: "天", help: "两位上传的照片到期自动删除，相册有操作时顺延。" },
  { key: "quality", label: "画质", type: "select", options: [["low", "low（草稿）"], ["medium", "medium（标准）"], ["high", "high（精细）"]] },
  { key: "tier", label: "清晰度", type: "select", options: [["standard", "标准"], ["hd", "2K"]], help: "2K 时竖幅约 1536×2304。" }
];

const PROMPT = [
  ["intro", "开头", ""],
  ["bride", "新娘照片说明", "{images} 替换为图片序号，如 Images 1-3 show。"],
  ["groom", "新郎照片说明", ""],
  ["virtualCouple", "虚拟新人（示例照片）", "后台生成示例照片时代替两位的照片。"],
  ["brideOutfit", "新娘礼服图", "{n} 图片序号，{name} 礼服名称。"],
  ["groomOutfit", "新郎礼服图", ""],
  ["outfitText", "礼服文字（没有礼服图时）", "{role} bride / groom，{value} 礼服描述。"],
  ["scene", "场景底图", ""],
  ["sceneText", "场景文字（没有底图时）", "{value} 场景描述。"],
  ["styling", "发型妆容行", ""],
  ["shot", "镜头行", "{value} 镜头的英文描述。"],
  ["light", "光线行", "{value} 场景的光线与色调。"],
  ["camera", "相机", ""],
  ["realism", "真实感", "减轻 AI 感，建议保留。"],
  ["safety", "安全约束", "建议保留。"],
  ["outro", "结尾", ""]
];

const PEOPLE = [["couple", "两人"], ["bride", "新娘"], ["groom", "新郎"]];
const RATIOS = ["2:3", "3:4", "1:1", "4:3", "3:2", "9:16", "16:9"].map((r) => [r, r]);

const input = (value, onInput, attrs = {}) => h("input.input", { value: value ?? "", ...attrs,
  oninput: (e) => onInput(attrs.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value) });

export async function render() {
  const root = h("div");
  let data;
  try { data = await api.get("/api/admin/settings/wedding"); } catch (err) { toastError(err); return root; }
  let value = structuredClone(data.value);
  let basic, prompt;
  const basicBox = h("div");
  const pkgBox = h("div");
  const shotBox = h("div");
  const promptBox = h("div");

  function drawBasic() { basic = form(BASIC, value); replace(basicBox, basic.node); }
  function drawPrompt() {
    prompt = form(PROMPT.map(([key, label, help]) => ({ key, label, help, type: "textarea", rows: 3, wide: true })), value.prompt);
    replace(promptBox, prompt.node);
  }

  function drawPackages() {
    const shotCount = value.shots.length;
    const rows = value.packages.map((p, i) => {
      const set = (key) => (v) => { p[key] = v; if (["looks", "shots", "price"].includes(key)) drawPackagesSummary(); };
      const summary = h("span.small.muted.num");
      const drawSummary = () => {
        const n = (Number(p.looks) || 0) * Math.min(Number(p.shots) || 0, shotCount);
        summary.textContent = n ? `${n} 张 · 每张约 ${Math.round((Number(p.price) || 0) / n)} 点` : "—";
      };
      p.__summary = drawSummary;
      drawSummary();
      return h("tr",
        h("td", input(p.key, set("key"), { maxLength: 24, "aria-label": "标识", placeholder: "classic" })),
        h("td", input(p.name, set("name"), { maxLength: 12, "aria-label": "名称" })),
        h("td", input(p.looks, set("looks"), { type: "number", min: 1, max: 8, "aria-label": "造型数" })),
        h("td", input(p.shots, set("shots"), { type: "number", min: 1, max: 12, "aria-label": "每套张数" })),
        h("td", input(p.retakes, set("retakes"), { type: "number", min: 0, max: 100, "aria-label": "免费重拍" })),
        h("td", input(p.price, set("price"), { type: "number", min: 0, "aria-label": "价格" })),
        h("td", input(p.badge, set("badge"), { maxLength: 8, "aria-label": "角标", placeholder: "最受欢迎" })),
        h("td", input(p.description, set("description"), { maxLength: 60, "aria-label": "介绍" })),
        h("td", summary),
        h("td", h("button.btn.btn-sm.btn-ghost", { type: "button", disabled: value.packages.length <= 1, "aria-label": "删除套系",
          onclick: () => { value.packages.splice(i, 1); drawPackages(); } }, "删除")));
    });
    replace(pkgBox,
      h("div.table-wrap", h("table.data-table.a-table.a-wd-edit",
        h("thead", h("tr", ["标识", "名称", "造型数", "每套张数", "免费重拍", "价格（点）", "角标", "介绍", "合计", ""].map((t) => h("th", t)))),
        h("tbody", rows))),
      h("div.a-form-actions", { style: { justifyContent: "flex-start" } },
        h("button.btn.btn-sm", { type: "button", disabled: value.packages.length >= 8, onclick: () => {
          value.packages.push({ key: `pkg${value.packages.length + 1}`, name: "新套系", looks: 2, shots: 6, retakes: 3, price: 599, badge: "", description: "" });
          drawPackages();
        } }, cicon("plus", "pink", 15), "添加套系")));
  }
  function drawPackagesSummary() { value.packages.forEach((p) => p.__summary?.()); }

  function drawShots() {
    const rows = value.shots.map((s, i) => h("tr",
      h("td.num", i + 1),
      h("td", input(s.key, (v) => { s.key = v; }, { maxLength: 24, "aria-label": "标识" })),
      h("td", input(s.name, (v) => { s.name = v; }, { maxLength: 10, "aria-label": "名称" })),
      h("td", selectMenu({ label: "人物", value: s.people, options: PEOPLE, onChange: (v) => { s.people = v; } }).node),
      h("td", selectMenu({ label: "比例", value: s.ratio, options: RATIOS, onChange: (v) => { s.ratio = v; } }).node),
      h("td", h("textarea.textarea", { rows: 2, maxLength: 400, value: s.prompt, "aria-label": "英文描述", oninput: (e) => { s.prompt = e.target.value; } })),
      h("td", h("div.a-row-actions",
        h("button.btn.btn-sm.btn-ghost", { type: "button", disabled: i === 0, "aria-label": "上移", onclick: () => { [value.shots[i - 1], value.shots[i]] = [value.shots[i], value.shots[i - 1]]; drawShots(); } }, "↑"),
        h("button.btn.btn-sm.btn-ghost", { type: "button", disabled: value.shots.length <= 1, "aria-label": "删除镜头", onclick: () => { value.shots.splice(i, 1); drawShots(); drawPackages(); } }, "删除")))));
    replace(shotBox,
      h("div.table-wrap", h("table.data-table.a-table.a-wd-edit.is-shots",
        h("thead", h("tr", ["", "标识", "名称", "人物", "比例", "英文描述", ""].map((t) => h("th", t)))),
        h("tbody", rows))),
      h("div.a-form-actions", { style: { justifyContent: "flex-start" } },
        h("button.btn.btn-sm", { type: "button", disabled: value.shots.length >= 20, onclick: () => {
          value.shots.push({ key: `shot${value.shots.length + 1}`, name: "新镜头", people: "couple", ratio: "2:3", prompt: "" });
          drawShots(); drawPackages();
        } }, cicon("plus", "pink", 15), "添加镜头")));
  }

  function collect() {
    const strip = (list) => list.map(({ __summary, ...rest }) => rest);
    return { ...value, ...basic.value, packages: strip(value.packages), shots: value.shots.map((s) => ({ ...s })), prompt: prompt.value };
  }

  async function save(button) {
    await busy(button, async () => {
      try {
        const saved = (await api.put("/api/admin/settings/wedding", { value: collect() })).value;
        value = structuredClone(saved);
        drawAll();
        toast("已保存", { type: "success" });
      } catch (err) { toastError(err); }
    });
  }

  function drawAll() { drawBasic(); drawPackages(); drawShots(); drawPrompt(); }
  drawAll();

  const saveButton = () => h("button.btn.btn-primary", { type: "button", onclick: (e) => save(e.currentTarget) }, "保存");
  replace(root,
    pageHead("婚纱套系与提示词", "套系按张数计价：每套造型拍镜头列表里的前 N 张。修改只影响之后的新拍摄。", [
      h("a.btn", { href: "/admin/wedding-scenes" }, cicon("camera", "pink"), "婚纱场景"),
      saveButton()
    ]),
    section("基础", null, basicBox),
    section("套系", "每套张数超过镜头数时按镜头数计算。角标会显示在套系卡片上，留空则不显示。", pkgBox),
    section("镜头", "每套造型按顺序取前 N 个镜头。两人镜头会同时用到两位的照片，独照只用一位的。", shotBox),
    section("提示词", "成片提示词由下面几段按顺序拼成，没有内容的段落自动省略。", promptBox,
      h("div.a-form-actions",
        h("button.btn", { type: "button", onclick: () => { value.prompt = structuredClone(data.defaults.prompt); drawPrompt(); toast("已恢复默认提示词，保存后生效"); } }, "恢复默认提示词"),
        saveButton())));
  return root;
}
