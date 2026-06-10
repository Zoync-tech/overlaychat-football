import { db, onValue, roomRef, query, limitToLast } from "./firebase.js";
import { getRoomId, escapeHtml, applyTeamTheme, stripKlipyUrl, getTeamCode } from "./shared.js";

const roomId = getRoomId();
const tickerStats = document.getElementById("tickerStats");
const tickerContent = document.getElementById("tickerContent");

let currentMessages = []; // Array of { id, user, text, timestamp }
let currentPredictions = []; // Array of { id, name, scoreA, scoreB, winner }
let currentMeta = {};

// 1 minute expiration (60,000ms)
const MESSAGE_EXPIRY = 60000;

/**
 * Calculates current prediction percentages based on team names
 */
const calculateStats = () => {
  const clean = (s) => (s || "").toString().trim().toLowerCase();
  const teamA = clean(currentMeta.teamA);
  const teamB = clean(currentMeta.teamB);
  
  if (!currentPredictions.length || !teamA) {
    currentMeta.percentA = 50;
    currentMeta.percentB = 50;
    return;
  }

  const countA = currentPredictions.filter(p => clean(p.winner) === teamA).length;
  const countB = currentPredictions.filter(p => clean(p.winner) === teamB).length;
  const total = countA + countB;

  if (total === 0) {
    currentMeta.percentA = 50;
    currentMeta.percentB = 50;
  } else {
    currentMeta.percentA = Math.round((countA / total) * 100);
    currentMeta.percentB = 100 - currentMeta.percentA;
  }
};

/**
 * Updates the ticker DOM content and calculates scrolling duration
 */
const updateTickerDOM = () => {
  const now = Date.now();
  calculateStats();

  // 1. Update Static Section (Match Summary)
  if (currentMeta.teamA && currentMeta.teamB) {
    const pA = currentMeta.percentA !== undefined ? currentMeta.percentA : 50;
    const pB = currentMeta.percentB !== undefined ? currentMeta.percentB : 50;
    const statsHtml = `<span>${escapeHtml(currentMeta.teamA)} ${pA}% vs ${pB}% ${escapeHtml(currentMeta.teamB)}</span>`;
    tickerStats.innerHTML = statsHtml;
    tickerStats.style.display = "flex";
  } else {
    tickerStats.style.display = "none";
  }

  // 2. Prepare Scrolling Content
  const items = [];
  const validMessages = currentMessages.filter(msg => (now - msg.timestamp) < MESSAGE_EXPIRY);

  // Use a generic Match Live indicator on start
  if (currentPredictions.length === 0 && validMessages.length === 0) {
    items.push(`
      <span class="ticker-item meta">
        <span class="ticker-badge">Live</span>
        <span>${escapeHtml(currentMeta.matchTitle || "OverlayChat")} is live! Waiting for predictions...</span>
      </span>
    `);
  }

  // 1b. Fan Predictions (Grouped)
  if (currentPredictions.length > 0) {
    const is2ndInnings = Boolean(currentMeta.secondInnings);
    const teamA = (currentMeta.teamA || "Home Team").toString().trim();
    const teamB = (currentMeta.teamB || "Away Team").toString().trim();
    const lowA = teamA.toLowerCase();
    const lowB = teamB.toLowerCase();

    let chasingTeam = null;
    if (is2ndInnings) {
      if (currentMeta.disableScoreA && !currentMeta.disableScoreB) chasingTeam = teamB;
      else if (currentMeta.disableScoreB && !currentMeta.disableScoreA) chasingTeam = teamA;
    }
    const lowChaser = (chasingTeam || "").toLowerCase();
    
    const sortedPredictions = [...currentPredictions].sort((a, b) => {
      if (currentMeta.predictionSort !== "score") return 0;
      const getValue = (p) => {
        let val = 0;
        if (is2ndInnings && chasingTeam) {
          const lowChaser = chasingTeam.toLowerCase();
          if (lowChaser === teamA.toLowerCase()) val = Number(p.scoreA) || 0;
          else val = Number(p.scoreB) || 0;
        } else {
          const hasA = !currentMeta.disableScoreA;
          const hasB = !currentMeta.disableScoreB;
          if (hasA && !hasB) val = Number(p.scoreA) || 0;
          else if (hasB && !hasA) val = Number(p.scoreB) || 0;
          else {
            const winner = (p.winner || "").toString().trim().toLowerCase();
            if (winner === teamA.toLowerCase()) val = Number(p.scoreA) || 0;
            else if (winner === teamB.toLowerCase()) val = Number(p.scoreB) || 0;
            else val = Math.max(Number(p.scoreA) || 0, Number(p.scoreB) || 0);
          }
        }
        return val === 0 ? Infinity : val;
      };
      return getValue(a) - getValue(b);
    });

    const fanParts = sortedPredictions
      .map((p) => {
        const predictedWinnerOrig = (p.winner || "Guess").toString().trim();
        const detailParts = [];
        const shouldShow = (score, isTeamChaser) => {
          const num = Number(score) || 0;
          if (num <= 0) return false;
          if (is2ndInnings) return isTeamChaser;
          return true;
        };

        if (!currentMeta.disableScoreA && shouldShow(p.scoreA, lowChaser === lowA)) {
          const isAChaser = lowChaser === lowA;
          const isOver = is2ndInnings && isAChaser && predictedWinnerOrig.toLowerCase() === lowA;
          const suffix = isOver ? " ov" : "";
          const displayVal = isOver ? (Number(p.scoreA) || 0).toFixed(1) : p.scoreA;
          detailParts.push(`${displayVal}${suffix}`);
        }
        if (!currentMeta.disableScoreB && shouldShow(p.scoreB, lowChaser === lowB)) {
          const isBChaser = lowChaser === lowB;
          const isOver = is2ndInnings && isBChaser && predictedWinnerOrig.toLowerCase() === lowB;
          const suffix = isOver ? " ov" : "";
          const displayVal = isOver ? (Number(p.scoreB) || 0).toFixed(1) : p.scoreB;
          detailParts.push(`${displayVal}${suffix}`);
        }

        if (detailParts.length === 0) return null;
        return `${p.name} (${predictedWinnerOrig}): ${detailParts.join(" - ")}`;
      })
      .filter(Boolean);

    if (fanParts.length > 0) {
      items.push(`
        <span class="ticker-item fan-prediction">
          <span class="ticker-badge">Fan Guesses</span>
          <span>${escapeHtml(fanParts.join(' | '))}</span>
        </span>
      `);
    }
  }

  // 2. Recent Messages
  const chatMessages = validMessages.filter(msg => {
    const stripped = stripKlipyUrl(msg.text);
    return !(msg.text && !stripped && (msg.text.includes("klipy.co") || msg.text.includes("klipy.com")));
  });

  chatMessages.forEach(msg => {
    let mediaHtml = "";
    if (msg.mediaUrl) {
      mediaHtml = `<img src="${escapeHtml(msg.mediaUrl)}" style="height:24px; vertical-align:middle; border-radius:4px; margin-left: 6px;" alt="" />`;
    }
    items.push(`
      <span class="ticker-item message">
        <span class="ticker-badge">Chat</span>
        <strong>${escapeHtml(msg.user)}:</strong>
        <span>${escapeHtml(stripKlipyUrl(msg.text))}${mediaHtml}</span>
      </span>
    `);
  });

  // Inject Scrolling HTML
  tickerContent.innerHTML = items.join('<span class="ticker-sep">•</span>');

  // Dynamic Scroll Duration
  const textLength = tickerContent.innerText.length;
  const speedFactor = 7;
  const duration = Math.max(25, textLength / speedFactor);
  tickerContent.style.animationDuration = `${duration}s`;
};

// --- DATA CONNECTORS ---

onValue(roomRef(roomId, "meta"), (snapshot) => {
  currentMeta = snapshot.val() || {};
  if (currentMeta.teamA && currentMeta.teamB) {
    applyTeamTheme(currentMeta.teamA, currentMeta.teamB);
  }
  updateTickerDOM();
});

onValue(roomRef(roomId, "predictions"), (snapshot) => {
  const data = snapshot.val() || {};
  currentPredictions = Object.entries(data).map(([id, p]) => ({
    id,
    name: p.name || "Guest",
    scoreA: p.scoreA || 0,
    scoreB: p.scoreB || 0,
    winner: p.predictedWinner
  }));
  updateTickerDOM();
});

const chatQuery = query(roomRef(roomId, "chat"), limitToLast(10));
onValue(chatQuery, (snapshot) => {
  const data = snapshot.val() || {};
  currentMessages = Object.entries(data)
    .map(([id, msg]) => ({
      id,
      user: msg.name || "Guest",
      text: msg.message,
      mediaUrl: msg.mediaUrl,
      timestamp: msg.createdAt || Date.now()
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
  updateTickerDOM();
});

setInterval(updateTickerDOM, 10000);
