// Scoring logic extracted for Node.js worker
const oversToBalls = (oversStr) => {
  const parts = String(oversStr).split(".");
  const overs = parseInt(parts[0]) || 0;
  const balls = parts[1] ? parseInt(parts[1]) : 0;
  return Math.abs(overs * 6 + balls);
};

const ballsToOversDisplay = (balls) => {
  const overs = Math.floor(balls / 6);
  const rem = balls % 6;
  return `${overs}.${rem} ov`;
};

const calculateInnings1Points = (prediction, actual, meta) => {
  const teamA = (meta.teamA || "Team A").toLowerCase();
  const teamB = (meta.teamB || "Team B").toLowerCase();

  let predScore = 0;
  if (!meta.disableScoreA && meta.disableScoreB) predScore = Number(prediction.scoreA) || 0;
  else if (!meta.disableScoreB && meta.disableScoreA) predScore = Number(prediction.scoreB) || 0;
  else {
    const winner = (prediction.predictedWinner || "").toLowerCase();
    if (winner === teamA) predScore = Number(prediction.scoreA) || 0;
    else if (winner === teamB) predScore = Number(prediction.scoreB) || 0;
    else predScore = Math.max(Number(prediction.scoreA) || 0, Number(prediction.scoreB) || 0);
  }

  const diff = Math.abs(actual - predScore);
  if (diff === 0) {
    return { points: 200, diff, rawDiff: 0, isExact: true, isNear5: true, isNear10: true, guess: predScore, mode: "Score" };
  }

  const base = Math.round(Math.max(0, 120 - (diff * 1.2)));
  const near5 = diff <= 5 ? 20 : 0;
  const near10 = diff <= 10 ? 10 : 0;

  const totalPoints = Math.max(0, base + near5 + near10);
  
  return {
    points: totalPoints,
    diff,
    rawDiff: diff,
    isExact: false,
    isNear5: diff <= 5,
    isNear10: diff <= 10,
    guess: predScore,
    mode: "Score"
  };
};

const calculateInnings2Points = (prediction, actualWinner, actualResult, meta, isOversOverride = null) => {
  actualWinner = (actualWinner || "").toLowerCase();
  const predWinner = (prediction.predictedWinner || "").toLowerCase();
  const teamA = (meta.teamA || "Team A").toLowerCase();
  const teamB = (meta.teamB || "Team B").toLowerCase();
  
  let chasingTeam = teamB;
  if (meta.disableScoreA && !meta.disableScoreB) chasingTeam = teamB;
  else if (meta.disableScoreB && !meta.disableScoreA) chasingTeam = teamA;

  let isChaserWinner = isOversOverride !== null 
    ? isOversOverride 
    : String(actualResult).includes("."); // simplified inference

  const predVal = chasingTeam === teamA ? prediction.scoreA : prediction.scoreB;

  if (predWinner !== actualWinner) {
    let wrongDiff = 0;
    if (isChaserWinner) {
      wrongDiff = Math.abs(oversToBalls(actualResult) - oversToBalls(predVal || 0));
    } else {
      wrongDiff = Math.abs(Number(actualResult) - Number(predVal || 0));
    }
    return { points: 0, diff: "---", rawDiff: wrongDiff, guess: predVal || "---", isExact: false, mode: "Wrong Winner" };
  }

  let points = 0;
  if (isChaserWinner) {
    const diff = Math.abs(oversToBalls(actualResult) - oversToBalls(predVal || 0));
    const accuracy = Math.round(Math.max(0, 120 - (diff * 1.8)));
    const near3Bonus = (diff <= 3) ? 20 : 0;
    const rangeBonus = (diff <= 9) ? 10 : 0;
    const exactBonus = (diff === 0) ? 70 : 0;

    points += accuracy + near3Bonus + rangeBonus + exactBonus;
    return { points: Math.max(0, points), diff: ballsToOversDisplay(diff), rawDiff: diff, guess: predVal, isExact: diff === 0, mode: "Overs" };
  } else {
    // Defending/Score Scenario
    const diff = Math.abs(Number(actualResult) - Number(predVal || 0));
    const base = Math.round(Math.max(0, 120 - (diff * 1.2)));
    const rangeBonusTier1 = (diff <= 5) ? 20 : 0;
    const rangeBonusTier2 = (diff <= 12) ? 10 : 0;
    const exactBonus = (diff === 0) ? 70 : 0;

    points += base + rangeBonusTier1 + rangeBonusTier2 + exactBonus;
    return { points: Math.max(0, points), diff: `${diff} runs`, rawDiff: diff, guess: predVal, isExact: diff === 0, mode: "Score" };
  }
};

const calculateMatchFinals = (h1, h2) => {
  const combinedMap = new Map();

  const mergeRecords = (data, isInnings1) => {
    Object.entries(data).forEach(([cid, p]) => {
      const rawName = (p.name || "Anonymous").toString().trim();
      const key = rawName.toLowerCase();

      if (!combinedMap.has(key)) {
        combinedMap.set(key, { displayName: rawName, p1: { pts: 0, winner: "", guess: "---", penalty: 0, penaltyDetails: "" }, p2: { pts: 0, winner: "", guess: "---", penalty: 0, penaltyDetails: "" } });
      }

      const rec = combinedMap.get(key);
      if (isInnings1) {
        rec.p1 = { pts: p.points || 0, winner: p.predictedWinner || "", guess: p.guess || "---", penalty: p.penalty || 0, penaltyDetails: p.penaltyDetails || "" };
      } else {
        rec.p2 = { pts: p.points || 0, winner: p.predictedWinner || "", guess: p.guess || "---", penalty: p.penalty || 0, penaltyDetails: p.penaltyDetails || "" };
      }
    });
  };

  mergeRecords(h1, true);
  mergeRecords(h2, false);

  return Array.from(combinedMap.values()).map(rec => {
    // rec.p1 and rec.p2 should contain the raw penalties if we want to extract the total match penalty
    // Usually the P2 prediction contains the most up-to-date stacked penalty (including winner change penalties applied by audience.js)
    const matchPenalty = Number(rec.p2.penalty || rec.p1.penalty || 0);
    const totalPenalty = matchPenalty;

    return {
      name: rec.displayName,
      p1Score: rec.p1.pts,
      p1Winner: rec.p1.winner,
      p1Guess: rec.p1.guess,
      p2Score: rec.p2.pts,
      p2Winner: rec.p2.winner,
      p2Guess: rec.p2.guess,
      penalty: totalPenalty,
      penaltyDetails: rec.p2.penaltyDetails || rec.p1.penaltyDetails || "",
      total: Math.max(0, rec.p1.pts + rec.p2.pts - totalPenalty)
    };
  });
};

module.exports = {
  calculateInnings1Points,
  calculateInnings2Points,
  calculateMatchFinals,
  oversToBalls
};
