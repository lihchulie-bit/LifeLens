"use strict";

import { auth, db } from "./firebase.js";
import {
    browserLocalPersistence,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    sendEmailVerification,
    sendPasswordResetEmail,
    setPersistence,
    signInWithEmailAndPassword,
    signOut as firebaseSignOut,
    updateProfile
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
    doc,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const PROTECTED_PAGES = new Set([
    "planner.html",
    "dashboard.html",
    "insights.html",
    "assistant.html"
]);

let authReadyPromise = null;

function currentPageName() {
    return window.location.pathname.split("/").pop() || "index.html";
}

function waitForAuthReady() {
    if (!authReadyPromise) {
        authReadyPromise = new Promise((resolve) => {
            const unsubscribe = onAuthStateChanged(auth, (user) => {
                unsubscribe();
                resolve(user);
            });
        });
    }

    return authReadyPromise;
}

function mapUser(user) {
    if (!user) {
        return null;
    }

    return {
        id: user.uid,
        uid: user.uid,
        name: user.displayName || user.email?.split("@")[0] || "LifeLens user",
        email: user.email || "",
        emailVerified: Boolean(user.emailVerified),
        createdAt: user.metadata?.creationTime || null
    };
}

export function getCurrentUser() {
    return mapUser(auth.currentUser);
}

export async function signOut() {
    await firebaseSignOut(auth);
    window.location.href = "index.html";
}

function friendlyAuthError(error) {
    const code = String(error?.code || "");

    const messages = {
        "auth/email-already-in-use": "An account with that email already exists.",
        "auth/invalid-email": "Please enter a valid email address.",
        "auth/invalid-credential": "Incorrect email or password.",
        "auth/user-disabled": "This account has been disabled.",
        "auth/weak-password": "Use a stronger password with at least 8 characters.",
        "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
        "auth/network-request-failed": "A network error occurred. Check your internet connection.",
        "auth/operation-not-allowed": "Email/password sign-in is not enabled in Firebase.",
        "auth/missing-password": "Please enter your password."
    };

    return new Error(messages[code] || error?.message || "Authentication failed.");
}

async function signUp({ name, email, password, confirmPassword }) {
    const cleanedName = String(name || "").trim();
    const cleanedEmail = String(email || "").trim().toLowerCase();

    if (cleanedName.length < 2) {
        throw new Error("Please enter your name.");
    }

    if (!/^\S+@\S+\.\S+$/.test(cleanedEmail)) {
        throw new Error("Please enter a valid email address.");
    }

    if (String(password).length < 8) {
        throw new Error("Password must contain at least 8 characters.");
    }

    if (password !== confirmPassword) {
        throw new Error("The passwords do not match.");
    }

    try {
        await setPersistence(auth, browserLocalPersistence);

        const credential = await createUserWithEmailAndPassword(
            auth,
            cleanedEmail,
            password
        );

        await updateProfile(credential.user, {
            displayName: cleanedName
        });

        await setDoc(
            doc(db, "users", credential.user.uid),
            {
                displayName: cleanedName,
                email: cleanedEmail,
                createdAt: serverTimestamp(),
                lastLoginAt: serverTimestamp(),
                profileVersion: 1
            },
            { merge: true }
        );

        try {
            await sendEmailVerification(credential.user);
        } catch (verificationError) {
            console.warn("Verification email could not be sent:", verificationError);
        }

        return credential.user;
    } catch (error) {
        throw friendlyAuthError(error);
    }
}

async function logIn({ email, password }) {
    const cleanedEmail = String(email || "").trim().toLowerCase();

    try {
        await setPersistence(auth, browserLocalPersistence);

        const credential = await signInWithEmailAndPassword(
            auth,
            cleanedEmail,
            password
        );

        await setDoc(
            doc(db, "users", credential.user.uid),
            {
                email: credential.user.email || cleanedEmail,
                displayName: credential.user.displayName || cleanedEmail.split("@")[0],
                lastLoginAt: serverTimestamp()
            },
            { merge: true }
        );

        return credential.user;
    } catch (error) {
        throw friendlyAuthError(error);
    }
}

async function requestPasswordReset(email) {
    const cleanedEmail = String(email || "").trim().toLowerCase();

    if (!/^\S+@\S+\.\S+$/.test(cleanedEmail)) {
        throw new Error("Please enter a valid email address.");
    }

    try {
        await sendPasswordResetEmail(auth, cleanedEmail);
    } catch (error) {
        throw friendlyAuthError(error);
    }
}

function renderAuthNavigation(user) {
    const navLinks = document.querySelector(".nav-links");
    if (!navLinks) {
        return;
    }

    navLinks.querySelector(".auth-nav-item")?.remove();

    const item = document.createElement("li");
    item.className = "auth-nav-item";

    if (!user) {
        const link = document.createElement("a");
        link.href = "login.html";
        link.className = "auth-nav-link";
        link.textContent = "Log in";
        item.appendChild(link);
        navLinks.appendChild(item);
        return;
    }

    const mappedUser = mapUser(user);
    const wrapper = document.createElement("div");
    wrapper.className = "auth-user-menu";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "auth-user-button";
    button.setAttribute("aria-expanded", "false");
    button.textContent = mappedUser.name.split(/\s+/)[0];

    const menu = document.createElement("div");
    menu.className = "auth-user-dropdown";
    menu.hidden = true;

    const identity = document.createElement("div");
    identity.className = "auth-user-identity";

    const identityName = document.createElement("strong");
    identityName.textContent = mappedUser.name;

    const identityEmail = document.createElement("span");
    identityEmail.textContent = mappedUser.email;

    identity.append(identityName, identityEmail);

    if (!mappedUser.emailVerified) {
        const verification = document.createElement("small");
        verification.className = "auth-verification-status";
        verification.textContent = "Email not verified";
        identity.appendChild(verification);
    }

    const logoutButton = document.createElement("button");
    logoutButton.type = "button";
    logoutButton.className = "auth-logout-button";
    logoutButton.textContent = "Log out";
    logoutButton.addEventListener("click", () => {
        signOut().catch((error) => {
            console.error("Could not sign out:", error);
        });
    });

    menu.append(identity, logoutButton);
    wrapper.append(button, menu);
    item.appendChild(wrapper);
    navLinks.appendChild(item);

    button.addEventListener("click", () => {
        menu.hidden = !menu.hidden;
        button.setAttribute("aria-expanded", String(!menu.hidden));
    });

    document.addEventListener("click", (event) => {
        if (!wrapper.contains(event.target)) {
            menu.hidden = true;
            button.setAttribute("aria-expanded", "false");
        }
    });
}

export function initializeLiveClock() {
    const navbar = document.querySelector(".navbar");
    if (!navbar || navbar.querySelector(".live-clock")) {
        return;
    }

    const clock = document.createElement("div");
    clock.className = "live-clock";
    clock.setAttribute("role", "timer");
    clock.setAttribute("aria-live", "off");
    clock.title = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const time = document.createElement("strong");
    const date = document.createElement("span");
    clock.append(time, date);

    function updateClock() {
        const now = new Date();
        time.textContent = new Intl.DateTimeFormat(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(now);
        date.textContent = new Intl.DateTimeFormat(undefined, {
            weekday: "short",
            day: "2-digit",
            month: "short"
        }).format(now);
        clock.setAttribute("aria-label", `Current time ${time.textContent}, ${date.textContent}`);
    }

    updateClock();
    window.setInterval(updateClock, 1000);

    const hamburger = navbar.querySelector(".hamburger");
    navbar.insertBefore(clock, hamburger || null);
}

function showAuthMessage(messageElement, text, type = "") {
    if (!messageElement) {
        return;
    }

    messageElement.textContent = text;
    messageElement.className = `auth-message ${type}`.trim();
}

function initializeAuthPage() {
    const authPage = document.querySelector(".auth-page");
    if (!authPage) {
        return;
    }

    const tabs = document.querySelectorAll("[data-auth-tab]");
    const panels = document.querySelectorAll("[data-auth-panel]");
    const message = document.querySelector("#auth-message");
    const title = document.querySelector("#auth-title");
    const description = document.querySelector("#auth-description");
    const loginForm = document.querySelector("#login-form");
    const signupForm = document.querySelector("#signup-form");
    const resetForm = document.querySelector("#reset-form");
    const forgotButton = document.querySelector("#forgot-password-button");
    const backToLoginButton = document.querySelector("#back-to-login-button");

    let resetCooldownTimer = null;

    function updateUrlMode(name) {
        const url = new URL(window.location.href);
        if (name === "reset") {
            url.searchParams.set("mode", "reset");
        } else {
            url.searchParams.delete("mode");
        }
        window.history.replaceState({}, "", url);
    }

    function showPanel(name, options = {}) {
        const validPanel = ["login", "signup", "reset"].includes(name) ? name : "login";

        tabs.forEach((tab) => {
            const active = tab.dataset.authTab === validPanel;
            tab.classList.toggle("active", active);
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1;
        });

        panels.forEach((panel) => {
            panel.hidden = panel.dataset.authPanel !== validPanel;
        });

        document.querySelector(".auth-tabs")?.classList.toggle("is-resetting", validPanel === "reset");

        if (validPanel === "reset") {
            if (title) title.textContent = "Reset your LifeLens password.";
            if (description) description.textContent = "We will send a secure password-reset link to your account email.";
            const loginEmail = loginForm?.elements.email?.value || "";
            if (resetForm?.elements.email && !resetForm.elements.email.value) {
                resetForm.elements.email.value = loginEmail;
            }
            window.setTimeout(() => resetForm?.elements.email?.focus(), 0);
        } else {
            if (title) title.textContent = "Your LifeLens account, securely synced.";
            if (description) description.textContent = "Sign in with Firebase Authentication to open your planner, dashboard, saved chats, XP, levels, and study history.";
        }

        if (!options.keepMessage) {
            showAuthMessage(message, "");
        }
        if (!options.keepUrl) {
            updateUrlMode(validPanel);
        }
    }

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => showPanel(tab.dataset.authTab));
    });

    loginForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = "Signing in…";
        showAuthMessage(message, "Signing you in…", "info");

        try {
            await logIn({
                email: event.currentTarget.elements.email.value,
                password: event.currentTarget.elements.password.value
            });

            const redirect = new URLSearchParams(window.location.search).get("redirect") || "planner.html";
            window.location.href = redirect;
        } catch (error) {
            showAuthMessage(message, error.message, "error");
        } finally {
            button.disabled = false;
            button.textContent = "Log in";
        }
    });

    signupForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = "Creating account…";
        showAuthMessage(message, "Creating your secure account…", "info");

        try {
            await signUp({
                name: event.currentTarget.elements.name.value,
                email: event.currentTarget.elements.email.value,
                password: event.currentTarget.elements.password.value,
                confirmPassword: event.currentTarget.elements.confirmPassword.value
            });

            showAuthMessage(
                message,
                "Account created. A verification email has been sent.",
                "success"
            );

            window.setTimeout(() => {
                window.location.href = "planner.html";
            }, 800);
        } catch (error) {
            showAuthMessage(message, error.message, "error");
        } finally {
            button.disabled = false;
            button.textContent = "Create account";
        }
    });

    forgotButton?.addEventListener("click", () => {
        showPanel("reset");
    });

    backToLoginButton?.addEventListener("click", () => {
        const resetEmail = resetForm?.elements.email?.value || "";
        if (loginForm?.elements.email && resetEmail) {
            loginForm.elements.email.value = resetEmail;
        }
        showPanel("login");
        window.setTimeout(() => loginForm?.elements.email?.focus(), 0);
    });

    resetForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button[type="submit"]');
        const email = event.currentTarget.elements.email.value;

        if (button.disabled) {
            return;
        }

        button.disabled = true;
        button.textContent = "Sending…";
        showAuthMessage(message, "Requesting a secure reset link…", "info");

        try {
            await requestPasswordReset(email);
            showAuthMessage(
                message,
                "If an account uses that email, a password-reset link has been sent. Check your inbox and spam folder.",
                "success"
            );

            let remaining = 15;
            button.textContent = `Send again in ${remaining}s`;
            resetCooldownTimer = window.setInterval(() => {
                remaining -= 1;
                if (remaining <= 0) {
                    window.clearInterval(resetCooldownTimer);
                    resetCooldownTimer = null;
                    button.disabled = false;
                    button.textContent = "Send reset email again";
                    return;
                }
                button.textContent = `Send again in ${remaining}s`;
            }, 1000);
        } catch (error) {
            showAuthMessage(message, error.message, "error");
            button.disabled = false;
            button.textContent = "Send reset email";
        }
    });

    const initialMode = new URLSearchParams(window.location.search).get("mode");
    showPanel(initialMode === "reset" ? "reset" : "login", { keepUrl: true });
}

export async function initializeAuth() {
    initializeAuthPage();

    const user = await waitForAuthReady();

    if (user?.uid) {
        localStorage.setItem("lifelens-last-auth-uid-v1", user.uid);
    }

    const page = currentPageName();

    const authMode = new URLSearchParams(window.location.search).get("mode");
    const passwordResetMode = authMode === "reset";

    if (document.body.classList.contains("auth-page") && user && !passwordResetMode) {
        const redirect = new URLSearchParams(window.location.search).get("redirect") || "planner.html";
        window.location.replace(redirect);
        return;
    }

    if (PROTECTED_PAGES.has(page) && !user) {
        const redirect = encodeURIComponent(
            `${page}${window.location.search}${window.location.hash}`
        );
        window.location.replace(`login.html?redirect=${redirect}`);
        return;
    }

    renderAuthNavigation(user);

    onAuthStateChanged(auth, (nextUser) => {
        if (nextUser?.uid) {
            localStorage.setItem("lifelens-last-auth-uid-v1", nextUser.uid);
        } else {
            localStorage.removeItem("lifelens-last-auth-uid-v1");
        }

        renderAuthNavigation(nextUser);

        if (PROTECTED_PAGES.has(currentPageName()) && !nextUser) {
            const redirect = encodeURIComponent(currentPageName());
            window.location.replace(`login.html?redirect=${redirect}`);
        }
    });
}
