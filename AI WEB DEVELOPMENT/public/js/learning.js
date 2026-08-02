"use strict";

const LEARNING_STORAGE_KEY =
    "lifelens-task-learning-history";

function loadHistory() {
    try {
        const storedHistory =
            localStorage.getItem(
                LEARNING_STORAGE_KEY
            );

        if (!storedHistory) {
            return [];
        }

        const parsedHistory =
            JSON.parse(storedHistory);

        return Array.isArray(parsedHistory)
            ? parsedHistory
            : [];
    } catch (error) {
        console.error(
            "Could not load learning history:",
            error
        );

        return [];
    }
}

function saveHistory(history) {
    try {
        localStorage.setItem(
            LEARNING_STORAGE_KEY,
            JSON.stringify(history)
        );

        return true;
    } catch (error) {
        console.error(
            "Could not save learning history:",
            error
        );

        return false;
    }
}

function normalizeTaskName(taskName) {
    return String(taskName)
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(
            /\b(homework|assignment|revision|practice|study|task)\b/g,
            ""
        )
        .replace(/\s+/g, " ")
        .trim();
}

function tasksAreSimilar(
    firstTaskName,
    secondTaskName
) {
    const firstName =
        normalizeTaskName(firstTaskName);

    const secondName =
        normalizeTaskName(secondTaskName);

    if (!firstName || !secondName) {
        return false;
    }

    if (
        firstName.includes(secondName) ||
        secondName.includes(firstName)
    ) {
        return true;
    }

    const firstWords =
        firstName.split(" ");

    const secondWords =
        secondName.split(" ");

    return firstWords.some((word) =>
        word.length >= 4 &&
        secondWords.includes(word)
    );
}

export function recordTaskResult({
    name,
    plannedDuration,
    actualDuration,
    priority
}) {
    if (
        !name ||
        !Number.isFinite(plannedDuration) ||
        !Number.isFinite(actualDuration) ||
        actualDuration <= 0
    ) {
        return false;
    }

    const history = loadHistory();

    history.push({
        id:
            crypto.randomUUID?.() ||
            `${Date.now()}-${Math.random()}`,
        name,
        normalizedName:
            normalizeTaskName(name),
        plannedDuration,
        actualDuration,
        priority: priority || "medium",
        completedAt:
            new Date().toISOString()
    });

    /*
        Keep only the latest 200 records so browser
        storage does not grow indefinitely.
    */
    const limitedHistory =
        history.slice(-200);

    return saveHistory(limitedHistory);
}

export function getDurationSuggestion(
    taskName
) {
    if (!taskName?.trim()) {
        return null;
    }

    const matchingResults =
        loadHistory().filter((result) =>
            tasksAreSimilar(
                result.name,
                taskName
            )
        );

    if (matchingResults.length === 0) {
        return null;
    }

    const totalActualMinutes =
        matchingResults.reduce(
            (total, result) =>
                total +
                Number(result.actualDuration),
            0
        );

    const averageActualDuration =
        Math.round(
            totalActualMinutes /
                matchingResults.length
        );

    return {
        averageMinutes:
            averageActualDuration,

        sampleSize:
            matchingResults.length,

        lastActualMinutes:
            matchingResults.at(-1)
                ?.actualDuration ??
            averageActualDuration
    };
}

export function clearLearningHistory() {
    localStorage.removeItem(
        LEARNING_STORAGE_KEY
    );
}

export function getLearningHistory() {
    return loadHistory().map((record) => ({
        ...record
    }));
}