const form = document.querySelector("#login-form");
const passwordInput = document.querySelector("#password");
const submitButton = document.querySelector("#submit-button");
const statusMessage = document.querySelector("#status");

function safeRedirectTarget() {
  const requested = new URLSearchParams(window.location.search).get("next") || "/";
  if (!requested.startsWith("/") || requested.startsWith("//")) return "/";
  return requested;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!passwordInput.value || submitButton.disabled) return;
  submitButton.disabled = true;
  statusMessage.textContent = "Checking...";
  statusMessage.classList.remove("error");
  try {
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordInput.value }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "That password was not accepted.");
    statusMessage.textContent = "Unlocked. Loading...";
    window.location.replace(safeRedirectTarget());
  } catch (error) {
    statusMessage.textContent = error.message;
    statusMessage.classList.add("error");
    submitButton.disabled = false;
    passwordInput.select();
  }
});
