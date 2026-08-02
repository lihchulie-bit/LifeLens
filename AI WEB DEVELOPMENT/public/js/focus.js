"use strict";

import {
    formatMinutesAsTime
} from "./utils.js";

const MENTAL_KEYWORDS = [
    "math",
    "mathematics",
    "physics",
    "chemistry",
    "biology",
    "coding",
    "programming",
    "study",
    "revision",
    "exam",
    "test",
    "homework",
    "assignment",
    "research",
    "sat",
    "ielts",
    "reading",
    "writing"
];

const PHYSICAL_KEYWORDS = [
    "gym",
    "exercise",
    "workout",
    "walking",
    "walk",
    "running",
    "run",
    "sports",
    "basketball",
    "football",
    "cleaning"
];

const RECOVERY_KEYWORDS = [
    "break",
    "lunch",
    "dinner",
    "breakfast",
    "meal",
    "music",
    "relax",
    "rest",
    "nap",
    "walking",
    "walk"
];

function containsKeyword(taskName, keywords) {
    const normalizedName =
        taskName.toLowerCase();

    return keywords.some((keyword) =>
        normalizedName.includes(keyword)
    );
}

function getLoadLevel(value) {
    if (value >= 75) {
        return "High";
    }

    if (value >= 45) {
        return "Moderate";
    }

    return "Low";
}

function clamp(value, minimum, maximum) {
    return Math.max(
        minimum,
        Math.min(maximum, value)
    );
}

function calculateLongestWorkPeriod(schedule) {
    let currentMinutes = 0;
    let longestMinutes = 0;

    schedule.forEach((item) => {
        if (item.type === "task") {
            currentMinutes += item.duration;

            longestMinutes = Math.max(
                longestMinutes,
                currentMinutes
            );

            return;
        }

        if (item.type === "break") {
            currentMinutes = 0;
        }
    });

    return longestMinutes;
}

function calculateFatigueTime(schedule) {
    let continuousWork = 0;

    for (const item of schedule) {
        if (item.type === "break") {
            continuousWork = 0;
            continue;
        }

        if (item.type !== "task") {
            continue;
        }

        continuousWork += item.duration;

        if (continuousWork >= 120) {
            return item.end;
        }
    }

    const lastTask = [...schedule]
        .reverse()
        .find((item) => item.type === "task");

    return lastTask?.end ?? null;
}

function calculatePeakFocusWindow(
    scheduledTasks,
    startMinutes
) {
    const firstMentalTask =
        scheduledTasks.find((task) =>
            containsKeyword(
                task.name,
                MENTAL_KEYWORDS
            )
        );

    const peakStart =
        firstMentalTask?.start ?? startMinutes;

    const peakEnd =
        Math.min(
            peakStart + 120,
            firstMentalTask?.end ?? peakStart + 120
        );

    return {
        start: peakStart,
        end: peakEnd
    };
}

function chooseRecoveryTip({
    mentalLoad,
    physicalLoad,
    recoveryScore,
    longestWorkPeriod
}) {
    if (
        longestWorkPeriod >= 120 ||
        mentalLoad >= 75
    ) {
        return "Take a 15–20 minute walk, drink water, and avoid another demanding task immediately afterward.";
    }

    if (
        physicalLoad >= 70 &&
        recoveryScore < 45
    ) {
        return "Add a proper meal and a short seated rest after your physical activity.";
    }

    if (recoveryScore < 35) {
        return "Add a short break, meal, or relaxing activity to improve recovery balance.";
    }

    return "Your recovery balance looks reasonable. Keep breaks and meals consistent.";
}

export function updateFocusPrediction({
    schedule,
    startMinutes,
    endMinutes
}) {
    const focusScoreValue =
        document.querySelector(
            "#focus-score-value"
        );

    const mentalLoadBar =
        document.querySelector(
            "#mental-load-bar"
        );

    const physicalLoadBar =
        document.querySelector(
            "#physical-load-bar"
        );

    const recoveryBar =
        document.querySelector(
            "#recovery-bar"
        );

    const mentalLoadLabel =
        document.querySelector(
            "#mental-load-label"
        );

    const physicalLoadLabel =
        document.querySelector(
            "#physical-load-label"
        );

    const recoveryLabel =
        document.querySelector(
            "#recovery-label"
        );

    const peakFocusTime =
        document.querySelector(
            "#peak-focus-time"
        );

    const fatigueTime =
        document.querySelector(
            "#fatigue-time"
        );

    const recoveryTip =
        document.querySelector(
            "#recovery-tip"
        );

    if (
        !focusScoreValue ||
        !mentalLoadBar ||
        !physicalLoadBar ||
        !recoveryBar ||
        !mentalLoadLabel ||
        !physicalLoadLabel ||
        !recoveryLabel ||
        !peakFocusTime ||
        !fatigueTime ||
        !recoveryTip
    ) {
        return;
    }

    const scheduledTasks = schedule.filter(
        (item) => item.type === "task"
    );

    const breaks = schedule.filter(
        (item) => item.type === "break"
    );

    const availableMinutes =
        Math.max(endMinutes - startMinutes, 1);

    let mentalMinutes = 0;
    let physicalMinutes = 0;
    let recoveryMinutes = 0;

    scheduledTasks.forEach((task) => {
        if (
            containsKeyword(
                task.name,
                MENTAL_KEYWORDS
            )
        ) {
            mentalMinutes += task.duration;
        }

        if (
            containsKeyword(
                task.name,
                PHYSICAL_KEYWORDS
            )
        ) {
            physicalMinutes += task.duration;
        }

        if (
            containsKeyword(
                task.name,
                RECOVERY_KEYWORDS
            )
        ) {
            recoveryMinutes += task.duration;
        }
    });

    recoveryMinutes += breaks.reduce(
        (total, item) =>
            total + item.duration,
        0
    );

    const mentalLoad = clamp(
        Math.round(
            (mentalMinutes / availableMinutes) *
                120
        ),
        0,
        100
    );

    const physicalLoad = clamp(
        Math.round(
            (physicalMinutes /
                availableMinutes) *
                130
        ),
        0,
        100
    );

    const recoveryScore = clamp(
        Math.round(
            (recoveryMinutes /
                availableMinutes) *
                180
        ),
        0,
        100
    );

    const longestWorkPeriod =
        calculateLongestWorkPeriod(schedule);

    let focusScore = 100;

    focusScore -=
        Math.max(mentalLoad - 65, 0) * 0.35;

    focusScore -=
        Math.max(physicalLoad - 75, 0) * 0.15;

    focusScore -=
        Math.max(
            longestWorkPeriod - 90,
            0
        ) * 0.12;

    focusScore +=
        Math.min(recoveryScore, 60) * 0.12;

    focusScore = clamp(
        Math.round(focusScore),
        0,
        100
    );

    const peakWindow =
        calculatePeakFocusWindow(
            scheduledTasks,
            startMinutes
        );

    const predictedFatigueTime =
        calculateFatigueTime(schedule);

    focusScoreValue.textContent =
        `${focusScore}%`;

    mentalLoadBar.style.width =
        `${mentalLoad}%`;

    physicalLoadBar.style.width =
        `${physicalLoad}%`;

    recoveryBar.style.width =
        `${recoveryScore}%`;

    mentalLoadLabel.textContent =
        `${getLoadLevel(
            mentalLoad
        )} · ${mentalLoad}%`;

    physicalLoadLabel.textContent =
        `${getLoadLevel(
            physicalLoad
        )} · ${physicalLoad}%`;

    recoveryLabel.textContent =
        `${getLoadLevel(
            recoveryScore
        )} · ${recoveryScore}%`;

    peakFocusTime.textContent =
        `${formatMinutesAsTime(
            peakWindow.start
        )} – ${formatMinutesAsTime(
            peakWindow.end
        )}`;

    fatigueTime.textContent =
        predictedFatigueTime !== null
            ? `Around ${formatMinutesAsTime(
                  predictedFatigueTime
              )}`
            : "Low fatigue risk";

    recoveryTip.textContent =
        chooseRecoveryTip({
            mentalLoad,
            physicalLoad,
            recoveryScore,
            longestWorkPeriod
        });
}