"use strict";

const KEYS = {
    history: "lifelens-completion-history-v1",
    reviews: "lifelens-daily-reviews",
    xp: "lifelens-planner-xp"
};

const $ = (id) => document.getElementById(id);

function readJSON(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || "");
        return value ?? fallback;
    } catch {
        return fallback;
    }
}

function fmtMinutes(value) {
    const minutes = Math.max(0, Math.round(Number(value) || 0));
    if (minutes === 0) return "0 min";
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (!hours) return `${minutes} min`;
    return `${hours} h${remainder ? ` ${remainder} min` : ""}`;
}

function dateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfDay(value = new Date()) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
}


function parseTaskId(record) {
    const raw = String(record?.taskId || "");
    const parts = raw.split("|");
    if (parts.length < 4) return null;

    const date = parts[0];
    const start = Number(parts[1]);
    const duration = Number(parts[2]);
    const name = parts.slice(3).join("|").trim();

    return {
        date,
        start: Number.isFinite(start) ? start : 0,
        duration: Number.isFinite(duration) ? duration : 0,
        name
    };
}

function getRecordName(record) {
    return String(
        record?.name ||
        record?.taskName ||
        record?.title ||
        parseTaskId(record)?.name ||
        ""
    );
}

function getRecordDate(record) {
    return record?.completedAt || record?.date || record?.completedDate || parseTaskId(record)?.date || "";
}

function getEffectiveMinutes(record) {
    const actual = Number(record?.actualDuration || record?.actualMinutes || 0);
    if (actual > 0) return actual;

    const completed = Number(record?.duration || record?.taskDuration || parseTaskId(record)?.duration || 0);
    if (completed > 0) return completed;

    return Math.max(0, Number(record?.plannedDuration || record?.plannedMinutes || 0));
}

function getPlannedMinutes(record) {
    return Math.max(0, Number(
        record?.plannedDuration ||
        record?.plannedMinutes ||
        record?.duration ||
        record?.taskDuration ||
        parseTaskId(record)?.duration ||
        0
    ));
}

function getActualMinutes(record) {
    return Math.max(0, Number(record?.actualDuration || record?.actualMinutes || 0));
}

function classify(name = "") {
    const text = String(name).toLowerCase();
    if (/math|algebra|calculus|geometry|statistic|trigonometry/.test(text)) return "Mathematics";
    if (/physics|mechanic|electric|wave|force|motion/.test(text)) return "Physics";
    if (/chem/.test(text)) return "Chemistry";
    if (/bio/.test(text)) return "Biology";
    if (/english|ielts|sat|reading|writing|essay|verbal/.test(text)) return "English & Tests";
    if (/code|coding|program|javascript|web|roblox|python|software/.test(text)) return "Coding";
    if (/mandarin|chinese|german|hindi|language/.test(text)) return "Languages";
    if (/deep work|focus|study|learning|revision|review|homework/.test(text)) return "General Study";
    return "Other";
}

function accuracy(planned, actual) {
    if (planned <= 0 || actual <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((1 - Math.abs(planned - actual) / planned) * 100)));
}

function getWeekRecords(history, offset = 0) {
    const end = startOfDay();
    end.setDate(end.getDate() - offset * 7 + 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 7);

    return history.filter((record) => {
        const completedAt = new Date(getRecordDate(record));
        return !Number.isNaN(completedAt.getTime()) && completedAt >= start && completedAt < end;
    });
}

function streakFromReviews(reviews) {
    const map = Array.isArray(reviews)
        ? Object.fromEntries(reviews.map((review) => [review.date || review.key, review]))
        : reviews || {};

    let streak = 0;
    const date = startOfDay();

    for (let index = 0; index < 366; index += 1) {
        const review = map[dateKey(date)];
        if (review && Number(review.completed || review.completedTasks || 0) > 0) {
            streak += 1;
            date.setDate(date.getDate() - 1);
        } else if (index === 0) {
            date.setDate(date.getDate() - 1);
        } else {
            break;
        }
    }

    return streak;
}

function subjectTotals(records) {
    const totals = {};
    records.forEach((record) => {
        const subject = classify(getRecordName(record));
        totals[subject] = (totals[subject] || 0) + getEffectiveMinutes(record);
    });

    return Object.entries(totals)
        .map(([name, minutes]) => ({ name, minutes }))
        .filter((entry) => entry.minutes > 0)
        .sort((first, second) => second.minutes - first.minutes);
}

function hourPeriod(records) {
    const totals = { Morning: 0, Afternoon: 0, Evening: 0, Night: 0 };
    records.forEach((record) => {
        const completedAt = new Date(getRecordDate(record));
        if (Number.isNaN(completedAt.getTime())) return;
        const parsed = parseTaskId(record);
        const scheduledHour = parsed && parsed.start >= 0 ? Math.floor(parsed.start / 60) : null;
        const hour = Number.isFinite(scheduledHour) ? scheduledHour : completedAt.getHours();
        const period = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : hour < 21 ? "Evening" : "Night";
        totals[period] += getEffectiveMinutes(record);
    });
    return Object.entries(totals).sort((first, second) => second[1] - first[1])[0];
}

function percentChange(current, previous) {
    if (previous <= 0) return undefined;
    return Math.round(((current - previous) / previous) * 100);
}

function comparisonText(change) {
    if (change === undefined || change === null) return "Not enough historical data yet";
    return `${change >= 0 ? "+" : ""}${change}% vs previous week`;
}

function build() {
    const rawHistory = readJSON(KEYS.history, []);
    const history = Array.isArray(rawHistory) ? rawHistory : [];
    const reviews = readJSON(KEYS.reviews, {});
    const current = getWeekRecords(history, 0);
    const previous = getWeekRecords(history, 1);
    const xp = Math.max(0, Number(localStorage.getItem(KEYS.xp)) || 0);

    const tasks = current.length;
    const previousTasks = previous.length;
    let focusedMinutes = current.reduce((sum, record) => sum + getEffectiveMinutes(record), 0);
    let previousFocusedMinutes = previous.reduce((sum, record) => sum + getEffectiveMinutes(record), 0);

    // Older completion entries may contain only timestamps. In that case, use the
    // dashboard's daily-review totals rather than incorrectly reporting zero time.
    const reviewValues = Array.isArray(reviews) ? reviews : Object.values(reviews || {});
    const currentKeys = new Set(current.map((record) => dateKey(getRecordDate(record))).filter(Boolean));
    const previousKeys = new Set(previous.map((record) => dateKey(getRecordDate(record))).filter(Boolean));

    if (focusedMinutes <= 0) {
        focusedMinutes = reviewValues
            .filter((review) => currentKeys.has(dateKey(review?.date || review?.key)))
            .reduce((sum, review) => sum + Math.max(0, Number(
                review?.actualMinutes || review?.focusedMinutes || review?.plannedMinutes || review?.totalMinutes || 0
            )), 0);
    }

    if (previousFocusedMinutes <= 0) {
        previousFocusedMinutes = reviewValues
            .filter((review) => previousKeys.has(dateKey(review?.date || review?.key)))
            .reduce((sum, review) => sum + Math.max(0, Number(
                review?.actualMinutes || review?.focusedMinutes || review?.plannedMinutes || review?.totalMinutes || 0
            )), 0);
    }

    const timingRecords = current.filter((record) => getPlannedMinutes(record) > 0 && getActualMinutes(record) > 0);
    const planned = timingRecords.reduce((sum, record) => sum + getPlannedMinutes(record), 0);
    const actual = timingRecords.reduce((sum, record) => sum + getActualMinutes(record), 0);
    const planningAccuracy = accuracy(planned, actual);
    const difference = actual - planned;

    const streak = streakFromReviews(reviews);
    const subjects = subjectTotals(current);
    const topSubject = subjects[0] || null;
    const strongestPeriod = hourPeriod(current);
    const taskChange = percentChange(tasks, previousTasks);
    const timeChange = percentChange(focusedMinutes, previousFocusedMinutes);

    const taskScore = Math.min(tasks, 12) / 12 * 35;
    const timeScore = Math.min(focusedMinutes, 600) / 600 * 25;
    const streakScore = Math.min(streak, 7) / 7 * 20;
    const accuracyScore = planningAccuracy === null ? 0 : planningAccuracy / 100 * 20;
    let score = Math.round(Math.min(100, taskScore + timeScore + streakScore + accuracyScore));
    if (!tasks) score = 0;

    const today = startOfDay();
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    $("insights-period").textContent = `Report for ${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${today.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

    $("weekly-score").textContent = score;
    $("score-ring-value").textContent = `${score}%`;
    $("score-ring").style.background = `conic-gradient(#93c5fd ${score * 3.6}deg,#ffffff2b 0deg)`;

    if (score >= 85) {
        $("weekly-score-label").textContent = "Excellent consistency, focused time, and estimation this week.";
    } else if (score >= 65) {
        $("weekly-score-label").textContent = "A strong week with one clear opportunity to improve.";
    } else if (score > 0 && planningAccuracy === null) {
        $("weekly-score-label").textContent = "Your activity is building. Record actual durations to improve this score.";
    } else if (score > 0) {
        $("weekly-score-label").textContent = "Consistency, focused time, and planning accuracy will raise this score.";
    } else {
        $("weekly-score-label").textContent = "Complete tasks to build your weekly score.";
    }

    $("metric-tasks").textContent = tasks;
    $("metric-time").textContent = fmtMinutes(focusedMinutes);
    $("metric-accuracy").textContent = planningAccuracy === null ? "—" : `${planningAccuracy}%`;
    $("metric-streak").textContent = `${streak} day${streak === 1 ? "" : "s"}`;
    $("metric-xp").textContent = `${xp} XP earned`;
    $("metric-tasks-change").textContent = comparisonText(taskChange);
    $("metric-time-change").textContent = comparisonText(timeChange);
    $("metric-accuracy-note").textContent = planningAccuracy === null
        ? "Record actual durations to measure accuracy"
        : `${Math.abs(difference)} min total estimation difference`;

    const report = [];
    if (tasks) {
        report.push(
            focusedMinutes > 0
                ? `You completed <strong>${tasks} task${tasks === 1 ? "" : "s"}</strong> and accumulated approximately <strong>${fmtMinutes(focusedMinutes)}</strong> of focused work during the last seven days.`
                : `You completed <strong>${tasks} task${tasks === 1 ? "" : "s"}</strong>. Their older completion records do not contain duration details yet, so focused time cannot be estimated reliably.`
        );
    } else {
        report.push("You have not recorded a completed task in the last seven days yet.");
    }

    if (topSubject) {
        report.push(`<strong>${topSubject.name}</strong> was your main focus, representing ${fmtMinutes(topSubject.minutes)} of your completed study time.`);
    }

    if (planningAccuracy !== null) {
        if (planningAccuracy >= 90) {
            report.push(`Your planning accuracy reached <strong>${planningAccuracy}%</strong>, meaning your estimates closely matched reality.`);
        } else if (difference > 0) {
            report.push(`Timed tasks took <strong>${fmtMinutes(Math.abs(difference))} longer</strong> than planned overall, so longer sessions need more buffer time.`);
        } else {
            report.push(`Timed tasks finished <strong>${fmtMinutes(Math.abs(difference))} earlier</strong> than planned overall, suggesting some estimates can be shortened.`);
        }
    } else if (tasks) {
        report.push("Your completed-task durations were used to estimate focused time. Recording actual durations will unlock precise planning-accuracy insights.");
    }

    if (strongestPeriod[1] > 0) {
        report.push(`Your strongest recorded period was the <strong>${strongestPeriod[0].toLowerCase()}</strong>, with ${fmtMinutes(strongestPeriod[1])} completed then.`);
    }

    $("weekly-report").innerHTML = report.map((paragraph) => `<p>${paragraph}</p>`).join("");

    const signals = [
        {
            title: topSubject ? `Top subject: ${topSubject.name}` : "No leading subject yet",
            text: topSubject ? `${fmtMinutes(topSubject.minutes)} completed this week.` : "Complete tasks from different subjects to compare them."
        },
        {
            title: planningAccuracy === null ? "Planning accuracy: collecting data" : `Planning accuracy: ${planningAccuracy}%`,
            text: planningAccuracy === null
                ? "Record actual task durations to unlock this metric."
                : planningAccuracy >= 90
                    ? "Your estimates closely match reality."
                    : "Use learned-duration suggestions for future tasks."
        },
        {
            title: `Current streak: ${streak} day${streak === 1 ? "" : "s"}`,
            text: streak >= 7
                ? "You maintained a full-week habit."
                : `${Math.max(0, 7 - streak)} more active day${7 - streak === 1 ? "" : "s"} to reach a seven-day streak.`
        }
    ];

    $("signal-list").innerHTML = signals
        .map((signal) => `<div class="signal-card"><strong>${signal.title}</strong><span>${signal.text}</span></div>`)
        .join("");

    const maximumMinutes = subjects[0]?.minutes || 1;
    $("subject-bars").innerHTML = subjects.length
        ? subjects.slice(0, 6).map((subject) => {
            const percentage = Math.max(5, Math.round(subject.minutes / maximumMinutes * 100));
            return `<div class="subject-row"><strong>${subject.name}</strong><div class="subject-track" aria-label="${subject.name}: ${fmtMinutes(subject.minutes)}"><div class="subject-fill" style="width:${percentage}%"></div></div><span class="subject-value">${fmtMinutes(subject.minutes)}</span></div>`;
        }).join("")
        : "<p>No subject data yet.</p>";

    const recommendations = [];
    if (!tasks) {
        recommendations.push("Complete one task so LifeLens can begin comparing your weekly patterns.");
    } else {
        if (planningAccuracy === null) {
            recommendations.push("Record actual duration for your next three completed tasks to unlock accurate estimation feedback.");
        } else if (planningAccuracy < 80) {
            recommendations.push(difference > 0
                ? "Add a 10–15 minute buffer to longer tasks until your estimates improve."
                : "Reduce generous task estimates slightly while continuing to record actual time.");
        }

        if (streak < 3) {
            recommendations.push("Schedule one small, achievable task on each of the next three days to build momentum.");
        }

        if (topSubject && subjects.length === 1) {
            recommendations.push(`Keep ${topSubject.name} as your anchor subject, then add one shorter session from a second subject for balance.`);
        } else if (topSubject && subjects.length > 1) {
            const secondSubject = subjects[1];
            recommendations.push(`${topSubject.name} received the most attention. Add one focused ${secondSubject.name} session to keep your week balanced.`);
        }

        if (strongestPeriod[1] > 0) {
            recommendations.push(`Place your hardest task in the ${strongestPeriod[0].toLowerCase()}, your strongest recorded period.`);
        }

        if (tasks < 5) {
            recommendations.push("Aim for at least five completed tasks next week so the trend data becomes more reliable.");
        }
    }

    $("recommendation-list").innerHTML = recommendations
        .slice(0, 4)
        .map((recommendation) => `<li>${recommendation}</li>`)
        .join("");

    $("insights-empty").hidden = tasks > 0;

    window.__lifelensInsightText = [
        "LifeLens Weekly Study Insights",
        `Tasks completed: ${tasks}`,
        `Focused time: ${fmtMinutes(focusedMinutes)}`,
        `Planning accuracy: ${planningAccuracy === null ? "not enough data" : `${planningAccuracy}%`}`,
        `Current streak: ${streak} days`,
        topSubject ? `Top subject: ${topSubject.name}` : "Top subject: not enough data",
        ...recommendations.map((recommendation, index) => `${index + 1}. ${recommendation}`)
    ].join("\n");
}

$("refresh-insights")?.addEventListener("click", build);
$("copy-insights")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(window.__lifelensInsightText || "");
    const button = $("copy-insights");
    button.textContent = "Copied";
    setTimeout(() => {
        button.textContent = "Copy summary";
    }, 1400);
});
window.addEventListener("storage", build);
build();
