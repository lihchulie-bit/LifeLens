"use strict";

import { accountStorage } from "./account-storage.js";

import {
    formatMinutesAsTime
} from "./utils.js";
import { auth } from "./firebase.js";

let latestPlannerContext = null;
let conversationHistory = [];
let requestInProgress = false;

const CHAT_STORAGE_KEY = "lifelens-chat-sessions-v1";
const ACTIVE_CHAT_KEY = "lifelens-active-chat-v1";
let chatSessions = [];
let activeChatId = null;

export function updateAssistantContext(context) {
    latestPlannerContext = context;
}

/* ================= OFFLINE FALLBACK ================= */

function createOfflineResponse(question) {
    if (!latestPlannerContext) {
        return (
            "I could not reach the online AI service. " +
            "Generate a schedule first and I can still provide basic offline advice."
        );
    }

    const normalizedQuestion =
        String(question).toLowerCase();

    const schedule =
        Array.isArray(latestPlannerContext.schedule)
            ? latestPlannerContext.schedule
            : [];

    const tasks =
        Array.isArray(latestPlannerContext.tasks)
            ? latestPlannerContext.tasks
            : [];

    const scheduledTasks = schedule.filter(
        (item) => item.type === "task"
    );

    const unscheduledTasks = schedule.filter(
        (item) => item.type === "unscheduled"
    );

    const missedDeadlines = scheduledTasks.filter(
        (item) => item.missesDeadline
    );

    if (
        normalizedQuestion.includes("first") ||
        normalizedQuestion.includes("next") ||
        normalizedQuestion.includes("priority")
    ) {
        const firstTask = scheduledTasks[0];

        if (!firstTask) {
            return "There are no scheduled tasks yet.";
        }

        return (
            `**Start with ${firstTask.name}.** It is scheduled for ` +
            `${formatMinutesAsTime(firstTask.start)}.`
        );
    }

    if (
        normalizedQuestion.includes("heavy") ||
        normalizedQuestion.includes("workload")
    ) {
        const totalMinutes = scheduledTasks.reduce(
            (total, task) =>
                total + Number(task.duration || 0),
            0
        );

        if (totalMinutes > 240) {
            return (
                "Your workload is quite heavy. " +
                "Consider postponing one lower-priority task."
            );
        }

        if (totalMinutes > 120) {
            return (
                "Your workload is moderate. " +
                "Keep your breaks enabled."
            );
        }

        return "Your workload looks manageable.";
    }

    if (
        normalizedQuestion.includes("deadline") ||
        normalizedQuestion.includes("late")
    ) {
        if (missedDeadlines.length > 0) {
            return (
                `${missedDeadlines.length} task` +
                `${missedDeadlines.length === 1 ? "" : "s"} ` +
                "may finish after the deadline."
            );
        }

        return "Your scheduled tasks currently finish before their deadlines.";
    }

    if (
        normalizedQuestion.includes("fit") ||
        normalizedQuestion.includes("unscheduled")
    ) {
        if (unscheduledTasks.length > 0) {
            return (
                `${unscheduledTasks.length} task` +
                `${unscheduledTasks.length === 1 ? " does" : "s do"} ` +
                "not fit into your available time."
            );
        }

        return "All tasks fit into your schedule.";
    }

    if (normalizedQuestion.includes("break")) {
        const breaks = schedule.filter(
            (item) => item.type === "break"
        );

        if (breaks.length === 0) {
            return (
                "No breaks are currently scheduled. " +
                "Consider enabling them for longer work periods."
            );
        }

        return (
            `${breaks.length} break` +
            `${breaks.length === 1 ? " is" : "s are"} ` +
            "included in your plan."
        );
    }

    return (
        `You entered ${tasks.length} task` +
        `${tasks.length === 1 ? "" : "s"}. ` +
        "The online chatbot is unavailable, but I can still answer basic " +
        "questions about priorities, workload, deadlines, and breaks."
    );
}

/* ================= CONTEXT ================= */

function safelyReadJSON(storageKey, fallbackValue) {
    try {
        const savedValue =
            accountStorage.getItem(storageKey);

        if (!savedValue) {
            return fallbackValue;
        }

        return JSON.parse(savedValue);
    } catch (error) {
        console.warn(
            `Could not read ${storageKey}:`,
            error
        );

        return fallbackValue;
    }
}

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

function calculateLevelSummary(xp) {
    const safeXP = Math.max(0, Number(xp) || 0);
    let current = LEVEL_RANKS[0];

    for (const level of LEVEL_RANKS) {
        if (safeXP >= level.threshold) {
            current = level;
        }
    }

    const next = LEVEL_RANKS.find((level) => level.threshold > safeXP) || null;

    return {
        xp: safeXP,
        level: current.level,
        rank: current.rank,
        nextRank: next?.rank || null,
        xpToNextRank: next ? next.threshold - safeXP : 0,
        maximumRankReached: !next
    };
}

function getCurrentStreak(activity) {
    if (!activity || typeof activity !== "object") {
        return 0;
    }

    const activeDates = Object.entries(activity)
        .filter(([, value]) => Number(value) > 0 || value === true)
        .map(([date]) => date)
        .sort();

    if (activeDates.length === 0) {
        return 0;
    }

    const toKey = (date) => [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");

    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);

    const todayKey = toKey(cursor);
    if (!activeDates.includes(todayKey)) {
        cursor.setDate(cursor.getDate() - 1);
    }

    let streak = 0;
    while (activeDates.includes(toKey(cursor))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
}

function summarizeTimingHistory(history) {
    const records = Array.isArray(history) ? history : [];
    const validRecords = records.filter((record) =>
        Number(record?.plannedDuration) > 0 &&
        Number(record?.actualDuration) > 0
    );

    const grouped = new Map();
    validRecords.forEach((record) => {
        const key = String(record.name || "General task").trim().toLowerCase();
        const current = grouped.get(key) || {
            name: String(record.name || "General task").trim(),
            samples: 0,
            plannedTotal: 0,
            actualTotal: 0
        };
        current.samples += 1;
        current.plannedTotal += Number(record.plannedDuration);
        current.actualTotal += Number(record.actualDuration);
        grouped.set(key, current);
    });

    return {
        totalSamples: validRecords.length,
        overallAveragePlannedMinutes: validRecords.length
            ? Math.round(validRecords.reduce((sum, r) => sum + Number(r.plannedDuration), 0) / validRecords.length)
            : 0,
        overallAverageActualMinutes: validRecords.length
            ? Math.round(validRecords.reduce((sum, r) => sum + Number(r.actualDuration), 0) / validRecords.length)
            : 0,
        taskPatterns: [...grouped.values()]
            .map((item) => ({
                name: item.name,
                samples: item.samples,
                averagePlannedMinutes: Math.round(item.plannedTotal / item.samples),
                averageActualMinutes: Math.round(item.actualTotal / item.samples),
                recommendedMinutes: Math.max(5, Math.round((item.actualTotal / item.samples) / 5) * 5)
            }))
            .sort((a, b) => b.samples - a.samples)
            .slice(0, 20)
    };
}

function buildAchievementSummary({ xp, streak, completionHistory, generationCount }) {
    const completedCount = Array.isArray(completionHistory) ? completionHistory.length : 0;
    const hours = (completionHistory || [])
        .map((item) => new Date(item?.completedAt))
        .filter((date) => !Number.isNaN(date.getTime()))
        .map((date) => date.getHours());
    let chatMessages = 0;
    try {
        const chats = JSON.parse(accountStorage.getItem("lifelens-chat-sessions-v1") || "[]");
        chatMessages = chats.reduce((sum, chat) => sum + (chat?.messages?.length || 0), 0);
    } catch {}
    const definitions = [
        ["First Step", completedCount, 1, "task"],
        ["Task Starter", completedCount, 10, "tasks"],
        ["Task Builder", completedCount, 25, "tasks"],
        ["Task Champion", completedCount, 50, "tasks"],
        ["Task Titan", completedCount, 100, "tasks"],
        ["XP Century", xp, 100, "XP"],
        ["XP Explorer", xp, 250, "XP"],
        ["XP Master", xp, 500, "XP"],
        ["XP Legend", xp, 1000, "XP"],
        ["Momentum", streak, 3, "days"],
        ["Week Warrior", streak, 7, "days"],
        ["Consistency Pro", streak, 14, "days"],
        ["Month Master", streak, 30, "days"],
        ["First Plan", generationCount, 1, "plan"],
        ["Planner Regular", generationCount, 10, "plans"],
        ["Planning Master", generationCount, 30, "plans"],
        ["Early Bird", hours.some((hour) => hour < 8) ? 1 : 0, 1, "task"],
        ["Night Owl", hours.some((hour) => hour >= 21) ? 1 : 0, 1, "task"],
        ["AI Explorer", chatMessages, 5, "messages"],
        ["AI Strategist", chatMessages, 25, "messages"],
        ["AI Mentor", chatMessages, 100, "messages"]
    ];
    return definitions.map(([title, current, target, unit]) => ({
        title,
        unlocked: Number(current) >= target,
        progress: `${Math.min(Number(current) || 0, target)}/${target} ${unit}`,
        percentage: Math.min(100, Math.round(((Number(current) || 0) / target) * 100))
    }));
}

function normalizePlannerDraft(candidate) {
    if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.tasks)) {
        return null;
    }

    const tasks = candidate.tasks
        .filter((task) => task && typeof task === "object")
        .map((task) => ({
            name: String(task.name || task.title || "Untitled task").trim().slice(0, 120),
            duration: Math.min(720, Math.max(5, Math.round((Number(task.duration) || 30) / 5) * 5)),
            priority: ["high", "medium", "low"].includes(String(task.priority).toLowerCase())
                ? String(task.priority).toLowerCase()
                : "medium",
            deadline: /^\d{2}:\d{2}$/.test(String(task.deadline || ""))
                ? String(task.deadline)
                : "",
            recurrence: ["once", "daily", "weekdays", "custom"].includes(String(task.recurrence).toLowerCase())
                ? String(task.recurrence).toLowerCase()
                : "once",
            recurrenceDays: Array.isArray(task.recurrenceDays)
                ? task.recurrenceDays.filter((day) => Number.isInteger(Number(day))).map(Number)
                : []
        }))
        .filter((task) => task.name);

    if (!tasks.length) {
        return null;
    }

    return {
        startTime: /^\d{2}:\d{2}$/.test(String(candidate.startTime || ""))
            ? String(candidate.startTime)
            : "09:00",
        endTime: /^\d{2}:\d{2}$/.test(String(candidate.endTime || ""))
            ? String(candidate.endTime)
            : "17:00",
        breaksEnabled: candidate.breaksEnabled !== false,
        breakDuration: Math.min(120, Math.max(5, Math.round((Number(candidate.breakDuration) || 10) / 5) * 5)),
        tasks
    };
}

function parsePlannerDraft(markdown) {
    const source = String(markdown || "");
    const candidates = [];

    const labelledBlocks = source.matchAll(/```lifelens-plan\s*([\s\S]*?)```/gi);
    for (const match of labelledBlocks) {
        candidates.push(match[1]);
    }

    const jsonBlocks = source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
    for (const match of jsonBlocks) {
        if (/"tasks"\s*:/.test(match[1])) {
            candidates.push(match[1]);
        }
    }

    const objectStart = source.indexOf("{");
    const objectEnd = source.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
        const possibleObject = source.slice(objectStart, objectEnd + 1);
        if (/"tasks"\s*:/.test(possibleObject)) {
            candidates.push(possibleObject);
        }
    }

    for (const candidate of candidates) {
        try {
            const draft = normalizePlannerDraft(JSON.parse(candidate.trim()));
            if (draft) {
                return draft;
            }
        } catch (error) {
            // Try the next candidate. Free models sometimes add prose around one block.
        }
    }

    return null;
}


function getLocalDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function categorizeTaskName(name) {
    const value = String(name || "").toLowerCase();
    const categories = [
        ["Mathematics", /\b(math|mathematics|calculus|algebra|geometry|statistics|sat math)\b/],
        ["Physics", /\b(physics|mechanics|electricity|waves|thermodynamics)\b/],
        ["Chemistry", /\b(chemistry|chemical|organic|inorganic|stoichiometry)\b/],
        ["Biology", /\b(biology|biological|genetics|ecology|anatomy)\b/],
        ["English", /\b(english|ielts|sat reading|sat verbal|writing|essay|literature)\b/],
        ["Coding", /\b(code|coding|programming|javascript|python|web dev|roblox|software)\b/],
        ["Languages", /\b(mandarin|chinese|german|hindi|japanese|korean|language)\b/]
    ];

    return categories.find(([, pattern]) => pattern.test(value))?.[0] || "Other";
}

function summarizeDashboardAnalytics(completionHistory, savedPlanner) {
    const records = Array.isArray(completionHistory)
        ? completionHistory.filter((record) => record && typeof record === "object")
        : [];
    const now = new Date();
    const todayKey = getLocalDateKey(now);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const recentRecords = records.filter((record) => {
        const completedAt = new Date(record.completedAt);
        return !Number.isNaN(completedAt.getTime()) && completedAt >= sevenDaysAgo;
    });
    const todayRecords = records.filter((record) => getLocalDateKey(record.completedAt) === todayKey);

    const subjectMinutes = {};
    const timePeriods = {
        Morning: 0,
        Afternoon: 0,
        Evening: 0,
        Night: 0,
        "Late night": 0
    };

    recentRecords.forEach((record) => {
        const minutes = Math.max(0, Number(record.actualDuration || record.plannedDuration || 0));
        const subject = categorizeTaskName(record.name);
        subjectMinutes[subject] = (subjectMinutes[subject] || 0) + minutes;

        const completedAt = new Date(record.completedAt);
        if (!Number.isNaN(completedAt.getTime())) {
            const hour = completedAt.getHours();
            const period = hour < 6
                ? "Late night"
                : hour < 12
                    ? "Morning"
                    : hour < 17
                        ? "Afternoon"
                        : hour < 21
                            ? "Evening"
                            : "Night";
            timePeriods[period] += minutes;
        }
    });

    const timingRecords = recentRecords.filter((record) =>
        Number(record.plannedDuration) > 0 && Number(record.actualDuration) > 0
    );
    const averageTimingDifference = timingRecords.length
        ? Math.round(timingRecords.reduce((sum, record) =>
            sum + Number(record.actualDuration) - Number(record.plannedDuration), 0
        ) / timingRecords.length)
        : 0;
    const averageAccuracy = timingRecords.length
        ? Math.round(timingRecords.reduce((sum, record) => {
            const planned = Number(record.plannedDuration);
            const actual = Number(record.actualDuration);
            return sum + Math.max(0, 100 - Math.abs(actual - planned) / planned * 100);
        }, 0) / timingRecords.length)
        : 0;

    const leadingSubject = Object.entries(subjectMinutes)
        .sort((first, second) => second[1] - first[1])[0] || null;
    const peakPeriod = Object.entries(timePeriods)
        .sort((first, second) => second[1] - first[1])[0] || null;
    const generatedSchedule = Array.isArray(savedPlanner?.generatedSchedule)
        ? savedPlanner.generatedSchedule.filter((item) => item?.type === "task")
        : [];
    const completedIds = new Set(
        Array.isArray(savedPlanner?.completedTaskIds) ? savedPlanner.completedTaskIds.map(String) : []
    );
    const completedScheduledTasks = generatedSchedule.filter((item) => completedIds.has(String(item.id))).length;

    return {
        window: {
            from: getLocalDateKey(sevenDaysAgo),
            to: todayKey
        },
        today: {
            completedTasks: todayRecords.length,
            actualMinutes: todayRecords.reduce((sum, record) =>
                sum + Math.max(0, Number(record.actualDuration || record.plannedDuration || 0)), 0
            ),
            scheduledTasks: generatedSchedule.length,
            completedScheduledTasks,
            completionRate: generatedSchedule.length
                ? Math.round(completedScheduledTasks / generatedSchedule.length * 100)
                : 0
        },
        lastSevenDays: {
            completedTasks: recentRecords.length,
            actualMinutes: recentRecords.reduce((sum, record) =>
                sum + Math.max(0, Number(record.actualDuration || record.plannedDuration || 0)), 0
            ),
            leadingSubject: leadingSubject
                ? { name: leadingSubject[0], minutes: leadingSubject[1] }
                : null,
            subjectMinutes,
            peakPeriod: peakPeriod && peakPeriod[1] > 0
                ? { name: peakPeriod[0], minutes: peakPeriod[1] }
                : null,
            timePeriodMinutes: timePeriods,
            averageTimingDifferenceMinutes: averageTimingDifference,
            averagePlanningAccuracyPercent: averageAccuracy
        }
    };
}

function buildLifeLensContext() {
    const savedPlanner = safelyReadJSON("lifelens-planner-data", null);
    const learningHistory = safelyReadJSON("lifelens-task-learning-history", []);
    const completionHistory = safelyReadJSON("lifelens-completion-history-v1", []);
    const streakActivity = safelyReadJSON("lifelens-streak-activity-v1", {});
    const dailyReviews = safelyReadJSON("lifelens-daily-reviews", {});
    const xp = Math.max(0, Number(accountStorage.getItem("lifelens-planner-xp")) || 0);
    const generationCount = Math.max(0, Number(accountStorage.getItem("lifelens-planner-generation-count-v1")) || 0);
    const streak = getCurrentStreak(streakActivity);
    const level = calculateLevelSummary(xp);
    const timing = summarizeTimingHistory(learningHistory);
    const dashboardAnalytics = summarizeDashboardAnalytics(completionHistory, savedPlanner);
    const firebaseUser = auth.currentUser;
    const achievements = buildAchievementSummary({
        xp,
        streak,
        completionHistory,
        generationCount
    });

    const generatedSchedule = Array.isArray(savedPlanner?.generatedSchedule)
        ? savedPlanner.generatedSchedule
        : [];
    const scheduledTasks = generatedSchedule.filter((item) => item?.type === "task");
    const completedTaskIds = Array.isArray(savedPlanner?.completedTaskIds)
        ? savedPlanner.completedTaskIds
        : [];

    return {
        userProfile: firebaseUser ? {
            displayName: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "LifeLens user",
            email: firebaseUser.email || "",
            emailVerified: Boolean(firebaseUser.emailVerified)
        } : null,
        planner: latestPlannerContext || null,
        savedPlanner,
        progress: {
            ...level,
            streak,
            generatedPlans: generationCount,
            completedTaskRecords: completionHistory.length,
            achievements,
            unlockedAchievements: achievements.filter((item) => item.unlocked).map((item) => item.title),
            closestLockedAchievements: achievements.filter((item) => !item.unlocked).slice(0, 3)
        },
        dashboard: {
            ...dashboardAnalytics,
            scheduledTaskCount: scheduledTasks.length,
            completedTaskCount: completedTaskIds.length,
            completionRate: scheduledTasks.length
                ? Math.round((completedTaskIds.length / scheduledTasks.length) * 100)
                : 0,
            dailyReviews,
            currentSchedule: generatedSchedule
        },
        timingHistory: timing,
        learningHistory,
        completionHistory,
        currentDate: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        capabilities: {
            canExplainDashboardProgress: true,
            canExplainLevelsAndAchievements: true,
            canUseActualTaskDurations: true,
            canGivePersonalizedDailyBriefings: true,
            canExplainWeeklyTrendsAndSubjectDistribution: true,
            canIdentifyPeakProductivityPeriods: true,
            canSuggestPlannerDrafts: true,
            cannotDirectlyGenerateSchedule: true
        },
        scheduleDraftProtocol: {
            instruction: "When the user explicitly asks for a suggested schedule or planner draft, provide helpful prose and include exactly one fenced block labelled lifelens-plan containing valid JSON. Do not claim it has been applied. The user must click Review in planner and then Generate Schedule.",
            schema: {
                startTime: "HH:MM",
                endTime: "HH:MM",
                breaksEnabled: true,
                breakDuration: 10,
                tasks: [
                    {
                        name: "Task name",
                        duration: 45,
                        priority: "high|medium|low",
                        deadline: "HH:MM or empty string",
                        recurrence: "once|daily|weekdays|custom",
                        recurrenceDays: []
                    }
                ]
            },
            durationRules: "Use 5-minute increments between 5 and 720. Prefer recommendedMinutes from timingHistory when a similar task exists."
        },
        responseFormatting: {
            markdown: true,
            markdownTables: true,
            math: "Use $...$ for inline math and $$...$$ for display math.",
            paragraphs: "Do not put punctuation or commas alone on a new line."
        }
    };
}


function sanitizeProviderReply(reply) {
    const cleaned = String(reply || "")
        .replace(/(?:^|\n)\s*User\s+Safety\s*:\s*(?:safe|unsafe)\s*/gi, "\n")
        .replace(/(?:^|\n)\s*Response\s+Safety\s*:\s*(?:safe|unsafe)\s*/gi, "\n")
        .replace(/\bUser\s+Safety\s*:\s*(?:safe|unsafe)\s*/gi, "")
        .replace(/\bResponse\s+Safety\s*:\s*(?:safe|unsafe)\s*/gi, "")
        .replace(/^\s*(?:FINAL ANSWER|FINAL RESPONSE)\s*:\s*/i, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    const internalLeakPatterns = [
        /\bCURRENT LIFELENS CONTEXT\b/i,
        /\bprivate_lifelens_context\b/i,
        /\bdailyReviews\b/i,
        /\btimingHistory\b/i,
        /\bsubjectMinutes\b/i,
        /\bcompletedTasks\s*:/i,
        /\boverallAveragePlannedMinutes\b/i,
        /\bwe trust the data\b/i,
        /\bXP\s*:\s*\d+\s*,\s*level\s*:/i
    ];

    if (internalLeakPatterns.some((pattern) => pattern.test(cleaned))) {
        return "I couldn’t format that response correctly. Please try the question again.";
    }

    return cleaned;
}

function normalizeAssistantMarkdown(markdown) {
    return sanitizeProviderReply(markdown)
        // Some free models double-escape LaTeX delimiters.
        .replace(/\\\\\[/g, "\\[")
        .replace(/\\\\\]/g, "\\]")
        .replace(/\\\\\(/g, "\\(")
        .replace(/\\\\\)/g, "\\)")
        // Normalize display delimiters placed on their own lines.
        .replace(/^\s*\\\[\s*$/gm, "\\[")
        .replace(/^\s*\\\]\s*$/gm, "\\]")
        .replace(/^\s*\$\$\s*$/gm, "$$")
        // Remove model spacing commands that otherwise leak as text.
        .replace(/\\(?:,|;|!)(?=\s|\\|[A-Za-z0-9])/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/* ================= SAFE MARKDOWN + MATH RENDERING ================= */

let mathJaxLoadPromise = null;

function ensureMathJaxLoaded() {
    if (window.MathJax?.typesetPromise) {
        return Promise.resolve(window.MathJax);
    }

    if (mathJaxLoadPromise) {
        return mathJaxLoadPromise;
    }

    window.MathJax = {
        tex: {
            inlineMath: [["\\(", "\\)"], ["$", "$"]],
            displayMath: [["\\[", "\\]"], ["$$", "$$"]],
            processEscapes: true,
            packages: { "[+]": ["ams"] }
        },
        loader: {
            load: ["[tex]/ams"]
        },
        options: {
            skipHtmlTags: [
                "script", "noscript", "style",
                "textarea", "pre", "code"
            ]
        }
    };

    mathJaxLoadPromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector(
            'script[data-lifelens-mathjax="true"]'
        );

        if (existingScript) {
            if (window.MathJax?.typesetPromise) {
                resolve(window.MathJax);
                return;
            }

            existingScript.addEventListener(
                "load",
                () => resolve(window.MathJax),
                { once: true }
            );
            existingScript.addEventListener("error", reject, { once: true });
            return;
        }

        const script = document.createElement("script");
        script.src =
            "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";
        script.async = true;
        script.dataset.lifelensMathjax = "true";
        script.addEventListener(
            "load",
            () => resolve(window.MathJax),
            { once: true }
        );
        script.addEventListener(
            "error",
            () => reject(new Error("MathJax could not be loaded.")),
            { once: true }
        );
        document.head.appendChild(script);
    });

    return mathJaxLoadPromise;
}

function cleanLatex(latex) {
    return String(latex || "")
        .replace(/^\s*(?:\\\[|\$\$)/, "")
        .replace(/(?:\\\]|\$\$)\s*$/, "")
        .trim();
}

function createMathElement(latex, displayMode = false) {
    const element = document.createElement(
        displayMode ? "div" : "span"
    );

    element.className = displayMode
        ? "assistant-math assistant-math-display"
        : "assistant-math assistant-math-inline";

    const cleaned = cleanLatex(latex);
    element.dataset.latex = cleaned;
    element.dataset.display = String(displayMode);
    element.textContent = displayMode
        ? `\\[${cleaned}\\]`
        : `\\(${cleaned}\\)`;

    return element;
}

function readableMathFallback(latex) {
    return String(latex || "")
        .replace(/\\(?:,|;|!|quad|qquad)/g, " ")
        .replace(/\\Longrightarrow|\\Rightarrow/g, "⇒")
        .replace(/\\rightarrow|\\to/g, "→")
        .replace(/\\times/g, "×")
        .replace(/\\cdot/g, "·")
        .replace(/\\leq/g, "≤")
        .replace(/\\geq/g, "≥")
        .replace(/\\neq/g, "≠")
        .replace(/\\pm/g, "±")
        .replace(/\\text\{([^}]*)\}/g, "$1")
        .replace(/[{}]/g, "")
        .replace(/\\([A-Za-z]+)/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
}

async function typesetMath(container) {
    const mathElements = Array.from(
        container.querySelectorAll(".assistant-math")
    );

    if (mathElements.length === 0) {
        return;
    }

    try {
        await ensureMathJaxLoaded();
        await window.MathJax.typesetPromise([container]);
    } catch (error) {
        console.warn("Math rendering fallback used:", error);
        mathElements.forEach((element) => {
            element.textContent = readableMathFallback(
                element.dataset.latex
            );
            element.classList.add("assistant-math-fallback");
        });
    }
}

function appendInlineMarkdown(container, text) {
    const source = String(text || "");
    const tokenPattern =
        /(\\\([\s\S]*?\\\)|\$(?!\$)[^$\n]+?\$|\*\*[^*]+\*\*|`[^`]+`)/g;
    let lastIndex = 0;

    for (const match of source.matchAll(tokenPattern)) {
        if (match.index > lastIndex) {
            container.appendChild(
                document.createTextNode(
                    source.slice(lastIndex, match.index)
                )
            );
        }

        const token = match[0];

        if (token.startsWith("\\(")) {
            container.appendChild(
                createMathElement(token.slice(2, -2), false)
            );
        } else if (token.startsWith("$")) {
            container.appendChild(
                createMathElement(token.slice(1, -1), false)
            );
        } else if (token.startsWith("**")) {
            const bold = document.createElement("strong");
            appendInlineMarkdown(bold, token.slice(2, -2));
            container.appendChild(bold);
        } else {
            const code = document.createElement("code");
            code.textContent = token.slice(1, -1);
            container.appendChild(code);
        }

        lastIndex = match.index + token.length;
    }

    if (lastIndex < source.length) {
        container.appendChild(
            document.createTextNode(source.slice(lastIndex))
        );
    }
}

function splitTableRow(line) {
    return String(line)
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
}

function isTableSeparator(line) {
    const cells = splitTableRow(line);
    return cells.length > 0 && cells.every(
        (cell) => /^:?-{3,}:?$/.test(cell)
    );
}

function renderTable(container, lines, startIndex) {
    if (
        startIndex + 1 >= lines.length ||
        !lines[startIndex].includes("|") ||
        !isTableSeparator(lines[startIndex + 1])
    ) {
        return null;
    }

    const headers = splitTableRow(lines[startIndex]);
    const wrapper = document.createElement("div");
    wrapper.className = "assistant-table-wrapper";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");

    headers.forEach((header) => {
        const th = document.createElement("th");
        appendInlineMarkdown(th, header);
        headRow.appendChild(th);
    });

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    let index = startIndex + 2;

    while (
        index < lines.length &&
        lines[index].trim() &&
        lines[index].includes("|")
    ) {
        const cells = splitTableRow(lines[index]);
        const row = document.createElement("tr");

        headers.forEach((_, cellIndex) => {
            const td = document.createElement("td");
            appendInlineMarkdown(td, cells[cellIndex] || "");
            row.appendChild(td);
        });

        tbody.appendChild(row);
        index += 1;
    }

    table.appendChild(tbody);
    wrapper.appendChild(table);
    container.appendChild(wrapper);
    return index;
}

function renderMarkdown(container, markdown) {
    const lines = normalizeAssistantMarkdown(markdown)
        .replace(/\r\n?/g, "\n")
        .split("\n");

    let currentList = null;
    let currentListType = "";
    let codeBlock = null;
    let mathDelimiter = null;
    let mathLines = [];
    let paragraphLines = [];

    function closeList() {
        currentList = null;
        currentListType = "";
    }

    function flushParagraph() {
        if (paragraphLines.length === 0) {
            return;
        }

        const paragraph = document.createElement("p");
        appendInlineMarkdown(
            paragraph,
            paragraphLines.join(" ").replace(/\s+/g, " ").trim()
        );
        container.appendChild(paragraph);
        paragraphLines = [];
    }

    function flushMath() {
        if (!mathDelimiter) {
            return;
        }

        const latex = mathLines.join("\n").trim();
        if (latex) {
            container.appendChild(createMathElement(latex, true));
        }
        mathDelimiter = null;
        mathLines = [];
    }

    function ensureList(type) {
        if (currentList && currentListType === type) {
            return currentList;
        }

        flushParagraph();
        closeList();
        currentListType = type;
        currentList = document.createElement(
            type === "ordered" ? "ol" : "ul"
        );
        container.appendChild(currentList);
        return currentList;
    }

    let index = 0;
    while (index < lines.length) {
        const rawLine = lines[index];
        const trimmedLine = rawLine.trim();

        if (mathDelimiter) {
            const closeIndex = rawLine.indexOf(mathDelimiter);
            if (closeIndex >= 0) {
                mathLines.push(rawLine.slice(0, closeIndex));
                flushMath();
                const remainder = rawLine.slice(
                    closeIndex + mathDelimiter.length
                ).trim();
                if (remainder) {
                    paragraphLines.push(remainder);
                }
            } else {
                mathLines.push(rawLine);
            }
            index += 1;
            continue;
        }

        if (codeBlock) {
            if (trimmedLine.startsWith("```")) {
                codeBlock = null;
            } else {
                codeBlock.textContent +=
                    `${codeBlock.textContent ? "\n" : ""}${rawLine}`;
            }
            index += 1;
            continue;
        }

        const tableEnd = renderTable(container, lines, index);
        if (tableEnd !== null) {
            flushParagraph();
            closeList();
            index = tableEnd;
            continue;
        }

        if (trimmedLine.startsWith("```")) {
            flushParagraph();
            closeList();
            const pre = document.createElement("pre");
            codeBlock = document.createElement("code");
            pre.appendChild(codeBlock);
            container.appendChild(pre);
            index += 1;
            continue;
        }

        const displayOpeners = [
            ["\\[", "\\]"],
            ["$$", "$$"]
        ];
        const opener = displayOpeners.find(
            ([open]) => trimmedLine.startsWith(open)
        );

        if (opener) {
            flushParagraph();
            closeList();
            const [open, close] = opener;
            const afterOpen = trimmedLine.slice(open.length);
            const closeIndex = afterOpen.indexOf(close);

            if (closeIndex >= 0) {
                container.appendChild(
                    createMathElement(
                        afterOpen.slice(0, closeIndex),
                        true
                    )
                );
                const remainder = afterOpen.slice(
                    closeIndex + close.length
                ).trim();
                if (remainder) {
                    paragraphLines.push(remainder);
                }
            } else {
                mathDelimiter = close;
                mathLines = afterOpen ? [afterOpen] : [];
            }
            index += 1;
            continue;
        }

        if (!trimmedLine) {
            flushParagraph();
            closeList();
            index += 1;
            continue;
        }

        if (/^(-{3,}|_{3,})$/.test(trimmedLine)) {
            flushParagraph();
            closeList();
            container.appendChild(document.createElement("hr"));
            index += 1;
            continue;
        }

        const headingMatch = trimmedLine.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
            flushParagraph();
            closeList();
            const headingLevel = Math.min(4, headingMatch[1].length + 2);
            const heading = document.createElement(`h${headingLevel}`);
            appendInlineMarkdown(heading, headingMatch[2]);
            container.appendChild(heading);
            index += 1;
            continue;
        }

        const unorderedMatch = trimmedLine.match(/^[-*•]\s+(.+)$/);
        if (unorderedMatch) {
            flushParagraph();
            const list = ensureList("unordered");
            const item = document.createElement("li");
            appendInlineMarkdown(item, unorderedMatch[1]);
            list.appendChild(item);
            index += 1;
            continue;
        }

        const orderedMatch = trimmedLine.match(/^\d+[.)]\s+(.+)$/);
        if (orderedMatch) {
            flushParagraph();
            const list = ensureList("ordered");
            const item = document.createElement("li");
            appendInlineMarkdown(item, orderedMatch[1]);
            list.appendChild(item);
            index += 1;
            continue;
        }

        closeList();
        paragraphLines.push(trimmedLine);
        index += 1;
    }

    flushParagraph();
    flushMath();
}

/* ================= MESSAGE RENDERING ================= */

function scrollMessagesToBottom(container) {
    container.scrollTop =
        container.scrollHeight;
}

function appendMessage(
    container,
    sender,
    message,
    extraClass = ""
) {
    const messageElement =
        document.createElement("div");

    messageElement.className =
        `assistant-message ${
            sender === "user"
                ? "user-message"
                : "ai-message"
        } ${extraClass}`.trim();

    const senderName =
        sender === "user"
            ? "You"
            : "LifeLens Coach";

    const strong =
        document.createElement("strong");

    strong.textContent = senderName;

    const content =
        document.createElement("div");

    content.className = "assistant-message-content";

    if (sender === "assistant") {
        renderMarkdown(content, message);
    } else {
        const paragraph = document.createElement("p");
        paragraph.textContent = String(message || "");
        content.appendChild(paragraph);
    }

    messageElement.append(
        strong,
        content
    );

    if (sender === "assistant" && !extraClass.includes("typing")) {
        const actions = document.createElement("div");
        actions.className = "assistant-message-actions";

        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "assistant-copy-button";
        copyButton.textContent = "Copy";
        copyButton.setAttribute("aria-label", "Copy assistant response");
        copyButton.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(
                    sanitizeProviderReply(message)
                );
                copyButton.textContent = "Copied";
                window.setTimeout(() => {
                    copyButton.textContent = "Copy";
                }, 1400);
            } catch (error) {
                console.warn("Could not copy assistant response:", error);
            }
        });

        const time = document.createElement("time");
        time.dateTime = new Date().toISOString();
        time.textContent = new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        });

        const plannerDraft = parsePlannerDraft(message);

        if (plannerDraft) {
            const draftButton = document.createElement("button");
            draftButton.type = "button";
            draftButton.className = "assistant-plan-draft-button";
            draftButton.textContent = "Review in planner";
            draftButton.title = "Load this suggestion into the planner form without generating it";
            draftButton.addEventListener("click", () => {
                accountStorage.setItem(
                    "lifelens-assistant-plan-draft-v1",
                    JSON.stringify(plannerDraft)
                );

                window.dispatchEvent(
                    new CustomEvent("lifelens-assistant-plan-draft", {
                        detail: plannerDraft
                    })
                );
            });
            actions.appendChild(draftButton);
        }

        actions.append(copyButton, time);
        messageElement.appendChild(actions);
    }

    container.appendChild(messageElement);

    if (sender === "assistant") {
        typesetMath(content).finally(() => {
            scrollMessagesToBottom(container);
        });
    }

    scrollMessagesToBottom(container);

    return messageElement;
}

function addTypingIndicator(container) {
    const typingElement =
        appendMessage(
            container,
            "assistant",
            "Thinking…",
            "assistant-typing-message"
        );

    typingElement.setAttribute(
        "aria-label",
        "LifeLens Coach is thinking"
    );

    return typingElement;
}

/* ================= API ================= */

async function requestAIResponse(message) {
    const historyForServer =
        conversationHistory.slice(-10);

    const response = await fetch("/api/chat", {
        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            message,
            context: buildLifeLensContext(),
            history: historyForServer
        })
    });

    let data = null;

    try {
        data = await response.json();
    } catch {
        throw new Error(
            "The server returned an unreadable response."
        );
    }

    if (!response.ok) {
        throw new Error(
            data?.error ||
            `Chat request failed with status ${response.status}.`
        );
    }

    if (
        !data ||
        typeof data.reply !== "string" ||
        !data.reply.trim()
    ) {
        throw new Error(
            "The AI model returned an empty response."
        );
    }

    return {
        reply: sanitizeProviderReply(data.reply),
        model:
            typeof data.model === "string"
                ? data.model
                : ""
    };
}


/* ================= SAVED CHATS ================= */

function createChatId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getWelcomeMessage() {
    return "Hi! I’m LifeLens Coach. Ask me about your schedule, studies, deadlines, workload, or productivity.";
}

function createNewChatSession() {
    const now = new Date().toISOString();

    return {
        id: createChatId(),
        title: "New chat",
        createdAt: now,
        updatedAt: now,
        messages: [
            {
                role: "assistant",
                content: getWelcomeMessage()
            }
        ]
    };
}

function loadChatSessions() {
    try {
        const parsed = JSON.parse(
            accountStorage.getItem(CHAT_STORAGE_KEY) || "[]"
        );

        chatSessions = Array.isArray(parsed)
            ? parsed.filter((session) =>
                session &&
                typeof session.id === "string" &&
                Array.isArray(session.messages)
            )
            : [];
    } catch (error) {
        console.warn("Could not load saved chats:", error);
        chatSessions = [];
    }

    if (chatSessions.length === 0) {
        chatSessions = [createNewChatSession()];
    }

    const savedActiveId = accountStorage.getItem(ACTIVE_CHAT_KEY);
    activeChatId = chatSessions.some((chat) => chat.id === savedActiveId)
        ? savedActiveId
        : chatSessions[0].id;
}

function saveChatSessions() {
    try {
        accountStorage.setItem(
            CHAT_STORAGE_KEY,
            JSON.stringify(chatSessions)
        );
        accountStorage.setItem(ACTIVE_CHAT_KEY, activeChatId || "");
    } catch (error) {
        console.warn("Could not save chats:", error);
    }
}

function getActiveChat() {
    return chatSessions.find((chat) => chat.id === activeChatId) || null;
}

function createChatTitle(message) {
    const clean = String(message || "")
        .replace(/\s+/g, " ")
        .trim();

    if (!clean) {
        return "New chat";
    }

    return clean.length > 36
        ? `${clean.slice(0, 36).trim()}…`
        : clean;
}

function syncConversationHistoryFromActiveChat() {
    const active = getActiveChat();
    conversationHistory = active
        ? active.messages
            .filter((message) =>
                message &&
                ["user", "assistant"].includes(message.role) &&
                typeof message.content === "string"
            )
            .slice(-12)
            .map((message) => ({
                role: message.role,
                content: message.content
            }))
        : [];
}

function addMessageToActiveChat(role, content) {
    const active = getActiveChat();
    if (!active) {
        return;
    }

    active.messages.push({
        role,
        content: String(content || ""),
        createdAt: new Date().toISOString()
    });

    if (
        role === "user" &&
        active.title === "New chat"
    ) {
        active.title = createChatTitle(content);
    }

    active.updatedAt = new Date().toISOString();
    syncConversationHistoryFromActiveChat();
    saveChatSessions();
}

/* ================= INITIALIZATION ================= */

export function initializeAssistant() {
    const form = document.querySelector("#assistant-form");
    const input = document.querySelector("#assistant-input");
    const messages = document.querySelector("#assistant-messages");
    const submitButton = form?.querySelector('button[type="submit"]');
    const suggestionButtons = document.querySelectorAll(
        ".assistant-suggestions button"
    );

    if (!form || !input || !messages) {
        return;
    }

    loadChatSessions();
    syncConversationHistoryFromActiveChat();

    const assistantSection = form.closest(".assistant-section");
    const assistantBox = form.closest(".assistant-box");
    const assistantHeading = assistantSection?.querySelector(
        ".assistant-heading"
    );

    if (!assistantSection || !assistantBox) {
        return;
    }

    assistantSection.id = "ai-coach";
    assistantSection.classList.add("assistant-enhanced");

    const toolbar = document.createElement("div");
    toolbar.className = "assistant-chat-toolbar";

    const title = document.createElement("div");
    title.className = "assistant-chat-title";

    const titleIcon = document.createElement("span");
    titleIcon.setAttribute("aria-hidden", "true");
    titleIcon.textContent = "🤖";

    const titleCopy = document.createElement("div");
    const titleName = document.createElement("strong");
    titleName.textContent = "LifeLens Coach";
    const titleStatus = document.createElement("small");
    titleStatus.textContent = "AI planning and study assistant";
    titleCopy.append(titleName, titleStatus);
    title.append(titleIcon, titleCopy);

    const toolbarActions = document.createElement("div");
    toolbarActions.className = "assistant-toolbar-actions";

    const historyButton = document.createElement("button");
    historyButton.type = "button";
    historyButton.className = "assistant-history-button";
    historyButton.textContent = "☰ Chats";
    historyButton.setAttribute("aria-expanded", "false");

    const briefingButton = document.createElement("button");
    briefingButton.type = "button";
    briefingButton.className = "assistant-briefing-button";
    briefingButton.textContent = "✦ Daily briefing";
    briefingButton.title = "Summarize today and recommend the next best action";

    const expandButton = document.createElement("button");
    expandButton.type = "button";
    expandButton.className = "assistant-expand-button";
    expandButton.setAttribute("aria-expanded", "false");
    expandButton.setAttribute("aria-label", "Expand assistant");
    expandButton.textContent = "⛶ Expand";

    toolbarActions.append(historyButton, briefingButton, expandButton);
    toolbar.append(title, toolbarActions);

    const memoryStrip = document.createElement("div");
    memoryStrip.className = "assistant-memory-strip";
    memoryStrip.innerHTML = `
        <span class="assistant-memory-status" aria-hidden="true"></span>
        <strong>Personalized memory active</strong>
        <span>Planner</span>
        <span>Dashboard</span>
        <span>XP & badges</span>
        <span>Actual timing</span>
    `;

    const shell = document.createElement("div");
    shell.className = "assistant-chat-shell";

    const sidebar = document.createElement("aside");
    sidebar.className = "assistant-chat-sidebar";
    sidebar.setAttribute("aria-label", "Saved chats");

    const newChatButton = document.createElement("button");
    newChatButton.type = "button";
    newChatButton.className = "assistant-new-chat-button";
    newChatButton.textContent = "+ New chat";

    const chatList = document.createElement("div");
    chatList.className = "assistant-chat-list";

    const conversationPane = document.createElement("div");
    conversationPane.className = "assistant-conversation-pane";

    const suggestions = assistantBox.querySelector(
        ".assistant-suggestions"
    );

    conversationPane.append(messages, form);
    if (suggestions) {
        conversationPane.appendChild(suggestions);
    }

    sidebar.append(newChatButton, chatList);
    shell.append(sidebar, conversationPane);
    assistantBox.replaceChildren(toolbar, memoryStrip, shell);

    const floatingLauncher = document.createElement("button");
    floatingLauncher.type = "button";
    floatingLauncher.className = "assistant-floating-launcher";
    floatingLauncher.innerHTML = '<span aria-hidden="true">🤖</span><span>AI Coach</span>';
    floatingLauncher.setAttribute("aria-label", "Open LifeLens AI Coach");
    document.body.appendChild(floatingLauncher);

    function renderActiveChat() {
        messages.replaceChildren();
        const active = getActiveChat();

        (active?.messages || []).forEach((message) => {
            appendMessage(
                messages,
                message.role === "user" ? "user" : "assistant",
                message.content
            );
        });

        syncConversationHistoryFromActiveChat();
        scrollMessagesToBottom(messages);
    }

    function renderChatList() {
        chatList.replaceChildren();

        [...chatSessions]
            .sort((first, second) =>
                String(second.updatedAt).localeCompare(
                    String(first.updatedAt)
                )
            )
            .forEach((chat) => {
                const row = document.createElement("div");
                row.className = "assistant-chat-list-row";
                row.classList.toggle(
                    "is-active",
                    chat.id === activeChatId
                );

                const openButton = document.createElement("button");
                openButton.type = "button";
                openButton.className = "assistant-chat-open-button";
                openButton.textContent = chat.title || "New chat";
                openButton.title = chat.title || "New chat";

                const menuButton = document.createElement("button");
                menuButton.type = "button";
                menuButton.className = "assistant-chat-menu-button";
                menuButton.textContent = "⋯";
                menuButton.setAttribute(
                    "aria-label",
                    `Manage ${chat.title || "chat"}`
                );

                openButton.addEventListener("click", () => {
                    activeChatId = chat.id;
                    saveChatSessions();
                    renderChatList();
                    renderActiveChat();
                    sidebar.classList.remove("is-open");
                    historyButton.setAttribute("aria-expanded", "false");
                });

                menuButton.addEventListener("click", () => {
                    const action = window.prompt(
                        "Type R to rename this chat or D to delete it."
                    )?.trim().toLowerCase();

                    if (action === "r") {
                        const newTitle = window.prompt(
                            "Rename chat:",
                            chat.title
                        )?.trim();

                        if (newTitle) {
                            chat.title = newTitle.slice(0, 60);
                            chat.updatedAt = new Date().toISOString();
                            saveChatSessions();
                            renderChatList();
                        }
                    }

                    if (action === "d") {
                        const confirmed = window.confirm(
                            `Delete “${chat.title}”?`
                        );

                        if (!confirmed) {
                            return;
                        }

                        chatSessions = chatSessions.filter(
                            (item) => item.id !== chat.id
                        );

                        if (chatSessions.length === 0) {
                            chatSessions.push(createNewChatSession());
                        }

                        if (activeChatId === chat.id) {
                            activeChatId = chatSessions[0].id;
                        }

                        saveChatSessions();
                        renderChatList();
                        renderActiveChat();
                    }
                });

                row.append(openButton, menuButton);
                chatList.appendChild(row);
            });
    }

    function createAndOpenNewChat() {
        const newChat = createNewChatSession();
        chatSessions.unshift(newChat);
        activeChatId = newChat.id;
        saveChatSessions();
        renderChatList();
        renderActiveChat();
        input.focus();
    }

    const setExpanded = (expanded) => {
        assistantSection.classList.toggle(
            "assistant-full-page",
            expanded
        );
        document.body.classList.toggle(
            "assistant-is-expanded",
            expanded
        );
        assistantHeading?.setAttribute(
            "aria-hidden",
            String(expanded)
        );
        expandButton.setAttribute(
            "aria-expanded",
            String(expanded)
        );
        expandButton.setAttribute(
            "aria-label",
            expanded ? "Collapse assistant" : "Expand assistant"
        );
        expandButton.textContent = expanded
            ? "✕ Close"
            : "⛶ Expand";

        window.setTimeout(() => {
            scrollMessagesToBottom(messages);
            input.focus();
        }, 0);
    };

    const setSidebarVisible = (visible) => {
        shell.classList.toggle("assistant-sidebar-hidden", !visible);
        sidebar.classList.toggle("is-open", visible);
        historyButton.setAttribute("aria-expanded", String(visible));
        historyButton.textContent = visible ? "☰ Chats" : "☰ Show chats";
    };

    historyButton.addEventListener("click", () => {
        const currentlyVisible =
            !shell.classList.contains("assistant-sidebar-hidden");
        setSidebarVisible(!currentlyVisible);
    });

    newChatButton.addEventListener("click", createAndOpenNewChat);

    expandButton.addEventListener("click", () => {
        setExpanded(
            !assistantSection.classList.contains(
                "assistant-full-page"
            )
        );
    });

    const setChatHidden = (hidden) => {
        if (!hidden) {
            assistantSection.hidden = false;
            assistantSection.classList.remove("assistant-is-hidden");
            floatingLauncher.classList.add("is-open");
            return;
        }

        setExpanded(false);
        sidebar.classList.remove("is-open");
        historyButton.setAttribute("aria-expanded", "false");
        assistantSection.classList.add("assistant-is-hidden");
        assistantSection.hidden = true;
        floatingLauncher.classList.remove("is-open");
    };

    const openAssistant = () => {
        setChatHidden(false);
        assistantSection.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

        window.setTimeout(() => input.focus(), 450);
    };

    floatingLauncher.addEventListener("click", openAssistant);
    const navbarCoachLink = document.querySelector(".ai-coach-nav-link");
    navbarCoachLink?.addEventListener("click", (event) => {
        event.preventDefault();
        openAssistant();
    });

    floatingLauncher.classList.add("is-open");
    setSidebarVisible(false);

    document.addEventListener("keydown", (event) => {
        if (
            event.key === "Escape" &&
            assistantSection.classList.contains(
                "assistant-full-page"
            )
        ) {
            setExpanded(false);
        }
    });

    async function submitQuestion(question) {
        const cleanedQuestion = String(question || "").trim();

        if (!cleanedQuestion || requestInProgress) {
            return;
        }

        requestInProgress = true;
        appendMessage(messages, "user", cleanedQuestion);
        addMessageToActiveChat("user", cleanedQuestion);
        renderChatList();

        input.value = "";
        input.disabled = true;

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Thinking…";
        }

        suggestionButtons.forEach((button) => {
            button.disabled = true;
        });
        briefingButton.disabled = true;

        const typingIndicator = addTypingIndicator(messages);

        try {
            const result = await requestAIResponse(cleanedQuestion);
            typingIndicator.remove();
            appendMessage(messages, "assistant", result.reply);
            addMessageToActiveChat("assistant", result.reply);
            renderChatList();
        } catch (error) {
            console.error("LifeLens chatbot error:", error);
            typingIndicator.remove();

            const fallbackResponse = createOfflineResponse(
                cleanedQuestion
            );

            const displayedResponse =
                `${fallbackResponse}\n\n` +
                `*Online AI is busy, so this answer was generated using LifeLens's built-in planner analysis.*`;

            appendMessage(
                messages,
                "assistant",
                displayedResponse
            );
            addMessageToActiveChat(
                "assistant",
                fallbackResponse
            );
            renderChatList();
        } finally {
            requestInProgress = false;
            input.disabled = false;

            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = "Send";
            }

            suggestionButtons.forEach((button) => {
                button.disabled = false;
            });
            briefingButton.disabled = false;

            input.focus();
        }
    }

    briefingButton.addEventListener("click", () => {
        submitQuestion(
            "Give me my personalized daily briefing. Summarize today, compare my recent productivity, explain my XP, level, streak, badges, strongest subject, peak productivity time, and planned-versus-actual timing when data is available. End with exactly one practical next action."
        );
    });

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        submitQuestion(input.value);
    });

    suggestionButtons.forEach((button) => {
        button.addEventListener("click", () => {
            submitQuestion(button.textContent);
        });
    });

    renderChatList();
    renderActiveChat();
}

