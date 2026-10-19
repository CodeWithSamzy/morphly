const fileInput = document.querySelector("#file-input");
const chooseButton = document.querySelector("#choose-image");
const changePhotoButton = document.querySelector("#change-photo");
const preview = document.querySelector("#preview");
const emptyState = document.querySelector("#empty-state");
const comparison = document.querySelector("#comparison");
const originalImage = document.querySelector("#original-image");
const editedImage = document.querySelector("#edited-image");
const consentCheck = document.querySelector("#consent-check");
const applyButton = document.querySelector("#apply-button");
const resetButton = document.querySelector("#reset-button");
const downloadButton = document.querySelector("#download-button");
const shareButton = document.querySelector("#share-button");
const compareSlider = document.querySelector("#compare-slider");
const compareLine = document.querySelector("#compare-line");
const promptInput = document.querySelector("#prompt-input");
const statusMessage = document.querySelector("#status-message");
const canvas = document.querySelector("#image-canvas");
const context = canvas.getContext("2d");
const imageMeta = document.querySelector("#image-meta");
const workspaceLabel = document.querySelector("#workspace-label");

let sourceImage = null;
let sourceFile = null;
let sourceUrl = null;
let outputUrl = null;
let outputBlob = null;
let imageName = "morphly-image";
let isGenerating = false;

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function updateControls() {
  const hasImage = Boolean(sourceImage);
  applyButton.disabled = !hasImage || !consentCheck.checked || !promptInput.value.trim() || isGenerating;
  applyButton.setAttribute("aria-busy", String(isGenerating));
  resetButton.disabled = !hasImage || isGenerating;
  downloadButton.disabled = !outputBlob;
  shareButton.disabled = !outputBlob;
  compareSlider.disabled = !outputBlob;
  changePhotoButton.hidden = !hasImage;
}

function applyComparison(position) {
  const value = Number(position);
  editedImage.style.clipPath = `inset(0 0 0 ${value}%)`;
  compareLine.style.left = `${value}%`;
}

function clearOutput() {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
  outputBlob = null;
  editedImage.removeAttribute("src");
  comparison.hidden = true;
  emptyState.hidden = !sourceImage;
  compareSlider.value = "50";
  applyComparison(50);
  updateControls();
}

function loadPhoto(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    setStatus("Choose a JPG, PNG, or WebP image.", true);
    return;
  }
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  clearOutput();
  sourceFile = file;
  sourceUrl = URL.createObjectURL(file);
  const image = new Image();
  sourceImage = image;
  image.onload = () => {
    if (sourceImage !== image) return;
    originalImage.src = sourceUrl;
    emptyState.hidden = true;
    comparison.hidden = false;
    editedImage.src = sourceUrl;
    imageName = file.name.replace(/\.[^.]+$/, "") || "morphly-image";
    imageMeta.textContent = `${image.naturalWidth} × ${image.naturalHeight} PX · ${file.name.toUpperCase()}`;
    workspaceLabel.textContent = "READY TO EDIT";
    setStatus("Photo loaded. Describe an edit and confirm permission to continue.");
    updateControls();
  };
  image.onerror = () => {
    if (sourceImage !== image) return;
    sourceImage = null;
    sourceFile = null;
    setStatus("That image could not be opened. Try another file.", true);
    updateControls();
  };
  image.src = sourceUrl;
}

async function renderImage() {
  if (!sourceImage || !sourceFile || isGenerating) return;
  isGenerating = true;
  updateControls();
  setStatus("Creating your edit… this can take a little while.");
  try {
    const uploadBudget = 4 * 1024 * 1024;
    let maxSide = 1280;
    let quality = 0.85;
    let imageData = "";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const scale = Math.min(1, maxSide / Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight));
      canvas.width = Math.max(1, Math.round(sourceImage.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceImage.naturalHeight * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
      const uploadBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!uploadBlob) throw new Error("This image could not be prepared. Try another photo.");
      imageData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read this image."));
        reader.readAsDataURL(uploadBlob);
      });
      if (imageData.length <= uploadBudget) break;
      maxSide = Math.round(maxSide * 0.75);
      quality = Math.max(0.6, quality - 0.1);
    }
    if (imageData.length > uploadBudget) throw new Error("That photo is too large to upload. Try a smaller one.");

    const response = await fetch("/api/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: promptInput.value.trim(),
        mimeType: "image/jpeg",
        imageData,
        consent: consentCheck.checked,
      }),
    });
    if (response.status === 401) {
      window.location.assign("/login");
      return;
    }
    if (response.status === 413) throw new Error("That photo is too large to upload. Try a smaller one.");
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The edit could not be created. Try again.");

    const binary = atob(result.imageData);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const nextBlob = new Blob([bytes], { type: result.mimeType || "image/png" });
    const nextUrl = URL.createObjectURL(nextBlob);
    const generatedImage = new Image();
    await new Promise((resolve, reject) => {
      generatedImage.onload = resolve;
      generatedImage.onerror = () => reject(new Error("The generated image could not be displayed."));
      generatedImage.src = nextUrl;
    });

    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputBlob = nextBlob;
    outputUrl = nextUrl;
    editedImage.src = outputUrl;
    canvas.width = generatedImage.naturalWidth;
    canvas.height = generatedImage.naturalHeight;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(generatedImage, 0, 0);
    emptyState.hidden = true;
    comparison.hidden = false;
    workspaceLabel.textContent = "AI EDIT READY";
    setStatus("Your edit is ready. Download it or adjust your prompt to try again.");
  } catch (error) {
    setStatus(error.message || "The edit failed. Please try again.", true);
  } finally {
    isGenerating = false;
    updateControls();
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeShareCard() {
  return new Promise((resolve) => {
    const card = document.createElement("canvas");
    const cardContext = card.getContext("2d");
    card.width = 1200;
    card.height = 1350;
    cardContext.fillStyle = "#f4f5f1";
    cardContext.fillRect(0, 0, card.width, card.height);
    const inset = 56;
    const imageTop = 56;
    const imageHeight = 1080;
    const ratio = Math.min((card.width - inset * 2) / canvas.width, imageHeight / canvas.height);
    const drawWidth = canvas.width * ratio;
    const drawHeight = canvas.height * ratio;
    cardContext.fillStyle = "#e6ebe5";
    cardContext.fillRect(inset, imageTop, card.width - inset * 2, imageHeight);
    cardContext.drawImage(canvas, (card.width - drawWidth) / 2, imageTop + (imageHeight - drawHeight) / 2, drawWidth, drawHeight);
    cardContext.fillStyle = "#202523";
    cardContext.font = "700 30px Manrope, sans-serif";
    cardContext.fillText("Morphly", inset, 1210);
    cardContext.fillStyle = "#286b52";
    cardContext.fillRect(inset + 145, 1183, 18, 18);
    cardContext.fillStyle = "#e6775b";
    cardContext.fillRect(inset + 168, 1183, 18, 18);
    cardContext.fillStyle = "#727b76";
    cardContext.font = "400 18px 'DM Mono', monospace";
    cardContext.fillText("A LITTLE CHANGE. A NEW FEELING.", inset, 1250);
    card.toBlob(resolve, "image/png");
  });
}

function openFilePicker() {
  fileInput.value = "";
  fileInput.click();
}

chooseButton.addEventListener("click", openFilePicker);
changePhotoButton.addEventListener("click", openFilePicker);
fileInput.addEventListener("change", (event) => loadPhoto(event.target.files[0]));
consentCheck.addEventListener("change", () => {
  updateControls();
  if (!consentCheck.checked) setStatus("Confirm your right to edit and send this photo for processing.");
  else if (!outputBlob) setStatus("Ready when you are.");
});
applyButton.addEventListener("click", renderImage);
promptInput.addEventListener("input", updateControls);
document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    promptInput.value = button.dataset.prompt;
    promptInput.focus();
    updateControls();
  });
});
resetButton.addEventListener("click", () => {
  if (!sourceImage) return;
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
  outputBlob = null;
  editedImage.src = sourceUrl;
  comparison.hidden = false;
  emptyState.hidden = true;
  workspaceLabel.textContent = "READY TO EDIT";
  compareSlider.value = "50";
  applyComparison(50);
  setStatus("Showing the original photo.");
  updateControls();
});
compareSlider.addEventListener("input", (event) => applyComparison(event.target.value));
downloadButton.addEventListener("click", () => {
  if (outputBlob) downloadBlob(outputBlob, `${imageName}-morphly.png`);
});
shareButton.addEventListener("click", async () => {
  if (!outputBlob) return;
  const card = await makeShareCard();
  if (!card) {
    setStatus("Could not create a share card. Download the image instead.", true);
    return;
  }
  const file = new File([card], `${imageName}-morphly-card.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ title: "My Morphly edit", files: [file] });
      setStatus("Share card ready.");
    } catch (error) {
      if (error.name === "AbortError") return;
      setStatus("Sharing was unavailable. Downloading your share card instead.");
      downloadBlob(card, file.name);
    }
  } else {
    downloadBlob(card, file.name);
    setStatus("Share card downloaded. Ready to post.");
  }
});

for (const eventName of ["dragenter", "dragover"]) {
  preview.addEventListener(eventName, (event) => {
    event.preventDefault();
    preview.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  preview.addEventListener(eventName, (event) => {
    event.preventDefault();
    preview.classList.remove("dragging");
  });
}
preview.addEventListener("drop", (event) => loadPhoto(event.dataTransfer.files[0]));

updateControls();
setStatus("Choose a photo to begin.");

const signOutButton = document.querySelector("#sign-out");
if (signOutButton) {
  fetch("/api/auth")
    .then((response) => (response.ok ? response.json() : {}))
    .then((data) => {
      if (!data.authEnabled) return;
      signOutButton.hidden = false;
      signOutButton.addEventListener("click", async () => {
        await fetch("/api/auth", { method: "DELETE" }).catch(() => {});
        window.location.assign("/login");
      });
    })
    .catch(() => {});
}
