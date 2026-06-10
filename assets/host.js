import {
  clearRoomNode,
  db,
  isFirebaseConfigured,
  onValue,
  roomRef,
  saveRoomMeta
} from "./firebase.js";
import { getAudienceEntryUrl, buildRoomUrl, getRoomId, setHidden, applyTeamTheme } from "./shared.js";

const roomId = getRoomId();
const hostRoomBadge = document.querySelector("#hostRoomBadge");
const hostSetupNotice = document.querySelector("#hostSetupNotice");
const hostStatus = document.querySelector("#hostStatus");
const matchTitleInput = document.querySelector("#matchTitle");
const teamAInput = document.querySelector("#teamA");
const teamBInput = document.querySelector("#teamB");
const matchStateInput = document.querySelector("#matchState");
const hostForm = document.querySelector("#hostForm");
const audienceLinkInput = document.querySelector("#audienceLink");
const overlayLinkInput = document.querySelector("#overlayLink");
const copyAudienceLinkButton = document.querySelector("#copyAudienceLink");
const copyOverlayLinkButton = document.querySelector("#copyOverlayLink");
const clearPredictionsButton = document.querySelector("#clearPredictions");
const clearChatButton = document.querySelector("#clearChat");

const predictionsPausedInput = document.querySelector("#predictionsPaused");
const allowRepredictionInput = document.querySelector("#allowReprediction");

hostRoomBadge.textContent = roomId;

const setStatus = (text, tone = "default") => {
  hostStatus.textContent = text;
  hostStatus.classList.remove("neutral", "danger");
  if (tone !== "default") {
    hostStatus.classList.add(tone);
  }
};

const audienceUrl = () => getAudienceEntryUrl();
const overlayUrl = () =>
  buildRoomUrl({ shortPath: "/o", fallbackPath: "./overlay.html" }, roomId);

audienceLinkInput.value = audienceUrl();
overlayLinkInput.value = overlayUrl();

const copyText = async (value, successText) => {
  try {
    await navigator.clipboard.writeText(value);
    setStatus(successText, "neutral");
  } catch (error) {
    console.error(error);
    setStatus("Copy failed", "danger");
  }
};

copyAudienceLinkButton.addEventListener("click", () =>
  copyText(audienceLinkInput.value, "Audience URL copied")
);

copyOverlayLinkButton.addEventListener("click", () =>
  copyText(overlayLinkInput.value, "Overlay URL copied")
);

if (!isFirebaseConfigured || !db) {
  setHidden(hostSetupNotice, false);
  setStatus("Setup required", "danger");
} else {
  onValue(roomRef(roomId, "meta"), (snapshot) => {
    const meta = snapshot.val() || {};
    matchTitleInput.value = meta.matchTitle || "";
    teamAInput.value = meta.teamA || "";
    teamBInput.value = meta.teamB || "";
    if (meta.matchState) {
      matchStateInput.value = meta.matchState;
    }
    predictionsPausedInput.checked = Boolean(meta.predictionsPaused);
    allowRepredictionInput.checked = Boolean(meta.allowReprediction);
    applyTeamTheme(meta.teamA, meta.teamB);
  });
}

predictionsPausedInput.addEventListener("change", async () => {
  if (!isFirebaseConfigured || !db) return;
  
  const predictionsPaused = predictionsPausedInput.checked;
  setStatus(predictionsPaused ? "Locking predictions..." : "Unlocking predictions...");
  
  try {
    await saveRoomMeta(roomId, { predictionsPaused });
    setStatus(predictionsPaused ? "Predictions locked" : "Predictions unlocked", "neutral");
  } catch (error) {
    console.error(error);
    setStatus("Failed to update lock", "danger");
    // Revert UI on failure
    predictionsPausedInput.checked = !predictionsPaused;
  }
});

allowRepredictionInput.addEventListener("change", async () => {
  if (!isFirebaseConfigured || !db) return;
  
  const allowReprediction = allowRepredictionInput.checked;
  setStatus(allowReprediction ? "Allowing re-predictions..." : "Disallowing re-predictions...");
  
  try {
    await saveRoomMeta(roomId, { allowReprediction });
    setStatus(allowReprediction ? "Re-predictions allowed" : "Re-predictions disallowed", "neutral");
  } catch (error) {
    console.error(error);
    setStatus("Failed to update re-prediction setting", "danger");
    allowRepredictionInput.checked = !allowReprediction;
  }
});

hostForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isFirebaseConfigured || !db) {
    return;
  }

  const matchTitle = matchTitleInput.value.trim();
  const teamA = teamAInput.value.trim();
  const teamB = teamBInput.value.trim();
  const matchState = matchStateInput.value;

  if (!matchTitle || !teamA || !teamB || !matchState) {
    setStatus("Fill every room field", "danger");
    return;
  }

  setStatus("Saving...");

  try {
    const predictionsPaused = predictionsPausedInput.checked;
    const allowReprediction = allowRepredictionInput.checked;
    await saveRoomMeta(roomId, { matchTitle, teamA, teamB, matchState, predictionsPaused, allowReprediction });
    setStatus("Room setup saved", "neutral");
  } catch (error) {
    console.error(error);
    setStatus("Save failed", "danger");
  }
});

clearPredictionsButton.addEventListener("click", async () => {
  if (!isFirebaseConfigured || !db) {
    return;
  }

  setStatus("Clearing predictions...");
  try {
    await clearRoomNode(roomId, "predictions");
    setStatus("Predictions cleared", "neutral");
  } catch (error) {
    console.error(error);
    setStatus("Could not clear predictions", "danger");
  }
});

clearChatButton.addEventListener("click", async () => {
  if (!isFirebaseConfigured || !db) {
    return;
  }

  setStatus("Clearing chat...");
  try {
    await clearRoomNode(roomId, "chat");
    setStatus("Chat cleared", "neutral");
  } catch (error) {
    console.error(error);
    setStatus("Could not clear chat", "danger");
  }
});
