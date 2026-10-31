import { h, cicon } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toastError, lightbox } from "../../core/ui.js";
import { dateTime } from "../../core/format.js";
import { pageHead, listView, table, statusPill, drawer, kv, section } from "../kit.js";

// 婚纱相册: every couple's shoot, for support and refunds. Read-only; the
// photos themselves are in 生成记录 like any other generation.

const STATUS = { shooting: ["拍摄中", "tape"], attention: ["需要处理", "pin"], done: ["已完成", "mat"] };
const ITEM_TEXT = { queued: "排队中", running: "拍摄中", succeeded: "已完成", failed: "失败", cancelled: "已退回" };

async function openShoot(id) {
  let shoot;
  try { shoot = (await api.get(`/api/admin/wedding/shoots/${id}`)).shoot; } catch (err) { toastError(err); return; }
  const ready = shoot.items.filter((it) => it.image && it.status !== "cancelled");
  drawer(shoot.title || `${shoot.package.name}套系`, h("div.stack",
    kv([
      ["相册", shoot.id],
      ["套系", `${shoot.package.name} · ${shoot.looks.length} 套造型 · ${shoot.photos} 张${shoot.extraPerLook ? `（每套加拍 ${shoot.extraPerLook}）` : ""}`],
      ["状态", `${STATUS[shoot.status][0]} · 完成 ${shoot.progress.done} · 进行中 ${shoot.progress.active} · 失败 ${shoot.progress.failed} · 已退回 ${shoot.progress.cancelled}`],
      ["点数", `支付 ${shoot.cost}，退回 ${shoot.refunded}`],
      ["免费重拍", `剩 ${shoot.retakesLeft} 次`],
      ["上传照片", `新娘 ${shoot.uploads.bride.length} 张 · 新郎 ${shoot.uploads.groom.length} 张`],
      ["创建时间", dateTime(shoot.createdAt)]
    ]),
    section("造型", null, h("div.stack", shoot.looks.map((look) => h("p.small",
      h("strong", `造型 ${look.index + 1} · ${look.scene.name}`), "  ",
      h("span.muted", [look.bride.name, look.groom.name, look.styling.hair, look.styling.headpiece, look.styling.makeup].join(" / ")))))),
    section(`照片 · ${shoot.items.length}`, null,
      h("div.a-gen-images", shoot.items.map((it) => it.image
        ? h("button", { type: "button", title: `${it.shot.name} · ${ITEM_TEXT[it.status] || it.status}`,
          onclick: () => lightbox(ready.map((x) => ({ src: x.image.url, alt: x.shot.name })), Math.max(0, ready.indexOf(it))) },
          h("img", { src: it.image.thumb, alt: it.shot.name, loading: "lazy" }))
        : h("div.a-wd-slot", { title: it.errorMessage || "" }, h("strong.small", it.shot.name), h("span.small.muted", ITEM_TEXT[it.status] || it.status))))),
    h("p.small.muted", "相册属于用户，后台只读。每张照片的提示词、渠道和错误详情在「生成记录」里查看。")), { width: 820 });
}

export async function render() {
  const view = listView({
    size: 30,
    load: (q) => api.get("/api/admin/wedding/shoots", q),
    render: (items) => table([
      { label: "", render: (s) => (s.cover ? h("img.a-thumb", { src: s.cover, alt: "" }) : h("span.a-thumb.is-empty")), width: "56px" },
      { label: "相册", render: (s) => h("button.link", { type: "button", onclick: () => openShoot(s.id) }, s.title || `${s.packageName}套系`) },
      { label: "用户", render: (s) => s.userEmail },
      { label: "套系", render: (s) => s.packageName },
      { label: "进度", render: (s) => {
        const status = s.active ? "shooting" : s.failed ? "attention" : "done";
        return [statusPill(...STATUS[status]), h("span.small.muted.num", ` ${s.done}/${s.photos}`)];
      } },
      { label: "点数", render: (s) => (s.refunded ? `${s.cost}（退 ${s.refunded}）` : s.cost), className: "right num" },
      { label: "免费重拍", render: (s) => s.retakesLeft, className: "right num" },
      { label: "时间", render: (s) => dateTime(s.createdAt), className: "num" }
    ], items, { empty: "还没有用户拍婚纱照" })
  });
  return h("div", pageHead("婚纱相册", "所有用户的婚纱照拍摄。点开相册查看造型、照片和点数。", [
    h("a.btn", { href: "/admin/wedding-scenes" }, cicon("camera", "pink"), "婚纱场景")
  ]), view.node);
}
