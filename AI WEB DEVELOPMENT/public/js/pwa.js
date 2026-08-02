
"use strict";

const PWA_CACHE_KEYS = {
  installDismissed: "lifelens-pwa-install-dismissed-at"
};

let deferredInstallPrompt = null;
let refreshingForUpdate = false;

function createPwaUi() {
  if (document.getElementById("pwa-offline-banner")) return;

  const banner = document.createElement("div");
  banner.id = "pwa-offline-banner";
  banner.className = "pwa-offline-banner";
  banner.setAttribute("role", "status");
  banner.textContent = "⚠ You are offline. Changes stay on this device and will sync when you reconnect.";

  const toast = document.createElement("section");
  toast.id = "pwa-toast";
  toast.className = "pwa-toast";
  toast.setAttribute("aria-live", "polite");
  toast.innerHTML = `
    <div class="pwa-toast__icon" id="pwa-toast-icon">✨</div>
    <div>
      <h2 class="pwa-toast__title" id="pwa-toast-title">LifeLens</h2>
      <p class="pwa-toast__message" id="pwa-toast-message"></p>
    </div>
    <div class="pwa-toast__actions">
      <button class="pwa-toast__button" id="pwa-toast-action" type="button">Continue</button>
      <button class="pwa-toast__close" id="pwa-toast-close" type="button" aria-label="Close">×</button>
    </div>`;

  document.body.append(banner, toast);
  document.getElementById("pwa-toast-close")?.addEventListener("click", hidePwaToast);
}

function showPwaToast({ icon = "✨", title, message, actionLabel, onAction }) {
  createPwaUi();
  const toast = document.getElementById("pwa-toast");
  const action = document.getElementById("pwa-toast-action");
  document.getElementById("pwa-toast-icon").textContent = icon;
  document.getElementById("pwa-toast-title").textContent = title;
  document.getElementById("pwa-toast-message").textContent = message;
  action.textContent = actionLabel;
  action.onclick = async () => {
    action.disabled = true;
    try { await onAction?.(); } finally { action.disabled = false; }
  };
  toast.classList.add("is-visible");
}

function hidePwaToast() {
  document.getElementById("pwa-toast")?.classList.remove("is-visible");
}

function updateOnlineStatus() {
  createPwaUi();
  const banner = document.getElementById("pwa-offline-banner");
  banner.classList.toggle("is-visible", !navigator.onLine);

  if (navigator.onLine && sessionStorage.getItem("lifelens-was-offline") === "1") {
    sessionStorage.removeItem("lifelens-was-offline");
    showPwaToast({
      icon: "☁️",
      title: "Back online",
      message: "LifeLens can sync your latest changes again.",
      actionLabel: "Got it",
      onAction: hidePwaToast
    });
  } else if (!navigator.onLine) {
    sessionStorage.setItem("lifelens-was-offline", "1");
  }
}

function bindInstallButtons() {
  document.querySelectorAll("#install-app-button, .install-app-button, [data-install-lifelens]")
    .forEach((button) => {
      button.addEventListener("click", async (event) => {
        if (!deferredInstallPrompt) return;
        event.preventDefault();
        await promptInstall();
      });
    });
}

async function promptInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const result = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  hidePwaToast();
  if (result.outcome === "accepted") {
    document.querySelectorAll("#install-app-button, .install-app-button, [data-install-lifelens]")
      .forEach((button) => { button.hidden = true; });
  }
}

function maybeShowInstallPrompt() {
  const dismissedAt = Number(localStorage.getItem(PWA_CACHE_KEYS.installDismissed) || 0);
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - dismissedAt < sevenDays) return;

  showPwaToast({
    icon: "📱",
    title: "Install LifeLens",
    message: "Launch faster, work offline, and use LifeLens like a desktop or mobile app.",
    actionLabel: "Install",
    onAction: promptInstall
  });
}

function watchForServiceWorkerUpdate(registration) {
  if (registration.waiting && navigator.serviceWorker.controller) {
    showUpdatePrompt(registration.waiting);
  }

  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        showUpdatePrompt(worker);
      }
    });
  });
}

function showUpdatePrompt(worker) {
  showPwaToast({
    icon: "✨",
    title: "New LifeLens version available",
    message: "Refresh once to load the latest improvements.",
    actionLabel: "Update now",
    onAction: () => {
      refreshingForUpdate = true;
      worker.postMessage({ type: "SKIP_WAITING" });
    }
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js");
    watchForServiceWorkerUpdate(registration);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshingForUpdate) window.location.reload();
    });
    window.setInterval(() => registration.update().catch(() => {}), 30 * 60 * 1000);
  } catch (error) {
    console.warn("LifeLens service worker could not be registered:", error);
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  bindInstallButtons();
  window.setTimeout(maybeShowInstallPrompt, 900);
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  hidePwaToast();
});

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);

document.addEventListener("DOMContentLoaded", () => {
  createPwaUi();
  bindInstallButtons();
  updateOnlineStatus();
  registerServiceWorker();
});
