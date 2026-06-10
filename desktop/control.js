import {
  db,
  isFirebaseConfigured,
  onValue,
  query,
  limitToLast,
  ref,
  roomRef,
  saveRoomMeta,
  clearRoomNode,
  getOnce,
  updateActiveSession,
  saveInningsHistory,
  getInningsHistory,
  archiveToHistory,
  getHistory,
  wipeMatchData,
  saveSeasonLeaderboard
} from "../assets/firebase.js";
import { getAudienceEntryUrl, escapeHtml, sortHistoryLatestFirst } from "../assets/shared.js";

const settingsForm = document.querySelector("#settingsForm");
const roomIdInput = document.querySelector("#roomId");
const matchTitleInput = document.querySelector("#matchTitle");
const teamAInput = document.querySelector("#teamA");
const teamBInput = document.querySelector("#teamB");
const allowRepredictionInput = document.querySelector("#allowReprediction");
const labelBattingA = document.querySelector("#labelBattingA");
const labelBattingB = document.querySelector("#labelBattingB");
const hideJoinInput = document.querySelector("#hideJoin");
const audienceUrlInput = document.querySelector("#audienceUrl");
const copyAudienceUrlButton = document.querySelector("#copyAudienceUrl");
const opacityInput = document.querySelector("#opacity");
const opacityValue = document.querySelector("#opacityValue");
const reactionOpacityInput = document.querySelector("#reactionOpacity");
const reactionOpacityValue = document.querySelector("#reactionOpacityValue");
const overlayStatus = document.querySelector("#overlayStatus");
const clickThroughStatus = document.querySelector("#clickThroughStatus");
const predictionPauseStatus = document.querySelector("#predictionPauseStatus");
const togglePredictionPauseButton = document.querySelector("#togglePredictionPause");
const showOverlayButton = document.querySelector("#showOverlay");
const hideOverlayButton = document.querySelector("#hideOverlay");
const reloadOverlayButton = document.querySelector("#reloadOverlay");
const resetBoundsButton = document.querySelector("#resetBounds");
const toggleHideChatButton = document.querySelector("#toggleHideChat");
const toggleHideJoinButton = document.querySelector("#toggleHideJoin");
const clearPredictionsButton = document.querySelector("#clearPredictions");
const clearChatButton = document.querySelector("#clearChat");
const showTickerButton = document.querySelector("#showTicker");
const hideTickerButton = document.querySelector("#hideTicker");
const reloadTickerButton = document.querySelector("#reloadTicker");
const resetTickerBoundsButton = document.querySelector("#resetTickerBounds");
const sortStatus = document.querySelector("#sortStatus");
const toggleSortModeButton = document.querySelector("#toggleSortMode");
const dotSort = document.querySelector("#dotSort");
const clearReactionsButton = document.querySelector("#clearReactions");
const showReactionButton = document.querySelector("#showReaction");
const hideReactionButton = document.querySelector("#hideReaction");
const reloadReactionButton = document.querySelector("#reloadReaction");
const resetReactionBoundsButton = document.querySelector("#resetReactionBounds");

// Obsolete Win Probability elements removed

let lastResults = [];
let lastOverallResults = [];
let fullHistory = {};

// UI Elements for History & Leaderboard
const mainViewHistoryBtn = document.querySelector("#mainViewHistoryBtn");
const historyDashboard = document.querySelector("#historyDashboard");
const closeHistoryBtn = document.querySelector("#closeHistory");
const matchList = document.querySelector("#matchList");
const matchDetail = document.querySelector("#matchDetail");

// Manual Entry Elements
const manualEntryDashboard = document.querySelector("#manualEntryDashboard");
const showManualEntryBtn = document.querySelector("#showManualEntry");
const closeManualEntryBtn = document.querySelector("#closeManualEntry");
const addManualRowBtn = document.querySelector("#addManualRow");
const manualPlayersBody = document.querySelector("#manualPlayersBody");
const saveManualMatchBtn = document.querySelector("#saveManualMatch");
const cancelManualSaveBtn = document.querySelector("#cancelManualSave");
const manTeamAInput = document.querySelector("#manualTeamA");
const manTeamBInput = document.querySelector("#manualTeamB");

// Edit Match Elements
const editMatchModal = document.querySelector("#editMatchModal");
const editMatchTitle = document.querySelector("#editMatchTitle");
const editMatchDate = document.querySelector("#editMatchDate");
const editActual1st = document.querySelector("#editActual1st");
const editActual2nd = document.querySelector("#editActual2nd");
const editTeamA = document.querySelector("#editTeamA");
const editTeamB = document.querySelector("#editTeamB");
const editWinRadioA = document.querySelector("#editWinRadioA");
const editWinRadioB = document.querySelector("#editWinRadioB");
const editLabelA = document.querySelector("#editLabelA");
const editLabelB = document.querySelector("#editLabelB");
const cancelEditMatchBtn = document.querySelector("#cancelEditMatch");
const saveEditMatchBtn = document.querySelector("#saveEditMatch");

// Status Dots
const dotOverlay = document.querySelector("#dotOverlay");
const dotInteractivity = document.querySelector("#dotInteractivity");
const dotPredictions = document.querySelector("#dotPredictions");

let currentSettings = null;
let currentMeta = {};
let stopMetaSubscription = null;
let heartbeatInterval = null;

const normalizeRoomId = (value) =>
  value.toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 40) || "fifa";

const setStatusText = (settings) => {
  currentSettings = settings;

  // Update Text
  overlayStatus.textContent = settings.overlayVisible ? "Visible" : "Hidden";
  clickThroughStatus.textContent = settings.clickThrough ? "Click-through" : "Interactive";
  opacityValue.textContent = `${Math.round(settings.opacity * 100)}%`;

  // Update Dots
  if (dotOverlay) {
    dotOverlay.className = `dot ${settings.overlayVisible ? 'active' : 'inactive'}`;
  }
  if (dotInteractivity) {
    dotInteractivity.className = `dot ${settings.clickThrough ? 'warning' : 'active'}`;
  }

  const reactionStatus = document.querySelector("#reactionStatus");
  if (reactionStatus) {
    reactionStatus.textContent = settings.reactionVisible ? "Visible" : "Hidden";
    reactionStatus.className = `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${settings.reactionVisible ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'}`;
  }

  roomIdInput.value = settings.roomId;
  opacityInput.value = settings.opacity;
  
  if (reactionOpacityInput) {
    const reactOp = settings.reactionOpacity !== undefined ? settings.reactionOpacity : settings.opacity;
    reactionOpacityInput.value = reactOp;
    reactionOpacityValue.textContent = `${Math.round(reactOp * 100)}%`;
  }

  audienceUrlInput.value = getAudienceEntryUrl();
};

const syncPauseUi = () => {
  const paused = Boolean(currentMeta.predictionsPaused);
  predictionPauseStatus.textContent = paused ? "Paused" : "Live";
  togglePredictionPauseButton.textContent = paused
    ? "Resume Predictions"
    : "Pause Predictions";

  if (dotPredictions) {
    dotPredictions.className = `dot ${paused ? 'inactive' : 'active'}`;
  }
};

const syncChatUi = () => {
  const hidden = Boolean(currentMeta.hideChat);
  toggleHideChatButton.textContent = hidden
    ? "Show Live Chat"
    : "Hide Live Chat";
};

const syncJoinUi = () => {
  const hidden = Boolean(currentMeta.hideJoin);
  toggleHideJoinButton.textContent = hidden
    ? "Show Join Section"
    : "Hide Join Section";
};

const syncSortUi = () => {
  const sortMode = currentMeta.predictionSort || "newest";
  const isScore = sortMode === "score";

  sortStatus.textContent = isScore ? "Score (Asc)" : "Newest First";
  toggleSortModeButton.textContent = isScore
    ? "Sort by Newest"
    : "Sort by Score";

  if (dotSort) {
    dotSort.className = `dot ${isScore ? 'active' : 'warning'}`;
  }
};

const getFormMeta = () => {
  const matchState = document.querySelector('input[name="matchState"]:checked')?.value || "Scheduled";

  return {
    matchTitle: matchTitleInput.value.trim(),
    teamA: teamAInput.value.trim(),
    teamB: teamBInput.value.trim(),
    allowReprediction: allowRepredictionInput.checked,
    matchState: matchState,
    predictionSort: currentMeta.predictionSort || "newest",
    predictionsPaused: Boolean(currentMeta.predictionsPaused),
    hideChat: Boolean(currentMeta.hideChat),
    hideJoin: Boolean(currentMeta.hideJoin),
    automationPaused: document.getElementById("automationPaused")?.checked || false
  };
};

const subscribeToMeta = (roomId) => {
  if (stopMetaSubscription) {
    stopMetaSubscription();
    stopMetaSubscription = null;
  }

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  if (!isFirebaseConfigured || !db) {
    currentMeta = {};
    syncPauseUi();
    syncChatUi();
    return;
  }

  // Start discovery heartbeat
  const tick = () => updateActiveSession(roomId).catch(console.error);
  tick();
  heartbeatInterval = setInterval(tick, 20000);

  stopMetaSubscription = onValue(roomRef(roomId, "meta"), (snapshot) => {
    currentMeta = snapshot.val() || {};

    const teamA = currentMeta.teamA || "";
    const teamB = currentMeta.teamB || "";

    matchTitleInput.value = currentMeta.matchTitle || "";
    teamAInput.value = teamA;
    teamBInput.value = teamB;

    // Sync Match State Radio
    const stateInput = document.querySelector(`input[name="matchState"][value="${currentMeta.matchState || 'Scheduled'}"]`);
    if (stateInput) stateInput.checked = true;

    syncPauseUi();
    syncChatUi();
    syncJoinUi();
    syncSortUi();

  });
};




// Update Resolution UI immediately when toggles change
document.querySelectorAll('input[name="innings"]').forEach(radio => {
  radio.addEventListener('change', () => {
    currentMeta.secondInnings = (radio.value === "2");
    updateResolutionVisibility();
  });
});

document.querySelectorAll('input[name="battingTeam"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const val = radio.value;
    currentMeta.disableScoreA = (val === "away");
    currentMeta.disableScoreB = (val === "home");
    updateResolutionVisibility();
  });
});

const loadInitialState = async () => {
  const settings = await window.overlayDesktop.getSettings();
  setStatusText(settings);
  subscribeToMeta(settings.roomId);
  updateSeasonLeaderboard();
};

const copyAudienceUrl = async () => {
  try {
    await window.overlayDesktop.copyText(audienceUrlInput.value);
    copyAudienceUrlButton.textContent = "Copied";
    window.setTimeout(() => {
      copyAudienceUrlButton.textContent = "Copy";
    }, 1400);
  } catch (error) {
    console.error(error);
    copyAudienceUrlButton.textContent = "Failed";
    window.setTimeout(() => {
      copyAudienceUrlButton.textContent = "Copy";
    }, 1400);
  }
};

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitBtn = settingsForm.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;

  const roomId = normalizeRoomId(roomIdInput.value.trim());

  // Visual Feedback
  submitBtn.disabled = true;
  submitBtn.textContent = "Deploying...";

  try {
    const nextSettings = await window.overlayDesktop.updateSettings({
      roomId,
      opacity: Number(opacityInput.value)
    });
    setStatusText(nextSettings);
    subscribeToMeta(roomId);

    if (isFirebaseConfigured && db) {
      await saveRoomMeta(roomId, getFormMeta());
    }

    await window.overlayDesktop.reloadOverlay();

    submitBtn.textContent = "Deployed";
    setTimeout(() => {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }, 1500);
  } catch (error) {
    console.error(error);
    submitBtn.textContent = "Error";
    setTimeout(() => {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }, 2000);
  }
});

opacityInput.addEventListener("input", async () => {
  const opacity = Number(opacityInput.value);
  opacityValue.textContent = `${Math.round(opacity * 100)}%`;
  setStatusText(await window.overlayDesktop.updateSettings({ opacity }));
});

if (reactionOpacityInput) {
  reactionOpacityInput.addEventListener("input", async () => {
    const reactionOpacity = Number(reactionOpacityInput.value);
    reactionOpacityValue.textContent = `${Math.round(reactionOpacity * 100)}%`;
    setStatusText(await window.overlayDesktop.updateSettings({ reactionOpacity }));
  });
}

copyAudienceUrlButton.addEventListener("click", copyAudienceUrl);

togglePredictionPauseButton.addEventListener("click", async () => {
  if (!isFirebaseConfigured || !db || !currentSettings) {
    return;
  }

  const roomId = normalizeRoomId(roomIdInput.value.trim() || currentSettings.roomId);
  const nextPaused = !Boolean(currentMeta.predictionsPaused);

  try {
    const meta = getFormMeta();
    meta.predictionsPaused = nextPaused;

    await saveRoomMeta(roomId, meta);
    currentMeta = {
      ...currentMeta,
      predictionsPaused: nextPaused
    };
    syncPauseUi();
    await window.overlayDesktop.reloadOverlay();
  } catch (error) {
    console.error(error);
  }
});

toggleHideChatButton.addEventListener("click", async () => {
  if (!isFirebaseConfigured || !db || !currentSettings) {
    return;
  }

  const roomId = normalizeRoomId(roomIdInput.value.trim() || currentSettings.roomId);
  const nextHideChat = !Boolean(currentMeta.hideChat);

  try {
    const meta = getFormMeta();
    meta.hideChat = nextHideChat;

    await saveRoomMeta(roomId, meta);
    currentMeta = {
      ...currentMeta,
      hideChat: nextHideChat
    };
    syncChatUi();
  } catch (error) {
    console.error(error);
  }
});

toggleHideJoinButton.addEventListener("click", async () => {
  if (!isFirebaseConfigured || !db || !currentSettings) {
    return;
  }

  const roomId = normalizeRoomId(roomIdInput.value.trim() || currentSettings.roomId);
  const nextHideJoin = !Boolean(currentMeta.hideJoin);

  try {
    const meta = getFormMeta();
    meta.hideJoin = nextHideJoin;

    await saveRoomMeta(roomId, meta);
    currentMeta = {
      ...currentMeta,
      hideJoin: nextHideJoin
    };
    syncJoinUi();
  } catch (error) {
    console.error(error);
  }
});

toggleSortModeButton.addEventListener("click", async () => {
  if (!isFirebaseConfigured || !db || !currentSettings) {
    return;
  }

  const roomId = normalizeRoomId(roomIdInput.value.trim() || currentSettings.roomId);
  const currentSort = currentMeta.predictionSort || "newest";
  const nextSort = currentSort === "newest" ? "score" : "newest";

  try {
    const meta = getFormMeta();
    meta.predictionSort = nextSort;

    await saveRoomMeta(roomId, meta);
    currentMeta = {
      ...currentMeta,
      predictionSort: nextSort
    };
    syncSortUi();
    await window.overlayDesktop.reloadOverlay();
  } catch (error) {
    console.error(error);
  }
});

showOverlayButton.addEventListener("click", async () => {
  setStatusText(await window.overlayDesktop.showOverlay());
});

hideOverlayButton.addEventListener("click", async () => {
  setStatusText(await window.overlayDesktop.hideOverlay());
});

reloadOverlayButton.addEventListener("click", async () => {
  setStatusText(await window.overlayDesktop.reloadOverlay());
});

resetBoundsButton.addEventListener("click", async () => {
  setStatusText(await window.overlayDesktop.resetBounds());
});

showTickerButton.addEventListener("click", async () => {
  setStatusText(await window.overlayDesktop.showTicker());
});

hideTickerButton.addEventListener("click", async () => {
  setStatusText(await window.overlayDesktop.hideTicker());
});

reloadTickerButton.addEventListener("click", async () => {
  setStatusText(await window.overlayDesktop.reloadTicker());
});

resetTickerBoundsButton.addEventListener("click", async () => {
  setStatusText(await window.overlayDesktop.resetTickerBounds());
});

if (showReactionButton) {
  showReactionButton.addEventListener("click", async () => {
    setStatusText(await window.overlayDesktop.showReaction());
  });
}
if (hideReactionButton) {
  hideReactionButton.addEventListener("click", async () => {
    setStatusText(await window.overlayDesktop.hideReaction());
  });
}
if (reloadReactionButton) {
  reloadReactionButton.addEventListener("click", async () => {
    setStatusText(await window.overlayDesktop.reloadReaction());
  });
}
if (resetReactionBoundsButton) {
  resetReactionBoundsButton.addEventListener("click", async () => {
    setStatusText(await window.overlayDesktop.resetReactionBounds());
  });
}

window.overlayDesktop.onSettingsChanged((settings) => {
  setStatusText(settings);
  subscribeToMeta(settings.roomId);
  updateSeasonLeaderboard();
});

// --- CLEAR HANDLERS ---
const handleClear = async (node, button) => {
  if (!isFirebaseConfigured || !db || !currentSettings) return;
  const originalText = button.textContent;
  const roomId = normalizeRoomId(roomIdInput.value.trim() || currentSettings.roomId);

  if (!confirm(`Are you sure you want to clear ALL ${node} for room ${roomId}?`)) return;

  try {
    button.disabled = true;
    button.textContent = "Clearing...";
    await clearRoomNode(roomId, node);
    button.textContent = "Cleared";
    setTimeout(() => {
      button.disabled = false;
      button.textContent = originalText;
    }, 1500);
  } catch (error) {
    console.error(error);
    button.textContent = "Error";
    setTimeout(() => {
      button.disabled = false;
      button.textContent = originalText;
    }, 1500);
  }
};

clearPredictionsButton.addEventListener("click", () => handleClear("predictions", clearPredictionsButton));
clearChatButton.addEventListener("click", () => handleClear("chat", clearChatButton));
clearReactionsButton.addEventListener("click", () => handleClear("reaction", clearReactionsButton));



// Match Resolution Logic
const resolution1st = document.getElementById("resolution1st");
const resolution2nd = document.getElementById("resolution2nd");
const actualScoreInput = document.getElementById("actualScore");
const chaserWonRadios = document.getElementsByName("chaserWon");
const labelChaserWon = document.getElementById("labelChaserWon");
const actualResultInput = document.getElementById("actualResult");
const labelActualResult = document.getElementById("labelActualResult");
const calculatePointsButton = document.getElementById("calculatePoints");
const resultsDashboard = document.getElementById("resultsDashboard");
const resultsBody = document.getElementById("resultsBody");
const closeResultsButton = document.getElementById("closeResults");
const resActualScoreLabel = document.getElementById("resActualScore");
const resSectionTitle = document.getElementById("resSectionTitle");
const viewFinalStandingsButton = document.getElementById("viewFinalStandings");
const overallDashboard = document.getElementById("overallDashboard");
const overallBody = document.getElementById("overallBody");
const overallMatchTitle = document.getElementById("overallMatchTitle");
const closeOverallButton = document.getElementById("closeOverall");
const exportOverallCsvButton = document.getElementById("exportOverallCsv");
const endMatchButton = document.getElementById("endMatch");
const exportCsvButton = document.getElementById("exportCsv");
const clearPrep2ndButton = document.getElementById("clearAndPrep2nd");


const calculateFootballPoints = (prediction, actualA, actualB) => {
  let points = 0;
  
  const predA = Number(prediction.scoreA || 0);
  const predB = Number(prediction.scoreB || 0);
  
  const actualDiff = actualA - actualB;
  const predDiff = predA - predB;
  
  const actualWinner = actualDiff > 0 ? "home" : actualDiff < 0 ? "away" : "draw";
  const predWinner = predDiff > 0 ? "home" : predDiff < 0 ? "away" : "draw";
  
  // 1. Correct Winner (40 points)
  if (actualWinner === predWinner) {
    points += 40;
  }
  
  // 2. Goal Difference Accuracy (20 points for exact diff)
  if (actualDiff === predDiff) {
    points += 20;
  }
  
  // 3. Goal Accuracy (20 points per team)
  if (predA === actualA) points += 20;
  if (predB === actualB) points += 20;
  
  // 4. Exact Score Bonus (50 points)
  const isExact = (predA === actualA && predB === actualB);
  if (isExact) {
    points += 50;
  }
  
  return {
    points,
    guess: `${predA} - ${predB}`,
    isExact,
    rawDiff: Math.abs(predA - actualA) + Math.abs(predB - actualB) // Used for tie-breaking
  };
};

const resolveMatch = async () => {
  if (!isFirebaseConfigured || !db || !currentSettings) return;
  const roomId = normalizeRoomId(roomIdInput.value.trim() || currentSettings.roomId);

  const actualScoreAInput = document.getElementById("actualScoreA");
  const actualScoreBInput = document.getElementById("actualScoreB");
  
  const actualA = parseInt(actualScoreAInput.value);
  const actualB = parseInt(actualScoreBInput.value);

  if (isNaN(actualA) || isNaN(actualB)) {
    alert("Please enter valid goals for both Team A and Team B.");
    return;
  }

  try {
    calculatePointsButton.disabled = true;
    calculatePointsButton.textContent = "Calculating...";

    // Fetch all predictions once
    const snapshot = await getOnce(roomRef(roomId, "predictions"));
    const predData = snapshot.val() || {};
    const predictions = Object.values(predData);

    if (predictions.length === 0) {
      alert("No predictions found in this room.");
      calculatePointsButton.disabled = false;
      calculatePointsButton.textContent = "Resolve Match";
      return;
    }

    // Process points
    const results = Object.entries(predData).map(([cid, p]) => {
      const pResult = calculateFootballPoints(p, actualA, actualB);

      return {
        clientId: cid,
        name: p.name || "Anonymous",
        ...pResult,
        originalPrediction: p
      };
    });

    // Sort Descending; break tie by rawDiff ascending (closest prediction ranks higher)
    const sortedResults = [...results].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const aDiff = typeof a.rawDiff === 'number' ? a.rawDiff : Infinity;
      const bDiff = typeof b.rawDiff === 'number' ? b.rawDiff : Infinity;
      return aDiff - bDiff;
    });
    lastResults = sortedResults;

    // Render Dashboard
    renderDashboard(sortedResults, `${actualA} - ${actualB}`);

    calculatePointsButton.disabled = false;
    calculatePointsButton.textContent = "Resolve Match";
  } catch (error) {
    console.error(error);
    alert("Error resolving match scores.");
    calculatePointsButton.disabled = false;
    calculatePointsButton.textContent = "Resolve Match";
  }
};

const renderDashboard = (results, actual) => {
  resActualScoreLabel.textContent = actual;

  resultsBody.innerHTML = results.map((r, i) => {
    let rankBadge = `<span class="rank-pill">${i + 1}</span>`;
    if (i === 0) rankBadge = `<span class="rank-pill rank-1">1</span>`;
    else if (i === 1) rankBadge = `<span class="rank-pill rank-2">2</span>`;
    else if (i === 2) rankBadge = `<span class="rank-pill rank-3">3</span>`;

    const exactBadge = r.isExact ? `<span class="exact-tag">EXACT!</span>` : "";

    return `
      <tr>
        <td>${rankBadge}</td>
        <td style="font-weight:700;">${escapeHtml(r.name)}</td>
        <td>${r.guess}</td>
        <td>${r.rawDiff} diff</td>
        <td style="font-weight:800; font-size:16px;">${r.points}</td>
      </tr>
    `;
  }).join("");

  resultsDashboard.classList.remove("hidden");
};

const downloadCSV = () => {
  if (lastResults.length === 0) return;

  const headers = ["Rank", "Name", "Guess", "Actual", "Diff", "Points"];
  const rows = lastResults.map((r, i) => [
    i + 1,
    r.name,
    r.guess,
    actualScoreInput.value,
    r.diff,
    r.points
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.join(","))
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `Match_Results_${new Date().toLocaleDateString()}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

calculatePointsButton.addEventListener("click", resolveMatch);
closeResultsButton.addEventListener("click", () => resultsDashboard.classList.add("hidden"));
exportCsvButton.addEventListener("click", downloadCSV);

viewFinalStandingsButton.addEventListener("click", async () => {
  const roomId = normalizeRoomId(roomIdInput.value.trim() || currentSettings.roomId);

  if (!confirm(`Finalize match and view final standings?`)) return;

  try {
    viewFinalStandingsButton.disabled = true;
    viewFinalStandingsButton.textContent = "Archiving...";

    // 1. Archive Results to History
    if (lastResults.length > 0) {
      const historyPayload = {};
      lastResults.forEach(r => {
        historyPayload[r.clientId || `legacy-${r.name}`] = {
          name: r.name,
          points: r.points,
          guess: r.guess,
          predictedWinner: r.originalPrediction?.predictedWinner || ""
        };
      });
      await saveInningsHistory(roomId, "final", historyPayload);
    }

    // 2. Automated Stage Transition
    const nextMeta = getFormMeta();
    nextMeta.matchState = "Full Time";
    await saveRoomMeta(roomId, nextMeta);

    // 3. Render Final Standings (simplified logic for football)
    overallMatchTitle.textContent = `${nextMeta.teamA || "Team A"} vs ${nextMeta.teamB || "Team B"} (Final Standings)`;
    overallBody.innerHTML = lastResults.map((r, i) => `
      <tr>
        <td><span class="rank-pill ${i < 3 ? 'rank-' + (i + 1) : ''}">${i + 1}</span></td>
        <td style="font-weight:700;">${escapeHtml(r.name)}</td>
        <td>${r.originalPrediction?.scoreA || 0}</td>
        <td>${r.originalPrediction?.scoreB || 0}</td>
        <td>0</td>
        <td style="font-weight:800; font-size:16px;">${r.points}</td>
      </tr>
    `).join("");

    resultsDashboard.classList.add("hidden");
    overallDashboard.classList.remove("hidden");
    
    document.getElementById("actualScoreA").value = "";
    document.getElementById("actualScoreB").value = "";

    viewFinalStandingsButton.disabled = false;
    viewFinalStandingsButton.textContent = "View Final Game Standings";
  } catch (error) {
    console.error(error);
    alert("Error finalizing match.");
    viewFinalStandingsButton.disabled = false;
  }
});

loadInitialState();

// --- Final Match & Combined Scoring Logic ---

// --- Standings Sync ---
const updateSeasonLeaderboard = async () => {
  if (!isFirebaseConfigured || !db || !currentSettings) return;
  const roomId = normalizeRoomId(roomIdInput.value.trim() || currentSettings.roomId);

  try {
    const history = await getHistory(roomId);
    if (!history) return;

    const seasonMap = new Map();
    Object.values(history).forEach(match => {
      const results = match.finalStandings || [];
      results.forEach(r => {
        const key = r.name.trim().toLowerCase();
        if (!seasonMap.has(key)) {
          seasonMap.set(key, { name: r.name, total: 0, matchCount: 0 });
        }
        const player = seasonMap.get(key);
        player.total += (r.total || 0);
        player.matchCount += 1;
      });
    });

    const players = Array.from(seasonMap.values()).map(p => ({
      ...p,
      ppg: Number((p.total / (p.matchCount || 1)).toFixed(2))
    }));

    // Sort by total points for the persistent leaderboard node
    const sorted = players.sort((a, b) => b.total - a.total);

    // Persist to Firebase
    await saveSeasonLeaderboard(roomId, sorted);
    console.log("Season leaderboard persisted successfully.");
  } catch (error) {
    console.error("Error updating season leaderboard:", error);
  }
};

let seasonSortMode = "total"; // "total" or "ppg"

window.showSeasonStats = async () => {
  if (!isFirebaseConfigured || !db || !currentSettings) return;
  const roomId = normalizeRoomId(roomIdInput.value.trim() || currentSettings.roomId);

  // Active state in sidebar
  document.querySelectorAll(".match-item").forEach(el => el.classList.remove("active"));
  document.getElementById("item-season-stats")?.classList.add("active");

  matchDetail.innerHTML = `<div class="empty-state"><p>Calculating & Syncing Season Standings...</p></div>`;

  try {
    // 1. Sync to Firebase (and Audience)
    await updateSeasonLeaderboard();
    const history = await getHistory(roomId);
    if (!history || Object.keys(history).length === 0) {
      matchDetail.innerHTML = `
        <div class="history-section">
          <div class="history-section-title">Season Rankings</div>
          <div class="empty-state"><p>No history data found in this room yet.</p></div>
        </div>
      `;
      return;
    }

    const seasonMap = new Map();
    Object.values(history).forEach(match => {
      const results = match.finalStandings || [];
      results.forEach(r => {
        const key = r.name.trim().toLowerCase();
        if (!seasonMap.has(key)) {
          seasonMap.set(key, { name: r.name, total: 0, matchCount: 0 });
        }
        const player = seasonMap.get(key);
        player.total += (r.total || 0);
        player.matchCount += 1;
      });
    });

    const players = Array.from(seasonMap.values()).map(p => ({
      ...p,
      ppg: Number((p.total / (p.matchCount || 1)).toFixed(2))
    }));

    const sorted = players.sort((a, b) => {
      if (seasonSortMode === "ppg") return b.ppg - a.ppg;
      return b.total - a.total;
    });

    matchDetail.innerHTML = `
      <div class="history-section">
        <div class="stats-header" style="flex-direction:column; align-items:flex-start; gap:10px;">
          <div class="history-section-title">Season Standings</div>
          <div class="season-sort-toggle">
            <div class="sort-item ${seasonSortMode === "total" ? "active" : ""}" onclick="window.setSeasonSort('total')">Total Points</div>
            <div class="sort-item ${seasonSortMode === "ppg" ? "active" : ""}" onclick="window.setSeasonSort('ppg')">Points Per Match</div>
          </div>
        </div>

        <table class="results-table">
          <thead>
            <tr>
              <th style="width:60px;">Rank</th>
              <th>Name</th>
              <th style="text-align:center;">Games</th>
              <th style="text-align:right;">${seasonSortMode === "ppg" ? "Avg PPG" : "Total Points"}</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map((s, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>
                  <div style="font-weight:700;">${escapeHtml(s.name)}</div>
                  <div class="ppg-label">${s.ppg} pts/game</div>
                </td>
                <td style="text-align:center;">
                  <span class="match-badge">${s.matchCount}</span>
                </td>
                <td style="font-weight:800; font-size:18px; color:var(--accent-blue); text-align:right;">
                  ${seasonSortMode === "ppg" ? s.ppg : s.total}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (error) {
    console.error(error);
    matchDetail.innerHTML = `<div class="empty-state"><p>Error loading history.</p></div>`;
  }
};

window.setSeasonSort = (mode) => {
  seasonSortMode = mode;
  showSeasonStats();
};

let editingMatchKey = null;

window.openEditMatch = (key) => {
  const match = fullHistory[key];
  if (!match) return;
  editingMatchKey = key;

  const res = match.matchResults || {};
  const dateStr = key.split("_")[0];

  editMatchTitle.value = match.matchTitle || "";
  editMatchDate.value = dateStr;
  editTeamA.value = match.teamA || "Team A";
  editTeamB.value = match.teamB || "Team B";
  editActual1st.value = res.actualA || res.actual1st || "";
  editActual2nd.value = res.actualB || res.actual2nd || "";

  document.getElementById("editLabelA").textContent = editTeamA.value;
  document.getElementById("editLabelB").textContent = editTeamB.value;

  editMatchModal.classList.remove("hidden");
};

const updateEditLabels = () => {
  document.getElementById("editLabelA").textContent = editTeamA.value || "Team A";
  document.getElementById("editLabelB").textContent = editTeamB.value || "Team B";
};

editTeamA.addEventListener("input", updateEditLabels);
editTeamB.addEventListener("input", updateEditLabels);

window.saveEditedMatch = async () => {
  if (!editingMatchKey) return;
  const roomId = normalizeRoomId(roomIdInput.value.trim() || currentSettings.roomId);
  
  const title = editMatchTitle.value.trim();
  const date = editMatchDate.value;
  const teamA = editTeamA.value.trim();
  const teamB = editTeamB.value.trim();
  const actualA = Number(editActual1st.value);
  const actualB = Number(editActual2nd.value);

  if (!title || !date || !teamA || !teamB || isNaN(actualA) || isNaN(actualB)) {
    alert("Please fill all fields correctly.");
    return;
  }

  try {
    saveEditMatchBtn.disabled = true;
    saveEditMatchBtn.textContent = "Recalculating...";
    matchList.classList.add("loading");

    const originalRecord = fullHistory[editingMatchKey];
    if (!originalRecord) throw new Error("Original match record not found in memory.");

    const matchSnapshot = JSON.parse(JSON.stringify(originalRecord));
    matchSnapshot.matchTitle = title;
    matchSnapshot.teamA = teamA;
    matchSnapshot.teamB = teamB;
    matchSnapshot.matchResults = { actualA, actualB };

    // Recalculate Final Standings based on original predictions
    if (matchSnapshot.final) {
      for (const pid in matchSnapshot.final) {
        const p = matchSnapshot.final[pid];
        const stats = calculateFootballPoints(p.originalPrediction || p, actualA, actualB);
        matchSnapshot.final[pid] = { ...p, ...stats };
      }
      matchSnapshot.finalStandings = Object.values(matchSnapshot.final).map(p => ({
        name: p.name,
        guess: p.guess,
        points: p.points,
        total: p.points
      }));
    }

    // Persistence Logic
    const oldDateKey = editingMatchKey;
    const newDateKey = `${date}_${oldDateKey.split("_")[1] || Date.now()}`;

    // Update Firebase
    if (oldDateKey !== newDateKey) {
      await archiveToHistory(roomId, newDateKey, matchSnapshot);
      await clearRoomNode(roomId, `history/${oldDateKey}`);
    } else {
      await archiveToHistory(roomId, oldDateKey, matchSnapshot);
    }
    
    // Sync Season Leaderboard
    await updateSeasonLeaderboard();

    console.log("Saving complete. refreshing history...");
    await openHistory(); 

    editingMatchKey = newDateKey;

    editMatchModal.classList.add("hidden");
    alert("Match updated and points recalculated!");
    
    window.selectArchivedMatch(newDateKey);

  } catch (error) {
    console.error("Save Edit Failed:", error);
    alert("Error updating match: " + error.message);
  } finally {
    saveEditMatchBtn.disabled = false;
    saveEditMatchBtn.textContent = "Save & Recalculate";
    matchList.classList.remove("loading");
  }
};

cancelEditMatchBtn.addEventListener("click", () => editMatchModal.classList.add("hidden"));
saveEditMatchBtn.addEventListener("click", window.saveEditedMatch);

window.selectArchivedMatch = (key) => {
  const match = fullHistory[key];
  if (!match) return;

  // Active state
  document.querySelectorAll(".match-item").forEach(el => el.classList.remove("active"));
  document.getElementById(`item-${key}`)?.classList.add("active");

  const buildTable = (data, title) => {
    const rows = Object.values(data).sort((a, b) => (b.points || 0) - (a.points || 0));
    return `
      <div class="history-section">
        <div class="history-section-title">${title}</div>
        <table class="results-table">
          <thead>
            <tr><th>Name</th><th>Guess</th><th>Points</th></tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td style="font-weight:700;">${escapeHtml(r.name)}</td>
                <td>${r.guess}</td>
                <td style="font-weight:800;">${r.points}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  };

  const finalRows = [...(match.finalStandings || [])].sort((a, b) => (b.total || 0) - (a.total || 0));
  const finalTable = `
    <div class="history-section">
      <div class="history-section-title">Final Match Standings</div>
      <table class="results-table">
        <thead>
          <tr><th>Name</th><th>Guess</th><th>Total</th></tr>
        </thead>
        <tbody>
          ${finalRows.map(r => `
            <tr>
              <td style="font-weight:700;">${escapeHtml(r.name)}</td>
              <td>${r.guess}</td>
              <td style="font-weight:800; font-size:16px; color:var(--accent-blue);">${r.total}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  matchDetail.innerHTML = `
    <div class="stats-header" style="margin-bottom:15px;">
      <div class="history-section-title" style="margin:0;">${escapeHtml(match.matchTitle)}</div>
    </div>
    <div class="history-grid">
      ${finalTable}
    </div>
  `;
};

  const finalRows = [...(match.finalStandings || [])].sort((a, b) => (b.total || 0) - (a.total || 0));
  const finalTable = `
    <div class="history-section">
      <div class="history-section-title">Final Match Standings</div>
      <table class="results-table">
        <thead>
          <tr><th>Name</th><th>Guess</th><th>Total</th></tr>
        </thead>
        <tbody>
          ${finalRows.map(r => `
            <tr>
              <td style="font-weight:700;">${escapeHtml(r.name)}</td>
              <td>${r.guess}</td>
              <td style="font-weight:800; font-size:16px; color:var(--accent-blue);">${r.total}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  matchDetail.innerHTML = `
    <div class="stats-header" style="margin-bottom:15px;">
      <div class="history-section-title" style="margin:0;">${escapeHtml(match.matchTitle)}</div>
    </div>
    <div class="history-grid">
      ${finalTable}
    </div>
  `;
};

const handleEndMatch = async () => {
  const roomId = normalizeRoomId(roomIdInput.value.trim() || currentSettings.roomId);
  if (!confirm("Are you sure you want to end the match? The live room will be cleared for a new game.")) return;

  try {
    endMatchButton.disabled = true;
    endMatchButton.textContent = "Clearing...";

    // 1. Wipe Live Match Data
    await wipeMatchData(roomId);

    overallDashboard.classList.add("hidden");
    alert("Live Room Reset.");
    location.reload();
  } catch (error) {
    console.error(error);
    alert("Error clearing match data.");
    endMatchButton.disabled = false;
    endMatchButton.textContent = "End Match & Archive Data";
  }
};

// History Explorer Functions
const openHistory = async () => {
  if (!isFirebaseConfigured || !db || !currentSettings) return;
  const roomId = normalizeRoomId(roomIdInput.value.trim() || currentSettings.roomId);

  historyDashboard.classList.remove("hidden");
  window.showSeasonStats(); // Default view

  try {
    const history = await getHistory(roomId);
    fullHistory = history || {};
    renderMatchList(fullHistory);
  } catch (error) {
    console.error(error);
  }
};

const renderMatchList = (history) => {
  const matches = sortHistoryLatestFirst(history);

  if (matches.length === 0) {
    matchList.innerHTML = `<div class="panel-note">No archived matches found.</div>`;
    return;
  }

  matchList.innerHTML = matches.map(([key, match]) => {
    const dateStr = key.split("_")[0];
    return `
      <div class="match-item" onclick="window.selectArchivedMatch('${key}')" id="item-${key}" style="position:relative;">
        <div>
          <label>${dateStr}</label>
          <span>${escapeHtml(match.matchTitle)}</span>
        </div>
        <button class="edit-item-btn" onclick="event.stopPropagation(); window.openEditMatch('${key}')" title="Edit Match Results">✎</button>
      </div>
    `;
  }).join("");
};

window.selectArchivedMatch = (key) => {
  const match = fullHistory[key];
  if (!match) return;

  // Active state
  document.querySelectorAll(".match-item").forEach(el => el.classList.remove("active"));
  document.getElementById(`item-${key}`)?.classList.add("active");

  const buildTable = (data, title) => {
    const rows = Object.values(data).sort((a, b) => (b.points || 0) - (a.points || 0));
    return `
      <div class="history-section">
        <div class="history-section-title">${title}</div>
        <table class="results-table">
          <thead>
            <tr><th>Name</th><th>Guess</th><th>Points</th></tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td style="font-weight:700;">${escapeHtml(r.name)}</td>
                <td>${r.guess}</td>
                <td style="font-weight:800;">${r.points}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  };

  const finalRows = [...(match.finalStandings || [])].sort((a, b) => (b.total || 0) - (a.total || 0));
  const finalTable = `
    <div class="history-section">
      <div class="history-section-title">Final Match Standings</div>
      <table class="results-table">
        <thead>
          <tr><th>Name</th><th>1st Inn</th><th>2nd Inn</th><th>Penalty</th><th>Total</th></tr>
        </thead>
        <tbody>
          ${finalRows.map(r => `
            <tr>
              <td style="font-weight:700;">${escapeHtml(r.name)}</td>
              <td>${r.p1Score}</td>
              <td>${r.p2Score}</td>
              <td>${r.penalty}</td>
              <td style="font-weight:800; font-size:16px; color:var(--accent-blue);">${r.total}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  matchDetail.innerHTML = `
    <div class="history-grid">
      ${finalTable}
      ${buildTable(match.innings1 || {}, "1st Innings Rankings")}
      ${buildTable(match.innings2 || {}, "2nd Innings Rankings")}
    </div>
  `;
};

mainViewHistoryBtn.addEventListener("click", openHistory);
closeHistoryBtn.addEventListener("click", () => historyDashboard.classList.add("hidden"));

// Manual Entry Logic
const addManualRow = () => {
  if (!manualPlayersBody) return;
  const teamA = manTeamAInput.value.trim() || "Team A";
  const teamB = manTeamBInput.value.trim() || "Team B";

  const tr = document.createElement("tr");
  tr.className = "manual-player-row";
  tr.innerHTML = `
    <td><input type="text" class="m-name" placeholder="Name" /></td>
    <td><input type="number" class="m-p1-guess" placeholder="A Goals" /></td>
    <td><input type="number" class="m-p2-guess" placeholder="B Goals" /></td>
    <td class="m-points-calc" style="color:var(--text-muted);">--</td>
    <td><button class="remove-row-btn">&times;</button></td>
  `;
  
  tr.querySelector(".remove-row-btn").onclick = () => tr.remove();
  manualPlayersBody.appendChild(tr);
};

const saveManualMatch = async () => {
  const dateStr = document.querySelector("#manualDate").value;
  const title = document.querySelector("#manualTitle").value.trim();
  const teamA = manTeamAInput.value.trim() || "Team A";
  const teamB = manTeamBInput.value.trim() || "Team B";
  const actualA = Number(document.querySelector("#manualActual1st").value);
  const actualB = Number(document.querySelector("#manualActual2nd").value);

  const roomId = normalizeRoomId(roomIdInput.value.trim() || (currentSettings && currentSettings.roomId));

  if (!dateStr || !title || isNaN(actualA) || isNaN(actualB)) {
    alert("Please fill in all match setup fields.");
    return;
  }

  if (!roomId) {
    alert("Error: Room Identity is missing. Please enter a Room ID at the top of the page first.");
    return;
  }

  const rows = document.querySelectorAll(".manual-player-row");
  if (rows.length === 0) {
    alert("Add at least one player.");
    return;
  }

  try {
    document.getElementById("saveManualMatch").disabled = true;
    document.getElementById("saveManualMatch").textContent = "Saving...";

    const finalStandingsData = {};

    rows.forEach((row, i) => {
      const name = row.querySelector(".m-name").value.trim() || `Player ${i + 1}`;
      const scoreA = Number(row.querySelector(".m-p1-guess").value) || 0;
      const scoreB = Number(row.querySelector(".m-p2-guess").value) || 0;

      const pReq = {
        name,
        scoreA,
        scoreB
      };

      const result = calculateFootballPoints(pReq, actualA, actualB);

      finalStandingsData[`manual_${Date.now()}_${i}`] = {
        name,
        guess: result.guess,
        points: result.points,
        total: result.points,
        originalPrediction: pReq
      };
    });

    const finalStandingsList = Object.values(finalStandingsData).map(p => ({
      name: p.name,
      guess: p.guess,
      points: p.points,
      total: p.total
    }));

    const dateKey = `${dateStr}_${Date.now()}`;
    const archivePayload = {
      matchTitle: title,
      teamA,
      teamB,
      final: finalStandingsData,
      finalStandings: finalStandingsList,
      matchResults: {
        actualA,
        actualB
      }
    };

    await archiveToHistory(roomId, dateKey, archivePayload);
    await updateSeasonLeaderboard();
    
    document.getElementById("manualEntryDashboard").classList.add("hidden");
    alert("Manual Match Archived Successfully!");
    
    await openHistory();

  } catch (error) {
    console.error("Manual Save Error:", error);
    alert("Failed to save match: " + error.message);
  } finally {
    document.getElementById("saveManualMatch").disabled = false;
    document.getElementById("saveManualMatch").textContent = "Calculate & Archive Match";
  }
};

showManualEntryBtn.addEventListener("click", () => {
  manualPlayersBody.innerHTML = "";
  addManualRow();
  manualEntryDashboard.classList.remove("hidden");
});

closeManualEntryBtn.addEventListener("click", () => manualEntryDashboard.classList.add("hidden"));
cancelManualSaveBtn.addEventListener("click", () => manualEntryDashboard.classList.add("hidden"));
addManualRowBtn.addEventListener("click", addManualRow);

const updateManualTeamLabels = () => {
  const teamA = manTeamAInput.value.trim() || "Team A";
  const teamB = manTeamBInput.value.trim() || "Team B";
  
  // 1. Update Winner radios
  const labelA = document.getElementById("manWinALabel");
  const labelB = document.getElementById("manWinBLabel");
  if (labelA) labelA.textContent = teamA;
  if (labelB) labelB.textContent = teamB;

  // 2. Update existing rows
  document.querySelectorAll(".manual-player-row").forEach(row => {
    const select1 = row.querySelector(".m-winner-1");
    if (select1) {
      select1.options[0].text = teamA;
      select1.options[1].text = teamB;
    }
    const select2 = row.querySelector(".m-winner-2");
    if (select2) {
      select2.options[0].text = teamA;
      select2.options[1].text = teamB;
    }
  });
};

manTeamAInput.addEventListener("input", updateManualTeamLabels);
manTeamBInput.addEventListener("input", updateManualTeamLabels);

saveManualMatchBtn.addEventListener("click", saveManualMatch);

viewFinalStandingsButton.addEventListener("click", viewFinalStandings);
endMatchButton.addEventListener("click", handleEndMatch);
exportCsvButton.addEventListener("click", downloadCSV);
exportOverallCsvButton.addEventListener("click", downloadOverallCSV);
closeOverallButton.addEventListener("click", () => overallDashboard.classList.add("hidden"));

// --- DATA UTILITIES (Run from Console) ---
window.renamePlayer = async (oldName, newName) => {
  if (!oldName || !newName) return console.error("Usage: renamePlayer('Old', 'New')");
  const roomId = normalizeRoomId(roomIdInput.value.trim() || currentSettings.roomId);
  if (!roomId) return console.error("No Room ID found.");
  
  console.log(`Renaming '${oldName}' to '${newName}' in room: ${roomId}...`);
  try {
    const history = await getHistory(roomId);
    if (!history) return console.log("No history found.");

    let updateCount = 0;
    for (const [dateKey, match] of Object.entries(history)) {
      let changed = false;
      const m = JSON.parse(JSON.stringify(match));

      const processNode = (obj) => {
        if (!obj) return;
        if (obj[oldName]) {
          const data = obj[oldName];
          data.name = newName;
          obj[newName] = data;
          delete obj[oldName];
          changed = true;
        }
      };

      processNode(m.innings1);
      processNode(m.innings2);
      if (m.finalStandings) {
        m.finalStandings.forEach(r => {
          if (r.name === oldName) { r.name = newName; changed = true; }
        });
      }

      if (changed) {
        await archiveToHistory(roomId, dateKey, m);
        updateCount++;
        console.log(`Updated match: ${dateKey}`);
      }
    }

    console.log(`Migration Complete. Updated ${updateCount} matches.`);
    alert(`Success: '${oldName}' renamed to '${newName}' in ${updateCount} matches.`);
    showSeasonStats();
  } catch (err) {
    console.error("Migration Failed:", err);
    alert(`Migration error: ${err.message}`);
  }
};


    labelBattingA.textContent = match.home;
    labelBattingB.textContent = match.away;
    
    // Pre-select 1st Innings
    document.querySelector("#innings1st").checked = true;
    
    alert(`Loaded Match #${match.matchNo} (${match.home} vs ${match.away}). Preview looks good? Click "Deploy Changes" below.`);
    settingsForm.querySelector("button[type='submit']").focus();
  });
}
