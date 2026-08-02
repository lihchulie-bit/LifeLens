"use strict";

import { accountStorage } from "./account-storage.js";

import {
    getLearningHistory
} from "./learning.js";
import { auth, db } from "./firebase.js";
import {
    doc,
    getDoc,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ================= GENERAL HELPERS ================= */

function formatDuration(minutes) {
    const safeMinutes = Math.max(
        0,
        Math.round(Number(minutes) || 0)
    );

    if (safeMinutes < 60) {
        return `${safeMinutes} min`;
    }

    const hours = Math.floor(
        safeMinutes / 60
    );

    const remainingMinutes =
        safeMinutes % 60;

    if (remainingMinutes === 0) {
        return `${hours} hr`;
    }

    return `${hours} hr ${remainingMinutes} min`;
}

function escapeHTML(text) {
    const temporaryElement =
        document.createElement("div");

    temporaryElement.textContent =
        String(text ?? "");

    return temporaryElement.innerHTML;
}

function normalizeDate(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function getStartOfCurrentWeek() {
    const today = new Date();

    today.setHours(0, 0, 0, 0);

    /*
        Monday becomes the first day of the week.

        Sunday returns 0, so it needs to move
        backward by six days.
    */
    const dayNumber =
        today.getDay();

    const daysSinceMonday =
        dayNumber === 0
            ? 6
            : dayNumber - 1;

    today.setDate(
        today.getDate() -
        daysSinceMonday
    );

    return today;
}

function getEndOfCurrentWeek() {
    const weekEnd =
        getStartOfCurrentWeek();

    weekEnd.setDate(
        weekEnd.getDate() + 7
    );

    return weekEnd;
}

function recordIsFromCurrentWeek(record) {
    const completedDate =
        normalizeDate(record.completedAt);

    if (!completedDate) {
        return false;
    }

    const weekStart =
        getStartOfCurrentWeek();

    const weekEnd =
        getEndOfCurrentWeek();

    return (
        completedDate >= weekStart &&
        completedDate < weekEnd
    );
}

function calculateAverage(
    records,
    propertyName
) {
    if (records.length === 0) {
        return 0;
    }

    const total = records.reduce(
        (sum, record) => {
            return (
                sum +
                Number(
                    record[propertyName] || 0
                )
            );
        },
        0
    );

    return Math.round(
        total / records.length
    );
}

function calculatePlanningAccuracy(
    totalPlanned,
    totalActual
) {
    if (
        totalPlanned <= 0 ||
        totalActual <= 0
    ) {
        return 0;
    }

    const difference =
        Math.abs(
            totalPlanned - totalActual
        );

    const differenceRatio =
        difference / totalPlanned;

    return Math.max(
        0,
        Math.min(
            100,
            Math.round(
                (1 - differenceRatio) * 100
            )
        )
    );
}

function getPlanningAccuracyMessage(
    accuracy,
    totalPlanned,
    totalActual
) {
    if (
        totalPlanned === 0 ||
        totalActual === 0
    ) {
        return (
            "Complete tasks to begin measuring " +
            "your planning accuracy."
        );
    }

    const difference =
        totalActual - totalPlanned;

    if (accuracy >= 90) {
        return (
            "Your estimates are highly accurate. " +
            "Keep using similar durations."
        );
    }

    if (accuracy >= 75) {
        return (
            "Your estimates are generally reliable, " +
            "with only small differences."
        );
    }

    if (difference > 0) {
        return (
            `Tasks took ${formatDuration(
                Math.abs(difference)
            )} longer than planned this week.`
        );
    }

    return (
        `Tasks took ${formatDuration(
            Math.abs(difference)
        )} less than planned this week.`
    );
}

/* ================= TASK GROUPING ================= */

function normalizeTaskCategory(taskName) {
    const normalizedName =
        String(taskName)
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .replace(
    /\b(homework|assignment|revision|practice|study|task)\b/g,
    ""
)
            .replace(/\s+/g, " ")
            .trim();

    if (!normalizedName) {
        return "General tasks";
    }

    const words =
        normalizedName.split(" ");

    const meaningfulWord =
        words.find(
            (word) => word.length >= 3
        );

    return meaningfulWord
        ? meaningfulWord.charAt(0).toUpperCase() +
          meaningfulWord.slice(1)
        : "General tasks";
}

function findMostPracticedTask(records) {
    if (records.length === 0) {
        return "—";
    }

    const categoryCounts = {};

    records.forEach((record) => {
        const category =
            normalizeTaskCategory(
                record.name
            );

        categoryCounts[category] =
            (categoryCounts[category] || 0) + 1;
    });

    const sortedCategories =
        Object.entries(categoryCounts)
            .sort(
                (
                    [, firstCount],
                    [, secondCount]
                ) =>
                    secondCount -
                    firstCount
            );

    return sortedCategories[0]?.[0] || "—";
}

/* ================= WEEKLY ACTIVITY ================= */

function createWeeklyData(records, selectedWeekStart = getStartOfCurrentWeek()) {
    const weekStart = new Date(selectedWeekStart);

    const days = [];

    for (
        let dayOffset = 0;
        dayOffset < 7;
        dayOffset += 1
    ) {
        const date =
            new Date(weekStart);

        date.setDate(
            weekStart.getDate() +
            dayOffset
        );

        const count = records.filter(
            (record) => {
                const completedDate =
                    normalizeDate(
                        record.completedAt
                    );

                if (!completedDate) {
                    return false;
                }

                return (
                    completedDate.getFullYear() ===
                        date.getFullYear() &&
                    completedDate.getMonth() ===
                        date.getMonth() &&
                    completedDate.getDate() ===
                        date.getDate()
                );
            }
        ).length;

        days.push({
            name:
                date.toLocaleDateString(
                    undefined,
                    {
                        weekday: "short"
                    }
                ),

            fullName:
                date.toLocaleDateString(
                    undefined,
                    {
                        weekday: "long"
                    }
                ),

            dateLabel:
                date.toLocaleDateString(
                    undefined,
                    {
                        month: "short",
                        day: "numeric"
                    }
                ),

            isoDate:
                date.toISOString().slice(0, 10),

            count
        });
    }

    return days;
}

function renderWeeklyBars(
    weeklyBars,
    weeklyData
) {
    if (!weeklyBars) {
        return;
    }

    const maximumCount = Math.max(
        ...weeklyData.map(
            (day) => day.count
        ),
        1
    );

    weeklyBars.innerHTML =
        weeklyData
            .map((day) => {
                const heightPercentage =
                    day.count === 0
                        ? 3
                        : Math.max(
                              10,
                              Math.round(
                                  (
                                      day.count /
                                      maximumCount
                                  ) * 100
                              )
                          );

                return `
                    <div
                        class="weekly-bar-column"
                        title="${escapeHTML(
                            `${day.fullName}, ${day.dateLabel}: ${day.count} completed`
                        )}"
                    >
                        <div class="weekly-bar-area">
                            <div
                                class="weekly-bar-fill"
                                style="height: ${heightPercentage}%"
                            ></div>
                        </div>

                        <span class="weekly-bar-count">
                            ${day.count}
                        </span>

                        <span class="weekly-bar-day">
                            ${escapeHTML(day.name)}
                        </span>

                        <span class="weekly-bar-date">
                            ${escapeHTML(day.dateLabel)}
                        </span>
                    </div>
                `;
            })
            .join("");
}

function getWeekStartWithOffset(weekOffset) {
    const weekStart = getStartOfCurrentWeek();
    weekStart.setDate(weekStart.getDate() + (Number(weekOffset) * 7));
    return weekStart;
}

function formatWeekRange(weekStart) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const startMonth = weekStart.toLocaleDateString(undefined, { month: "short" });
    const endMonth = weekEnd.toLocaleDateString(undefined, { month: "short" });
    const year = weekEnd.getFullYear();

    if (weekStart.getMonth() === weekEnd.getMonth()) {
        return `${startMonth} ${weekStart.getDate()}–${weekEnd.getDate()}, ${year}`;
    }

    return `${startMonth} ${weekStart.getDate()} – ${endMonth} ${weekEnd.getDate()}, ${year}`;
}

function findStrongestDay(weeklyData) {
    const strongestResult =
        weeklyData.reduce(
            (strongest, day) => {
                return day.count >
                    strongest.count
                    ? day
                    : strongest;
            },
            {
                fullName: "—",
                count: 0
            }
        );

    return strongestResult;
}

/* ================= LEARNING INSIGHTS ================= */

function createLearningInsight(record) {
    const planned =
        Number(record.plannedDuration || 0);

    const actual =
        Number(record.actualDuration || 0);

    const difference =
        actual - planned;

    const safeName =
        escapeHTML(record.name);

    if (difference === 0) {
        return `
            <strong>${safeName}</strong>
            matched your estimate exactly at
            ${formatDuration(actual)}.
        `;
    }

    if (difference < 0) {
        return `
            <strong>${safeName}</strong>
            was completed
            ${formatDuration(
                Math.abs(difference)
            )}
            faster than planned.
        `;
    }

    return `
        <strong>${safeName}</strong>
        took
        ${formatDuration(difference)}
        longer than planned.
    `;
}

function renderRecentInsights(
    insightList,
    records
) {
    if (!insightList) {
        return;
    }

    const recentRecords =
        [...records]
            .sort((first, second) => {
                return (
                    new Date(
                        second.completedAt
                    ) -
                    new Date(
                        first.completedAt
                    )
                );
            })
            .slice(0, 5);

    if (recentRecords.length === 0) {
        insightList.innerHTML = `
            <li>
                No learning history is available yet.
            </li>
        `;

        return;
    }

    insightList.innerHTML =
        recentRecords
            .map(
                (record) => `
                    <li>
                        ${createLearningInsight(record)}
                    </li>
                `
            )
            .join("");
}


/* ================= PRODUCTIVITY SCORE ================= */

function calculateProductivityScore(records, accuracy, weeklyData) {
    if (records.length === 0) {
        return {
            total: 0,
            completion: 0,
            accuracy: 0,
            consistency: 0,
            message: "Complete tasks to generate your score."
        };
    }

    /*
        Completion rewards up to ten completed tasks per week.
        Accuracy uses the existing planned-versus-actual result.
        Consistency rewards activity across multiple days.
    */
    const completion = Math.min(
        100,
        Math.round((records.length / 10) * 100)
    );

    const activeDays = weeklyData.filter(
        (day) => day.count > 0
    ).length;

    const consistency = Math.min(
        100,
        Math.round((activeDays / 5) * 100)
    );

    const total = Math.round(
        completion * 0.4 +
        accuracy * 0.4 +
        consistency * 0.2
    );

    let message = "A good start. Complete more tasks across the week to raise your score.";

    if (total >= 90) {
        message = "Outstanding week — your completion, timing, and consistency are all excellent.";
    } else if (total >= 75) {
        message = "Strong performance. Your planning habits are becoming reliable and consistent.";
    } else if (total >= 55) {
        message = "Solid progress. Better time estimates or another active day would improve your score.";
    }

    return {
        total,
        completion,
        accuracy,
        consistency,
        message
    };
}

function renderProductivityScore(elements, score) {
    const {
        ring,
        total,
        message,
        completion,
        accuracy,
        consistency
    } = elements;

    ring?.style.setProperty(
        "--score",
        String(score.total)
    );

    ring?.style.setProperty(
        "--score-progress",
        `${score.total}%`
    );

    if (total) total.textContent = String(score.total);
    if (message) message.textContent = score.message;
    if (completion) completion.textContent = `${score.completion}%`;
    if (accuracy) accuracy.textContent = `${score.accuracy}%`;
    if (consistency) consistency.textContent = `${score.consistency}%`;
}

/* ================= PRIORITY DISTRIBUTION ================= */

function renderPriorityChart(records, elements) {
    const counts = {
        high: 0,
        medium: 0,
        low: 0
    };

    records.forEach((record) => {
        const priority = String(
            record.priority || "medium"
        ).toLowerCase();

        if (Object.hasOwn(counts, priority)) {
            counts[priority] += 1;
        } else {
            counts.medium += 1;
        }
    });

    const total = records.length;
    const highPercent = total > 0
        ? (counts.high / total) * 100
        : 0;
    const mediumPercent = total > 0
        ? (counts.medium / total) * 100
        : 0;

    if (elements.donut) {
        elements.donut.style.setProperty("background", total > 0
            ? `conic-gradient(
                #ef4444 0 ${highPercent}%,
                #f59e0b ${highPercent}% ${highPercent + mediumPercent}%,
                #22c55e ${highPercent + mediumPercent}% 100%
            )`
            : "conic-gradient(#e2e8f0 0 100%)", "important");
    }

    if (elements.total) elements.total.textContent = String(total);
    if (elements.high) elements.high.textContent = String(counts.high);
    if (elements.medium) elements.medium.textContent = String(counts.medium);
    if (elements.low) elements.low.textContent = String(counts.low);
}

/* ================= PLANNED VS ACTUAL CHART ================= */

function renderTimeComparisonChart(container, records) {
    if (!container) {
        return;
    }

    const recentRecords = [...records]
        .sort((first, second) => (
            new Date(second.completedAt) -
            new Date(first.completedAt)
        ))
        .slice(0, 6)
        .reverse();

    if (recentRecords.length === 0) {
        container.innerHTML = `
            <p class="chart-empty-message">
                Complete tasks to compare planned and actual time.
            </p>
        `;
        return;
    }

    const maximumMinutes = Math.max(
        ...recentRecords.flatMap((record) => [
            Number(record.plannedDuration || 0),
            Number(record.actualDuration || 0)
        ]),
        1
    );

    container.innerHTML = recentRecords.map((record) => {
        const planned = Number(record.plannedDuration || 0);
        const actual = Number(record.actualDuration || 0);
        const plannedWidth = Math.max(3, Math.round((planned / maximumMinutes) * 100));
        const actualWidth = Math.max(3, Math.round((actual / maximumMinutes) * 100));

        return `
            <div class="time-comparison-row">
                <div class="time-comparison-label" title="${escapeHTML(record.name)}">
                    ${escapeHTML(record.name)}
                </div>

                <div class="time-comparison-bars">
                    <div class="comparison-bar-line">
                        <span>Plan</span>
                        <div class="comparison-track">
                            <i class="comparison-fill planned" style="width:${plannedWidth}%"></i>
                        </div>
                        <strong>${formatDuration(planned)}</strong>
                    </div>

                    <div class="comparison-bar-line">
                        <span>Actual</span>
                        <div class="comparison-track">
                            <i class="comparison-fill actual" style="width:${actualWidth}%"></i>
                        </div>
                        <strong>${formatDuration(actual)}</strong>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}



/* ================= DAILY REVIEW ================= */
const DAILY_REVIEW_STORAGE_KEY = "lifelens-daily-reviews";
const PLANNER_STORAGE_KEY = "lifelens-planner-data";


function inferStudyCategory(taskName) {
    const name = String(taskName || "").toLowerCase();

    const categoryRules = [
        ["Mathematics", /\b(math|mathematics|algebra|geometry|calculus|statistics|sat math)\b/],
        ["Physics", /\b(physics|mechanics|electricity|waves|thermodynamics)\b/],
        ["Chemistry", /\b(chemistry|chemical|organic|inorganic|stoichiometry)\b/],
        ["Biology", /\b(biology|biological|genetics|ecology|anatomy)\b/],
        ["English", /\b(english|ielts|sat reading|sat verbal|writing|reading|essay|grammar)\b/],
        ["Coding", /\b(coding|programming|javascript|python|html|css|roblox|software|computer)\b/],
        ["Languages", /\b(mandarin|chinese|german|hindi|japanese|korean|language)\b/],
        ["Other", /.*/]
    ];

    return categoryRules.find(([, pattern]) => pattern.test(name))?.[0] || "Other";
}

function createSubjectDistribution(records) {
    const totals = new Map();

    records.forEach((record) => {
        const category = inferStudyCategory(record.name);
        const minutes = Math.max(0, Number(record.actualDuration || 0));
        totals.set(category, (totals.get(category) || 0) + minutes);
    });

    return [...totals.entries()]
        .map(([name, minutes]) => ({ name, minutes }))
        .filter((item) => item.minutes > 0)
        .sort((a, b) => b.minutes - a.minutes);
}

function renderSubjectDistribution(records) {
    const donut = document.querySelector("#subject-donut");
    const legend = document.querySelector("#subject-legend");
    const totalElement = document.querySelector("#subject-total-time");

    if (!donut || !legend || !totalElement) {
        return;
    }

    const distribution = createSubjectDistribution(records);
    const total = distribution.reduce((sum, item) => sum + item.minutes, 0);
    totalElement.textContent = formatDuration(total);

    if (total <= 0) {
        donut.style.background = "conic-gradient(#dbeafe 0 100%)";
        legend.innerHTML = '<li class="chart-empty-message">Complete tasks to reveal your study mix.</li>';
        return;
    }

    const colors = ["#2563eb", "#7c3aed", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#64748b"];
    let cursor = 0;
    const segments = distribution.map((item, index) => {
        const percentage = (item.minutes / total) * 100;
        const start = cursor;
        cursor += percentage;
        return `${colors[index % colors.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    });

    donut.style.background = `conic-gradient(${segments.join(", ")})`;
    legend.innerHTML = distribution.slice(0, 7).map((item, index) => {
        const percentage = Math.round((item.minutes / total) * 100);
        return `
            <li>
                <i class="subject-legend-dot" style="background:${colors[index % colors.length]}"></i>
                <span>${escapeHTML(item.name)}</span>
                <strong>${formatDuration(item.minutes)} · ${percentage}%</strong>
            </li>
        `;
    }).join("");
}

function getTimePeriod(hour) {
    if (hour < 6) return "Late night";
    if (hour < 12) return "Morning";
    if (hour < 17) return "Afternoon";
    if (hour < 21) return "Evening";
    return "Night";
}

function renderPeakProductivity(records) {
    const title = document.querySelector("#peak-productivity-time");
    const message = document.querySelector("#peak-productivity-message");
    const bars = document.querySelector("#time-of-day-bars");

    if (!title || !message || !bars) {
        return;
    }

    const periodOrder = ["Morning", "Afternoon", "Evening", "Night", "Late night"];
    const totals = Object.fromEntries(periodOrder.map((period) => [period, 0]));
    const counts = Object.fromEntries(periodOrder.map((period) => [period, 0]));

    records.forEach((record) => {
        const completedAt = new Date(record.completedAt);
        if (Number.isNaN(completedAt.getTime())) return;
        const period = getTimePeriod(completedAt.getHours());
        totals[period] += Math.max(0, Number(record.actualDuration || 0));
        counts[period] += 1;
    });

    const bestPeriod = periodOrder.reduce((best, period) =>
        totals[period] > totals[best] ? period : best,
        periodOrder[0]
    );
    const maximum = Math.max(...Object.values(totals), 0);

    if (maximum <= 0) {
        title.textContent = "—";
        message.textContent = "Complete tasks at different times to identify your best focus window.";
    } else {
        const labels = {
            Morning: "6 AM–12 PM",
            Afternoon: "12–5 PM",
            Evening: "5–9 PM",
            Night: "9 PM–12 AM",
            "Late night": "12–6 AM"
        };
        title.textContent = `${bestPeriod} · ${labels[bestPeriod]}`;
        message.textContent = `${counts[bestPeriod]} completed task${counts[bestPeriod] === 1 ? "" : "s"} and ${formatDuration(totals[bestPeriod])} of focused work were recorded in this period.`;
    }

    bars.innerHTML = periodOrder.map((period) => {
        const width = maximum > 0 ? Math.round((totals[period] / maximum) * 100) : 0;
        return `
            <div class="time-period-row">
                <span>${period}</span>
                <div class="time-period-track"><div class="time-period-fill" style="width:${width}%"></div></div>
                <strong>${formatDuration(totals[period])}</strong>
            </div>
        `;
    }).join("");
}

function renderSmartDashboardInsights(records, accuracy, weeklyData) {
    const list = document.querySelector("#smart-dashboard-insights");
    if (!list) return;

    if (!records.length) {
        list.innerHTML = "<li>Complete tasks to unlock personalized weekly insights.</li>";
        return;
    }

    const insights = [];
    const averageDifference = records.reduce((sum, record) =>
        sum + (Number(record.actualDuration || 0) - Number(record.plannedDuration || 0)), 0
    ) / records.length;

    if (Math.abs(averageDifference) >= 5) {
        insights.push(
            averageDifference > 0
                ? `Your tasks take about ${formatDuration(Math.round(averageDifference))} longer than planned on average. Increase future estimates slightly.`
                : `You finish tasks about ${formatDuration(Math.abs(Math.round(averageDifference)))} earlier than planned on average. Your estimates may be more generous than necessary.`
        );
    } else {
        insights.push("Your planned durations are closely matching your actual work time this week.");
    }

    const distribution = createSubjectDistribution(records);
    if (distribution[0]) {
        insights.push(`${distribution[0].name} received the most attention this week with ${formatDuration(distribution[0].minutes)} of completed work.`);
    }

    const strongest = findStrongestDay(weeklyData);
    if (strongest.count > 0) {
        insights.push(`${strongest.fullName} was your strongest completion day with ${strongest.count} finished task${strongest.count === 1 ? "" : "s"}.`);
    }

    if (accuracy >= 90) {
        insights.push(`Your ${accuracy}% planning accuracy is excellent. Keep using your current estimation approach.`);
    } else if (accuracy < 70) {
        insights.push(`Planning accuracy is ${accuracy}%. Use LifeLens duration suggestions before finalizing longer sessions.`);
    }

    list.innerHTML = insights.slice(0, 4).map((insight) => `<li>${escapeHTML(insight)}</li>`).join("");
}

function getLocalDateKey(dateValue = new Date()) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function recordIsFromToday(record) {
    return getLocalDateKey(record?.completedAt) === getLocalDateKey();
}

function getCompletionStorageKey(taskName) {
    return `lifelens-completed-${String(taskName || "").trim().toLowerCase()}`;
}

function taskIsCompleted(taskName) {
    return accountStorage.getItem(getCompletionStorageKey(taskName)) === "true";
}

function loadPlannerSnapshot() {
    try {
        const parsed = JSON.parse(accountStorage.getItem(PLANNER_STORAGE_KEY) || "null");
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
        console.error("Could not load planner snapshot:", error);
        return null;
    }
}

function loadDailyReviews() {
    try {
        const parsed = JSON.parse(accountStorage.getItem(DAILY_REVIEW_STORAGE_KEY) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
        console.error("Could not load daily reviews:", error);
        return {};
    }
}

function saveDailyReviews(reviews) {
    accountStorage.setItem(DAILY_REVIEW_STORAGE_KEY, JSON.stringify(reviews));
}

function getDashboardScheduleTaskId(item, scheduleDate) {
    const baseDate = normalizeDate(scheduleDate) || new Date();
    baseDate.setHours(0, 0, 0, 0);
    baseDate.setDate(baseDate.getDate() + Number(item?.dateOffset || 0));

    return [
        getLocalDateKey(baseDate),
        Number(item?.start || 0),
        Number(item?.duration || 0),
        String(item?.name || "").trim().toLowerCase()
    ].join("|");
}

function createDailyReview(history) {
    const todayHistory = history.filter(recordIsFromToday);
    const planner = loadPlannerSnapshot();
    const schedule = Array.isArray(planner?.generatedSchedule) ? planner.generatedSchedule : [];
    const todayTasks = schedule.filter((item) => item?.type === "task" && Number(item.dateOffset || 0) === 0);
    const completedNames = new Set(todayHistory.map((record) => String(record.name || "").trim().toLowerCase()));
    const completedTaskIds = new Set(Array.isArray(planner?.completedTaskIds) ? planner.completedTaskIds : []);
    const completedScheduled = todayTasks.filter((task) =>
        completedTaskIds.has(getDashboardScheduleTaskId(task, planner?.scheduleDate)) ||
        taskIsCompleted(task.name) ||
        completedNames.has(String(task.name || "").trim().toLowerCase())
    ).length;
    const completed = todayTasks.length > 0 ? completedScheduled : todayHistory.length;
    const total = Math.max(todayTasks.length, completed);
    const planned = todayHistory.reduce((sum, record) => sum + Number(record.plannedDuration || 0), 0);
    const actual = todayHistory.reduce((sum, record) => sum + Number(record.actualDuration || 0), 0);
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const accuracy = calculatePlanningAccuracy(planned, actual);
    const difference = actual - planned;

    const byDifference = todayHistory.map((record) => ({
        name: record.name || "Unnamed task",
        difference: Number(record.actualDuration || 0) - Number(record.plannedDuration || 0)
    }));
    const mostEfficient = [...byDifference].sort((a, b) => a.difference - b.difference)[0];
    const needsMoreTime = [...byDifference].sort((a, b) => b.difference - a.difference)[0];

    let recommendation = "Complete tasks today to generate a personalized recommendation.";
    if (todayHistory.length > 0) {
        if (needsMoreTime && needsMoreTime.difference >= 10) {
            recommendation = `${needsMoreTime.name} took ${formatDuration(needsMoreTime.difference)} longer than planned. Give it a larger time block or schedule it earlier tomorrow.`;
        } else if (mostEfficient && mostEfficient.difference <= -10) {
            recommendation = `${mostEfficient.name} finished ${formatDuration(Math.abs(mostEfficient.difference))} early. You can use a slightly shorter estimate next time.`;
        } else if (accuracy >= 90) {
            recommendation = "Your time estimates were highly accurate today. Keep using similar durations for these tasks.";
        } else {
            recommendation = "Your day was reasonably balanced. Review unfinished tasks and protect your highest-energy hours tomorrow.";
        }
    }

    return {
        date: getLocalDateKey(),
        completed,
        total,
        rate,
        planned,
        actual,
        difference,
        accuracy,
        efficient: mostEfficient?.name || "—",
        longest: needsMoreTime?.difference > 0 ? needsMoreTime.name : "—",
        recommendation,
        unfinished: todayTasks.filter((task) =>
            !completedTaskIds.has(getDashboardScheduleTaskId(task, planner?.scheduleDate)) &&
            !taskIsCompleted(task.name) &&
            !completedNames.has(String(task.name || "").trim().toLowerCase())
        ).length,
        createdAt: new Date().toISOString()
    };
}

function renderDailyReviewHistory(container) {
    if (!container) return;
    const reviews = Object.values(loadDailyReviews()).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 7);
    if (reviews.length === 0) {
        container.innerHTML = '<p class="dashboard-message">No saved reviews yet.</p>';
        return;
    }
    container.innerHTML = reviews.map((review) => `
        <div class="daily-review-history-item">
            <strong>${escapeHTML(new Date(`${review.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}</strong>
            <span>${Number(review.completed || 0)} / ${Number(review.total || 0)} tasks</span>
            <span>${Number(review.accuracy || 0)}% accuracy</span>
        </div>
    `).join("");
}

function initializeDailyReview(history) {
    const elements = {
        date: document.querySelector("#daily-review-date"),
        badge: document.querySelector("#daily-review-status-badge"),
        completed: document.querySelector("#daily-review-completed"),
        rate: document.querySelector("#daily-review-rate"),
        planned: document.querySelector("#daily-review-planned"),
        actual: document.querySelector("#daily-review-actual"),
        difference: document.querySelector("#daily-review-difference"),
        accuracy: document.querySelector("#daily-review-accuracy"),
        efficient: document.querySelector("#daily-review-efficient"),
        longest: document.querySelector("#daily-review-longest"),
        recommendation: document.querySelector("#daily-review-recommendation"),
        save: document.querySelector("#save-daily-review-button"),
        move: document.querySelector("#move-unfinished-button"),
        message: document.querySelector("#daily-review-action-message"),
        history: document.querySelector("#daily-review-history-list")
    };
    if (!elements.completed) return;

    let review = createDailyReview(history);
    const render = () => {
        elements.date.textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        elements.completed.textContent = `${review.completed} / ${review.total}`;
        elements.rate.textContent = `${review.rate}%`;
        elements.planned.textContent = formatDuration(review.planned);
        elements.actual.textContent = formatDuration(review.actual);
        elements.difference.textContent = review.difference === 0 ? "On target" : `${review.difference > 0 ? "+" : "−"}${formatDuration(Math.abs(review.difference))}`;
        elements.accuracy.textContent = `${review.accuracy}%`;
        elements.efficient.textContent = review.efficient;
        elements.longest.textContent = review.longest;
        elements.recommendation.textContent = review.recommendation;
        const saved = Boolean(loadDailyReviews()[review.date]);
        elements.badge.textContent = saved ? "Saved" : "Live";
        elements.badge.classList.toggle("is-saved", saved);
        elements.move.disabled = review.unfinished === 0;
        elements.move.textContent = review.unfinished > 0 ? `Move ${review.unfinished} unfinished task${review.unfinished === 1 ? "" : "s"} to tomorrow` : "No unfinished tasks";
        renderDailyReviewHistory(elements.history);
    };

    elements.save.addEventListener("click", () => {
        review = createDailyReview(getLearningHistory());
        const reviews = loadDailyReviews();
        reviews[review.date] = review;
        saveDailyReviews(reviews);
        elements.message.textContent = "Today’s review was saved.";
        render();
        renderHeatmap();
        renderAchievements();
        renderXPSystem();
        renderAICoach();

        const today = document.querySelector(
            `#heatmap-grid .heatmap-cell[data-date="${getLocalDateKey()}"]`
        );

        if (today) {
            today.classList.remove("new-review");
            void today.offsetWidth;
            today.classList.add("new-review");
        }
    });

    elements.move.addEventListener("click", () => {
        const planner = loadPlannerSnapshot();
        if (!planner || !Array.isArray(planner.generatedSchedule)) {
            elements.message.textContent = "Generate or restore a planner schedule first.";
            return;
        }
        let moved = 0;
        planner.generatedSchedule = planner.generatedSchedule.map((item) => {
            if (item?.type !== "task" || Number(item.dateOffset || 0) !== 0 || taskIsCompleted(item.name)) return item;
            moved += 1;
            return { ...item, dateOffset: 1, rescheduled: true, rescheduledAt: new Date().toISOString() };
        });
        planner.savedAt = new Date().toISOString();
        accountStorage.setItem(PLANNER_STORAGE_KEY, JSON.stringify(planner));
        elements.message.textContent = moved > 0 ? `${moved} unfinished task${moved === 1 ? " was" : "s were"} moved to tomorrow. Open the planner to view the updated schedule.` : "There were no unfinished tasks to move.";
        review = createDailyReview(getLearningHistory());
        render();
    });

    render();
}

/* ==========================================================
   PRODUCTIVITY HEATMAP
========================================================== */

function getLast84Days() {
    const days = [];

    const today = new Date();
    today.setHours(0,0,0,0);

    for(let i=83;i>=0;i--){
        const d=new Date(today);
        d.setDate(today.getDate()-i);
        days.push(d);
    }

    return days;
}

function getHeatLevel(rate){

    if(rate===0) return 0;

    if(rate<=25) return 1;

    if(rate<=50) return 2;

    if(rate<=75) return 3;

    return 4;

}

function formatHeatDate(date) {
    return getLocalDateKey(date);
}

function loadSavedReviews(){

    try{

        return JSON.parse(
            accountStorage.getItem(
                DAILY_REVIEW_STORAGE_KEY
            ) || "{}"
        );

    }

    catch{

        return {};

    }

}
const STREAK_ACTIVITY_STORAGE_KEY =
    "lifelens-streak-activity-v1";

function loadPlannerStreakActivity() {
    try {
        const saved = JSON.parse(
            accountStorage.getItem(
                STREAK_ACTIVITY_STORAGE_KEY
            ) || "{}"
        );

        return saved && typeof saved === "object"
            ? saved
            : {};
    } catch {
        return {};
    }
}

function getActiveStreakDates(reviews) {
    const activeDates = new Set();

    Object.entries(reviews || {}).forEach(
        ([dateKey, review]) => {
            if (Number(review?.completed || 0) > 0) {
                activeDates.add(dateKey);
            }
        }
    );

    Object.entries(loadPlannerStreakActivity()).forEach(
        ([dateKey, count]) => {
            if (Number(count || 0) > 0) {
                activeDates.add(dateKey);
            }
        }
    );

    return activeDates;
}

function shiftLocalDateKey(dateKey, dayOffset) {
    const [year, month, day] = String(dateKey)
        .split("-")
        .map(Number);

    if (!year || !month || !day) {
        return "";
    }

    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + dayOffset);

    return formatHeatDate(date);
}

function calculateCurrentStreak(reviews) {
    const activeDates = getActiveStreakDates(reviews);
    let cursor = formatHeatDate(new Date());

    if (!activeDates.has(cursor)) {
        cursor = shiftLocalDateKey(cursor, -1);
    }

    let streak = 0;

    while (cursor && activeDates.has(cursor)) {
        streak++;
        cursor = shiftLocalDateKey(cursor, -1);
    }

    return streak;
}

function calculateLongestStreak(reviews) {
    const keys = Array.from(
        getActiveStreakDates(reviews)
    ).sort();

    let longest = 0;
    let current = 0;
    let previousKey = "";

    keys.forEach((key) => {
        const expectedKey = previousKey
            ? shiftLocalDateKey(previousKey, 1)
            : "";

        current = previousKey && key === expectedKey
            ? current + 1
            : 1;

        longest = Math.max(longest, current);
        previousKey = key;
    });

    return longest;
}
function calculateAverageCompletion(reviews){

    const values=Object.values(reviews);

    if(values.length===0) return 0;

    const total=values.reduce(
        (sum,r)=>sum+(r.rate||0),
        0
    );

    return Math.round(total/values.length);

}
function calculateBestWeekday(reviews){

    const weekdays=[
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday"
    ];

    const stats={};

    weekdays.forEach(day=>{

        stats[day]={
            total:0,
            count:0
        };

    });

    Object.values(reviews).forEach(review=>{

        const day=weekdays[
            new Date(review.date).getDay()
        ];

        stats[day].total+=review.rate||0;

        stats[day].count++;

    });

    let best="—";

    let bestRate=-1;

    weekdays.forEach(day=>{

        if(stats[day].count===0) return;

        const avg=
            stats[day].total/
            stats[day].count;

        if(avg>bestRate){

            bestRate=avg;

            best=day;

        }

    });

    return best;

}
function renderHeatmap(){

    const grid=document.querySelector("#heatmap-grid");

    if(!grid) return;

    const reviews=loadSavedReviews();
    const plannerActivity =
        loadPlannerStreakActivity();

    const days=getLast84Days();

    grid.innerHTML="";

    days.forEach(day=>{

        const key=formatHeatDate(day);

        const review=reviews[key];
        const plannerCompletions = Math.max(
            0,
            Number(plannerActivity[key]) || 0
        );
        const effectiveRate = review
            ? Number(review.rate || 0)
            : plannerCompletions > 0
                ? 25
                : 0;

        const level=getHeatLevel(
            effectiveRate
        );

        const cell=document.createElement("button");

        cell.type="button";

        cell.className=
            `heatmap-cell level-${level}`;

        cell.dataset.date=key;
cell.dataset.rate = String(
    effectiveRate
);

cell.dataset.completed = String(
    review
        ? Math.min(
            Number(review.completed || 0),
            Math.max(0, Number(review.total || 0))
        )
        : plannerCompletions
);

cell.dataset.total = String(
    Number(review?.total || 0)
);

cell.dataset.accuracy = String(
    Number(review?.accuracy || 0)
);

cell.dataset.hasReview = String(
    Boolean(review)
);
        if (key === getLocalDateKey()) {
    cell.classList.add("is-today");
}


        grid.appendChild(cell);

    });

    document.querySelector(
        "#current-streak"
    ).textContent=
        `${calculateCurrentStreak(reviews)} days`;

    document.querySelector(
        "#longest-streak"
    ).textContent=
        `${calculateLongestStreak(reviews)} days`;

    document.querySelector(
        "#average-completion"
    ).textContent=
        `${calculateAverageCompletion(reviews)}%`;

    document.querySelector(
        "#best-weekday"
    ).textContent=
        calculateBestWeekday(reviews);

}

/* ==========================================================
   HEATMAP DETAILS
========================================================== */

function showHeatmapDetail(dateKey) {
    const detail = document.querySelector("#heatmap-detail");

    if (!detail || !dateKey) {
        return;
    }

    const reviews=loadSavedReviews();

    const review=reviews[dateKey];

    document
        .querySelectorAll(".heatmap-cell")
        .forEach(cell=>cell.classList.remove("is-selected"));

    const selected=document.querySelector(
        `.heatmap-cell[data-date="${dateKey}"]`
    );

    if(selected){

        selected.classList.add("is-selected");

    }

    if(!review){

        detail.innerHTML=`
            <div class="heatmap-detail-header">
                <strong>${dateKey}</strong>

                <span class="heatmap-detail-badge">
                    No Review
                </span>
            </div>

            <p>
                No productivity review was saved for this day.
            </p>
        `;

        detail.classList.add("is-visible");

        return;

    }

    detail.innerHTML=`

        <div class="heatmap-detail-header">

            <strong>

                ${new Date(`${dateKey}T12:00:00`).toLocaleDateString(
                    undefined,
                    {
                        weekday:"long",
                        month:"long",
                        day:"numeric",
                        year:"numeric"
                    }
                )}

            </strong>

            <span class="heatmap-detail-badge">

                ${review.rate}% Completed

            </span>

        </div>

        <div class="heatmap-detail-grid">

            <div class="heatmap-detail-item">

                <span>Completed</span>

                <strong>

                    ${review.completed}
                    /
                    ${review.total}

                </strong>

            </div>

            <div class="heatmap-detail-item">

                <span>Accuracy</span>

                <strong>

                    ${review.accuracy}%

                </strong>

            </div>

            <div class="heatmap-detail-item">

                <span>Planned</span>

                <strong>

                    ${formatDuration(review.planned)}

                </strong>

            </div>

            <div class="heatmap-detail-item">

                <span>Actual</span>

                <strong>

                    ${formatDuration(review.actual)}

                </strong>

            </div>

        </div>

        <br>

        <div class="heatmap-detail-grid">

            <div class="heatmap-detail-item">

                <span>Most Efficient Task</span>

                <strong>

                    ${review.efficient}

                </strong>

            </div>

            <div class="heatmap-detail-item">

                <span>Needed More Time</span>

                <strong>

                    ${review.longest}

                </strong>

            </div>

        </div>

        <br>

        <strong>

            LifeLens Recommendation

        </strong>

        <p style="margin-top:10px;line-height:1.7;">

            ${review.recommendation}

        </p>

    `;

    detail.classList.add("is-visible");

}
function createHeatmapTooltipContent(cell) {
    const dateKey = cell.dataset.date;

    if (!dateKey) {
        return "";
    }

    const formattedDate = new Date(
        `${dateKey}T12:00:00`
    ).toLocaleDateString(
        undefined,
        {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric"
        }
    );

    const hasReview =
        cell.dataset.hasReview === "true";

    if (!hasReview) {
        return `
            <strong class="heatmap-tooltip-date">
                ${escapeHTML(formattedDate)}
            </strong>

            <span class="heatmap-tooltip-info">
                No saved productivity review
            </span>
        `;
    }

    const rate =
        Number(cell.dataset.rate || 0);

    const total =
        Math.max(0, Number(cell.dataset.total || 0));

    const completed =
        Math.min(
            Math.max(0, Number(cell.dataset.completed || 0)),
            total
        );

    const accuracy =
        Number(cell.dataset.accuracy || 0);

    return `
        <strong class="heatmap-tooltip-date">
            ${escapeHTML(formattedDate)}
        </strong>

        <span class="heatmap-tooltip-rate">
            ${rate}% completed
        </span>

        <span class="heatmap-tooltip-info">
            ${completed} / ${total} tasks
            <br>
            ${accuracy}% planning accuracy
        </span>
    `;
}

function positionHeatmapTooltip(
    tooltip,
    event
) {
    const spacing = 14;

    let left =
        event.clientX + spacing;

    let top =
        event.clientY + spacing;

    const tooltipWidth =
        tooltip.offsetWidth;

    const tooltipHeight =
        tooltip.offsetHeight;

    if (
        left + tooltipWidth >
        window.innerWidth - spacing
    ) {
        left =
            event.clientX -
            tooltipWidth -
            spacing;
    }

    if (
        top + tooltipHeight >
        window.innerHeight - spacing
    ) {
        top =
            event.clientY -
            tooltipHeight -
            spacing;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

const COMPLETION_HISTORY_STORAGE_KEY =
    "lifelens-completion-history-v1";
const PLANNER_GENERATION_COUNT_KEY =
    "lifelens-planner-generation-count-v1";

const LEVEL_RANKS = [
    { level: 1, rank: "Starter", threshold: 0 },
    { level: 2, rank: "Explorer", threshold: 100 },
    { level: 3, rank: "Builder", threshold: 250 },
    { level: 4, rank: "Achiever", threshold: 500 },
    { level: 5, rank: "Strategist", threshold: 850 },
    { level: 6, rank: "Scholar", threshold: 1300 },
    { level: 7, rank: "Master", threshold: 1850 },
    { level: 8, rank: "Legend", threshold: 2500 }
];

function loadCompletionHistory() {
    try {
        const parsed = JSON.parse(
            accountStorage.getItem(COMPLETION_HISTORY_STORAGE_KEY) || "[]"
        );

        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function getPlannerXP() {
    return Math.max(
        0,
        Number(accountStorage.getItem("lifelens-planner-xp")) || 0
    );
}

function calculateTotalXP() {
    return getPlannerXP();
}

function calculateLevelData(totalXP) {
    const safeTotalXP = Math.max(0, Number(totalXP) || 0);
    let current = LEVEL_RANKS[0];

    LEVEL_RANKS.forEach((level) => {
        if (safeTotalXP >= level.threshold) {
            current = level;
        }
    });

    const next = LEVEL_RANKS.find(
        (level) => level.threshold > safeTotalXP
    ) || null;

    const levelRange = next
        ? next.threshold - current.threshold
        : 1;

    const progress = next
        ? Math.min(
              100,
              Math.max(
                  0,
                  ((safeTotalXP - current.threshold) / levelRange) * 100
              )
          )
        : 100;

    return {
        level: current.level,
        rank: current.rank,
        levelStartXP: current.threshold,
        nextLevelXP: next?.threshold ?? current.threshold,
        nextLevel: next?.level ?? current.level,
        nextRank: next?.rank ?? current.rank,
        xpNeeded: next ? Math.max(0, next.threshold - safeTotalXP) : 0,
        progress,
        isMaxLevel: !next
    };
}

const ACHIEVEMENT_HISTORY_KEY = "lifelens-achievement-history-v2";
let achievementCloudUser = null;
let achievementPopupTimeout;

function getChatMessageCount() {
    try {
        const chats = JSON.parse(
            accountStorage.getItem("lifelens-chat-sessions-v1") || "[]"
        );
        return chats.reduce(
            (total, chat) => total + (Array.isArray(chat?.messages) ? chat.messages.length : 0),
            0
        );
    } catch {
        return 0;
    }
}

function getAchievementMetrics() {
    const reviewMap = loadDailyReviews();
    const reviews = Array.isArray(reviewMap)
        ? reviewMap
        : Object.values(reviewMap || {});
    const history = loadCompletionHistory();
    const plannerXP = getPlannerXP();
    const streak = calculateCurrentStreak(reviews);
    const completionCount = Math.max(history.length, Math.floor(plannerXP / 10));
    const generationCount = Math.max(
        0,
        Number(accountStorage.getItem(PLANNER_GENERATION_COUNT_KEY)) || 0
    );
    const completedDates = history
        .map((record) => normalizeDate(record?.completedAt))
        .filter(Boolean);
    const hours = completedDates.map((date) => date.getHours());
    const weekendCount = completedDates.filter((date) => [0, 6].includes(date.getDay())).length;
    const deepWorkCount = history.filter((record) => Number(record?.actualDuration || record?.duration || 0) >= 90).length;
    const totalActualMinutes = history.reduce(
        (sum, record) => sum + Math.max(0, Number(record?.actualDuration || 0)),
        0
    );
    const perfectReviews = reviews.filter((review) => Number(review?.rate) >= 100).length;
    const accurateReviews = reviews.filter((review) => Number(review?.accuracy) >= 90).length;
    const chatMessages = getChatMessageCount();

    return {
        plannerXP,
        streak,
        completionCount,
        generationCount,
        hours,
        weekendCount,
        deepWorkCount,
        totalActualMinutes,
        perfectReviews,
        accurateReviews,
        chatMessages
    };
}

function makeAchievement(id, category, icon, title, description, current, target, unit = "") {
    const safeCurrent = Math.max(0, Number(current) || 0);
    const safeTarget = Math.max(1, Number(target) || 1);
    const unlocked = safeCurrent >= safeTarget;
    const percentage = Math.min(100, Math.round((safeCurrent / safeTarget) * 100));
    return {
        id,
        category,
        icon,
        title,
        description,
        unlocked,
        current: Math.min(safeCurrent, safeTarget),
        target: safeTarget,
        percentage,
        progress: unlocked ? "Unlocked" : `${Math.min(safeCurrent, safeTarget)} / ${safeTarget}${unit ? ` ${unit}` : ""}`
    };
}

function getAchievementData() {
    const m = getAchievementMetrics();
    const earlyBird = m.hours.some((hour) => hour < 8) ? 1 : 0;
    const nightOwl = m.hours.some((hour) => hour >= 21) ? 1 : 0;

    return [
        makeAchievement("first-step", "Tasks", "👣", "First Step", "Complete your first task.", m.completionCount, 1, "task"),
        makeAchievement("task-starter", "Tasks", "✅", "Task Starter", "Complete 10 tasks.", m.completionCount, 10, "tasks"),
        makeAchievement("task-builder", "Tasks", "🧱", "Task Builder", "Complete 25 tasks.", m.completionCount, 25, "tasks"),
        makeAchievement("task-champion", "Tasks", "🥇", "Task Champion", "Complete 50 tasks.", m.completionCount, 50, "tasks"),
        makeAchievement("task-titan", "Tasks", "🏆", "Task Titan", "Complete 100 tasks.", m.completionCount, 100, "tasks"),

        makeAchievement("xp-century", "XP", "💯", "XP Century", "Earn 100 XP.", m.plannerXP, 100, "XP"),
        makeAchievement("xp-explorer", "XP", "🧭", "XP Explorer", "Earn 250 XP.", m.plannerXP, 250, "XP"),
        makeAchievement("xp-master", "XP", "💎", "XP Master", "Earn 500 XP.", m.plannerXP, 500, "XP"),
        makeAchievement("xp-legend", "XP", "👑", "XP Legend", "Earn 1,000 XP.", m.plannerXP, 1000, "XP"),

        makeAchievement("streak-3", "Streaks", "🔥", "Momentum", "Maintain a 3-day streak.", m.streak, 3, "days"),
        makeAchievement("week-warrior", "Streaks", "⚔️", "Week Warrior", "Maintain a 7-day streak.", m.streak, 7, "days"),
        makeAchievement("streak-14", "Streaks", "🌋", "Consistency Pro", "Maintain a 14-day streak.", m.streak, 14, "days"),
        makeAchievement("month-master", "Streaks", "📅", "Month Master", "Maintain a 30-day streak.", m.streak, 30, "days"),

        makeAchievement("first-plan", "Planning", "🗓️", "First Plan", "Generate your first schedule.", m.generationCount, 1, "plan"),
        makeAchievement("planner-10", "Planning", "📋", "Planner Regular", "Generate 10 schedules.", m.generationCount, 10, "plans"),
        makeAchievement("planning-master", "Planning", "🧠", "Planning Master", "Generate 30 schedules.", m.generationCount, 30, "plans"),
        makeAchievement("perfect-planner", "Planning", "🎯", "Perfect Planner", "Complete 5 days with every task finished.", m.perfectReviews, 5, "days"),
        makeAchievement("accuracy-expert", "Planning", "📐", "Accuracy Expert", "Record 7 days with at least 90% planning accuracy.", m.accurateReviews, 7, "days"),

        makeAchievement("early-bird", "Study Habits", "🌅", "Early Bird", "Complete a task before 8:00 AM.", earlyBird, 1, "task"),
        makeAchievement("night-owl", "Study Habits", "🌙", "Night Owl", "Complete a task at or after 9:00 PM.", nightOwl, 1, "task"),
        makeAchievement("deep-work", "Study Habits", "🎧", "Deep Work", "Complete a session lasting at least 90 minutes.", m.deepWorkCount, 1, "session"),
        makeAchievement("deep-work-pro", "Study Habits", "🧘", "Focus Machine", "Complete 10 deep-work sessions.", m.deepWorkCount, 10, "sessions"),
        makeAchievement("weekend-warrior", "Study Habits", "☀️", "Weekend Warrior", "Complete 5 tasks on weekends.", m.weekendCount, 5, "tasks"),
        makeAchievement("ten-hours", "Study Habits", "⏱️", "Ten-Hour Scholar", "Record 10 hours of actual study time.", m.totalActualMinutes, 600, "minutes"),

        makeAchievement("ai-explorer", "AI Coach", "🤖", "AI Explorer", "Exchange 5 messages with LifeLens Coach.", m.chatMessages, 5, "messages"),
        makeAchievement("ai-strategist", "AI Coach", "🪄", "AI Strategist", "Exchange 25 messages with LifeLens Coach.", m.chatMessages, 25, "messages"),
        makeAchievement("ai-mentor", "AI Coach", "🧠", "AI Mentor", "Exchange 100 messages with LifeLens Coach.", m.chatMessages, 100, "messages")
    ];
}

function loadAchievementHistory() {
    try {
        const value = JSON.parse(accountStorage.getItem(ACHIEVEMENT_HISTORY_KEY) || "{}");
        return value && typeof value === "object" ? value : {};
    } catch {
        return {};
    }
}

async function saveAchievementState(achievements, history) {
    accountStorage.setItem(ACHIEVEMENT_HISTORY_KEY, JSON.stringify(history));
    if (!achievementCloudUser) return;
    try {
        await setDoc(
            doc(db, "users", achievementCloudUser.uid),
            {
                gamification: {
                    achievements: achievements.map((item) => ({
                        id: item.id,
                        unlocked: item.unlocked,
                        current: item.current,
                        target: item.target,
                        unlockedAt: history[item.id] || null
                    })),
                    achievementHistory: history,
                    updatedAt: new Date().toISOString()
                }
            },
            { merge: true }
        );
    } catch (error) {
        console.warn("Achievement cloud sync unavailable:", error);
    }
}

function launchAchievementConfetti() {
    const container = document.createElement("div");
    container.className = "achievement-confetti";
    for (let index = 0; index < 24; index += 1) {
        const piece = document.createElement("i");
        piece.style.setProperty("--x", `${Math.random() * 100}vw`);
        piece.style.setProperty("--delay", `${Math.random() * 0.5}s`);
        piece.style.setProperty("--spin", `${Math.random() * 720 - 360}deg`);
        container.appendChild(piece);
    }
    document.body.appendChild(container);
    window.setTimeout(() => container.remove(), 2600);
}

function showAchievementPopup(achievement) {
    const popup = document.querySelector("#level-up-popup");
    const icon = popup?.querySelector(".level-up-popup-icon");
    const title = document.querySelector("#level-up-popup-title");
    const message = document.querySelector("#level-up-popup-message");
    if (!popup) return;
    if (icon) icon.textContent = achievement.icon;
    if (title) title.textContent = `${achievement.title} unlocked!`;
    if (message) message.textContent = achievement.description;
    window.clearTimeout(achievementPopupTimeout);
    popup.hidden = false;
    requestAnimationFrame(() => popup.classList.add("is-visible"));
    launchAchievementConfetti();
    achievementPopupTimeout = window.setTimeout(() => {
        popup.classList.remove("is-visible");
        window.setTimeout(() => { popup.hidden = true; }, 260);
    }, 3800);
}

function renderAchievements() {
    const list = document.querySelector("#achievement-list");
    const summary = document.querySelector("#achievement-summary");
    const historyList = document.querySelector("#achievement-history-list");
    if (!list) return;

    const achievements = getAchievementData();
    const history = loadAchievementHistory();
    const newlyUnlocked = [];
    achievements.forEach((achievement) => {
        if (achievement.unlocked && !history[achievement.id]) {
            history[achievement.id] = new Date().toISOString();
            newlyUnlocked.push(achievement);
        }
    });

    const categories = [...new Set(achievements.map((item) => item.category))];
    list.innerHTML = categories.map((category) => {
        const items = achievements.filter((item) => item.category === category);
        return `
            <section class="achievement-category">
                <h3>${escapeHTML(category)}</h3>
                <div class="achievement-category-grid">
                    ${items.map((achievement) => `
                        <article class="achievement ${achievement.unlocked ? "unlocked" : "locked"}">
                            <div class="achievement-icon" aria-hidden="true">${achievement.icon}</div>
                            <div class="achievement-copy">
                                <div class="achievement-title">${escapeHTML(achievement.title)}</div>
                                <p class="achievement-description">${escapeHTML(achievement.description)}</p>
                                <div class="achievement-progress-track" aria-label="${achievement.percentage}% complete">
                                    <span style="width:${achievement.percentage}%"></span>
                                </div>
                                <div class="achievement-progress">
                                    <span>${escapeHTML(achievement.progress)}</span>
                                    ${history[achievement.id] ? `<time>${escapeHTML(new Date(history[achievement.id]).toLocaleDateString())}</time>` : ""}
                                </div>
                            </div>
                        </article>
                    `).join("")}
                </div>
            </section>
        `;
    }).join("");

    if (summary) {
        const unlockedCount = achievements.filter((item) => item.unlocked).length;
        summary.textContent = `${unlockedCount} of ${achievements.length} achievements unlocked`;
    }

    if (historyList) {
        const unlocked = achievements
            .filter((item) => history[item.id])
            .sort((a, b) => new Date(history[b.id]) - new Date(history[a.id]));
        historyList.innerHTML = unlocked.length
            ? unlocked.slice(0, 8).map((item) => `
                <li><span>${item.icon} ${escapeHTML(item.title)}</span><time>${escapeHTML(new Date(history[item.id]).toLocaleDateString())}</time></li>
            `).join("")
            : "<li>No achievements unlocked yet.</li>";
    }

    void saveAchievementState(achievements, history);
    if (newlyUnlocked.length) showAchievementPopup(newlyUnlocked[0]);
}

function showLevelUpPopup(levelData) {
    showAchievementPopup({
        icon: "🎉",
        title: `${levelData.rank} rank`,
        description: `You reached Level ${levelData.level}. Keep going!`
    });
}

onAuthStateChanged(auth, async (user) => {
    achievementCloudUser = user;
    if (!user) return;
    try {
        const snapshot = await getDoc(doc(db, "users", user.uid));
        const cloudHistory = snapshot.data()?.gamification?.achievementHistory;
        if (cloudHistory && typeof cloudHistory === "object") {
            const localHistory = loadAchievementHistory();
            accountStorage.setItem(
                ACHIEVEMENT_HISTORY_KEY,
                JSON.stringify({ ...cloudHistory, ...localHistory })
            );
            renderAchievements();
        }
    } catch (error) {
        console.warn("Achievement cloud load unavailable:", error);
    }
});

function renderXPSystem() {
    const levelElement = document.querySelector("#xp-level");
    const currentElement = document.querySelector("#xp-current");
    const nextElement = document.querySelector("#xp-next");
    const progressFill = document.querySelector("#xp-progress-fill");
    const messageElement = document.querySelector("#xp-message");
    const badge = document.querySelector(".xp-level-badge");

    if (!levelElement || !currentElement || !nextElement || !progressFill) {
        return;
    }

    const totalXP = calculateTotalXP();
    const levelData = calculateLevelData(totalXP);
    const storedPreviousLevel = accountStorage.getItem("lifelens-previous-level");
    const previousLevel = storedPreviousLevel === null
        ? levelData.level
        : Number(storedPreviousLevel);

    levelElement.textContent = String(levelData.level);
    currentElement.textContent = `${totalXP} total XP`;
    nextElement.textContent = levelData.isMaxLevel
        ? "Maximum rank reached"
        : `${levelData.xpNeeded} XP to ${levelData.nextRank}`;
    progressFill.style.width = `${levelData.progress}%`;

    if (badge) {
        badge.innerHTML =
            `Level <span id="xp-level">${levelData.level}</span> · ${escapeHTML(levelData.rank)}`;
        badge.title = `${levelData.rank} rank`;
    }

    if (messageElement) {
        messageElement.textContent = levelData.isMaxLevel
            ? `Legend rank · ${totalXP} total XP`
            : `${levelData.rank} rank · ${levelData.xpNeeded} XP needed for ${levelData.nextRank}`;
    }

    if (badge && levelData.level > previousLevel) {
        badge.classList.remove("level-up");
        void badge.offsetWidth;
        badge.classList.add("level-up");
        showLevelUpPopup(levelData);
    }

    accountStorage.setItem(
        "lifelens-previous-level",
        String(levelData.level)
    );
}

function renderAICoach() {
    const rateElement = document.querySelector("#ai-coach-rate");
    const rankElement = document.querySelector("#ai-coach-rank");
    const nextElement = document.querySelector("#ai-coach-next");
    const streakElement = document.querySelector("#ai-coach-streak");
    const actionElement = document.querySelector("#ai-coach-action");

    if (!rateElement || !rankElement || !nextElement || !streakElement || !actionElement) {
        return;
    }

    const review = createDailyReview(getLearningHistory());
    const reviews = loadDailyReviews();
    const levelData = calculateLevelData(calculateTotalXP());
    const streak = calculateCurrentStreak(reviews);

    rateElement.textContent = `${review.rate}%`;
    rankElement.textContent = levelData.rank;
    nextElement.textContent = levelData.isMaxLevel
        ? "Max rank"
        : `${levelData.xpNeeded} XP`;
    streakElement.textContent = `${streak} day${streak === 1 ? "" : "s"}`;

    if (review.total === 0) {
        actionElement.textContent =
            "Generate today’s plan, then complete your first scheduled task.";
    } else if (review.unfinished > 0) {
        actionElement.textContent =
            `Complete ${review.unfinished === 1 ? "your next task" : `one of your ${review.unfinished} unfinished tasks`} to earn 10 XP.`;
    } else if (!levelData.isMaxLevel) {
        actionElement.textContent =
            `Today’s plan is complete. You need ${levelData.xpNeeded} more XP to reach ${levelData.nextRank}.`;
    } else {
        actionElement.textContent =
            "You reached Legend. Keep your streak active with one meaningful task tomorrow.";
    }
}

function initializeHeatmap() {
    renderHeatmap();
    renderAchievements();
    renderXPSystem();

    const grid =
        document.querySelector("#heatmap-grid");

    const tooltip =
        document.querySelector(
            "#heatmap-tooltip"
        );

    if (!grid) {
        return;
    }

    grid.addEventListener(
        "click",
        (event) => {
            const cell =
                event.target.closest(
                    ".heatmap-cell[data-date]"
                );

            if (!cell) {
                return;
            }

            showHeatmapDetail(
                cell.dataset.date
            );
        }
    );

    if (!tooltip) {
        return;
    }

    grid.addEventListener(
        "pointerover",
        (event) => {
            const cell =
                event.target.closest(
                    ".heatmap-cell[data-date]"
                );

            if (!cell) {
                return;
            }

            tooltip.innerHTML =
                createHeatmapTooltipContent(cell);

            tooltip.hidden = false;

            requestAnimationFrame(() => {
                tooltip.classList.add(
                    "is-visible"
                );

                positionHeatmapTooltip(
                    tooltip,
                    event
                );
            });
        }
    );

    grid.addEventListener(
        "pointermove",
        (event) => {
            if (tooltip.hidden) {
                return;
            }

            positionHeatmapTooltip(
                tooltip,
                event
            );
        }
    );

    grid.addEventListener(
        "pointerout",
        (event) => {
            const leavingCell =
                event.target.closest(
                    ".heatmap-cell[data-date]"
                );

            if (!leavingCell) {
                return;
            }

            const enteringCell =
                event.relatedTarget?.closest?.(
                    ".heatmap-cell[data-date]"
                );

            if (enteringCell) {
                return;
            }

            tooltip.classList.remove(
                "is-visible"
            );

            window.setTimeout(() => {
                if (
                    !tooltip.classList.contains(
                        "is-visible"
                    )
                ) {
                    tooltip.hidden = true;
                }
            }, 150);
        }
    );
}
/* ================= DASHBOARD INITIALIZATION ================= */



window.addEventListener("lifelens-xp-updated", () => {
    renderXPSystem();
    renderAchievements();
    renderAICoach();
});

window.addEventListener(
    "lifelens-streak-updated",
    () => {
        renderHeatmap();
        renderAchievements();
        renderAICoach();
    }
);

window.addEventListener("lifelens-progress-updated", () => {
    renderAchievements();
    renderAICoach();
});

window.addEventListener("storage", (event) => {
    if (event.key === "lifelens-planner-xp") {
        renderXPSystem();
        renderAchievements();
        renderAICoach();
    }

    if (event.key === STREAK_ACTIVITY_STORAGE_KEY) {
        renderHeatmap();
        renderAchievements();
        renderAICoach();
    }

    if (
        event.key === COMPLETION_HISTORY_STORAGE_KEY ||
        event.key === PLANNER_GENERATION_COUNT_KEY
    ) {
        renderAchievements();
        renderAICoach();
    }
});

export function initializeDashboard() {
    const dashboardMain =
        document.querySelector(
            ".dashboard-main"
        );

    if (!dashboardMain) {
        return;
    }

    const completedTaskCount =
        document.querySelector(
            "#completed-task-count"
        );

    const averageActualTime =
        document.querySelector(
            "#average-actual-time"
        );

    const planningAccuracy =
        document.querySelector(
            "#planning-accuracy"
        );

    const mostPracticedTask =
        document.querySelector(
            "#most-practiced-task"
        );

    const weeklyBars =
        document.querySelector(
            "#weekly-bars"
        );

    const weeklyDateRange =
        document.querySelector(
            "#weekly-date-range"
        );

    const previousWeekButton =
        document.querySelector(
            "#previous-week-button"
        );

    const nextWeekButton =
        document.querySelector(
            "#next-week-button"
        );

    const totalPlannedTime =
        document.querySelector(
            "#total-planned-time"
        );

    const totalActualTime =
        document.querySelector(
            "#total-actual-time"
        );

    const accuracyFill =
        document.querySelector(
            "#accuracy-fill"
        );

    const accuracyMessage =
        document.querySelector(
            "#accuracy-message"
        );

    const recentLearningList =
        document.querySelector(
            "#recent-learning-list"
        );

    const strongestDay =
        document.querySelector(
            "#strongest-day"
        );

    const strongestDayMessage =
        document.querySelector(
            "#strongest-day-message"
        );

    const emptyState =
        document.querySelector(
            "#dashboard-empty-state"
        );

    const productivityScoreElements = {
        ring: document.querySelector("#productivity-score-ring"),
        total: document.querySelector("#productivity-score"),
        message: document.querySelector("#productivity-score-message"),
        completion: document.querySelector("#score-completion"),
        accuracy: document.querySelector("#score-accuracy"),
        consistency: document.querySelector("#score-consistency")
    };

    const priorityChartElements = {
        donut: document.querySelector("#priority-donut"),
        total: document.querySelector("#priority-total"),
        high: document.querySelector("#priority-high-count"),
        medium: document.querySelector("#priority-medium-count"),
        low: document.querySelector("#priority-low-count")
    };

    const timeComparisonChart =
        document.querySelector("#time-comparison-chart");

    const history =
        getLearningHistory();

    const weeklyHistory =
        history.filter(
            recordIsFromCurrentWeek
        );

    const totalPlanned =
        weeklyHistory.reduce(
            (total, record) =>
                total +
                Number(
                    record.plannedDuration || 0
                ),
            0
        );

    const totalActual =
        weeklyHistory.reduce(
            (total, record) =>
                total +
                Number(
                    record.actualDuration || 0
                ),
            0
        );

    const averageActual =
        calculateAverage(
            weeklyHistory,
            "actualDuration"
        );

    const accuracy =
        calculatePlanningAccuracy(
            totalPlanned,
            totalActual
        );

    const weeklyData =
        createWeeklyData(
            weeklyHistory
        );

    const strongestResult =
        findStrongestDay(
            weeklyData
        );

    const productivityScore =
        calculateProductivityScore(
            weeklyHistory,
            accuracy,
            weeklyData
        );

    if (completedTaskCount) {
        completedTaskCount.textContent =
            String(weeklyHistory.length);
    }

    if (averageActualTime) {
        averageActualTime.textContent =
            formatDuration(averageActual);
    }

    if (planningAccuracy) {
        planningAccuracy.textContent =
            `${accuracy}%`;
    }

    if (mostPracticedTask) {
        mostPracticedTask.textContent =
            findMostPracticedTask(
                weeklyHistory
            );
    }

    if (totalPlannedTime) {
        totalPlannedTime.textContent =
            formatDuration(totalPlanned);
    }

    if (totalActualTime) {
        totalActualTime.textContent =
            formatDuration(totalActual);
    }

    if (accuracyFill) {
        accuracyFill.style.width =
            `${accuracy}%`;
    }

    if (accuracyMessage) {
        accuracyMessage.textContent =
            getPlanningAccuracyMessage(
                accuracy,
                totalPlanned,
                totalActual
            );
    }

    if (strongestDay) {
        strongestDay.textContent =
            strongestResult.count > 0
                ? strongestResult.fullName
                : "—";
    }

    if (strongestDayMessage) {
        strongestDayMessage.textContent =
            strongestResult.count > 0
                ? `${strongestResult.count} task${
                      strongestResult.count === 1
                          ? ""
                          : "s"
                  } completed on your strongest day.`
                : "Complete tasks on different days to reveal your weekly pattern.";
    }

    let selectedWeekOffset = 0;

    const renderSelectedWeek = () => {
        const selectedWeekStart =
            getWeekStartWithOffset(selectedWeekOffset);

        const selectedWeekData =
            createWeeklyData(history, selectedWeekStart);

        renderWeeklyBars(
            weeklyBars,
            selectedWeekData
        );

        if (weeklyDateRange) {
            weeklyDateRange.textContent =
                formatWeekRange(selectedWeekStart);
        }

        if (nextWeekButton) {
            nextWeekButton.disabled =
                selectedWeekOffset >= 0;
        }
    };

    previousWeekButton?.addEventListener(
        "click",
        () => {
            selectedWeekOffset -= 1;
            renderSelectedWeek();
        }
    );

    nextWeekButton?.addEventListener(
        "click",
        () => {
            if (selectedWeekOffset < 0) {
                selectedWeekOffset += 1;
                renderSelectedWeek();
            }
        }
    );

    renderSelectedWeek();

    renderRecentInsights(
        recentLearningList,
        weeklyHistory
    );

    renderProductivityScore(
        productivityScoreElements,
        productivityScore
    );

    renderPriorityChart(
        weeklyHistory,
        priorityChartElements
    );

    renderTimeComparisonChart(
        timeComparisonChart,
        weeklyHistory
    );

    renderSubjectDistribution(weeklyHistory);
    renderPeakProductivity(weeklyHistory);
    renderSmartDashboardInsights(weeklyHistory, accuracy, weeklyData);

    initializeDailyReview(history);

    if (emptyState) {
        emptyState.classList.toggle(
            "is-visible",
            weeklyHistory.length === 0
        );
    }

    initializeHeatmap();

    // Render each gamification panel independently so one data issue
    // cannot prevent the level card or other dashboard sections from loading.
    try {
        renderXPSystem();
    } catch (error) {
        console.error("Could not render the XP level system:", error);
    }

    try {
        renderAchievements();
    } catch (error) {
        console.error("Could not render achievements:", error);
        const summary = document.querySelector("#achievement-summary");
        if (summary) {
            summary.textContent = "Achievement progress could not be loaded.";
        }
    }

    try {
        renderAICoach();
    } catch (error) {
        console.error("Could not render AI Coach statistics:", error);
    }
}