import Database from "better-sqlite3";
import { config } from "./config.js";
import { seedCategories, OUTFIT_TREE, UPSTREAM_OUTFIT_SERIES } from "./services/taxonomy-seed.js";

export const db = new Database(config.dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.pragma("synchronous = NORMAL");

// Ordered, append-only migrations. PRAGMA user_version records how many ran.
const migrations = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    nickname TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
    credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
    email_verified INTEGER NOT NULL DEFAULT 0,
    invite_code TEXT NOT NULL UNIQUE,
    referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    bonus_granted INTEGER NOT NULL DEFAULT 0,
    signup_ip TEXT,
    last_login_at INTEGER,
    last_login_ip TEXT,
    last_checkin TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_users_created ON users(created_at);
  CREATE INDEX idx_users_referred ON users(referred_by);

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE INDEX idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE user_tokens (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('verify_email', 'reset_password')),
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_tokens_user ON user_tokens(user_id, kind);

  CREATE TABLE credit_ledger (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    kind TEXT NOT NULL,
    ref_type TEXT,
    ref_id TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_ledger_user ON credit_ledger(user_id, id DESC);
  CREATE INDEX idx_ledger_kind_time ON credit_ledger(kind, created_at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE channels (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('openai', 'mock')),
    base_url TEXT NOT NULL DEFAULT '',
    api_key_enc TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT 'gpt-image-2',
    options TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_ok_at INTEGER,
    last_error TEXT,
    last_error_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('pose', 'outfit')),
    group_key TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    series TEXT NOT NULL DEFAULT '',
    series_zh TEXT NOT NULL DEFAULT '',
    series_en TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    category_zh TEXT NOT NULL DEFAULT '',
    category_en TEXT NOT NULL DEFAULT '',
    category_ja TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    name_zh TEXT NOT NULL DEFAULT '',
    name_en TEXT NOT NULL DEFAULT '',
    angle TEXT NOT NULL DEFAULT '',
    angle_zh TEXT NOT NULL DEFAULT '',
    angle_en TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '',
    people INTEGER NOT NULL DEFAULT 1,
    root TEXT NOT NULL DEFAULT 'library' CHECK (root IN ('library', 'custom')),
    thumb_path TEXT NOT NULL,
    preview_path TEXT NOT NULL DEFAULT '',
    original_path TEXT NOT NULL,
    rating TEXT NOT NULL DEFAULT 'general' CHECK (rating IN ('general', 'suggestive', 'explicit')),
    enabled INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'upstream',
    use_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_assets_type ON assets(type, sort);
  CREATE INDEX idx_assets_group ON assets(group_key);

  CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('person', 'outfit')),
    path TEXT NOT NULL,
    mime TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    bytes INTEGER,
    consent_at INTEGER,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    deleted_at INTEGER
  );
  CREATE INDEX idx_uploads_user ON uploads(user_id, created_at DESC);
  CREATE INDEX idx_uploads_expires ON uploads(expires_at);

  CREATE TABLE generations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    mode TEXT NOT NULL CHECK (mode IN ('edit', 'generate')),
    pose_id TEXT,
    outfit_id TEXT,
    outfit_upload_id TEXT,
    person_upload_id TEXT,
    style TEXT NOT NULL DEFAULT '',
    scene TEXT NOT NULL DEFAULT '',
    prompt_user TEXT NOT NULL DEFAULT '',
    prompt_final TEXT NOT NULL DEFAULT '',
    ratio TEXT NOT NULL,
    tier TEXT NOT NULL,
    size TEXT NOT NULL,
    quality TEXT NOT NULL,
    n INTEGER NOT NULL,
    cost_credits INTEGER NOT NULL,
    refunded_credits INTEGER NOT NULL DEFAULT 0,
    channel_id INTEGER,
    model TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER,
    error_code TEXT,
    error_message TEXT,
    error_detail TEXT,
    usage TEXT,
    api_cost_usd REAL,
    is_public INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    featured INTEGER NOT NULL DEFAULT 0,
    approved INTEGER NOT NULL DEFAULT 0,
    consent_at INTEGER,
    client_ip TEXT,
    deleted_at INTEGER,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    published_at INTEGER
  );
  CREATE INDEX idx_gen_user ON generations(user_id, created_at DESC);
  CREATE INDEX idx_gen_status ON generations(status, created_at);
  CREATE INDEX idx_gen_public ON generations(is_public, hidden, published_at DESC);
  CREATE INDEX idx_gen_created ON generations(created_at);

  CREATE TABLE generation_images (
    id TEXT PRIMARY KEY,
    generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    path TEXT NOT NULL,
    thumb_path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    bytes INTEGER,
    format TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_genimg_gen ON generation_images(generation_id, idx);

  CREATE TABLE packages (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    credits INTEGER NOT NULL CHECK (credits > 0),
    bonus_credits INTEGER NOT NULL DEFAULT 0 CHECK (bonus_credits >= 0),
    price_cents INTEGER NOT NULL CHECK (price_cents > 0),
    badge TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    package_id INTEGER,
    title TEXT NOT NULL,
    credits INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CNY',
    provider TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'closed', 'refunded')),
    provider_trade_no TEXT,
    pay_data TEXT,
    paid_at INTEGER,
    expires_at INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);
  CREATE INDEX idx_orders_status ON orders(status, created_at);

  CREATE TABLE redeem_codes (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    credits INTEGER NOT NULL CHECK (credits > 0),
    batch TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'disabled')),
    expires_at INTEGER,
    used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    used_at INTEGER,
    created_by INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_redeem_batch ON redeem_codes(batch);

  CREATE TABLE reports (
    id INTEGER PRIMARY KEY,
    generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    handled_by INTEGER,
    handled_at INTEGER,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_reports_status ON reports(status, created_at DESC);

  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY,
    actor_id INTEGER,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_audit_time ON audit_logs(created_at DESC);
  `,

  // 2: asset ownership, licensing and review; the category tree; asset
  // generation jobs; paid use of shared assets; reference-image uploads.
  (conn) => {
    conn.exec(`
    ALTER TABLE assets ADD COLUMN owner_id INTEGER REFERENCES users(id);
    ALTER TABLE assets ADD COLUMN license TEXT NOT NULL DEFAULT 'commercial'
      CHECK (license IN ('commercial', 'noncommercial'));
    ALTER TABLE assets ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
      CHECK (visibility IN ('public', 'private'));
    ALTER TABLE assets ADD COLUMN review TEXT NOT NULL DEFAULT 'none'
      CHECK (review IN ('none', 'pending', 'approved', 'rejected'));
    ALTER TABLE assets ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
    ALTER TABLE assets ADD COLUMN price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0);
    ALTER TABLE assets ADD COLUMN earned INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE assets ADD COLUMN job_id TEXT;
    ALTER TABLE assets ADD COLUMN published_at INTEGER;
    CREATE INDEX idx_assets_owner ON assets(owner_id, type);
    CREATE INDEX idx_assets_review ON assets(review);

    -- The imported catalog's images are not licensed for commercial use.
    UPDATE assets SET license = 'noncommercial' WHERE source = 'upstream';
    -- Uploaded poses used an English angle key; use the catalog's keys.
    UPDATE assets SET angle = '正面', angle_zh = '正面', angle_en = 'Front' WHERE angle = 'front';

    CREATE TABLE asset_categories (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('pose', 'outfit')),
      parent_id INTEGER REFERENCES asset_categories(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      name_zh TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      hint TEXT NOT NULL DEFAULT '',
      rating TEXT NOT NULL DEFAULT 'general' CHECK (rating IN ('general', 'suggestive', 'explicit')),
      gen_enabled INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX idx_cat_major ON asset_categories(type, key) WHERE parent_id IS NULL;
    CREATE UNIQUE INDEX idx_cat_minor ON asset_categories(parent_id, key) WHERE parent_id IS NOT NULL;

    ALTER TABLE generations ADD COLUMN kind TEXT NOT NULL DEFAULT 'work' CHECK (kind IN ('work', 'asset'));
    ALTER TABLE generations ADD COLUMN params TEXT;
    ALTER TABLE generations ADD COLUMN asset_fee INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE generations ADD COLUMN ref_upload_id TEXT;
    ALTER TABLE generations ADD COLUMN source_asset_id TEXT;
    CREATE INDEX idx_gen_kind ON generations(kind, user_id, created_at DESC);

    -- Credits paid to use another user's asset: held with the job, paid to the
    -- owner (minus the platform's share) when it succeeds, refunded if it fails.
    CREATE TABLE asset_fees (
      id INTEGER PRIMARY KEY,
      generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      payer_id INTEGER NOT NULL,
      price INTEGER NOT NULL,
      rebate INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'paid', 'refunded')),
      created_at INTEGER NOT NULL,
      settled_at INTEGER
    );
    CREATE INDEX idx_fees_gen ON asset_fees(generation_id);
    CREATE INDEX idx_fees_owner ON asset_fees(owner_id, created_at DESC);

    -- Rebuild uploads to allow the 'reference' kind (asset generation input).
    CREATE TABLE uploads_v2 (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('person', 'outfit', 'reference')),
      path TEXT NOT NULL,
      mime TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      bytes INTEGER,
      consent_at INTEGER,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      deleted_at INTEGER
    );
    INSERT INTO uploads_v2 (id, user_id, kind, path, mime, width, height, bytes, consent_at, created_at, expires_at, deleted_at)
      SELECT id, user_id, kind, path, mime, width, height, bytes, consent_at, created_at, expires_at, deleted_at FROM uploads;
    DROP TABLE uploads;
    ALTER TABLE uploads_v2 RENAME TO uploads;
    CREATE INDEX idx_uploads_user ON uploads(user_id, created_at DESC);
    CREATE INDEX idx_uploads_expires ON uploads(expires_at);
    `);
    seedCategories(conn);
    // Imported outfits get a major category (大类) so they sit in the tree.
    const setSeries = conn.prepare(`UPDATE assets SET series = ?, series_zh = ?, series_en = ?
      WHERE type = 'outfit' AND series = '' AND category = ?`);
    for (const [category, key] of Object.entries(UPSTREAM_OUTFIT_SERIES)) {
      const major = OUTFIT_TREE.find((m) => m.key === key);
      setSeries.run(key, major.zh, major.en, category);
    }
  }
];

export function migrate() {
  const current = db.pragma("user_version", { simple: true });
  for (let version = current; version < migrations.length; version++) {
    db.transaction(() => {
      const step = migrations[version];
      if (typeof step === "function") step(db);
      else db.exec(step);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
  return db.pragma("user_version", { simple: true });
}

export const tx = (fn) => db.transaction(fn);
