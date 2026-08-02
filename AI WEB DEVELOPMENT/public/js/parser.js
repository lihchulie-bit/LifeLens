"use strict";

const MIN_DURATION = 5;
const MAX_DURATION = 720;
const DURATION_STEP = 5;

function normalizeDurationToAllowedValue(minutes) {
    const safeMinutes = Number(minutes);

    if (!Number.isFinite(safeMinutes)) {
        return 30;
    }

    return Math.min(
        MAX_DURATION,
        Math.max(
            MIN_DURATION,
            Math.round(safeMinutes / DURATION_STEP) * DURATION_STEP
        )
    );
}

function extractDuration(text) {
    const hourAndMinuteMatch = text.match(
        /(\d+)\s*(?:hours?|hrs?|h)\s*(?:and\s*)?(\d+)?\s*(?:minutes?|mins?|min|m)?/i
    );

    if (hourAndMinuteMatch) {
        const hours = Number(hourAndMinuteMatch[1]);
        const minutes = Number(hourAndMinuteMatch[2] || 0);

        return normalizeDurationToAllowedValue(
            hours * 60 + minutes
        );
    }

    const decimalHourMatch = text.match(
        /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i
    );

    if (decimalHourMatch) {
        return normalizeDurationToAllowedValue(
            Math.round(Number(decimalHourMatch[1]) * 60)
        );
    }

    const minuteMatch = text.match(
        /(\d+)\s*(?:minutes?|mins?|min|m)\b/i
    );

    if (minuteMatch) {
        return normalizeDurationToAllowedValue(
            Number(minuteMatch[1])
        );
    }

    return 30;
}

function extractDeadline(text) {
    const timeMatch = text.match(
        /(?:before|by|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
    );

    if (!timeMatch) {
        return "";
    }

    let hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2] || 0);
    const period = timeMatch[3]?.toLowerCase();

    if (period === "pm" && hours < 12) {
        hours += 12;
    }

    if (period === "am" && hours === 12) {
        hours = 0;
    }

    if (hours > 23 || minutes > 59) {
        return "";
    }

    return `${String(hours).padStart(2, "0")}:${String(
        minutes
    ).padStart(2, "0")}`;
}

function detectPriority(text) {
    const lowerText = text.toLowerCase();

    const explicitPriority = lowerText.match(
        /\b(high|medium|low)\s+priority\b/
    );

    if (explicitPriority) {
        return explicitPriority[1];
    }

    const highPriorityWords = [
        "urgent",
        "important",
        "exam",
        "test",
        "deadline",
        "homework",
        "assignment",
        "submit"
    ];

    if (
        highPriorityWords.some((word) =>
            lowerText.includes(word)
        )
    ) {
        return "high";
    }

    const lowPriorityWords = [
        "optional",
        "if possible",
        "maybe",
        "relax",
        "music",
        "leisure"
    ];

    if (
        lowPriorityWords.some((word) =>
            lowerText.includes(word)
        )
    ) {
        return "low";
    }

    return "medium";
}

function cleanTaskName(text) {
    return text
        .replace(
            /(?:for)\s+\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|min|m)\b/gi,
            ""
        )
        .replace(
            /\d+\s*(?:hours?|hrs?|h)\s*(?:and\s*)?\d*\s*(?:minutes?|mins?|min|m)?/gi,
            ""
        )
        .replace(
            /(?:before|by|at)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi,
            ""
        )
        .replace(
            /\b(?:high|medium|low)\s+priority\b/gi,
            ""
        )
        .replace(/^\s*(?:and|then|also)\s+/i, "")
        .replace(/[,.]+$/g, "")
        .trim();
}

export function parseNaturalTasks(text) {
    const normalizedText = text
        .replace(/\n+/g, ",")
        .replace(/\band then\b/gi, ",")
        .replace(/\bthen\b/gi, ",")
        .replace(/\band\b(?=\s+[a-z])/gi, ",");

    const segments = normalizedText
        .split(/[;,]+/)
        .map((segment) => segment.trim())
        .filter(Boolean);

    return segments
        .map((segment) => ({
            name: cleanTaskName(segment),
            duration: extractDuration(segment),
            priority: detectPriority(segment),
            deadline: extractDeadline(segment)
        }))
        .filter((task) => task.name.length > 0);
}