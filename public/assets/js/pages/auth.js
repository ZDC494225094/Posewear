import { h, tile } from "../core/dom.js";
import { api } from "../core/api.js";
import { store, draft } from "../core/store.js";
import { toast, toastError, busy } from "../core/ui.js";
import { navigate } from "../core/nav.js";

// Only same-site paths: "/x" but not "//host" or "/\host" (browsers treat "\" as "/").
const safeNext = (value) => (typeof value === "string" && /^\/(?![/\\])\S*$/.test(value) ? value : "/studio");

function shell(title, sub, form, foot, extra) {
  return h("div.auth.ambient",
    h("div.auth-card.glass",
      h("img.auth-logo", { src: "/assets/img/favicon.svg", alt: "", width: 52, height: 52 }),
      h("h1", title),
      sub ? h("p.auth-sub", sub) : null,
      extra || null,
      form,
      foot ? h("div.auth-foot", foot) : null));
}

function input(name, { label, help, ...props }) {
  return h("label.field", h("span", label), h("input.input", { name, ...props }), help ? h("small", help) : null);
}

export async function render(ctx) {
  const path = ctx.url.pathname;
  const cfg = store.config;
  const next = safeNext(ctx.query.next);

  if ((path === "/login" || path === "/register") && store.user) {
    navigate(next, { replace: true });
    return h("div");
  }

  if (path === "/login") {
    const form = h("form.stack", { onsubmit: async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.currentTarget));
      await busy(e.currentTarget.querySelector("button[type=submit]"), async () => {
        try {
          const res = await api.post("/api/auth/login", data);
          store.setUser(res.user);
          navigate(next, { replace: true });
        } catch (err) { toastError(err); }
      });
    } },
    input("email", { label: "邮箱", type: "email", autocomplete: "email", required: true, autofocus: true }),
    input("password", { label: "密码", type: "password", autocomplete: "current-password", required: true }),
    h("button.btn.btn-primary.btn-lg.btn-block", { type: "submit" }, "登录"));
    return shell("登录", "欢迎回来，继续你的创作。", form, [
      h("a.link", { href: `/register${ctx.query.next ? `?next=${encodeURIComponent(next)}` : ""}` }, "没有账号？免费注册"),
      cfg.auth.passwordReset ? h("a.link", { href: "/forgot-password" }, "忘记密码") : h("span.faint", "忘记密码请联系客服")
    ]);
  }

  if (path === "/register") {
    if (!cfg.auth.registrationOpen) {
      return shell("暂停注册", "当前暂不开放新用户注册，请稍后再来。", null, h("a.link", { href: "/login" }, "已有账号，去登录"));
    }
    const agree = h("input", { type: "checkbox", name: "agree", required: true });
    const form = h("form.stack", { onsubmit: async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.currentTarget));
      await busy(e.currentTarget.querySelector("button[type=submit]"), async () => {
        try {
          const res = await api.post("/api/auth/register", { ...data, agree: agree.checked });
          draft.write({});
          store.setUser(res.user);
          if (res.verificationSent) toast("验证邮件已发送，验证邮箱后赠送点数到账", { type: "success", timeout: 7000 });
          else if (res.user.credits) toast(`注册成功，已送你 ${res.user.credits} 点`, { type: "success" });
          navigate(next, { replace: true });
        } catch (err) { toastError(err); }
      });
    } },
    input("email", { label: "邮箱", type: "email", autocomplete: "email", required: true, autofocus: true }),
    input("password", { label: "密码", type: "password", autocomplete: "new-password", minLength: 8, required: true, help: "至少 8 位" }),
    input("inviteCode", { label: cfg.auth.inviteRequired ? "邀请码" : "邀请码（选填）", value: ctx.query.ref || "", autocomplete: "off",
      required: cfg.auth.inviteRequired, maxLength: 16 }),
    h("label.check", agree, h("span", "我已阅读并同意", h("a.link", { href: "/legal/terms", target: "_blank" }, "《用户协议》"), "、",
      h("a.link", { href: "/legal/privacy", target: "_blank" }, "《隐私政策》"), "和", h("a.link", { href: "/legal/content-policy", target: "_blank" }, "《内容规范》"))),
    h("button.btn.btn-primary.btn-lg.btn-block", { type: "submit" }, cfg.auth.signupBonus ? `注册并领取 ${cfg.auth.signupBonus} 点` : "注册"));
    const perks = h("ul.auth-perks",
      cfg.auth.signupBonus ? h("li", tile("gift", "pink"), `注册送 ${cfg.auth.signupBonus} 点`) : null,
      h("li", tile("redo", "teal"), "生成失败自动退点"),
      h("li", tile("lock", "blue"), "人物照片到期自动删除"));
    return shell("注册", null, form,
      h("a.link", { href: `/login${ctx.query.next ? `?next=${encodeURIComponent(next)}` : ""}` }, "已有账号，去登录"), perks);
  }

  if (path === "/forgot-password") {
    const form = h("form.stack", { onsubmit: async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.currentTarget));
      await busy(e.currentTarget.querySelector("button[type=submit]"), async () => {
        try {
          await api.post("/api/auth/forgot", data);
          toast("如果该邮箱已注册，你会在几分钟内收到重置邮件", { type: "success", timeout: 7000 });
        } catch (err) { toastError(err); }
      });
    } },
    input("email", { label: "注册邮箱", type: "email", autocomplete: "email", required: true, autofocus: true }),
    h("button.btn.btn-primary.btn-lg.btn-block", { type: "submit" }, "发送重置邮件"));
    return shell("找回密码", "输入注册邮箱，我们会发送一封重置密码的邮件。", form, h("a.link", { href: "/login" }, "返回登录"));
  }

  // /reset-password?token=...
  const form = h("form.stack", { onsubmit: async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    await busy(e.currentTarget.querySelector("button[type=submit]"), async () => {
      try {
        await api.post("/api/auth/reset", { token: ctx.query.token, password: data.password });
        toast("密码已重置，请用新密码登录", { type: "success" });
        navigate("/login", { replace: true });
      } catch (err) { toastError(err); }
    });
  } },
  input("password", { label: "新密码", type: "password", autocomplete: "new-password", minLength: 8, required: true, autofocus: true, help: "至少 8 位" }),
  h("button.btn.btn-primary.btn-lg.btn-block", { type: "submit" }, "设置新密码"));
  return shell("设置新密码", null, form, h("a.link", { href: "/login" }, "返回登录"));
}
