import { db, tx } from "../db.js";
import * as settings from "./settings.js";
import * as credits from "./credits.js";
import { sendMail, mailEnabled } from "./mailer.js";
import { hashPassword, verifyPassword, randomToken, randomId, sha256 } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, unauthorized, notFound } from "../lib/errors.js";
import { enforce } from "../lib/rate-limit.js";
import { DAY, localDate, startOfLocalDay } from "../lib/time.js";
import { log } from "../lib/logger.js";

export const SESSION_COOKIE = "pw_sid";

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    role: row.role,
    status: row.status,
    credits: row.credits,
    emailVerified: !!row.email_verified,
    inviteCode: row.invite_code,
    createdAt: row.created_at,
    checkedInToday: row.last_checkin === localDate()
  };
}

function uniqueInviteCode() {
  for (let i = 0; i < 10; i++) {
    const code = randomId(8).toUpperCase();
    if (!db.prepare("SELECT 1 FROM users WHERE invite_code = ?").get(code)) return code;
  }
  throw new Error("Could not allocate an invite code");
}

export async function createUser({ email, password, nickname = "", role = "user", referredBy = null,
  ip = null, emailVerified = false }) {
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
    throw conflict("EMAIL_TAKEN", "该邮箱已注册，请直接登录");
  }
  const passwordHash = await hashPassword(password);
  const now = Date.now();
  const info = db.prepare(`INSERT INTO users (email, password_hash, nickname, role, invite_code, referred_by,
    email_verified, signup_ip, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(email, passwordHash, nickname || email.split("@")[0].slice(0, 20), role, uniqueInviteCode(),
      referredBy, emailVerified ? 1 : 0, ip, now, now);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
}

// Signup and invite rewards are granted once, after email verification when
// verification is required. This keeps throwaway accounts from farming credits.
export const grantSignupRewards = tx((userId) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user || user.bonus_granted) return;
  const auth = settings.get("auth");
  db.prepare("UPDATE users SET bonus_granted = 1 WHERE id = ?").run(userId);
  if (auth.signupBonus > 0) credits.adjust(userId, auth.signupBonus, "signup", { note: "新用户注册赠送" });
  if (user.referred_by) {
    if (auth.inviteeBonus > 0) {
      credits.adjust(userId, auth.inviteeBonus, "invite", { refType: "inviter", refId: user.referred_by, note: "受邀注册奖励" });
    }
    const inviter = db.prepare("SELECT id, status FROM users WHERE id = ?").get(user.referred_by);
    if (inviter && inviter.status === "active" && auth.inviteReward > 0) {
      credits.adjust(inviter.id, auth.inviteReward, "invite", { refType: "invitee", refId: userId, note: "邀请好友注册" });
    }
  }
});

export async function register({ email, password, inviteCode, ip }) {
  const auth = settings.get("auth");
  if (!auth.registrationOpen) throw forbidden("当前暂停开放注册", "REGISTRATION_CLOSED");
  enforce(`register:${ip}`, 10, 60 * 60 * 1000, "注册尝试过于频繁，请一小时后再试");
  const today = db.prepare("SELECT COUNT(*) AS n FROM users WHERE signup_ip = ? AND created_at >= ?")
    .get(ip, startOfLocalDay()).n;
  if (today >= auth.maxRegistrationsPerIpPerDay) {
    throw forbidden("该网络今日注册账号数已达上限", "REGISTRATION_LIMIT");
  }
  let referredBy = null;
  const code = String(inviteCode || "").trim().toUpperCase();
  if (code) {
    const inviter = db.prepare("SELECT id FROM users WHERE invite_code = ? AND status = 'active'").get(code);
    if (!inviter) throw badRequest("INVALID_INVITE", "邀请码无效");
    referredBy = inviter.id;
  } else if (auth.inviteRequired) {
    throw badRequest("INVITE_REQUIRED", "当前仅支持邀请注册，请填写邀请码");
  }
  const needsVerification = auth.requireEmailVerification && mailEnabled();
  const user = await createUser({ email, password, referredBy, ip });
  if (needsVerification) {
    await sendVerification(user).catch((err) => log.warn(`Verification mail to ${email} failed`, err));
  } else {
    grantSignupRewards(user.id);
  }
  return db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
}

export async function authenticate({ email, password, ip }) {
  enforce(`login:ip:${ip}`, 20, 10 * 60 * 1000, "登录尝试过于频繁，请 10 分钟后再试");
  enforce(`login:email:${email}`, 8, 10 * 60 * 1000, "该账号登录尝试过于频繁，请 10 分钟后再试");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  // Always run a hash check so response timing doesn't reveal which emails exist.
  const ok = await verifyPassword(password, user?.password_hash ||
    "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==");
  if (!user || !ok) throw unauthorized("邮箱或密码不正确");
  if (user.status === "banned") throw forbidden("该账号已被停用，如有疑问请联系客服", "ACCOUNT_BANNED");
  db.prepare("UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?").run(Date.now(), ip, user.id);
  return user;
}

export function createSession(userId, { ip, userAgent }) {
  const token = randomToken(32);
  const now = Date.now();
  const days = settings.get("auth").sessionDays;
  db.prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(sha256(token), userId, now, now + days * DAY, now, ip,
    String(userAgent || "").slice(0, 300));
  return { token, maxAge: days * DAY };
}

// Resolve a session cookie to its user. Sessions slide: activity in the second
// half of the lifetime extends them.
export function sessionUser(token) {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const row = db.prepare(`SELECT s.id AS session_id, s.expires_at, s.last_seen_at, u.* FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(id);
  const now = Date.now();
  if (!row || row.expires_at <= now) return null;
  if (now - row.last_seen_at > 5 * 60 * 1000) {
    const days = settings.get("auth").sessionDays;
    const remaining = row.expires_at - now;
    const expires = remaining < (days * DAY) / 2 ? now + days * DAY : row.expires_at;
    db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").run(now, expires, id);
  }
  return row;
}

export function destroySession(token) {
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
}

export function destroyUserSessions(userId, exceptSessionId = null) {
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?").run(userId, exceptSessionId);
}

function createUserToken(userId, kind, ttlMs) {
  const token = randomToken(32);
  const now = Date.now();
  db.prepare("UPDATE user_tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL")
    .run(now, userId, kind);
  db.prepare("INSERT INTO user_tokens (id, user_id, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(sha256(token), userId, kind, now + ttlMs, now);
  return token;
}

function consumeUserToken(token, kind) {
  const row = db.prepare("SELECT * FROM user_tokens WHERE id = ? AND kind = ?").get(sha256(String(token || "")), kind);
  if (!row || row.used_at || row.expires_at <= Date.now()) {
    throw badRequest("INVALID_TOKEN", "链接无效或已过期，请重新申请");
  }
  db.prepare("UPDATE user_tokens SET used_at = ? WHERE id = ?").run(Date.now(), row.id);
  return row.user_id;
}

function baseUrl() {
  return settings.get("site").publicBaseUrl || "";
}

export async function sendVerification(user) {
  if (!mailEnabled()) throw badRequest("MAIL_DISABLED", "邮件服务未配置");
  enforce(`verify-mail:${user.id}`, 3, 60 * 60 * 1000, "验证邮件发送过于频繁，请稍后再试");
  const token = createUserToken(user.id, "verify_email", 2 * DAY);
  await sendMail({
    to: user.email,
    subject: "验证你的邮箱",
    text: "感谢注册。点击下方按钮完成邮箱验证，验证后注册赠送的点数会自动到账。链接 48 小时内有效。",
    actionUrl: `${baseUrl()}/api/auth/verify-email?token=${encodeURIComponent(token)}`,
    actionLabel: "验证邮箱"
  });
}

export function verifyEmail(token) {
  const userId = consumeUserToken(token, "verify_email");
  db.prepare("UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?").run(Date.now(), userId);
  grantSignupRewards(userId);
  return userId;
}

export async function requestPasswordReset(email, ip) {
  enforce(`forgot:${ip}`, 5, 60 * 60 * 1000, "操作过于频繁，请一小时后再试");
  if (!mailEnabled()) throw badRequest("MAIL_DISABLED", "暂不支持自助找回密码，请联系客服处理");
  const user = db.prepare("SELECT * FROM users WHERE email = ? AND status = 'active'").get(email);
  // Same response whether or not the email exists.
  if (!user) return;
  const token = createUserToken(user.id, "reset_password", 30 * 60 * 1000);
  await sendMail({
    to: user.email,
    subject: "重置密码",
    text: "我们收到了重置密码的请求。点击下方按钮设置新密码，链接 30 分钟内有效。如果不是你本人操作，请忽略这封邮件。",
    actionUrl: `${baseUrl()}/reset-password?token=${encodeURIComponent(token)}`,
    actionLabel: "设置新密码"
  });
}

export async function resetPassword(token, password) {
  const userId = consumeUserToken(token, "reset_password");
  const hash = await hashPassword(password);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hash, Date.now(), userId);
  destroyUserSessions(userId);
  return userId;
}

export async function changePassword(user, current, next, sessionId) {
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id);
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    throw badRequest("WRONG_PASSWORD", "当前密码不正确");
  }
  const hash = await hashPassword(next);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hash, Date.now(), user.id);
  destroyUserSessions(user.id, sessionId);
}

export const checkin = tx((userId) => {
  const amount = settings.get("auth").checkinCredits;
  if (amount <= 0) throw badRequest("CHECKIN_DISABLED", "签到活动未开启");
  const today = localDate();
  const result = db.prepare("UPDATE users SET last_checkin = ? WHERE id = ? AND (last_checkin IS NULL OR last_checkin <> ?)")
    .run(today, userId, today);
  if (result.changes === 0) throw conflict("ALREADY_CHECKED_IN", "今天已经签到过了");
  return { amount, balance: credits.adjust(userId, amount, "checkin", { note: `${today} 签到` }) };
});

export function inviteStats(userId) {
  const row = db.prepare(`SELECT COUNT(*) AS invited, COALESCE(SUM(bonus_granted), 0) AS rewarded
    FROM users WHERE referred_by = ?`).get(userId);
  const earned = db.prepare(`SELECT COALESCE(SUM(delta), 0) AS n FROM credit_ledger
    WHERE user_id = ? AND kind = 'invite' AND ref_type = 'invitee'`).get(userId).n;
  return { invited: row.invited, rewarded: row.rewarded, earned };
}

export async function ensureBootstrapAdmin(email, password) {
  if (!email || !password) return null;
  const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) {
    if (existing.role !== "admin") {
      db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?").run(Date.now(), existing.id);
    }
    return existing;
  }
  const user = await createUser({ email: email.toLowerCase(), password, nickname: "管理员", role: "admin", emailVerified: true });
  db.prepare("UPDATE users SET bonus_granted = 1 WHERE id = ?").run(user.id);
  log.info(`Bootstrap admin created: ${user.email}`);
  return user;
}

export function getUser(id) {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!row) throw notFound("用户不存在");
  return row;
}
