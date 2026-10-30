#!/usr/bin/env node
// Create an admin account, or promote an existing one and reset its password.
//   npm run admin:create -- --email you@example.com --password 'a-long-password'
import { migrate, db } from "../server/db.js";
import { createUser } from "../server/services/auth.js";
import { hashPassword } from "../server/lib/crypto.js";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const email = String(option("email") || "").trim().toLowerCase();
const password = String(option("password") || "");

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
  console.error("Usage: npm run admin:create -- --email you@example.com --password <at least 8 characters>");
  process.exit(1);
}

migrate();
const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
if (existing) {
  db.prepare("UPDATE users SET role = 'admin', status = 'active', password_hash = ?, updated_at = ? WHERE id = ?")
    .run(await hashPassword(password), Date.now(), existing.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
  console.log(`Promoted ${email} to admin and reset its password.`);
} else {
  const user = await createUser({ email, password, nickname: "管理员", role: "admin", emailVerified: true });
  db.prepare("UPDATE users SET bonus_granted = 1 WHERE id = ?").run(user.id);
  console.log(`Created admin ${email}.`);
}
