"use strict";

import { auth } from "./firebase.js";

const OWNER_KEY = "lifelens-local-data-owner-v1";
const LAST_UID_KEY = "lifelens-last-auth-uid-v1";
const PREFIX = "lifelens-user";

function currentUid() {
    const uid = auth.currentUser?.uid || localStorage.getItem(LAST_UID_KEY);
    return typeof uid === "string" && uid.trim() ? uid.trim() : "guest";
}

function scopedKey(key) {
    return `${PREFIX}:${currentUid()}:${String(key)}`;
}

function canMigrateLegacyData() {
    const uid = currentUid();
    if (uid === "guest") return false;

    const owner = localStorage.getItem(OWNER_KEY);
    if (!owner) {
        localStorage.setItem(OWNER_KEY, uid);
        return true;
    }

    return owner === uid;
}

function rememberCurrentUser() {
    const uid = auth.currentUser?.uid;
    if (uid) localStorage.setItem(LAST_UID_KEY, uid);
}

export const accountStorage = {
    getItem(key) {
        rememberCurrentUser();
        const scoped = localStorage.getItem(scopedKey(key));
        if (scoped !== null) return scoped;

        if (!canMigrateLegacyData()) return null;

        const legacy = localStorage.getItem(String(key));
        if (legacy !== null) {
            localStorage.setItem(scopedKey(key), legacy);
            localStorage.removeItem(String(key));
        }
        return legacy;
    },

    setItem(key, value) {
        rememberCurrentUser();
        localStorage.setItem(scopedKey(key), String(value));
    },

    removeItem(key) {
        rememberCurrentUser();
        localStorage.removeItem(scopedKey(key));
        if (canMigrateLegacyData()) localStorage.removeItem(String(key));
    },

    keyFor(key) {
        rememberCurrentUser();
        return scopedKey(key);
    }
};
