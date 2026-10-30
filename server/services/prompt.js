import * as settings from "./settings.js";

const fill = (template, values) =>
  String(template || "").replace(/\{(\w+)\}/g, (all, key) => (key in values ? String(values[key]) : all));

// Assemble the model prompt from the admin-editable template lines. The image
// numbers here must match the order images are sent in: pose, outfit, person.
export function buildPrompt({ pose, outfit, outfitKeywords = "", person = false, style, scene, userText = "" }) {
  const p = settings.get("prompt");
  const lines = [];
  let n = 0;
  const hasImages = !!(pose || outfit || person);
  lines.push(hasImages ? p.intro : p.textOnlyIntro);
  if (pose) lines.push(fill(pose.people > 1 ? p.poseDuo : p.pose, { n: ++n }));
  if (outfit) {
    let line = fill(p.outfit, { n: ++n });
    if (outfitKeywords) line += ` Key pieces: ${outfitKeywords}.`;
    lines.push(line);
  }
  if (person) {
    lines.push(fill(p.person, { n: ++n }));
    if (p.personSafety) lines.push(p.personSafety);
  }
  if (style?.prompt) lines.push(fill(p.style, { value: style.prompt }));
  if (scene?.prompt) lines.push(fill(p.scene, { value: scene.prompt }));
  if (userText) lines.push(fill(p.user, { value: userText }));
  lines.push(p.outro);
  return lines.map((line) => line.trim()).filter(Boolean).join("\n");
}

// Banned-word screen for user text. CJK terms match as substrings; Latin terms
// match whole words so "sex" does not block "sexy" or "Sussex".
export function findBannedWord(text) {
  const value = String(text || "");
  if (!value) return null;
  const lower = value.toLowerCase();
  for (const word of settings.get("safety").bannedWords) {
    const w = word.toLowerCase();
    if (/^[\x00-\x7f]+$/.test(w)) {
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(lower)) return word;
    } else if (lower.includes(w)) return word;
  }
  return null;
}
