/* =========================================================
 * ai.js — 电脑 AI 决策
 * 依据：手牌强度、底池赔率、位置、随机波动、难度
 * 返回：{ action:'fold'|'check'|'call'|'raise'|'allin', raiseTo? }
 * ========================================================= */

function aiDecide(game) {
  const ai = game.ai;
  const player = game.player;
  const toCall = game.currentBet - ai.bet;
  const pot = game.pot;
  const bb = game.bigBlind;
  const diff = game.difficulty; // 'normal' | 'hard'
  const rng = game.rng;         // 随机源，便于测试

  // 1. 牌力
  let strength;
  let drawText = '';
  if (game.community.length === 0) {
    strength = preflopStrength(ai.hole);
    if (strength > 0.62) drawText = '不错的起手牌';
  } else {
    strength = postflopStrength(ai.hole, game.community);
    const ev = bestHand([...ai.hole, ...game.community]);
    if (ev.type >= 4) drawText = `我拿到了${ev.name}`;
  }

  // 2. 位置优势：翻牌前大盲位后行动偏保守；翻牌后庄家位（后行动）偏激进
  const isDealerAI = game.dealer === 'ai';
  const positionBonus = isDealerAI ? (game.community.length ? 0.05 : -0.05) : (game.community.length ? -0.05 : 0.05);

  // 3. 底池赔率
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;

  // 4. 随机波动 + 难度调整
  const baseAggro = diff === 'hard' ? 0.08 : 0;
  const rand = rng() * 0.14;
  const effective = Math.min(1, strength + positionBonus + baseAggro + rand);

  // 5. 决策
  const allInTarget = ai.chips + ai.bet; // 全下时的目标下注总额

  if (toCall === 0) {
    // 无人下注：可过牌或主动下注/加注
    if (effective > 0.58) {
      // 主动下注
      const size = pot <= 0 ? bb * 2 : Math.max(bb, Math.round(pot * (0.5 + rng() * 0.6)));
      const raiseTo = Math.min(allInTarget, game.currentBet + size);
      if (raiseTo >= allInTarget) {
        return { action: 'allin', text: '全下！', note: drawText };
      }
      return { action: 'raise', raiseTo, text: raiseTo >= game.currentBet + bb * 4 ? '加注' : '下注', note: drawText };
    }
    return { action: 'check', text: '过牌', note: drawText };
  }

  // 面对下注
  if (toCall >= ai.chips) {
    // 跟注即全下
    if (effective > 0.45) {
      return { action: 'call', text: '跟注(全下)', note: drawText };
    }
    return { action: 'fold', text: '弃牌', note: drawText };
  }

  const required = potOdds;
  if (effective > 0.75) {
    // 强牌加注或全下
    if (effective > 0.9 || (rng() < 0.5 && ai.chips < pot * 1.2)) {
      return { action: 'allin', text: '全下！', note: drawText };
    }
    const raiseTo = Math.min(allInTarget, game.currentBet + Math.max(bb * 2, Math.round(pot * (0.6 + rng() * 0.5))));
    return { action: 'raise', raiseTo, text: '加注', note: drawText };
  }
  if (effective > required * 1.35) {
    // 便宜跟注：划算
    if (effective > 0.62 && rng() < 0.35) {
      const raiseTo = Math.min(allInTarget, game.currentBet + bb * 3);
      return { action: 'raise', raiseTo, text: '加注', note: drawText };
    }
    return { action: 'call', text: '跟注', note: drawText };
  }
  // 诈唬：极低概率
  if (rng() < 0.08 && ai.chips > toCall * 3) {
    return { action: 'raise', raiseTo: Math.min(allInTarget, game.currentBet + pot), text: '诈唬！', note: '想偷池' };
  }
  return { action: 'fold', text: '弃牌', note: drawText };
}
