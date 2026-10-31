import { h, cicon } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { dateTime } from "../../core/format.js";
import { pageHead, settingsForm, section, listView, table, statusPill } from "../kit.js";

// Settings group "library": the free share for users who haven't recharged,
// previews and downloads, and the record of who tripped the scraping limits.
export async function render() {
  const form = await settingsForm("library", [
    { heading: "免费浏览" },
    { key: "lockEnabled", label: "未充值用户限制浏览", type: "switch", help: "关闭后所有人都能浏览和使用全部素材。" },
    { key: "freeLimit", label: "每类免费浏览", type: "number", min: 0, suffix: "个",
      help: "姿势按组计算。免费的是素材库里排在最前面的素材，可以在「素材库」里改排序。其余的只显示模糊的缩略图和名称。" },
    { key: "unlockMinYuan", label: "解锁需要累计充值", type: "number", min: 0, suffix: "元",
      help: "0 表示充值任意金额就解锁。也可以在「用户」里为某个用户单独解锁或锁定。" },
    { key: "unlockByRedeem", label: "使用兑换码也算充值", type: "switch" },
    { heading: "防盗图" },
    { key: "previewWatermark", label: "大图加淡水印", type: "switch",
      help: "用户查看的素材大图叠加站点名和用户 ID。缩略图、首页示例和发给模型的图片不加。" },
    { key: "dailyPreviews", label: "每人每天最多查看大图", type: "number", min: 50, suffix: "张" },
    { key: "originalDownload", label: "素材原图下载", type: "select", options: [["login", "登录后可下载"], ["public", "所有人可下载"], ["disabled", "关闭下载"]],
      help: "请按素材授权范围设置。每人每小时最多 60 张，每天最多 200 张。" }
  ], { title: null });

  const alerts = listView({
    size: 30,
    load: (q) => api.get("/api/admin/access-alerts", q),
    render: (items) => table([
      { label: "最近一次", render: (a) => dateTime(a.lastAt), className: "num" },
      { label: "用户", render: (a) => (a.userId
        ? h("a.link", { href: `/admin/users?q=${encodeURIComponent(a.email || String(a.userId))}` }, a.email || `#${a.userId}`)
        : h("span.muted", "未登录访客")) },
      { label: "IP", render: (a) => h("span.num", a.ip || "—") },
      { label: "拦下的请求", render: (a) => statusPill(a.kindText, a.kind === "preview" || a.kind === "original" ? "pin" : "tape") },
      { label: "触发", render: (a) => `${a.hits} 次`, className: "right num" },
      { label: "首次", render: (a) => dateTime(a.firstAt), className: "num" },
      { label: "", render: (a) => (a.userStatus === "banned" ? statusPill("已停用", "pin") : "") }
    ], items, { empty: "还没有人触发访问限制" })
  });

  return h("div",
    pageHead("素材浏览与防盗图", "未充值用户能看多少素材、大图和原图怎么给，以及谁在批量抓取素材。", [
      h("a.btn", { href: "/admin/assets" }, cicon("hanger", "teal"), "素材库")
    ]),
    form,
    section("访问风控记录", "所有素材图片都要用接口签发的链接才能打开：链接一两个小时后失效，只对签发给的账号或浏览器有效，不能被其他网站引用。短时间内翻看大量素材列表或图片的账号和 IP 会被暂时拦下，并记在这里。同一个账号反复出现时，可以在「用户」里停用。",
      alerts.node));
}
