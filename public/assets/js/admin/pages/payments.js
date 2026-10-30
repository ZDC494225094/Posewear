import { h } from "../../core/dom.js";
import { pageHead, settingsForm, section } from "../kit.js";

export async function render() {
  const origin = location.origin;
  const form = await settingsForm("payment", [
    { key: "orderExpireMinutes", label: "订单支付时限（分钟）", type: "number", min: 5, max: 1440 },
    { heading: "支付宝" },
    { key: "alipay.enabled", label: "启用支付宝", type: "switch" },
    { key: "alipay.mode", label: "支付方式", type: "select", options: [["page", "电脑网站支付（跳转收银台）"], ["qr", "当面付（页面显示二维码）"]] },
    { key: "alipay.sandbox", label: "沙箱环境", type: "switch", help: "使用支付宝开放平台沙箱应用联调时开启。" },
    { key: "alipay.appId", label: "AppID" },
    { key: "alipay.privateKey", label: "应用私钥", type: "secret", help: "支付宝密钥工具生成的应用私钥（PKCS#1 或 PKCS#8，带不带 BEGIN 头都可以）。" },
    { key: "alipay.alipayPublicKey", label: "支付宝公钥", type: "textarea", rows: 3, wide: true, help: "开放平台“接口加签方式”里的支付宝公钥，用于验证异步通知。" },
    { heading: "微信支付（Native 扫码，APIv3）" },
    { key: "wechat.enabled", label: "启用微信支付", type: "switch" },
    { key: "wechat.mchId", label: "商户号 mchid" },
    { key: "wechat.appId", label: "AppID", help: "与商户号绑定的公众号或小程序 AppID。" },
    { key: "wechat.serialNo", label: "商户 API 证书序列号" },
    { key: "wechat.privateKey", label: "商户 API 证书私钥", type: "secret", help: "apiclient_key.pem 的内容。" },
    { key: "wechat.apiV3Key", label: "APIv3 密钥", type: "secret", help: "32 位，用于解密支付通知。" },
    { key: "wechat.platformPublicKeyId", label: "微信支付公钥 ID", placeholder: "PUB_KEY_ID_...", help: "商户平台“API安全”中的微信支付公钥 ID。" },
    { key: "wechat.platformPublicKey", label: "微信支付公钥", type: "textarea", rows: 4, wide: true, help: "pub_key.pem 的内容，用于验证支付通知的签名。" },
    { heading: "测试" },
    { key: "mock.enabled", label: "启用模拟支付", type: "switch", help: "任何用户都能免费“支付”，只用于联调。正式运营前务必关闭。" }
  ], { title: "支付配置", description: "密钥加密保存，后台只显示首尾几位。" });
  return h("div",
    pageHead("支付", "支付宝和微信支付的商户参数。用户下单后在支付页扫码或跳转付款，到账由支付通知确认，也可以在订单页人工确认。"),
    section("回调地址", "在支付平台后台无需单独配置，下单时会自动带上。请确保「站点与注册」里的公网地址正确且可从外网访问（HTTPS）。",
      h("dl.kv.a-kv",
        h("dt", "支付宝通知"), h("dd", h("code", `${origin}/api/pay/notify/alipay`)),
        h("dt", "微信支付通知"), h("dd", h("code", `${origin}/api/pay/notify/wechat`)))),
    form,
    section("上线前检查", null, h("ul.a-notes.small",
      h("li", "先用支付宝沙箱或小额真实订单完整走一遍：下单、付款、通知到账、点数增加。"),
      h("li", "支付通知丢失时，用户在支付页点“我已支付”会主动查询订单；后台「订单」页也可以人工确认到账。"),
      h("li", "同一订单的重复通知只会入账一次。"))));
}
