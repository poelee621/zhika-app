-- 知卡 ZhiCard 社区版数据模型（D1 SQLite）

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  nickname TEXT DEFAULT '',
  avatar_id TEXT,
  bio TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

-- 短信验证码（每手机号一行，含重发冷却）
CREATE TABLE IF NOT EXISTS sms_codes (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  next_at INTEGER NOT NULL
);

-- 卡片发布（images = media id 列表 JSON；cards = 原始卡片数据 JSON）
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  theme TEXT DEFAULT 'knowledge',
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

CREATE INDEX IF NOT EXISTS idx_cards_created ON cards(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_card ON comments(card_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id, created_at DESC);
