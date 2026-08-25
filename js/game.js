/* =========================================================
 * game.js — 德州扑克游戏引擎 + 界面交互
 * 单机人机对战（heads-up）
 * ========================================================= */

(() => {
'use strict';

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const els = {
  setupScreen: $('setup-screen'), gameScreen: $('game-screen'), overScreen: $('gameover-screen'),
  startChips: $('start-chips'), startBlinds: $('start-blinds'), startBtn: $('start-btn'),
  roundLabel: $('round-label'), dealerTag: $('dealer-tag'), handInfo: $('hand-info'),
  playerChips: $('player-chips'), aiChips: $('ai-chips'),
  playerCards: $('player-cards'), aiCards: $('ai-cards'),
  playerBet: $('player-bet'), aiBet: $('ai-bet'),
  playerBetTray: $('player-bet-tray'), aiBetTray: $('ai-bet-tray'),
  playerStatus: $('player-status'), aiStatus: $('ai-status'),
  playerHandName: $('player-hand-name'), aiDecision: $('ai-decision'),
  community: $('community'), potAmount: $('pot-amount'), handResult: $('hand-result'),
  btnFold: $('btn-fold'), btnCheckCall: $('btn-check-call'), btnRaise: $('btn-raise'), btnAllin: $('btn-allin'),
  raiseSlider: $('raise-slider'), raiseAmountLabel: $('raise-amount-label'),
  menuBtn: $('menu-btn'), overlay: $('overlay'), modal: $('modal'),
  modalTitle: $('modal-title'), modalBody: $('modal-body'), modalActions: $('modal-actions'),
  gameoverTitle: $('gameover-title'), gameoverDesc: $('gameover-desc'), gameoverStats: $('gameover-stats'),
  restartBtn: $('restart-btn'), backMenuBtn: $('back-menu-btn')
};

// ---------- 游戏状态 ----------
const game = {
  player: null, ai: null,
  community: [], deck: [],
  dealer: 'player',
  street: 'preflop',
  currentBet: 0, pot: 0,
  toAct: null,
  busy: false,
  difficulty: 'normal',
  bigBlind: 20, smallBlind: 10,
  stats: { hands: 0, playerWins: 0, biggestPot: 0 },
  rng: Math.random.bind(Math)
};

function P(chips) { return { chips, hole: [], bet: 0, handCommitted: 0, acted: false, folded: false, allIn: false }; }
const delay = ms => new Promise(r => setTimeout(r, ms));

// =========================================================
// 主流程
// =========================================================

function startGame() {
  const chips = Math.max(500, Math.min(100000, parseInt(els.startChips.value, 10) || 2000));
  game.bigBlind = parseInt(els.startBlinds.value, 10);
  game.smallBlind = Math.round(game.bigBlind / 2);
  game.player = P(chips);
  game.ai = P(chips);
  game.stats = { hands: 0, playerWins: 0, biggestPot: 0 };
  game.dealer = Math.random() < 0.5 ? 'player' : 'ai';
  els.setupScreen.classList.add('hidden');
  els.gameScreen.classList.remove('hidden');
  els.overScreen.classList.add('hidden');
  startHand();
}

function startHand() {
  game.community = [];
  game.deck = createShuffledDeck();
  game.player = P(game.player ? game.player.chips : 2000);
  game.ai = P(game.ai ? game.ai.chips : 2000);
  game.pot = 0; game.currentBet = 0; game.busy = false;
  game.finishing = false;
  game.revealed = false;
  game.handId = (game.handId || 0) + 1;
  game.stats.hands++;
  els.handResult.classList.add('hidden');
  els.handInfo.textContent = '盲注 ' + game.smallBlind + '/' + game.bigBlind;
  els.aiDecision.textContent = '';
  els.playerHandName.textContent = '';
  clearSeatStatus();

  game.player.hole = [game.deck.pop(), game.deck.pop()];
  game.ai.hole = [game.deck.pop(), game.deck.pop()];

  const sb = game.dealer === 'player' ? game.player : game.ai;
  const bb = game.dealer === 'player' ? game.ai : game.player;
  postBlind(sb, game.smallBlind);
  postBlind(bb, game.bigBlind);
  game.currentBet = bb.bet;

  renderAll();
  beginStreet('preflop');
}

function postBlind(p, amount) {
  const add = Math.min(amount, p.chips);
  p.chips -= add; p.bet += add; p.handCommitted += add; game.pot += add;
  if (p.chips === 0) p.allIn = true;
}

async function beginStreet(street) {
  const hid = game.handId;
  game.street = street;
  if (street !== 'preflop') {
    // 翻牌前盲注已在下注流程外预先缴纳，只需重置后续街的下注额
    game.currentBet = 0;
    game.player.bet = 0; game.ai.bet = 0;
    game.player.acted = false; game.ai.acted = false;
  }

  els.roundLabel.textContent = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' }[street];
  renderAll();

  if (street === 'flop') dealCommunity(3);
  else if (street === 'turn') dealCommunity(1);
  else if (street === 'river') dealCommunity(1);

  if (street !== 'preflop') renderAll();

  const someoneAllIn = game.player.allIn || game.ai.allIn;
  if (someoneAllIn && runoutNeeded()) {
    await runOutToShowdown();
    return;
  }

  // 先行动者：翻牌前非庄家（大盲）先，翻牌后庄家先；若其已全下则顺延
  let first = street === 'preflop'
    ? (game.dealer === 'player' ? 'ai' : 'player')
    : game.dealer;
  if (first === 'player' && game.player.allIn) first = 'ai';
  else if (first === 'ai' && game.ai.allIn) first = 'player';
  game.toAct = first;
  setControls();

  if (first === 'ai') scheduleAI();
}

/** 是否需要直接摊牌：一方全下且另一方已跟平（或同样全下），再无下注可能 */
function runoutNeeded() {
  const pAll = game.player.allIn, aAll = game.ai.allIn;
  if (pAll && aAll) return true;
  if (pAll && game.ai.bet === game.currentBet) return true;
  if (aAll && game.player.bet === game.currentBet) return true;
  return false;
}

function dealCommunity(n) {
  for (let i = 0; i < n; i++) game.community.push(game.deck.pop());
}

async function runOutToShowdown() {
  const hid = game.handId;
  // 全下局面：发完剩余公共牌后直接摊牌
  if (game.community.length === 0) { dealCommunity(3); renderAll(); await delay(700); }
  if (hid !== game.handId) return;
  if (game.community.length === 3) { dealCommunity(1); renderAll(); await delay(700); }
  if (hid !== game.handId) return;
  if (game.community.length === 4) { dealCommunity(1); renderAll(); await delay(700); }
  if (hid !== game.handId) return;
  showdown();
}

// =========================================================
// 行动处理
// =========================================================

function placeBet(p, targetLevel) {
  // 目标下注总额不能超过「已下 + 剩余」，且不能低于已下
  const add = Math.max(0, Math.min(targetLevel, p.bet + p.chips) - p.bet);
  if (add <= 0) return 0;
  p.chips -= add; p.bet += add; p.handCommitted += add; game.pot += add;
  if (p.chips === 0) p.allIn = true;
  return add;
}

function onBetRaise(p) {
  // 仅当加注确实超过对手当前下注时，才需要对手重新行动（短全下未超过则视为跟平）
  for (const o of [game.player, game.ai]) {
    if (o !== p && !o.folded && !o.allIn && p.bet > o.bet) o.acted = false;
  }
}

function isRoundComplete() {
  const actives = [game.player, game.ai].filter(x => !x.folded);
  if (actives.length <= 1) return true;
  for (const x of actives) {
    if (x.allIn) continue;
    if (x.bet !== game.currentBet || !x.acted) return false;
  }
  return true;
}

function afterAction(actor) {
  if (isRoundComplete()) {
    game.toAct = null;
    completeStreet();
    return;
  }
  const next = actor === 'player' ? 'ai' : 'player';
  const n = next === 'player' ? game.player : game.ai;
  if (n.folded || n.allIn) {
    completeStreet();
    return;
  }
  game.toAct = next;
  setControls();
  if (next === 'ai') scheduleAI();
}

function completeStreet() {
  game.toAct = null;
  setControls();
  if (game.street === 'river') {
    showdown();
  } else {
    const next = game.street === 'preflop' ? 'flop' : game.street === 'flop' ? 'turn' : 'river';
    beginStreet(next);
  }
}

// ---------- 玩家操作 ----------
function playerFold() {
  if (game.toAct !== 'player' || game.busy || game.finishing) return;
  game.busy = true;
  game.player.folded = true;
  renderAll();
  showSeatStatus('player', '弃牌');
  const chipsWon = game.pot;
  game.ai.chips += chipsWon; game.pot = 0;
  renderAll();
  finishHand('你弃牌了，AI 赢得底池 ' + chipsWon, game.ai, chipsWon);
}

function playerCheckCall() {
  if (game.toAct !== 'player' || game.busy || game.finishing) return;
  const p = game.player;
  const toCall = Math.min(game.currentBet - p.bet, p.chips);
  p.acted = true;
  if (toCall > 0) {
    placeBet(p, p.bet + toCall);
    showSeatStatus('player', p.allIn ? '跟注(全下)' : '跟注');
  } else {
    showSeatStatus('player', '过牌');
  }
  renderAll();
  afterAction('player');
}

function playerRaise() {
  if (game.toAct !== 'player' || game.busy || game.finishing) return;
  const p = game.player;
  const target = parseInt(els.raiseSlider.value, 10);
  const minRaise = game.currentBet + game.bigBlind;
  if (target >= p.chips + p.bet) { playerAllIn(); return; }
  if (target < minRaise) { playerCheckCall(); return; }
  const raised = placeBet(p, target);
  if (raised <= 0) return;
  p.acted = true;
  onBetRaise(p);
  game.currentBet = Math.max(game.currentBet, p.bet);
  showSeatStatus('player', p.allIn ? '全下' : '加注到 ' + p.bet);
  renderAll();
  afterAction('player');
}

function playerAllIn() {
  if (game.toAct !== 'player' || game.busy || game.finishing) return;
  const p = game.player;
  placeBet(p, p.chips + p.bet);
  p.acted = true;
  onBetRaise(p);
  game.currentBet = Math.max(game.currentBet, p.bet);
  showSeatStatus('player', '全下！');
  renderAll();
  afterAction('player');
}

// ---------- AI 操作 ----------
function scheduleAI() {
  setTimeout(async () => {
    if (game.toAct !== 'ai' || game.busy) return;
    game.busy = true;
    els.aiStatus.textContent = '思考中…';
    await delay(500 + game.rng() * 700);
    const decision = aiDecide(game);
    const ai = game.ai;
    const minRaise = game.currentBet + game.bigBlind;

    showBubble('AI 决定：' + decision.text);
    els.aiStatus.textContent = '';

    if (decision.action === 'fold') {
      ai.folded = true;
      showSeatStatus('ai', '弃牌');
      renderAll();
      const chipsWon = game.pot;
      game.player.chips += chipsWon; game.pot = 0;
      renderAll();
      game.busy = false;
      finishHand('AI 弃牌，你赢得底池 ' + chipsWon, game.player, chipsWon);
      return;
    }
    if (decision.action === 'check') {
      ai.acted = true;
      showSeatStatus('ai', '过牌');
    } else if (decision.action === 'call') {
      const toCall = Math.min(game.currentBet - ai.bet, ai.chips);
      ai.acted = true;
      placeBet(ai, ai.bet + toCall);
      showSeatStatus('ai', ai.allIn ? '跟注(全下)' : '跟注');
    } else { // raise / allin
      const allInTarget = ai.chips + ai.bet;
      let target = decision.action === 'allin' ? allInTarget : (decision.raiseTo || minRaise);
      target = Math.max(minRaise, target);
      if (target >= allInTarget) {
        placeBet(ai, allInTarget);
        showSeatStatus('ai', '全下！');
      } else {
        placeBet(ai, target);
        showSeatStatus('ai', '加注到 ' + ai.bet);
      }
      ai.acted = true;
      onBetRaise(ai);
      game.currentBet = Math.max(game.currentBet, ai.bet);
    }
    renderAll();
    game.busy = false;
    afterAction('ai');
  }, 350);
}

// =========================================================
// 摊牌与结算
// =========================================================

async function showdown() {
  game.busy = true;
  game.finishing = true;
  game.revealed = true;
  game.toAct = null;
  const hid = game.handId;
  setControls();
  renderAiCards(true);
  showBubble('亮牌！');
  await delay(900);
  if (hid !== game.handId) return;

  const pb = bestHand([...game.player.hole, ...game.community]);
  const ab = bestHand([...game.ai.hole, ...game.community]);
  const cmp = compareEval(pb, ab);

  const cA = game.ai.handCommitted, cB = game.player.handCommitted;
  const minC = Math.min(cA, cB);
  const mainPot = 2 * minC;
  const excess = game.pot - mainPot;
  let resultText;

  if (cmp > 0) {
    game.player.chips += mainPot;
    if (cB > cA) game.player.chips += excess; else game.ai.chips += excess;
    game.stats.playerWins++;
    resultText = '你赢了 ' + game.pot + ' 筹码！（' + pb.name + '）';
  } else if (cmp < 0) {
    game.ai.chips += mainPot;
    if (cA > cB) game.ai.chips += excess; else game.player.chips += excess;
    resultText = 'AI 赢了 ' + game.pot + ' 筹码！（' + ab.name + '）';
  } else {
    const half = Math.floor(game.pot / 2);
    const odd = game.pot % 2;
    game.player.chips += half; game.ai.chips += half;
    if (odd) game.player.chips += odd;
    resultText = '平局！平分底池 ' + game.pot + ' 筹码（均为 ' + pb.name + '）';
  }
  game.stats.biggestPot = Math.max(game.stats.biggestPot, game.pot);
  game.pot = 0;

  els.playerHandName.textContent = '你的牌型：' + pb.name;
  els.handResult.textContent = resultText;
  els.handResult.classList.remove('hidden');
  els.handResult.classList.toggle('win', cmp >= 0);
  renderAll();
  await delay(3000);
  if (hid !== game.handId) return;
  game.busy = false;
  nextHandOrGameOver();
}

function finishHand(msg, winner, potSize) {
  const hid = game.handId;
  game.finishing = true;
  game.toAct = null;
  game.busy = false;
  game.stats.biggestPot = Math.max(game.stats.biggestPot, potSize || 0);
  game.pot = 0;
  els.handResult.textContent = msg;
  els.handResult.classList.remove('hidden');
  els.handResult.classList.toggle('win', winner === game.player);
  renderAll();
  setTimeout(() => { if (hid === game.handId) nextHandOrGameOver(); }, 2400);
}

function nextHandOrGameOver() {
  if (!game.finishing) return;
  game.finishing = false;
  if (game.player.chips <= 0 || game.ai.chips <= 0) {
    gameOver();
    return;
  }
  game.dealer = game.dealer === 'player' ? 'ai' : 'player';
  startHand();
}

function gameOver() {
  els.gameScreen.classList.add('hidden');
  els.overScreen.classList.remove('hidden');
  const playerWin = game.player.chips > 0;
  els.gameoverTitle.textContent = playerWin ? '你赢了！' : '你输了';
  els.gameoverDesc.textContent = playerWin
    ? 'AI 筹码耗尽，你以 ' + game.player.chips + ' 筹码获胜'
    : '你的筹码耗尽，AI 最终筹码 ' + game.ai.chips;
  els.gameoverStats.innerHTML =
    '<div><span>对局数</span><b>' + game.stats.hands + '</b></div>' +
    '<div><span>获胜手数</span><b>' + game.stats.playerWins + '</b></div>' +
    '<div><span>最大底池</span><b>' + game.stats.biggestPot + '</b></div>' +
    '<div><span>剩余筹码</span><b>' + game.player.chips + '</b></div>';
}

// =========================================================
// UI 渲染
// =========================================================

function renderAll() {
  els.playerChips.textContent = game.player.chips;
  els.aiChips.textContent = game.ai.chips;
  els.potAmount.textContent = game.pot;
  renderCards(game.player.hole, els.playerCards, true);
  const aiFaceUp = game.revealed || game.player.folded || game.ai.folded;
  renderCards(game.ai.hole, els.aiCards, aiFaceUp);
  renderCommunity();
  updateBetTrays();
  updateDealerTag();
  updateRaiseSlider();
  setControls();
}

function renderCards(cards, container, faceUp) {
  container.innerHTML = '';
  for (const c of cards) {
    const div = document.createElement('div');
    if (faceUp) {
      div.className = 'card ' + (c.suit === 'h' || c.suit === 'd' ? 'red' : 'black');
      div.innerHTML =
        '<span class="corner top">' + rankLabel(c.rank) + SUIT_GLYPH[c.suit] + '</span>' +
        '<span class="center">' + SUIT_GLYPH[c.suit] + '</span>' +
        '<span class="corner bottom">' + rankLabel(c.rank) + SUIT_GLYPH[c.suit] + '</span>';
    } else {
      div.className = 'card back';
      div.innerHTML = '<span class="back-pattern"></span>';
    }
    container.appendChild(div);
  }
}

function renderAiCards(faceUp) {
  renderCards(game.ai.hole, els.aiCards, faceUp);
}

function renderCommunity() {
  const slots = els.community.children;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    slot.innerHTML = '';
    if (i < game.community.length) {
      const c = game.community[i];
      const div = document.createElement('div');
      div.className = 'card ' + (c.suit === 'h' || c.suit === 'd' ? 'red' : 'black');
      div.innerHTML =
        '<span class="corner top">' + rankLabel(c.rank) + SUIT_GLYPH[c.suit] + '</span>' +
        '<span class="center">' + SUIT_GLYPH[c.suit] + '</span>' +
        '<span class="corner bottom">' + rankLabel(c.rank) + SUIT_GLYPH[c.suit] + '</span>';
      slot.appendChild(div);
    }
  }
}

function updateBetTrays() {
  els.playerBet.textContent = game.player.bet;
  els.aiBet.textContent = game.ai.bet;
  els.playerBetTray.classList.toggle('visible', game.player.bet > 0);
  els.aiBetTray.classList.toggle('visible', game.ai.bet > 0);
}

function updateDealerTag() {
  // 将庄家标记移动到当前庄家座位旁
  const target = document.getElementById(game.dealer === 'player' ? 'seat-player' : 'seat-ai');
  if (target && els.dealerTag.parentNode !== target) target.appendChild(els.dealerTag);
}

function showSeatStatus(seat, text) {
  const el = seat === 'player' ? els.playerStatus : els.aiStatus;
  el.textContent = text;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.classList.remove('visible'); el.textContent = ''; }, 2200);
}

function clearSeatStatus() {
  els.playerStatus.classList.remove('visible'); els.playerStatus.textContent = '';
  els.aiStatus.classList.remove('visible'); els.aiStatus.textContent = '';
}

function showBubble(text) {
  els.aiDecision.textContent = text;
  els.aiDecision.classList.add('visible');
  clearTimeout(els.aiDecision._t);
  els.aiDecision._t = setTimeout(() => els.aiDecision.classList.remove('visible'), 2600);
}

// ---------- 操作按钮 ----------
function setControls() {
  const turn = game.toAct === 'player';
  const p = game.player;
  const toCall = Math.min(game.currentBet - p.bet, p.chips);
  const canCall = toCall > 0;
  const minRaise = game.currentBet + game.bigBlind;

  els.btnFold.disabled = !turn;
  els.btnAllin.disabled = !turn;
  els.btnRaise.disabled = !turn;
  els.raiseSlider.disabled = !turn;
  els.btnCheckCall.disabled = !turn;

  if (turn) {
    els.btnCheckCall.textContent = canCall ? '跟注 ' + toCall : '过牌';
    els.btnAllin.textContent = p.chips > 0 ? '全下 ' + p.chips : '全下';
  } else {
    els.btnCheckCall.textContent = '过牌';
  }
  updateRaiseSlider();
}

function updateRaiseSlider() {
  const p = game.player;
  const minRaise = game.currentBet + game.bigBlind;
  const allIn = p.chips + p.bet; // 加注到该金额即全下
  const lo = Math.min(minRaise, allIn);
  const hi = Math.max(lo, allIn);
  const val = parseInt(els.raiseSlider.value, 10);
  els.raiseSlider.min = lo;
  els.raiseSlider.max = hi;
  els.raiseSlider.step = game.bigBlind;
  if (isNaN(val) || val < lo || val > hi) els.raiseSlider.value = Math.min(lo, hi);
  const v = parseInt(els.raiseSlider.value, 10);
  els.raiseAmountLabel.textContent = '加注到 ' + (isNaN(v) ? hi : v);
}

// =========================================================
// 菜单 / 弹窗
// =========================================================

function openModal(title, bodyHTML, actions) {
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = bodyHTML;
  els.modalActions.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.primary ? 'primary' : 'ghost');
    b.textContent = a.label;
    b.onclick = a.onClick;
    els.modalActions.appendChild(b);
  }
  els.overlay.classList.remove('hidden');
  els.modal.classList.remove('hidden');
}

function closeModal() {
  els.overlay.classList.add('hidden');
  els.modal.classList.add('hidden');
}

function openMenu() {
  openModal('菜单',
    '<p>对局数：<b>' + game.stats.hands + '</b>　获胜手数：<b>' + game.stats.playerWins + '</b></p>' +
    '<p>你 <b>' + game.player.chips + '</b>　|　AI <b>' + game.ai.chips + '</b></p>' +
    '<p class="muted">盲注：小盲 ' + game.smallBlind + ' / 大盲 ' + game.bigBlind + '</p>',
    [
      { label: '继续游戏', primary: true, onClick: closeModal },
      { label: '重新开始本局', onClick: () => { closeModal(); startGame(); } },
      { label: '返回设置', onClick: () => { closeModal(); backToSetup(); } }
    ]);
}

function backToSetup() {
  els.gameScreen.classList.add('hidden');
  els.overScreen.classList.add('hidden');
  els.setupScreen.classList.remove('hidden');
}

// =========================================================
// 事件绑定 & 初始化
// =========================================================

els.startBtn.onclick = startGame;
els.restartBtn.onclick = startGame;
els.backMenuBtn.onclick = backToSetup;
els.menuBtn.onclick = openMenu;
els.overlay.onclick = closeModal;

els.btnFold.onclick = playerFold;
els.btnCheckCall.onclick = playerCheckCall;
els.btnRaise.onclick = playerRaise;
els.btnAllin.onclick = playerAllIn;
els.raiseSlider.oninput = () => { els.raiseAmountLabel.textContent = '加注到 ' + els.raiseSlider.value; };

document.querySelectorAll('.stepper').forEach(btn => {
  btn.onclick = () => {
    const input = els.startChips;
    const v = Math.max(500, Math.min(100000, (parseInt(input.value, 10) || 0) + parseInt(btn.dataset.step, 10)));
    input.value = v;
  };
});

document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    game.difficulty = btn.dataset.diff;
  };
});

// 调试句柄（浏览器与测试环境均可访问）
if (typeof window !== 'undefined') window.__game = game;

})();
