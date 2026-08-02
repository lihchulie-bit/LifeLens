"use strict";

import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

function initializeRevealAnimations() {
    const elements = document.querySelectorAll(".reveal-on-scroll");

    if (!("IntersectionObserver" in window)) {
        elements.forEach((element) => element.classList.add("is-visible"));
        return;
    }

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            });
        },
        { threshold: 0.12 }
    );

    elements.forEach((element) => observer.observe(element));
}

function initializeCounters() {
    const counters = document.querySelectorAll("[data-counter]");

    const animateCounter = (element) => {
        const target = Number(element.dataset.counter || 0);
        const suffix = element.dataset.suffix || "";
        const duration = 900;
        const start = performance.now();

        const update = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = `${Math.round(target * eased)}${suffix}`;
            if (progress < 1) requestAnimationFrame(update);
        };

        requestAnimationFrame(update);
    };

    if (!("IntersectionObserver" in window)) {
        counters.forEach(animateCounter);
        return;
    }

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                animateCounter(entry.target);
                observer.unobserve(entry.target);
            });
        },
        { threshold: 0.5 }
    );

    counters.forEach((counter) => observer.observe(counter));
}

function initializePreviewTabs() {
    const tabs = document.querySelectorAll("[data-preview-tab]");
    const panels = document.querySelectorAll("[data-preview-panel]");

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            const target = tab.dataset.previewTab;

            tabs.forEach((candidate) => {
                candidate.setAttribute("aria-selected", String(candidate === tab));
            });

            panels.forEach((panel) => {
                const active = panel.dataset.previewPanel === target;
                panel.hidden = !active;
                panel.classList.toggle("active", active);
            });
        });
    });
}

function initializeFAQ() {
    document.querySelectorAll(".landing-faq-item > button").forEach((button) => {
        button.addEventListener("click", () => {
            const content = button.nextElementSibling;
            const expanded = button.getAttribute("aria-expanded") === "true";

            button.setAttribute("aria-expanded", String(!expanded));
            button.querySelector("span").textContent = expanded ? "+" : "−";
            content.hidden = expanded;
        });
    });
}

function initializeInstallTriggers() {
    const triggers = document.querySelectorAll("[data-install-trigger]");
    const mainInstallButton = document.querySelector("#install-app-button");

    triggers.forEach((trigger) => {
        trigger.addEventListener("click", () => {
            if (mainInstallButton && !mainInstallButton.hidden) {
                mainInstallButton.click();
                return;
            }

            trigger.textContent = "Install from your browser menu";
            window.setTimeout(() => {
                trigger.innerHTML = "Install LifeLens <span>→</span>";
            }, 2500);
        });
    });
}


function initializeLandingMobileMenu() {
    const navbar = document.querySelector(".landing-navbar");
    const hamburger = navbar?.querySelector(".hamburger");
    const navLinks = navbar?.querySelector(".nav-links");

    if (!navbar || !hamburger || !navLinks) return;

    const setOpen = (open) => {
        navLinks.classList.toggle("active", open);
        navbar.classList.toggle("mobile-menu-open", open);
        hamburger.setAttribute("aria-expanded", String(open));
        hamburger.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
        hamburger.textContent = open ? "×" : "☰";
    };

    hamburger.addEventListener("click", (event) => {
        event.stopPropagation();
        setOpen(hamburger.getAttribute("aria-expanded") !== "true");
    });

    navLinks.addEventListener("click", (event) => {
        if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("click", (event) => {
        if (!navbar.contains(event.target)) setOpen(false);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setOpen(false);
            hamburger.focus();
        }
    });

    window.addEventListener("resize", () => {
        if (window.innerWidth > 1180) setOpen(false);
    });
}

function initializeLandingNavigationShadow() {
    const header = document.querySelector(".landing-header");
    if (!header) return;

    const update = () => header.classList.toggle("is-scrolled", window.scrollY > 12);
    update();
    window.addEventListener("scroll", update, { passive: true });
}

function initializeLandingThemeSync() {
    const root = document.documentElement;
    const body = document.body;
    const toggle = document.querySelector("#theme-toggle");

    const applyTheme = (theme, persist = false) => {
        const isDark = theme === "dark";

        root.classList.toggle("dark-mode", isDark);
        root.dataset.theme = isDark ? "dark" : "light";
        body?.classList.toggle("dark-mode", isDark);

        if (toggle) {
            toggle.textContent = isDark ? "☀️" : "🌙";
            toggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
            toggle.setAttribute("aria-pressed", String(isDark));
            toggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
        }

        if (persist) {
            localStorage.setItem("lifelens-theme", isDark ? "dark" : "light");
        }
    };

    const savedTheme = localStorage.getItem("lifelens-theme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const initialTheme = savedTheme === "dark" || savedTheme === "light"
        ? savedTheme
        : (prefersDark ? "dark" : "light");

    applyTheme(initialTheme);

    toggle?.addEventListener("click", () => {
        const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
        applyTheme(nextTheme, true);
    });
}

function initializeLandingAccountLinks() {
    const loginLinks = Array.from(document.querySelectorAll('a[href="login.html"]'));
    const signupLinks = Array.from(document.querySelectorAll('a[href="login.html#signup"]'));
    const mainLoginLink = document.querySelector(".landing-login-link");

    const render = (user) => {
        if (user) {
            loginLinks.forEach((link) => {
                link.href = "planner.html";
                if (link === mainLoginLink) {
                    link.textContent = "Open Planner";
                } else if (/log in/i.test(link.textContent)) {
                    link.textContent = "Open Planner";
                }
                link.setAttribute("aria-label", "Open your LifeLens planner");
            });

            signupLinks.forEach((link) => {
                link.href = "dashboard.html";
                link.textContent = "Open Dashboard";
                link.setAttribute("aria-label", "Open your LifeLens dashboard");
            });
            return;
        }

        loginLinks.forEach((link) => {
            link.href = "login.html";
            if (link === mainLoginLink || /open planner/i.test(link.textContent)) {
                link.textContent = "Log in";
            }
        });

        signupLinks.forEach((link) => {
            link.href = "login.html#signup";
            if (/open dashboard/i.test(link.textContent)) {
                link.textContent = "Create account";
            }
        });
    };

    render(auth.currentUser);
    onAuthStateChanged(auth, render);

    loginLinks.forEach((link) => {
        link.addEventListener("click", (event) => {
            if (!auth.currentUser) return;
            event.preventDefault();
            window.location.href = "planner.html";
        });
    });

    signupLinks.forEach((link) => {
        link.addEventListener("click", (event) => {
            if (!auth.currentUser) return;
            event.preventDefault();
            window.location.href = "dashboard.html";
        });
    });
}

initializeRevealAnimations();
initializeCounters();
initializePreviewTabs();
initializeFAQ();
initializeInstallTriggers();
initializeLandingNavigationShadow();
initializeLandingMobileMenu();
initializeLandingThemeSync();
initializeLandingAccountLinks();
