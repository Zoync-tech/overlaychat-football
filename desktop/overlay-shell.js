const overlayFrame = document.querySelector("#overlayFrame");
const toggleClickThroughButton = document.querySelector("#toggleClickThrough");
const openControlsButton = document.querySelector("#openControls");

const renderUrl = async (settings) => {
  const url = new URL(settings.overlayBaseUrl);
  url.searchParams.set("room", settings.roomId);
  url.searchParams.set("mode", "desktop");
  if (overlayFrame.src !== url.toString()) {
    overlayFrame.src = url.toString();
  }
};

toggleClickThroughButton.addEventListener("click", async () => {
  await window.overlayDesktop.toggleClickThrough();
});

openControlsButton.addEventListener("click", async () => {
  await window.overlayDesktop.openControls();
});

window.overlayDesktop.onOverlayUrl((url) => {
  if (overlayFrame.src !== url) {
    overlayFrame.src = url;
  }
});

window.overlayDesktop.onSettingsChanged(renderUrl);
window.overlayDesktop.getSettings().then(renderUrl);
