"use strict";
import {
    initializeDashboard
} from "./dashboard.js?v=20260719-dashboard-v5";
import {
    initializeAssistant
} from "./assistant.js";

import {
    initializePlanner
} from "./planner.js";
import {
    initializeAuth,
    initializeLiveClock
} from "./auth.js";

function initializeNavigation() {
    const hamburger =
        document.querySelector(".hamburger");

    const navLinks =
        document.querySelector(".nav-links");

    if (!hamburger || !navLinks) {
        return;
    }

    hamburger.addEventListener("click", () => {
        const menuIsOpen =
            navLinks.classList.toggle("active");

        hamburger.setAttribute(
            "aria-expanded",
            String(menuIsOpen)
        );

        hamburger.textContent =
            menuIsOpen ? "✕" : "☰";
    });

    navLinks.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => {
            navLinks.classList.remove("active");

            hamburger.setAttribute(
                "aria-expanded",
                "false"
            );

            hamburger.textContent = "☰";
        });
    });
}

function initializeCurrentYear() {
    const currentYear =
        document.querySelector("#current-year");

    if (currentYear) {
        currentYear.textContent =
            String(new Date().getFullYear());
    }
}
function initializeHeroSlider() {
    const slider =
        document.querySelector(".hero-slider");

    const slides =
        document.querySelectorAll(".hero-slide");

    const dots =
        document.querySelectorAll(".slider-dot");

    const previousButton =
        document.querySelector("#previous-slide");

    const nextButton =
        document.querySelector("#next-slide");

    const pauseButton =
        document.querySelector(
            "#slider-pause-button"
        );

    if (
        !slider ||
        slides.length === 0 ||
        dots.length === 0
    ) {
        return;
    }

    let currentSlide = 0;
    let automaticSlideTimer = null;
    let sliderIsPaused = false;
    let touchStartX = 0;

    function showSlide(slideIndex) {
        const normalizedIndex =
            (slideIndex + slides.length) %
            slides.length;

        slides.forEach((slide, index) => {
            const slideIsActive =
                index === normalizedIndex;

            slide.classList.toggle(
                "active",
                slideIsActive
            );

            slide.setAttribute(
                "aria-hidden",
                String(!slideIsActive)
            );
        });

        dots.forEach((dot, index) => {
            const dotIsActive =
                index === normalizedIndex;

            dot.classList.toggle(
                "active",
                dotIsActive
            );

            dot.setAttribute(
                "aria-selected",
                String(dotIsActive)
            );
        });

        currentSlide = normalizedIndex;
    }

    function showNextSlide() {
        showSlide(currentSlide + 1);
    }

    function showPreviousSlide() {
        showSlide(currentSlide - 1);
    }

    function stopAutomaticSlides() {
        window.clearInterval(
            automaticSlideTimer
        );

        automaticSlideTimer = null;
    }

    function startAutomaticSlides() {
        stopAutomaticSlides();

        if (sliderIsPaused) {
            return;
        }

        automaticSlideTimer =
            window.setInterval(() => {
                showNextSlide();
            }, 5000);
    }

    function restartAutomaticSlides() {
        stopAutomaticSlides();
        startAutomaticSlides();
    }

    nextButton?.addEventListener(
        "click",
        () => {
            showNextSlide();
            restartAutomaticSlides();
        }
    );

    previousButton?.addEventListener(
        "click",
        () => {
            showPreviousSlide();
            restartAutomaticSlides();
        }
    );

    dots.forEach((dot) => {
        dot.addEventListener("click", () => {
            const targetIndex = Number(
                dot.dataset.slideTarget
            );

            showSlide(targetIndex);
            restartAutomaticSlides();
        });
    });

    pauseButton?.addEventListener(
        "click",
        () => {
            sliderIsPaused =
                !sliderIsPaused;

            pauseButton.setAttribute(
                "aria-pressed",
                String(sliderIsPaused)
            );

            pauseButton.setAttribute(
                "aria-label",
                sliderIsPaused
                    ? "Resume automatic slides"
                    : "Pause automatic slides"
            );

            pauseButton.textContent =
                sliderIsPaused ? "▶" : "❚❚";

            if (sliderIsPaused) {
                stopAutomaticSlides();
            } else {
                startAutomaticSlides();
            }
        }
    );

    slider.addEventListener(
        "mouseenter",
        stopAutomaticSlides
    );

    slider.addEventListener(
        "mouseleave",
        startAutomaticSlides
    );

    slider.addEventListener(
        "touchstart",
        (event) => {
            touchStartX =
                event.touches[0].clientX;
        },
        {
            passive: true
        }
    );

    slider.addEventListener(
        "touchend",
        (event) => {
            const touchEndX =
                event.changedTouches[0].clientX;

            const swipeDistance =
                touchEndX - touchStartX;

            if (
                Math.abs(swipeDistance) < 50
            ) {
                return;
            }

            if (swipeDistance > 0) {
                showPreviousSlide();
            } else {
                showNextSlide();
            }

            restartAutomaticSlides();
        },
        {
            passive: true
        }
    );

    document.addEventListener(
        "visibilitychange",
        () => {
            if (document.hidden) {
                stopAutomaticSlides();
            } else {
                startAutomaticSlides();
            }
        }
    );

    showSlide(0);
    startAutomaticSlides();
}

function initializeTheme() {
    const themeButton =
        document.querySelector("#theme-toggle");

    const savedTheme =
        localStorage.getItem(
            "lifelens-theme"
        );

    const systemPrefersDark =
        window.matchMedia(
            "(prefers-color-scheme: dark)"
        ).matches;

    const shouldUseDarkMode =
        savedTheme === "dark" ||
        (!savedTheme && systemPrefersDark);

    function applyTheme(isDarkMode) {
        document.documentElement.classList.toggle(
            "dark-mode",
            isDarkMode
        );

        if (!themeButton) {
            return;
        }

        themeButton.textContent =
            isDarkMode ? "☀️" : "🌙";

        themeButton.setAttribute(
            "aria-pressed",
            String(isDarkMode)
        );

        themeButton.setAttribute(
            "aria-label",
            isDarkMode
                ? "Switch to light mode"
                : "Switch to dark mode"
        );
    }

    applyTheme(shouldUseDarkMode);

    themeButton?.addEventListener(
        "click",
        () => {
            const darkModeIsActive =
                document.documentElement.classList.contains(
                    "dark-mode"
                );

            const newDarkModeState =
                !darkModeIsActive;

            applyTheme(
                newDarkModeState
            );

            localStorage.setItem(
                "lifelens-theme",
                newDarkModeState
                    ? "dark"
                    : "light"
            );
        }
    );
}
function createPWAStatusUI() {
    let statusContainer =
        document.querySelector("#pwa-status-container");

    if (statusContainer) {
        return statusContainer;
    }

    statusContainer = document.createElement("div");
    statusContainer.id = "pwa-status-container";
    statusContainer.className = "pwa-status-container";
    statusContainer.setAttribute("aria-live", "polite");
    statusContainer.setAttribute("aria-atomic", "true");

    document.body.appendChild(statusContainer);

    return statusContainer;
}

function showPWAStatus({
    message,
    type = "info",
    actionText = "",
    onAction = null,
    persistent = false
}) {
    const statusContainer = createPWAStatusUI();
    const notice = document.createElement("div");

    notice.className = `pwa-notice pwa-notice-${type}`;

    const messageElement = document.createElement("p");
    messageElement.textContent = message;
    notice.appendChild(messageElement);

    if (actionText && typeof onAction === "function") {
        const actionButton = document.createElement("button");
        actionButton.type = "button";
        actionButton.className = "pwa-notice-action";
        actionButton.textContent = actionText;
        actionButton.addEventListener("click", onAction);
        notice.appendChild(actionButton);
    }

    const dismissButton = document.createElement("button");
    dismissButton.type = "button";
    dismissButton.className = "pwa-notice-dismiss";
    dismissButton.setAttribute("aria-label", "Dismiss notification");
    dismissButton.textContent = "×";
    dismissButton.addEventListener("click", () => notice.remove());
    notice.appendChild(dismissButton);

    statusContainer.replaceChildren(notice);

    window.requestAnimationFrame(() => {
        notice.classList.add("is-visible");
    });

    if (!persistent) {
        window.setTimeout(() => {
            notice.classList.remove("is-visible");
            window.setTimeout(() => notice.remove(), 250);
        }, 3500);
    }
}

function initializeConnectionStatus() {
    let wasOffline = !navigator.onLine;

    if (wasOffline) {
        showPWAStatus({
            message: "You’re offline. Saved planner data and cached pages are still available.",
            type: "offline",
            persistent: true
        });
    }

    window.addEventListener("offline", () => {
        wasOffline = true;

        document.documentElement.classList.add("is-offline");

        showPWAStatus({
            message: "You’re offline. LifeLens will keep working with saved and cached data.",
            type: "offline",
            persistent: true
        });
    });

    window.addEventListener("online", () => {
        document.documentElement.classList.remove("is-offline");

        if (wasOffline) {
            showPWAStatus({
                message: "Back online. LifeLens can sync and check for updates again.",
                type: "online"
            });
        }

        wasOffline = false;
    });
}

function showInstalledAppIndicator() {
    const isInstalled =
        window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true;

    if (!isInstalled) {
        return;
    }

    const navbar = document.querySelector(".navbar");

    if (!navbar || navbar.querySelector(".installed-app-badge")) {
        return;
    }

    const badge = document.createElement("span");
    badge.className = "installed-app-badge";
    badge.textContent = "App installed";
    badge.title = "LifeLens is running as an installed app";

    const installButton = navbar.querySelector("#install-app-button");

    if (installButton) {
        installButton.hidden = true;
        installButton.insertAdjacentElement("afterend", badge);
    } else {
        navbar.appendChild(badge);
    }
}

async function initializeServiceWorker() {
    if (!("serviceWorker" in navigator)) {
        return;
    }

    let refreshing = false;

    navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
            if (refreshing) {
                return;
            }

            refreshing = true;
            window.location.reload();
        }
    );

    try {
        const registration =
            await navigator.serviceWorker.register(
                "./service-worker.js",
                { scope: "./" }
            );

        function promptForUpdate(worker) {
            if (!worker) {
                return;
            }

            showPWAStatus({
                message: "A new version of LifeLens is ready.",
                type: "update",
                actionText: "Update now",
                persistent: true,
                onAction: () => {
                    worker.postMessage({
                        type: "SKIP_WAITING"
                    });
                }
            });
        }

        if (registration.waiting) {
            promptForUpdate(registration.waiting);
        }

        registration.addEventListener(
            "updatefound",
            () => {
                const installingWorker =
                    registration.installing;

                if (!installingWorker) {
                    return;
                }

                installingWorker.addEventListener(
                    "statechange",
                    () => {
                        if (
                            installingWorker.state === "installed" &&
                            navigator.serviceWorker.controller
                        ) {
                            promptForUpdate(
                                registration.waiting || installingWorker
                            );
                        }
                    }
                );
            }
        );

        window.setInterval(() => {
            registration.update().catch(() => {});
        }, 60 * 60 * 1000);

        console.log(
            "LifeLens service worker registered:",
            registration.scope
        );
    } catch (error) {
        console.error(
            "Service worker registration failed:",
            error
        );
    }
}
function initializeInstallPrompt() {
    const installButton =
        document.querySelector(
            "#install-app-button"
        );

    if (!installButton) {
        return;
    }

    let deferredInstallPrompt = null;

    const alreadyInstalled =
        window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true;

    if (!alreadyInstalled) {
        installButton.hidden = false;
    }

    window.addEventListener(
        "beforeinstallprompt",
        (event) => {
            event.preventDefault();

            deferredInstallPrompt = event;

            installButton.hidden = false;
        }
    );

    installButton.addEventListener(
        "click",
        async () => {
            if (!deferredInstallPrompt) {
                const isIOS = /iphone|ipad|ipod/i.test(
                    navigator.userAgent
                );

                const message = isIOS
                    ? "To install LifeLens, open the Share menu in Safari and choose Add to Home Screen."
                    : "The browser install prompt is not available yet. Open this site through HTTPS, then use your browser menu and choose Install app or Add to Home screen.";

                window.alert(message);
                return;
            }

            installButton.disabled = true;

            deferredInstallPrompt.prompt();

            const choiceResult =
                await deferredInstallPrompt
                    .userChoice;

            if (
                choiceResult.outcome ===
                "accepted"
            ) {
                installButton.textContent =
                    "Installed";
            }

            deferredInstallPrompt = null;
            installButton.hidden = true;
            installButton.disabled = false;
        }
    );

    window.addEventListener(
        "appinstalled",
        () => {
            deferredInstallPrompt = null;
            installButton.hidden = true;

            console.log(
                "LifeLens was installed successfully."
            );
        }
    );
}
document.addEventListener("DOMContentLoaded", () => {
    initializeAuth();
    initializeLiveClock();
    initializeNavigation();
    initializeCurrentYear();
    initializeTheme();
    initializeHeroSlider();
    initializePlanner();
    initializeAssistant();
    initializeDashboard();
    initializeConnectionStatus();
    showInstalledAppIndicator();
    initializeInstallPrompt();

    window.addEventListener(
        "load",
        initializeServiceWorker,
        { once: true }
    );
});