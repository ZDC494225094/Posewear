import { h } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy } from "../../core/ui.js";
import { pageHead, settingsForm, section } from "../kit.js";

export async function render() {
  const site = await settingsForm("site", [
    { key: "name", label: "站点名称", help: "第一个空格前的部分显示为品牌字。" },
    { key: "tagline", label: "标语" },
    { key: "description", label: "站点介绍", type: "textarea", rows: 2, wide: true, help: "显示在首页，也用于搜索引擎描述。" },
    { key: "keywords", label: "SEO 关键词", wide: true },
    { key: "publicBaseUrl", label: "公网地址", placeholder: "https://your-domain.com", help: "支付回调和邮件链接使用此地址。" },
    { key: "supportContact", label: "客服联系方式", placeholder: "微信 / 邮箱 / 电话" },
    { key: "announcement", label: "顶部公告", wide: true, help: "留空则不显示。" },
    { key: "announcementLevel", label: "公告样式", type: "select", options: [["info", "普通"], ["warning", "醒目"]] },
    { key: "icp", label: "ICP 备案号", placeholder: "京ICP备XXXXXXXX号" },
    { key: "publicSecurityRecord", label: "公安备案号" },
    { key: "footerNote", label: "页脚附加说明", wide: true }
  ], { title: "站点信息" });

  const auth = await settingsForm("auth", [
    { key: "registrationOpen", label: "开放注册", type: "switch" },
    { key: "inviteRequired", label: "仅限邀请注册", type: "switch" },
    { key: "requireEmailVerification", label: "注册需验证邮箱", type: "switch", help: "需要先配置好邮件服务。开启后，注册赠送的点数在验证邮箱后发放。" },
    { key: "signupBonus", label: "注册赠送点数", type: "number", min: 0 },
    { key: "inviteReward", label: "邀请人奖励点数", type: "number", min: 0 },
    { key: "inviteeBonus", label: "被邀请人额外点数", type: "number", min: 0 },
    { key: "checkinCredits", label: "每日签到点数", type: "number", min: 0, help: "0 表示关闭签到。" },
    { key: "maxRegistrationsPerIpPerDay", label: "同一 IP 每日最多注册", type: "number", min: 1 },
    { key: "sessionDays", label: "登录有效期（天）", type: "number", min: 1, max: 365 }
  ], { title: "注册与奖励" });

  const library = await settingsForm("library", [
    { key: "originalDownload", label: "素材原图下载", type: "select", options: [["login", "登录后可下载"], ["public", "所有人可下载"], ["disabled", "关闭下载"]],
      help: "请按素材授权范围设置。" }
  ], { title: "素材下载" });

  const mail = await settingsForm("mail", [
    { key: "enabled", label: "启用邮件", type: "switch", help: "用于找回密码和邮箱验证。" },
    { key: "host", label: "SMTP 服务器", placeholder: "smtp.exmail.qq.com" },
    { key: "port", label: "端口", type: "number", min: 1, max: 65535 },
    { key: "secure", label: "使用 SSL/TLS", type: "switch", help: "465 端口一般开启，587 端口一般关闭（STARTTLS）。" },
    { key: "user", label: "账号" },
    { key: "pass", label: "密码 / 授权码", type: "secret" },
    { key: "from", label: "发件人", placeholder: "姿衣 <noreply@your-domain.com>" }
  ], { title: "邮件服务" });
  const testTo = h("input.input", { type: "email", placeholder: "收件邮箱（默认发给自己）" });
  const mailTest = section("发送测试邮件", null, h("div.copy-row", testTo,
    h("button.btn", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
      try { await api.post("/api/admin/settings/mail/test", { to: testTo.value || undefined }); toast("测试邮件已发送", { type: "success" }); }
      catch (err) { toastError(err); }
    }) }, "发送")));

  const legal = await settingsForm("legal", [
    { key: "terms", label: "用户服务协议", type: "textarea", rows: 12, wide: true },
    { key: "privacy", label: "隐私政策", type: "textarea", rows: 12, wide: true },
    { key: "contentPolicy", label: "内容规范", type: "textarea", rows: 10, wide: true }
  ], { title: "协议与政策", description: "支持简单 Markdown：# 标题、- 列表、**加粗**。默认文本为模板，请根据你的主体信息修改，并请专业人士审阅。" });

  return h("div", pageHead("站点与注册", "品牌信息、注册奖励、邮件服务和协议文本。"), site, auth, library, mail, mailTest, legal);
}
