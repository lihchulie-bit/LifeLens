"use strict";

import {
    capitalizeWord,
    escapeHTML,
    formatMinutesAsTime
} from "./utils.js";
function formatDuration(minutes) {
    if (minutes < 60) {
        return `${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (remainingMinutes === 0) {
        return `${hours} hr`;
    }

    return `${hours} hr ${remainingMinutes} min`;
}
const HEAVY_TASK_KEYWORDS = [
    "math",
    "mathematics",
    "physics",
    "chemistry",
    "biology",
    "coding",
    "programming",
    "revision",
    "study",
    "exam",
    "test",
    "assignment",
    "homework",
    "sat",
    "ielts",
    "research"
];

const LIGHT_TASK_KEYWORDS = [
    "walk",
    "walking",
    "exercise",
    "gym",
    "music",
    "clean",
    "cleaning",
    "shopping",
    "relax",
    "break",
    "meal",
    "lunch",
    "dinner",
    "breakfast"
];

function classifyTask(taskName) {
    const normalizedName =
        taskName.toLowerCase();

    if (
        HEAVY_TASK_KEYWORDS.some((keyword) =>
            normalizedName.includes(keyword)
        )
    ) {
        return "heavy";
    }

    if (
        LIGHT_TASK_KEYWORDS.some((keyword) =>
            normalizedName.includes(keyword)
        )
    ) {
        return "light";
    }

    return "moderate";
}

function findLongestContinuousWork(schedule) {
    let currentWorkMinutes = 0;
    let longestWorkMinutes = 0;

    schedule.forEach((item) => {
        if (item.type === "task") {
            currentWorkMinutes += item.duration;

            longestWorkMinutes = Math.max(
                longestWorkMinutes,
                currentWorkMinutes
            );
        } else if (item.type === "break") {
            currentWorkMinutes = 0;
        }
    });

    return longestWorkMinutes;
}

function countConsecutiveHeavyTasks(schedule) {
    let currentCount = 0;
    let maximumCount = 0;

    schedule.forEach((item) => {
        if (item.type !== "task") {
            currentCount = 0;
            return;
        }

        const taskType =
            classifyTask(item.name);

        if (taskType === "heavy") {
            currentCount += 1;

            maximumCount = Math.max(
                maximumCount,
                currentCount
            );
        } else {
            currentCount = 0;
        }
    });

    return maximumCount;
}

function scheduleCrossesTime(
    startMinutes,
    endMinutes,
    targetMinutes
) {
    return (
        startMinutes <= targetMinutes &&
        endMinutes >= targetMinutes
    );
}

function hasMealRelatedTask(
    scheduledTasks,
    mealKeywords
) {
    return scheduledTasks.some((task) => {
        const taskName =
            task.name.toLowerCase();

        return mealKeywords.some((keyword) =>
            taskName.includes(keyword)
        );
    });
}
export function analyzeSchedule({
    schedule,
    tasks,
    startMinutes,
    endMinutes,
    breaksEnabled
}) {
    console.log("analyzeSchedule called");
    const analysisSection =
        document.querySelector("#planner-analysis");

    const scoreElement =
        document.querySelector("#productivity-score");

    const scoreMessage =
        document.querySelector("#score-message");

    const analysisList =
        document.querySelector("#analysis-list");

    const recommendationList =
        document.querySelector("#recommendation-list");
const taskWorkloadBar =
    document.querySelector("#task-workload-bar");

const breakWorkloadBar =
    document.querySelector("#break-workload-bar");

const freeWorkloadBar =
    document.querySelector("#free-workload-bar");

const taskTimeLabel =
    document.querySelector("#task-time-label");

const breakTimeLabel =
    document.querySelector("#break-time-label");

const freeTimeLabel =
    document.querySelector("#free-time-label");

const visualTimeline =
    document.querySelector("#visual-timeline");
   if (
    !analysisSection ||
    !scoreElement ||
    !scoreMessage ||
    !analysisList ||
    !recommendationList ||
    !taskWorkloadBar ||
    !breakWorkloadBar ||
    !freeWorkloadBar ||
    !taskTimeLabel ||
    !breakTimeLabel ||
    !freeTimeLabel ||
    !visualTimeline
) {
    return;
}

    const scheduledTasks = schedule.filter(
        (item) => item.type === "task"
    );

    const breaks = schedule.filter(
        (item) => item.type === "break"
    );

    const unscheduledTasks = schedule.filter(
        (item) => item.type === "unscheduled"
    );

    const missedDeadlines = scheduledTasks.filter(
        (item) => item.missesDeadline
    );

    const heavyTasks = scheduledTasks.filter(
    (task) =>
        classifyTask(task.name) === "heavy"
);

const lightTasks = scheduledTasks.filter(
    (task) =>
        classifyTask(task.name) === "light"
);

const maximumHeavySequence =
    countConsecutiveHeavyTasks(schedule);

const longestContinuousWork =
    findLongestContinuousWork(schedule);

const highPriorityCount =
    scheduledTasks.filter(
        (task) => task.priority === "high"
    ).length;

const scheduleIncludesLunchTime =
    scheduleCrossesTime(
        startMinutes,
        endMinutes,
        12 * 60
    );

const scheduleIncludesDinnerTime =
    scheduleCrossesTime(
        startMinutes,
        endMinutes,
        18 * 60
    );

const hasLunchTask =
    hasMealRelatedTask(
        scheduledTasks,
        ["lunch", "eat", "meal"]
    );

const hasDinnerTask =
    hasMealRelatedTask(
        scheduledTasks,
        ["dinner", "eat", "meal"]
    );

    const totalAvailableTime =
        endMinutes - startMinutes;

    const totalTaskTime = scheduledTasks.reduce(
        (total, item) => total + item.duration,
        0
    );

    const totalBreakTime = breaks.reduce(
        (total, item) => total + item.duration,
        0
    );
const freeTime = Math.max(
    totalAvailableTime - totalTaskTime - totalBreakTime,
    0
);

const taskPercentage =
    totalAvailableTime > 0
        ? (totalTaskTime / totalAvailableTime) * 100
        : 0;

const breakPercentage =
    totalAvailableTime > 0
        ? (totalBreakTime / totalAvailableTime) * 100
        : 0;

const freePercentage =
    totalAvailableTime > 0
        ? (freeTime / totalAvailableTime) * 100
        : 0;
    const utilization =
        totalAvailableTime > 0
            ? (totalTaskTime + totalBreakTime) /
              totalAvailableTime
            : 0;

    let score = 100;

    score -= unscheduledTasks.length * 15;
    score -= missedDeadlines.length * 12;
if (maximumHeavySequence >= 3) {
    score -= 8;
}

if (longestContinuousWork > 120) {
    score -= 8;
} else if (longestContinuousWork > 90) {
    score -= 4;
}

if (
    scheduleIncludesLunchTime &&
    !hasLunchTask
) {
    score -= 3;
}

if (
    scheduleIncludesDinnerTime &&
    !hasDinnerTask
) {
    score -= 3;
}
    if (
        scheduledTasks.length >= 3 &&
        breaksEnabled &&
        breaks.length === 0
    ) {
        score -= 8;
    }

    if (utilization > 0.95) {
        score -= 7;
    }

    if (utilization < 0.4) {
        score -= 5;
    }

    score = Math.max(0, Math.min(100, score));

    const analysisPoints = [];
    const recommendations = [];

    if (scheduledTasks.length > 0) {
        analysisPoints.push(
            `${scheduledTasks.length} task${
                scheduledTasks.length === 1 ? "" : "s"
            } successfully fitted into your available time.`
        );
    }

    const highPriorityTasks = tasks.filter(
        (task) => task.priority === "high"
    );

    if (highPriorityTasks.length > 0) {
        analysisPoints.push(
            `${highPriorityTasks.length} high-priority task${
                highPriorityTasks.length === 1
                    ? " was"
                    : "s were"
            } placed before lower-priority work.`
        );
    }

    if (heavyTasks.length > 0) {
    analysisPoints.push(
        `${heavyTasks.length} mentally demanding task${
            heavyTasks.length === 1 ? " was" : "s were"
        } identified in your schedule.`
    );
}

if (lightTasks.length > 0) {
    analysisPoints.push(
        `${lightTasks.length} lighter activit${
            lightTasks.length === 1 ? "y was" : "ies were"
        } included to improve workload balance.`
    );
}

if (
    longestContinuousWork > 0 &&
    longestContinuousWork <= 90
) {
    analysisPoints.push(
        "Your continuous work periods remain within a manageable length."
    );
}

    if (breaks.length > 0) {
        analysisPoints.push(
            `${breaks.length} break${
                breaks.length === 1 ? " was" : "s were"
            } added to reduce continuous workload.`
        );
    }

    if (
        missedDeadlines.length === 0 &&
        scheduledTasks.length > 0
    ) {
        analysisPoints.push(
            "All scheduled tasks finish before their deadlines."
        );
    }

    if (unscheduledTasks.length > 0) {
        recommendations.push({
            text:
                `${unscheduledTasks.length} task${
                    unscheduledTasks.length === 1
                        ? " does"
                        : "s do"
                } not fit. Extend your available time or shorten task durations.`,
            type: "warning"
        });
    }

    if (missedDeadlines.length > 0) {
        recommendations.push({
            text:
                `${missedDeadlines.length} task${
                    missedDeadlines.length === 1
                        ? " misses"
                        : "s miss"
                } its deadline. Consider starting earlier.`,
            type: "warning"
        });
    }

    if (
        scheduledTasks.length >= 3 &&
        !breaksEnabled
    ) {
        recommendations.push({
            text:
                "Consider enabling breaks for a longer schedule.",
            type: "warning"
        });
    }

    if (utilization > 0.95) {
        recommendations.push({
            text:
                "Your schedule is very full. Leave extra time for unexpected delays.",
            type: "warning"
        });
    }
    if (maximumHeavySequence >= 3) {
    recommendations.push({
        text:
            "You have at least three mentally demanding tasks scheduled consecutively. Place a lighter activity or longer break between them.",
        type: "warning"
    });
}

if (longestContinuousWork > 120) {
    recommendations.push({
        text:
            `Your longest continuous work period is ${formatDuration(
                longestContinuousWork
            )}. Consider taking a proper break before reaching two hours.`,
        type: "warning"
    });
} else if (longestContinuousWork > 90) {
    recommendations.push({
        text:
            `You are working continuously for ${formatDuration(
                longestContinuousWork
            )}. A short recovery break may improve concentration.`,
        type: "warning"
    });
}

if (
    highPriorityCount >= 4
) {
    recommendations.push({
        text:
            "Four or more tasks are marked as high priority. Consider whether every task is truly urgent.",
        type: "warning"
    });
}

if (
    heavyTasks.length >= 3 &&
    lightTasks.length === 0
) {
    recommendations.push({
        text:
            "Your schedule contains several demanding tasks but no lighter activity. Add exercise, walking, or another low-intensity task.",
        type: "warning"
    });
}

if (
    scheduleIncludesLunchTime &&
    !hasLunchTask
) {
    recommendations.push({
        text:
            "Your schedule passes through lunchtime, but no meal period is included. Consider adding lunch around 12:00 PM.",
        type: "warning"
    });
}

if (
    scheduleIncludesDinnerTime &&
    !hasDinnerTask
) {
    recommendations.push({
        text:
            "Your schedule continues through dinner time. Consider setting aside time for an evening meal.",
        type: "warning"
    });
}

if (
    heavyTasks.length > 0 &&
    maximumHeavySequence < 3 &&
    longestContinuousWork <= 90
) {
    recommendations.push({
        text:
            "Your demanding tasks are distributed reasonably well, helping reduce mental fatigue.",
        type: "positive"
    });
}
    if (
        unscheduledTasks.length === 0 &&
        missedDeadlines.length === 0 &&
        utilization <= 0.95
    ) {
        recommendations.push({
            text:
                "Your schedule has a healthy balance between work and available time.",
            type: "positive"
        });
    }

    if (analysisPoints.length === 0) {
        analysisPoints.push(
            "No tasks were scheduled for analysis."
        );
    }

    if (recommendations.length === 0) {
        recommendations.push({
            text:
                "Your schedule is realistic and ready to use.",
            type: "positive"
        });
    }

    analysisList.innerHTML = analysisPoints
        .map((point) => `<li>${escapeHTML(point)}</li>`)
        .join("");

    recommendationList.innerHTML = recommendations
        .map(
            (item) => `
                <li class="${item.type}">
                    ${escapeHTML(item.text)}
                </li>
            `
        )
        .join("");

    scoreElement.textContent = String(score);

    if (score >= 90) {
        scoreMessage.textContent =
            "Excellent balance and time management.";
    } else if (score >= 75) {
        scoreMessage.textContent =
            "A strong schedule with a few areas to improve.";
    } else if (score >= 60) {
        scoreMessage.textContent =
            "Your schedule works, but it needs adjustment.";
    } else {
        scoreMessage.textContent =
            "Consider changing your timing, breaks, or task durations.";
    }
taskWorkloadBar.style.width =
    `${taskPercentage}%`;

breakWorkloadBar.style.width =
    `${breakPercentage}%`;

freeWorkloadBar.style.width =
    `${freePercentage}%`;

taskTimeLabel.textContent =
    formatDuration(totalTaskTime);

breakTimeLabel.textContent =
    formatDuration(totalBreakTime);

freeTimeLabel.textContent =
    formatDuration(freeTime);

visualTimeline.innerHTML = schedule
    .filter((item) => item.type !== "unscheduled")
    .map((item) => {
        const isBreak = item.type === "break";

        const priorityBadge = isBreak
            ? ""
            : `
                <span
                    class="timeline-priority ${item.priority}-priority"
                >
                    ${capitalizeWord(item.priority)}
                </span>
            `;

        return `
            <div class="timeline-item ${
                isBreak ? "timeline-break" : ""
            }">
                <div class="timeline-time">
                    ${formatMinutesAsTime(item.start)}
                </div>

                <div class="timeline-track">
                    <span class="timeline-dot"></span>
                </div>

                <div class="timeline-content">
                    <h4>${escapeHTML(item.name)}</h4>

                    <p>
                        ${item.duration} minutes ·
                        Ends at ${formatMinutesAsTime(item.end)}
                    </p>

                    ${priorityBadge}
                </div>
            </div>
        `;
    })
    .join("");
    console.log("analyzeSchedule called");
    analysisSection.hidden = false;
}