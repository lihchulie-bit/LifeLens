"use strict";

import { accountStorage } from "./account-storage.js";

import { auth, db } from "./firebase.js";
import {
    deleteField,
    doc,
    getDoc,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const PENDING_PLANNER_KEY = "lifelens-planner-cloud-pending-v1";

function waitForUser() {
    if (auth.currentUser) {
        return Promise.resolve(auth.currentUser);
    }

    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve(user || null);
        });
    });
}

function cloneSerializable(value) {
    return JSON.parse(JSON.stringify(value));
}

export async function loadPlannerFromCloud() {
    const user = await waitForUser();

    if (!user) {
        return null;
    }

    const snapshot = await getDoc(doc(db, "users", user.uid));

    if (!snapshot.exists()) {
        return null;
    }

    const planner = snapshot.data()?.planner;

    if (!planner || typeof planner !== "object") {
        return null;
    }

    return cloneSerializable(planner);
}

export async function savePlannerToCloud(plannerData) {
    const user = await waitForUser();

    if (!user) {
        throw new Error("Sign in before syncing planner data.");
    }

    const serializablePlanner = cloneSerializable({
        ...plannerData,
        cloudUpdatedAt: new Date().toISOString()
    });

    await setDoc(
        doc(db, "users", user.uid),
        {
            planner: serializablePlanner,
            plannerUpdatedAt: serverTimestamp()
        },
        { merge: true }
    );

    accountStorage.removeItem(PENDING_PLANNER_KEY);
    return serializablePlanner;
}

export function queuePlannerForCloud(plannerData) {
    try {
        accountStorage.setItem(
            PENDING_PLANNER_KEY,
            JSON.stringify(plannerData)
        );
        return true;
    } catch (error) {
        console.error("Could not queue planner cloud sync:", error);
        return false;
    }
}

export function getQueuedPlanner() {
    try {
        const raw = accountStorage.getItem(PENDING_PLANNER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.error("Could not read pending planner sync:", error);
        return null;
    }
}

export async function flushQueuedPlanner() {
    const queuedPlanner = getQueuedPlanner();

    if (!queuedPlanner) {
        return null;
    }

    return savePlannerToCloud(queuedPlanner);
}

export async function clearPlannerFromCloud() {
    const user = await waitForUser();

    if (!user) {
        return false;
    }

    await setDoc(
        doc(db, "users", user.uid),
        {
            planner: deleteField(),
            plannerUpdatedAt: serverTimestamp()
        },
        { merge: true }
    );

    accountStorage.removeItem(PENDING_PLANNER_KEY);
    return true;
}
