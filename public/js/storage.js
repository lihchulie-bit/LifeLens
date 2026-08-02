"use strict";

import { accountStorage } from "./account-storage.js";

const STORAGE_KEY = "lifelens-planner-data";

export function savePlannerData(data) {
    try {
        accountStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(data)
        );

        return true;
    } catch (error) {
        console.error(
            "LifeLens could not save planner data:",
            error
        );

        return false;
    }
}

export function loadPlannerData() {
    try {
        const savedData =
            accountStorage.getItem(STORAGE_KEY);

        if (!savedData) {
            return null;
        }

        const parsedData = JSON.parse(savedData);

        if (
            !parsedData ||
            typeof parsedData !== "object"
        ) {
            return null;
        }

        return parsedData;
    } catch (error) {
        console.error(
            "LifeLens could not load planner data:",
            error
        );

        return null;
    }
}

export function clearPlannerData() {
    try {
        accountStorage.removeItem(STORAGE_KEY);

        return true;
    } catch (error) {
        console.error(
            "LifeLens could not clear planner data:",
            error
        );

        return false;
    }
}