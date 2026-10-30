import express from "express";
import { db } from "../db.js";
import * as auth from "../services/auth.js";
import * as credits from "../services/credits.js";
import * as billing from "../services/billing.js";
import * as settings from "../services/settings.js";
import * as library from "../services/library.js";
import { requireUser } from "../middleware.js";
import * as v from "../lib/validate.js";

export const router = express.Router();

// Not behind requireUser: the client calls this on load to learn whether a
// session exists, and a 401 would be noise.
router.get("/me", (req, res) => {
  res.json({ user: req.user && req.user.status === "active" ? auth.publicUser(req.user) : null });
});

router.patch("/me", requireUser, (req, res) => {
  const nickname = v.str(req.body?.nickname, "nickname", { min: 1, max: 20, message: "昵称长度需为 1–20 个字符" });
  db.prepare("UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?").run(nickname, Date.now(), req.user.id);
  library.invalidate(); // shared assets show the owner's nickname
  res.json({ user: auth.publicUser(auth.getUser(req.user.id)) });
});

router.post("/me/password", requireUser, async (req, res) => {
  const current = v.str(req.body?.current, "current", { min: 1, max: 128, trim: false, message: "请输入当前密码" });
  const next = v.password(req.body?.next, "next");
  await auth.changePassword(req.user, current, next, req.sessionId);
  res.json({ ok: true });
});

router.get("/me/ledger", requireUser, (req, res) => {
  res.json(credits.listLedger(req.user.id, v.page(req.query)));
});

router.get("/me/orders", requireUser, (req, res) => {
  res.json(billing.listOrders(req.user.id, v.page(req.query)));
});

router.post("/me/checkin", requireUser, (req, res) => {
  res.json(auth.checkin(req.user.id));
});

router.get("/me/invite", requireUser, (req, res) => {
  const a = settings.get("auth");
  res.json({
    code: req.user.invite_code,
    reward: a.inviteReward,
    inviteeBonus: a.inviteeBonus,
    ...auth.inviteStats(req.user.id)
  });
});
