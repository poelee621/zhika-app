-- 知卡 ZhiCard 社区版数据模型（D1 SQLite）
-- 全新部署用：wrangler d1 execute zhika-social --file=schema.sql
-- 在线迁移用：worker.js 启动时自动 migrateDB()（幂等 PRAGMA 检测后 ALTER）
-- 登录：用户ID(8位数字) + 密码（PBKDF2-SHA256/100k）

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  nickname TEXT DEFAULT '',
  avatar_id TEXT,
  bio TEXT DEFAULT '',
  phone TEXT,                            -- 兼容旧数据，新流程不再写入
  created_at INTEGER NOT NULL
);

-- 卡片发布（images = media id 列表 JSON；cards = 原始卡片数据 JSON；tags = 分类标签 JSON 数组，如 ["tech","knowledge"]）
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  theme TEXT DEFAULT 'knowledge',
  tags TEXT DEFAULT '[]',
  cover_id TEXT,
  images TEXT DEFAULT '[]',
  cards TEXT DEFAULT '[]',
  like_count INTEGER DEFAULT 0,
  fav_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS likes (
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (card_id, user_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (card_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 图片存储（base64；R2 开通后可选迁移）
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  mime TEXT DEFAULT 'image/jpeg',
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_cards_created ON cards(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_card ON comments(card_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);
CREATE INDEX IF NOT EXISTS idx_favs_user ON favorites(user_id);
