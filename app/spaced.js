// spaced.js —— 间隔复习调度（本地 localStorage）
// 把每次生成的知识卡组成「一套 set」存下；每张卡按遗忘曲线排程复习提醒。
const SPACED = {
  KEY: 'zhika_sets',
  // 复习间隔（天）：1 → 3 → 7 → 15 → 30 → 完成
  INTERVALS: [1, 3, 7, 15, 30],

  _load() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); }
    catch (e) { return []; }
  },
  _save(arr) { localStorage.setItem(this.KEY, JSON.stringify(arr)); },

  // 保存一套卡片；每张卡加入 level(0) 与 nextReview(今天)
  saveSet(set) {
    const arr = this._load();
    const now = Date.now();
    const card = {
      id: 'set_' + now,
      title: set.title || '知识卡片',
      summary: set.summary || '',
      theme: set.theme || 'knowledge',
      createdAt: now,
      cards: (set.cards || []).map(c => ({
        cid: c.id || ('c_' + Math.random().toString(36).slice(2)),
        type: c.type, label: c.label, content: c.content,
        level: 0, nextReview: now, lastReview: 0
      }))
    };
    arr.unshift(card);
    this._save(arr);
    return card.id;
  },

  list() { return this._load(); },

  // 今天及之前到期的卡片
  dueToday() {
    const now = Date.now();
    const arr = this._load();
    const due = [];
    arr.forEach(set => {
      (set.cards || []).forEach(c => {
        if (c.level < this.INTERVALS.length && c.nextReview <= now) {
          due.push({ setId: set.id, setTitle: set.title, card: c });
        }
      });
    });
    return due;
  },

  // 标记某卡已复习，推进到下一间隔
  review(setId, cid) {
    const arr = this._load();
    const set = arr.find(s => s.id === setId);
    if (!set) return;
    const c = (set.cards || []).find(x => x.cid === cid);
    if (!c) return;
    c.level = Math.min(c.level + 1, this.INTERVALS.length);
    c.lastReview = Date.now();
    if (c.level < this.INTERVALS.length) {
      const days = this.INTERVALS[c.level];
      c.nextReview = Date.now() + days * 86400000;
    } else {
      c.nextReview = Infinity; // 已巩固
    }
    this._save(arr);
  },

  remove(setId) {
    const arr = this._load().filter(s => s.id !== setId);
    this._save(arr);
  }
};
