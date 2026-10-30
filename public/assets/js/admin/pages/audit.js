import { h } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { dateTime } from "../../core/format.js";
import { pageHead, listView, table } from "../kit.js";

const ACTIONS = {
  "admin.login": "管理员登录", "settings.update": "修改设置", "channel.create": "添加渠道", "channel.update": "修改渠道",
  "channel.delete": "删除渠道", "user.update": "修改用户", "user.credits": "调整点数", "user.password_reset": "重置密码",
  "generation.update": "修改作品", "generation.delete": "删除作品", "order.mark_paid": "人工确认到账", "order.refund": "标记退款",
  "package.create": "新建套餐", "package.update": "修改套餐", "package.delete": "删除套餐", "redeem.create": "生成兑换码",
  "redeem.status": "修改兑换码", "redeem.export": "导出兑换码", "asset.update": "修改素材", "asset.bulk": "批量修改素材",
  "asset.create": "上传素材", "asset.delete": "删除素材", "report.resolve": "处理举报", "credits.grant_all": "全员发放点数"
};

export async function render() {
  const view = listView({
    size: 50,
    filters: [{ key: "action", type: "select", label: "操作类型", options: [["", "全部操作"],
      ["settings", "设置"], ["channel", "渠道"], ["user", "用户"], ["order", "订单"], ["redeem", "兑换码"], ["asset", "素材"], ["generation", "作品"], ["admin", "登录"]] }],
    load: (q) => api.get("/api/admin/audit", q),
    render: (items) => table([
      { label: "时间", render: (r) => dateTime(r.created_at), className: "num" },
      { label: "管理员", render: (r) => r.actor_email || `#${r.actor_id ?? "—"}` },
      { label: "操作", render: (r) => ACTIONS[r.action] || r.action },
      { label: "对象", render: (r) => (r.target_type ? `${r.target_type} ${r.target_id ?? ""}` : "—"), className: "num small" },
      { label: "详情", render: (r) => (r.detail ? h("code.a-detail", JSON.stringify(r.detail).slice(0, 200)) : "") },
      { label: "IP", render: (r) => r.ip || "", className: "num small" }
    ], items, { empty: "暂无记录" })
  });
  return h("div", pageHead("操作日志", "后台的每次修改都会记录在这里，便于追溯。"), view.node);
}
