import nodemailer from "nodemailer";
import * as settings from "./settings.js";
import { log } from "../lib/logger.js";

let cached = { key: "", transport: null };

function transport() {
  const mail = settings.get("mail");
  const key = JSON.stringify([mail.host, mail.port, mail.secure, mail.user, mail.pass]);
  if (cached.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: mail.host, port: mail.port, secure: mail.secure,
        auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined,
        connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000
      })
    };
  }
  return cached.transport;
}

export function mailEnabled() {
  const mail = settings.get("mail");
  return mail.enabled && !!mail.host;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

export async function sendMail({ to, subject, text, actionUrl, actionLabel }) {
  if (!mailEnabled()) throw new Error("MAIL_DISABLED");
  const mail = settings.get("mail");
  const site = settings.get("site").name;
  const html = `<div style="font-family:system-ui,'PingFang SC','Microsoft YaHei',sans-serif;max-width:520px;margin:24px auto;color:#14261f;line-height:1.7">
    <p style="font-size:18px;font-weight:600;margin:0 0 16px">${escapeHtml(site)}</p>
    ${text.split("\n").map((line) => `<p style="margin:0 0 10px">${escapeHtml(line)}</p>`).join("")}
    ${actionUrl ? `<p style="margin:24px 0"><a href="${escapeHtml(actionUrl)}" style="background:#2b6450;color:#fff;padding:10px 20px;border-radius:999px;text-decoration:none;display:inline-block">${escapeHtml(actionLabel || "打开链接")}</a></p>
    <p style="font-size:12px;color:#5b6a63;word-break:break-all">如果按钮无法点击，请复制链接到浏览器打开：${escapeHtml(actionUrl)}</p>` : ""}
  </div>`;
  const info = await transport().sendMail({
    from: mail.from || mail.user, to, subject: `${subject} - ${site}`,
    text: actionUrl ? `${text}\n\n${actionUrl}` : text, html
  });
  log.info(`Mail sent to ${to}: ${subject} (${info.messageId || "no id"})`);
  return info;
}
