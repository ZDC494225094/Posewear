import express from "express";
import * as auth from "../services/auth.js";
import * as settings from "../services/settings.js";
import { requireUser, secureCookie } from "../middleware.js";
import { audit } from "../services/audit.js";
import { badRequest } from "../lib/errors.js";
import * as v from "../lib/validate.js";

export const router = express.Router();

function setSessionCookie(req, res, userId) {
  const { token, maxAge } = auth.createSession(userId, { ip: req.ip, userAgent: req.get("user-agent") });
  res.cookie(auth.SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secureCookie(req), path: "/", maxAge });
}

router.post("/auth/register", async (req, res) => {
  const email = v.email(req.body?.email);
  const password = v.password(req.body?.password);
  if (!req.body?.agree) throw badRequest("AGREEMENT_REQUIRED", "请先阅读并同意用户协议和隐私政策");
  const user = await auth.register({ email, password, inviteCode: req.body?.inviteCode, ip: req.ip });
  setSessionCookie(req, res, user.id);
  res.status(201).json({
    user: auth.publicUser(user),
    verificationSent: !user.email_verified && settings.get("auth").requireEmailVerification
  });
});

router.post("/auth/login", async (req, res) => {
  const email = v.email(req.body?.email);
  const password = v.str(req.body?.password, "password", { min: 1, max: 128, trim: false, message: "请输入密码" });
  const user = await auth.authenticate({ email, password, ip: req.ip });
  setSessionCookie(req, res, user.id);
  if (user.role === "admin") audit({ user, ip: req.ip }, "admin.login", "user", user.id);
  res.json({ user: auth.publicUser(user) });
});

router.post("/auth/logout", (req, res) => {
  auth.destroySession(req.cookies?.[auth.SESSION_COOKIE]);
  res.clearCookie(auth.SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

router.post("/auth/forgot", async (req, res) => {
  const email = v.email(req.body?.email);
  await auth.requestPasswordReset(email, req.ip);
  res.json({ ok: true });
});

router.post("/auth/reset", async (req, res) => {
  const token = v.str(req.body?.token, "token", { min: 10, max: 200 });
  const password = v.password(req.body?.password);
  await auth.resetPassword(token, password);
  res.json({ ok: true });
});

// Link target in the verification email.
router.get("/auth/verify-email", (req, res) => {
  try {
    auth.verifyEmail(String(req.query.token || ""));
    res.redirect(303, "/account?verified=1");
  } catch {
    res.redirect(303, "/account?verified=0");
  }
});

router.post("/auth/resend-verification", requireUser, async (req, res) => {
  if (req.user.email_verified) return res.json({ ok: true, already: true });
  await auth.sendVerification(req.user);
  res.json({ ok: true });
});
