/* =========================================================
 * cards.js — 扑克牌工具 + 牌型判定 + 牌力评估
 * ========================================================= */

const RANKS = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };
const SUITS = ['s','h','d','c'];
const SUIT_GLYPH = { s:'♠', h:'♥', d:'♦', c:'♣' };

/** 创建一副标准 52 张牌并洗牌（Fisher-Yates） */
function createShuffledDeck() {
  const deck = [];
  for (const s of SUITS) for (const r in RANKS) deck.push({ rank: RANKS[r], suit: s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function rankLabel(r) {
  return r === 14 ? 'A' : r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : r === 10 ? 'T' : String(r);
}

/* ---------------------------------------------------------
 * 牌型判定：从 7 张牌（2 底牌 + 5 公共）中取最大 5 张牌型
 * type: 8同花顺 7四条 6葫芦 5同花 4顺子 3三条 2两对 1一对 0高牌
 * --------------------------------------------------------- */

function evalFive(cards) {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suit = cards[0].suit;
  const isFlush = cards.every(c => c.suit === suit);

  // 顺子判定（含 A2345 车轮顺）
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let isStraight = false;
  let high = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) { isStraight = true; high = uniq[0]; }
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) { isStraight = true; high = 5; }
  }

  if (isFlush && isStraight) return { type: 8, name: '同花顺', rank: [high] };
  if (isFlush) return { type: 5, name: '同花', rank: ranks };

  // 频次统计
  const freq = {};
  for (const r of ranks) freq[r] = (freq[r] || 0) + 1;
  const groups = Object.entries(freq).map(([r, n]) => ({ rank: +r, n })).sort((a, b) => b.n - a.n || b.rank - a.rank);

  if (groups[0].n === 4) return { type: 7, name: '四条', rank: [groups[0].rank, groups[1].rank] };
  if (groups[0].n === 3 && groups[1].n === 2) return { type: 6, name: '葫芦', rank: [groups[0].rank, groups[1].rank] };
  if (isStraight) return { type: 4, name: '顺子', rank: [high] };
  if (groups[0].n === 3) return { type: 3, name: '三条', rank: [groups[0].rank, ...groups.filter(g => g.n === 1).map(g => g.rank)] };
  if (groups[0].n === 2 && groups[1].n === 2) {
    const kickers = groups.filter(g => g.n === 1).map(g => g.rank);
    return { type: 2, name: '两对', rank: [groups[0].rank, groups[1].rank, kickers[0]] };
  }
  if (groups[0].n === 2) {
    return { type: 1, name: '一对', rank: [groups[0].rank, ...groups.filter(g => g.n === 1).map(g => g.rank)] };
  }
  return { type: 0, name: '高牌', rank: ranks };
}

/** 从 5~7 张牌中枚举全部 5 张组合，取最大牌型 */
function bestHand(cards) {
  let best = null;
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const ev = evalFive(five);
            if (!best || compareEval(ev, best) > 0) best = ev;
          }
  return best;
}

/** 比较两个 5 张牌型：>0 表示 a 更大，0 平局，<0 表示 a 更小 */
function compareEval(a, b) {
  if (a.type !== b.type) return a.type - b.type;
  const len = Math.max(a.rank.length, b.rank.length);
  for (let i = 0; i < len; i++) {
    const x = a.rank[i] || 0, y = b.rank[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/* ---------------------------------------------------------
 * 牌力评估（供 AI 使用）
 * --------------------------------------------------------- */

/** 翻牌前手牌强度（Chen 公式简化版），返回 0~1 */
function preflopStrength(hole) {
  const [a, b] = [...hole].sort((x, y) => y.rank - x.rank);
  const highVal = r => r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2;
  let score;
  if (a.rank === b.rank) {
    score = Math.max(highVal(a.rank) * 2, 5);
  } else {
    score = Math.floor(highVal(a.rank));
    if (a.suit === b.suit) score += 2;
    const gap = a.rank - b.rank - 1;
    score += gap === 0 ? -1 : gap === 1 ? -1 : gap === 2 ? -2 : gap === 3 ? -4 : gap >= 4 ? -5 : 0;
    if (gap <= 1) score += 1; // 连张加成
  }
  return Math.max(0.05, Math.min(1, score / 20));
}

const TYPE_BASE = { 8: 1, 7: 0.96, 6: 0.92, 5: 0.86, 4: 0.81, 3: 0.7, 2: 0.62, 1: 0.45, 0: 0.22 };

/** 翻牌后综合牌力 0~1（含听牌加分） */
function postflopStrength(hole, board) {
  const ev = bestHand([...hole, ...board]);
  let s = TYPE_BASE[ev.type];
  // 关键牌微调：四条/两对用踢脚，其余用主牌，越接近 A 越强
  const k = (ev.type === 7 || ev.type === 2 || ev.type === 1) ? ev.rank[1] : ev.rank[0];
  s += (k - 11) * 0.006;
  s = Math.min(1, Math.max(0.05, s));
  // 听牌加分
  const drawBonus = countDraws(hole, board);
  return Math.min(1, s + drawBonus);
}

/** 统计听牌：同花听牌 / 顺子听牌 */
function countDraws(hole, board) {
  const all = [...hole, ...board];
  let bonus = 0;
  // 同花听牌：5~6 张同花色
  const suitCount = {};
  for (const c of all) suitCount[c.suit] = (suitCount[c.suit] || 0) + 1;
  for (const n of Object.values(suitCount)) {
    if (n === 4) bonus += 0.06;
    else if (n === 3 && board.length >= 4) bonus += 0.03;
  }
  // 顺子听牌：检查是否存在 4 张连续的关键区间
  const ranks = new Set(all.map(c => (c.rank === 14 ? 1 : c.rank))); // 轮轴 A 当 1
  const ranks2 = new Set(all.map(c => c.rank));
  bonus += straightDrawBonus(ranks) + straightDrawBonus(ranks2);
  return Math.min(0.12, bonus);
}

function straightDrawBonus(rankSet) {
  let bestRun = 0;
  let run = 0;
  for (let r = 1; r <= 14; r++) {
    if (rankSet.has(r)) { run++; bestRun = Math.max(bestRun, run); } else run = 0;
  }
  if (bestRun >= 5) return 0; // 已成顺
  if (bestRun === 4) return 0.05;
  if (bestRun === 3 && rankSet.size >= 6) return 0.02;
  return 0;
}
