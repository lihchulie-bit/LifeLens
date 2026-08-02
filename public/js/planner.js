"use strict";

import { accountStorage } from "./account-storage.js";
import {
    getDurationSuggestion,
    recordTaskResult
} from "./learning.js";
import {
    updateFocusPrediction
} from "./focus.js";
import {
    updateAssistantContext
} from "./assistant.js";
import {
    clearPlannerData,
    loadPlannerData,
    savePlannerData
} from "./storage.js";
import {
    clearPlannerFromCloud,
    flushQueuedPlanner,
    loadPlannerFromCloud,
    queuePlannerForCloud,
    savePlannerToCloud
} from "./firestore.js";

import {
    capitalizeWord,
    convertTimeToMinutes,
    escapeHTML,
    formatMinutesAsTime
} from "./utils.js";

import { parseNaturalTasks } from "./parser.js";
import { analyzeSchedule } from "./analysis.js";

export function initializePlanner() {
    /* ================= DOM ELEMENTS ================= */

    const plannerForm =
        document.querySelector("#planner-form");

    const plannerMessage =
        document.querySelector("#planner-message");

    const taskList =
        document.querySelector("#task-list");

    const addTaskButton =
        document.querySelector("#add-task-button");

    const startTimeInput =
        document.querySelector("#start-time");

    const endTimeInput =
        document.querySelector("#end-time");

    const breakToggle =
        document.querySelector("#break-toggle");

    const breakDurationInput =
        document.querySelector("#break-duration");

    const breakDurationGroup =
        document.querySelector(".break-duration-group");

    const naturalTaskInput =
        document.querySelector("#natural-task-input");

    const parseTasksButton =
        document.querySelector("#parse-tasks-button");

    const naturalTaskMessage =
        document.querySelector("#natural-task-message");

    const scheduleOutput =
        document.querySelector("#schedule-output");

    const saveStatus =
        document.querySelector("#save-status");

    const clearPlannerButton =
        document.querySelector("#clear-planner-button");

    const analysisSection =
        document.querySelector("#planner-analysis");

    if (!plannerForm || !taskList) {
        return;
    }

    /* ================= STATE ================= */

    let taskCounter =
        taskList.querySelectorAll(".task-item").length;

    let automaticSaveTimer = null;
    let latestGeneratedSchedule = null;
    let latestScheduleDate = null;
    let latestStartMinutes = null;
    let latestEndMinutes = null;
    let latestBreaksEnabled = true;
    let latestBreakDuration = 0;
    const REMINDERS_STORAGE_KEY =
        "lifelens-reminders-enabled-v1";
    const ASSISTANT_PLAN_DRAFT_KEY =
        "lifelens-assistant-plan-draft-v1";

    let remindersEnabled =
        accountStorage.getItem(REMINDERS_STORAGE_KEY) === "true";
    let activeReminderTimers = [];
    let overdueCheckTimer = null;
    let lastOverdueSignature = "";

    /* ================= GENERAL HELPERS ================= */

    function setPlannerMessage(
        message,
        type = "error"
    ) {
        if (!plannerMessage) {
            return;
        }

        plannerMessage.textContent = message;

        plannerMessage.style.color =
            type === "success"
                ? "#15803d"
                : "#dc2626";
    }

    function clearPlannerMessage() {
        if (!plannerMessage) {
            return;
        }

        plannerMessage.textContent = "";
    }

    function setNaturalTaskMessage(
        message,
        type = "error"
    ) {
        if (!naturalTaskMessage) {
            return;
        }

        naturalTaskMessage.textContent = message;

        naturalTaskMessage.style.color =
            type === "success"
                ? "#15803d"
                : "#dc2626";
    }

    function clearNaturalTaskMessage() {
        if (!naturalTaskMessage) {
            return;
        }

        naturalTaskMessage.textContent = "";
    }

    function updateSaveStatus(
        message,
        className = ""
    ) {
        if (!saveStatus) {
            return;
        }

        saveStatus.textContent = message;

        saveStatus.classList.remove(
            "is-saving",
            "is-saved",
            "is-error"
        );

        if (className) {
            saveStatus.classList.add(className);
        }
    }

    /* ================= BREAK SETTINGS ================= */

    function updateBreakSettings() {
        if (
            !breakToggle ||
            !breakDurationInput ||
            !breakDurationGroup
        ) {
            return;
        }

        const breaksEnabled =
            breakToggle.checked;

        breakDurationInput.disabled =
            !breaksEnabled;

        breakDurationGroup.classList.toggle(
            "is-disabled",
            !breaksEnabled
        );

        const switchText = breakToggle
            .closest(".switch")
            ?.querySelector(".switch-text");

        if (switchText) {
            switchText.textContent =
                breaksEnabled
                    ? "Breaks enabled"
                    : "Breaks disabled";
        }
    }

    /* ================= TASK BUTTON HELPERS ================= */

    function updateRemoveButtons() {
        const taskItems =
            taskList.querySelectorAll(".task-item");

        taskItems.forEach((taskItem) => {
            const removeButton =
                taskItem.querySelector(
                    ".remove-task-button"
                );

            if (!removeButton) {
                return;
            }

            /*
                The last task cannot disappear entirely.

                When only one remains, the × button clears
                its fields instead of removing the row.
            */
            const onlyOneTask =
                taskItems.length === 1;

            removeButton.disabled = false;

            removeButton.title =
                onlyOneTask
                    ? "Clear this task"
                    : "Remove this task";

            removeButton.setAttribute(
                "aria-label",
                onlyOneTask
                    ? "Clear task"
                    : "Remove task"
            );
        });
    }

    function clearTaskItem(taskItem) {
        const nameInput =
            taskItem.querySelector(".task-name");

        const durationInput =
            taskItem.querySelector(
                ".task-duration"
            );

        const priorityInput =
            taskItem.querySelector(
                ".task-priority"
            );

        const deadlineInput =
            taskItem.querySelector(
                ".task-deadline"
            );

        if (nameInput) {
            nameInput.value = "";
        }

        if (durationInput) {
            durationInput.value = "";
        }

        if (priorityInput) {
            priorityInput.value = "";
        }

        if (deadlineInput) {
            deadlineInput.value = "";
        }

        nameInput?.focus();
    }

     /* ================= TASK CREATION ================= */

    function createTaskItem(taskData = {}) {
        taskCounter += 1;

        const {
            name = "",
            duration = "",
            priority = "",
            deadline = "",
            recurrence = "once",
            recurrenceDays = []
        } = taskData;

        const taskItem =
            document.createElement("div");

        taskItem.className = "task-item";

        taskItem.innerHTML = `
            <div class="form-group task-name-group">
                <label for="task-name-${taskCounter}">
                    Task name
                </label>

                <input
                    type="text"
                    id="task-name-${taskCounter}"
                    class="task-name"
                    placeholder="Example: SAT reading practice"
                    maxlength="80"
                    value="${escapeHTML(name)}"
                    required
                >
            </div>

            <div class="form-group">
                <label for="task-duration-${taskCounter}">
                    Duration
                </label>

                <div class="task-duration-wrapper">
                    <input
                        type="number"
                        id="task-duration-${taskCounter}"
                        class="task-duration"
                        min="5"
                        max="720"
                        step="5"
                        inputmode="numeric"
                        placeholder="Minutes"
                        value="${escapeHTML(duration)}"
                        required
                    >
                    <span>min</span>
                </div>
                <small class="task-duration-help">5–720 minutes, in 5-minute steps.</small>
            </div>

            <div class="form-group">
                <label for="task-priority-${taskCounter}">
                    Priority
                </label>

                <select
                    id="task-priority-${taskCounter}"
                    class="task-priority"
                    required
                >
                    <option value="">Select</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                </select>
            </div>

            <div class="form-group">
                <label for="task-deadline-${taskCounter}">
                    Deadline
                </label>

                <input
                    type="time"
                    id="task-deadline-${taskCounter}"
                    class="task-deadline"
                    value="${deadline}"
                >
            </div>

            <div class="form-group recurrence-group">
                <label for="task-recurrence-${taskCounter}">Repeat</label>
                <select id="task-recurrence-${taskCounter}" class="task-recurrence">
                    <option value="once">Does not repeat</option>
                    <option value="daily">Every day</option>
                    <option value="weekdays">Weekdays</option>
                    <option value="custom">Custom days</option>
                </select>
                <div class="recurrence-days" hidden>
                    ${[0,1,2,3,4,5,6].map((day) => `<button type="button" class="recurrence-day" data-day="${day}" aria-pressed="false" aria-label="${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][day]}">${["S","M","T","W","T","F","S"][day]}</button>`).join("")}
                </div>
            </div>

            <p
    class="learning-suggestion"
    hidden
></p>
            <button
                type="button"
                class="remove-task-button"
                aria-label="Remove task"
            >
                ×
            </button>
        `;

        const durationSelect =
            taskItem.querySelector(".task-duration");

        const prioritySelect =
            taskItem.querySelector(".task-priority");

        if (durationSelect && duration !== "") {
            durationSelect.value = String(duration);
        }

        if (prioritySelect) {
            prioritySelect.value = priority;
        }

        const recurrenceSelect = taskItem.querySelector(".task-recurrence");
        const recurrenceDaysBox = taskItem.querySelector(".recurrence-days");
        if (recurrenceSelect) recurrenceSelect.value = recurrence;
        taskItem.querySelectorAll(".recurrence-day").forEach((button) => {
            const isSelected = recurrenceDays
                .map(Number)
                .includes(Number(button.dataset.day));

            button.classList.toggle("is-selected", isSelected);
            button.setAttribute("aria-pressed", String(isSelected));

            button.addEventListener("click", () => {
                const nextSelected =
                    !button.classList.contains("is-selected");

                button.classList.toggle("is-selected", nextSelected);
                button.setAttribute(
                    "aria-pressed",
                    String(nextSelected)
                );

                saveCurrentPlanner();
            });
        });

        const updateRecurrenceDays = () => {
            if (recurrenceDaysBox) {
                recurrenceDaysBox.hidden =
                    recurrenceSelect?.value !== "custom";
            }
        };

        recurrenceSelect?.addEventListener("change", () => {
            updateRecurrenceDays();
            saveCurrentPlanner();
        });
        updateRecurrenceDays();

        taskList.appendChild(taskItem);

updateRemoveButtons();

if (name.trim()) {
    showLearningSuggestion(
        taskItem
    );
}

return taskItem;
    }

    /* ================= ASSISTANT PLAN DRAFT ================= */

    function normalizeDraftTime(value) {
        const text = String(value || "").trim();
        return /^([01]\d|2[0-3]):[0-5]\d$/.test(text)
            ? text
            : "";
    }

    function applyAssistantPlanDraft(rawDraft) {
        const draft = rawDraft && typeof rawDraft === "object"
            ? rawDraft
            : null;

        const draftTasks = Array.isArray(draft?.tasks)
            ? draft.tasks
                .map((task) => ({
                    name: String(task?.name || "").trim().slice(0, 80),
                    duration: Math.min(
                        720,
                        Math.max(
                            5,
                            Math.round(Number(task?.duration || 0) / 5) * 5
                        )
                    ),
                    priority: ["high", "medium", "low"].includes(task?.priority)
                        ? task.priority
                        : "medium",
                    deadline: normalizeDraftTime(task?.deadline),
                    recurrence: ["once", "daily", "weekdays", "custom"].includes(task?.recurrence)
                        ? task.recurrence
                        : "once",
                    recurrenceDays: Array.isArray(task?.recurrenceDays)
                        ? task.recurrenceDays.filter((day) => Number.isInteger(Number(day)) && Number(day) >= 0 && Number(day) <= 6)
                        : []
                }))
                .filter((task) => task.name && task.duration >= 5)
            : [];

        if (draftTasks.length === 0) {
            setPlannerMessage("The AI draft did not contain any valid tasks.");
            return false;
        }

        const shouldReplace = window.confirm(
            "Use this AI suggestion as a planner draft? This replaces the current task form, but it will NOT generate the schedule until you press Generate Schedule."
        );

        if (!shouldReplace) {
            return false;
        }

        const startTime = normalizeDraftTime(draft.startTime);
        const endTime = normalizeDraftTime(draft.endTime);

        if (startTimeInput && startTime) {
            startTimeInput.value = startTime;
        }

        if (endTimeInput && endTime) {
            endTimeInput.value = endTime;
        }

        if (breakToggle && typeof draft.breaksEnabled === "boolean") {
            breakToggle.checked = draft.breaksEnabled;
        }

        if (breakDurationInput && Number.isFinite(Number(draft.breakDuration))) {
            breakDurationInput.value = String(
                Math.min(60, Math.max(5, Math.round(Number(draft.breakDuration) / 5) * 5))
            );
        }

        taskList.replaceChildren();
        draftTasks.forEach((task) => createTaskItem(task));

        updateBreakSettings();
        updateRemoveButtons();
        saveCurrentPlanner();
        accountStorage.removeItem(ASSISTANT_PLAN_DRAFT_KEY);

        setPlannerMessage(
            "AI schedule suggestion loaded as a draft. Review it, then press Generate Schedule when ready.",
            "success"
        );

        plannerForm.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

        return true;
    }

    window.addEventListener("lifelens-assistant-plan-draft", (event) => {
        applyAssistantPlanDraft(event.detail);
    });

    /* ================= TASK COLLECTION ================= */

    function collectTasks() {
    const taskItems =
        taskList.querySelectorAll(".task-item");

    const tasks = [];

    for (const taskItem of taskItems) {
        const name =
            taskItem
                .querySelector(".task-name")
                ?.value.trim() || "";

        const durationValue =
            taskItem
                .querySelector(".task-duration")
                ?.value || "";

        const priority =
            taskItem
                .querySelector(".task-priority")
                ?.value || "";

        const deadlineValue =
            taskItem
                .querySelector(".task-deadline")
                ?.value || "";

        /*
            Ignore a row that is completely blank.
        */
        const rowIsCompletelyEmpty =
            !name &&
            !durationValue &&
            !priority &&
            !deadlineValue;

        if (rowIsCompletelyEmpty) {
            continue;
        }

        /*
            Reject a row that was started but not completed.
        */
        if (
            !name ||
            !durationValue ||
            !priority
        ) {
            return {
                success: false,
                tasks: [],
                message:
                    "Please complete or remove every partially filled task."
            };
        }

        const recurrence = taskItem.querySelector(".task-recurrence")?.value || "once";
        const recurrenceDays = Array.from(
            taskItem.querySelectorAll(".recurrence-day.is-selected")
        ).map((button) => Number(button.dataset.day));

        /*
            A complete task must always be available to the schedule generator.
            The repeat option describes when the task should recur after today;
            it must not silently remove the task the user is currently adding.
        */
        const duration = Number(durationValue);

        if (
            !Number.isFinite(duration) ||
            duration < 5 ||
            duration > 720
        ) {
            return {
                success: false,
                tasks: [],
                message: "Each task duration must be between 5 and 720 minutes."
            };
        }

        tasks.push({
            name,
            duration,
            priority,
            deadline: deadlineValue
                ? convertTimeToMinutes(deadlineValue)
                : null,
            recurrence,
            recurrenceDays
        });
    }

    if (tasks.length === 0) {
        return {
            success: false,
            tasks: [],
            message:
                "Please add at least one complete task."
        };
    }

    return {
        success: true,
        tasks,
        message: ""
    };
}

    function collectTaskFieldsForStorage() {
        return Array.from(
            taskList.querySelectorAll(".task-item")
        ).map((taskItem) => ({
            name:
                taskItem
                    .querySelector(".task-name")
                    ?.value.trim() || "",

            duration:
                taskItem
                    .querySelector(".task-duration")
                    ?.value || "",

            priority:
                taskItem
                    .querySelector(".task-priority")
                    ?.value || "",

            deadline: taskItem.querySelector(".task-deadline")?.value || "",
            recurrence: taskItem.querySelector(".task-recurrence")?.value || "once",
            recurrenceDays: Array.from(taskItem.querySelectorAll(".recurrence-day.is-selected")).map((button) => Number(button.dataset.day))
        }));
    }

    /* ================= TASK SORTING ================= */

    function sortTasks(tasks) {
        const priorityOrder = {
            high: 1,
            medium: 2,
            low: 3
        };

        return [...tasks].sort(
            (firstTask, secondTask) => {
                const priorityDifference =
                    priorityOrder[
                        firstTask.priority
                    ] -
                    priorityOrder[
                        secondTask.priority
                    ];

                if (priorityDifference !== 0) {
                    return priorityDifference;
                }

                if (
                    firstTask.deadline !== null &&
                    secondTask.deadline !== null
                ) {
                    return (
                        firstTask.deadline -
                        secondTask.deadline
                    );
                }

                if (
                    firstTask.deadline !== null
                ) {
                    return -1;
                }

                if (
                    secondTask.deadline !== null
                ) {
                    return 1;
                }

                return 0;
            }
        );
    }

    /* ================= STORAGE ================= */

    async function syncPlannerToCloud(plannerData) {
        if (!navigator.onLine) {
            queuePlannerForCloud(plannerData);
            updateSaveStatus(
                "Saved offline. Waiting to sync...",
                "is-saving"
            );
            return;
        }

        try {
            updateSaveStatus(
                "Syncing with cloud...",
                "is-saving"
            );
            await savePlannerToCloud(plannerData);
            updateSaveStatus(
                "Saved locally and to cloud.",
                "is-saved"
            );
        } catch (error) {
            console.error("Planner cloud sync failed:", error);
            queuePlannerForCloud(plannerData);
            updateSaveStatus(
                "Saved locally. Cloud sync pending.",
                "is-saving"
            );
        }
    }

    function saveCurrentPlanner() {
        const plannerData = {
            version: 1,

            startTime:
                startTimeInput?.value || "",

            endTime:
                endTimeInput?.value || "",

            breaksEnabled:
                breakToggle?.checked ?? true,

            breakDuration:
                breakDurationInput?.value || "10",

            naturalTaskText:
                naturalTaskInput?.value || "",

            tasks:
                collectTaskFieldsForStorage(),

            generatedSchedule:
                Array.isArray(latestGeneratedSchedule)
                    ? latestGeneratedSchedule
                    : null,

            scheduleDate:
                latestScheduleDate instanceof Date &&
                !Number.isNaN(latestScheduleDate.getTime())
                    ? latestScheduleDate.toISOString()
                    : null,

            generatedContext: latestGeneratedSchedule
                ? {
                    startMinutes: latestStartMinutes,
                    endMinutes: latestEndMinutes,
                    breaksEnabled: latestBreaksEnabled,
                    breakDuration: latestBreakDuration
                }
                : null,

            remindersEnabled,

            completedTaskIds:
                Array.isArray(latestGeneratedSchedule)
                    ? latestGeneratedSchedule
                        .filter((item) =>
                            item.type === "task" &&
                            isTaskCompleted(getScheduleTaskId(item))
                        )
                        .map((item) => getScheduleTaskId(item))
                    : [],

            savedAt:
                new Date().toISOString()
        };

        const saveSucceeded =
            savePlannerData(plannerData);

        if (saveSucceeded) {
            updateSaveStatus(
                "Saved locally. Syncing...",
                "is-saving"
            );
            void syncPlannerToCloud(plannerData);
        } else {
            updateSaveStatus(
                "Your changes could not be saved.",
                "is-error"
            );
        }
    }

    function scheduleAutomaticSave() {
        updateSaveStatus(
            "Saving changes...",
            "is-saving"
        );

        window.clearTimeout(
            automaticSaveTimer
        );

        automaticSaveTimer =
            window.setTimeout(() => {
                saveCurrentPlanner();
            }, 400);
    }

    function restoreSavedPlanner(providedData = null) {
        const savedData =
            providedData || loadPlannerData();

        if (!savedData) {
            remindersEnabled =
                accountStorage.getItem(REMINDERS_STORAGE_KEY) === "true";
            updateBreakSettings();
            updateRemoveButtons();
            return false;
        }

        if (startTimeInput) {
            startTimeInput.value =
                savedData.startTime || "";
        }

        if (endTimeInput) {
            endTimeInput.value =
                savedData.endTime || "";
        }

        if (breakToggle) {
            breakToggle.checked =
                savedData.breaksEnabled !== false;
        }

        if (breakDurationInput) {
            breakDurationInput.value =
                savedData.breakDuration || "10";
        }

        if (naturalTaskInput) {
            naturalTaskInput.value =
                savedData.naturalTaskText || "";
        }

        if (Array.isArray(savedData.tasks)) {
            taskList.innerHTML = "";

            savedData.tasks.forEach((task) => {
                createTaskItem({
                    name: task.name || "",
                    duration:
                        task.duration || "",
                    priority:
                        task.priority || "",
                    deadline: task.deadline || "",
                    recurrence: task.recurrence || "once",
                    recurrenceDays:
                        Array.isArray(task.recurrenceDays)
                            ? task.recurrenceDays
                            : []
                });
            });

            if (savedData.tasks.length === 0) {
                createTaskItem();
            }
        }

        updateBreakSettings();
        updateRemoveButtons();

        const savedSchedule =
            Array.isArray(savedData.generatedSchedule)
                ? savedData.generatedSchedule
                : null;

        const savedContext =
            savedData.generatedContext &&
            typeof savedData.generatedContext === "object"
                ? savedData.generatedContext
                : null;

        const restoredDate =
            savedData.scheduleDate
                ? new Date(savedData.scheduleDate)
                : null;

        const scheduleCanBeRestored =
            savedSchedule &&
            savedSchedule.length > 0 &&
            restoredDate &&
            !Number.isNaN(restoredDate.getTime());

        if (scheduleCanBeRestored) {
            latestGeneratedSchedule =
                savedSchedule;

            latestScheduleDate =
                restoredDate;

            latestStartMinutes =
                Number.isFinite(
                    Number(savedContext?.startMinutes)
                )
                    ? Number(savedContext.startMinutes)
                    : convertTimeToMinutes(
                        savedData.startTime || ""
                    );

            latestEndMinutes =
                Number.isFinite(
                    Number(savedContext?.endMinutes)
                )
                    ? Number(savedContext.endMinutes)
                    : convertTimeToMinutes(
                        savedData.endTime || ""
                    );

            latestBreaksEnabled =
                savedContext?.breaksEnabled !== false;

            latestBreakDuration =
                Number(savedContext?.breakDuration) ||
                Number(savedData.breakDuration) ||
                10;

            if (Array.isArray(savedData.completedTaskIds)) {
                savedData.completedTaskIds.forEach((taskId) => {
                    if (taskId) {
                        accountStorage.setItem(
                            getCompletionStorageKey(taskId),
                            "true"
                        );
                    }
                });
            }

            remindersEnabled =
                savedData.remindersEnabled === true ||
                accountStorage.getItem(REMINDERS_STORAGE_KEY) === "true";

            displaySchedule(
                latestGeneratedSchedule,
                latestStartMinutes,
                latestEndMinutes
            );

            const restoredTasks =
                latestGeneratedSchedule.filter(
                    (item) =>
                        item.type === "task" ||
                        item.type === "unscheduled"
                );

            analyzeSchedule({
                schedule: latestGeneratedSchedule,
                tasks: restoredTasks,
                startMinutes: latestStartMinutes,
                endMinutes: latestEndMinutes,
                breaksEnabled: latestBreaksEnabled
            });

            updateFocusPrediction({
                schedule: latestGeneratedSchedule,
                startMinutes: latestStartMinutes,
                endMinutes: latestEndMinutes
            });

            updateAssistantContext({
                schedule: latestGeneratedSchedule,
                tasks: restoredTasks,
                startMinutes: latestStartMinutes,
                endMinutes: latestEndMinutes,
                breaksEnabled: latestBreaksEnabled,
                breakDuration: latestBreakDuration
            });

            updateScheduleProgress();
            refreshOverdueTasks(true);

            if (
                remindersEnabled &&
                "Notification" in window &&
                Notification.permission === "granted"
            ) {
                scheduleTaskReminders();
                syncReminderButtonState();
            }
        }

        updateSaveStatus(
            scheduleCanBeRestored
                ? "Saved planner and schedule restored."
                : "Saved planner restored.",
            "is-saved"
        );

        return Boolean(scheduleCanBeRestored);
    }

        /* ================= SCHEDULE GENERATION ================= */

    function createSchedule(
        tasks,
        startMinutes,
        endMinutes,
        breaksEnabled,
        breakDuration
    ) {
        const schedule = [];
        let currentTime = startMinutes;

        tasks.forEach((task, index) => {
            const taskEndTime =
                currentTime + task.duration;

            if (taskEndTime > endMinutes) {
                schedule.push({
                    type: "unscheduled",
                    ...task
                });

                return;
            }

            schedule.push({
                type: "task",
                ...task,
                start: currentTime,
                end: taskEndTime,
                missesDeadline:
                    task.deadline !== null &&
                    taskEndTime > task.deadline
            });

            currentTime = taskEndTime;

            const hasAnotherTask =
                index < tasks.length - 1;

            const breakFits =
                currentTime + breakDuration <=
                endMinutes;

            if (
                breaksEnabled &&
                hasAnotherTask &&
                breakFits
            ) {
                schedule.push({
                    type: "break",
                    name: "Short break",
                    duration: breakDuration,
                    start: currentTime,
                    end:
                        currentTime +
                        breakDuration
                });

                currentTime += breakDuration;
            }
        });

        return schedule;
    }

    /* ================= TASK REMINDERS ================= */

    function clearTaskReminders(preservePreference = false) {
        activeReminderTimers.forEach((timerId) => {
            window.clearTimeout(timerId);
        });

        activeReminderTimers = [];

        if (!preservePreference) {
            remindersEnabled = false;
            accountStorage.setItem(
                REMINDERS_STORAGE_KEY,
                "false"
            );
        }
    }

    function createTaskReminderDate(task) {
        if (!latestScheduleDate || !task) {
            return null;
        }

        const reminderDate = new Date(latestScheduleDate);
        reminderDate.setDate(
            reminderDate.getDate() +
            Number(task.dateOffset || 0)
        );
        reminderDate.setHours(
            Math.floor(task.start / 60),
            task.start % 60,
            0,
            0
        );

        return reminderDate;
    }

    async function showLifeLensNotification(title, body) {
        const options = {
            body,
            icon: "./assets/icon-192.png",
            badge: "./assets/icon-192.png",
            tag: `lifelens-${Date.now()}`
        };

        if ("serviceWorker" in navigator) {
            const registration =
                await navigator.serviceWorker.getRegistration();

            if (registration) {
                await registration.showNotification(
                    title,
                    options
                );

                return;
            }
        }

        new Notification(title, options);
    }

    function scheduleTaskReminders() {
        clearTaskReminders(true);

        if (!latestGeneratedSchedule) {
            return 0;
        }

        const now = Date.now();
        let scheduledCount = 0;

        latestGeneratedSchedule
            .filter((item) => item.type === "task")
            .forEach((task) => {
                const reminderDate =
                    createTaskReminderDate(task);

                if (!reminderDate) {
                    return;
                }

                const delay =
                    reminderDate.getTime() - now;

                if (delay <= 0) {
                    return;
                }

                const timerId = window.setTimeout(() => {
                    showLifeLensNotification(
                        `Time for ${task.name}`,
                        `Your planned task starts now and ends at ${formatMinutesAsTime(task.end)}.`
                    ).catch((error) => {
                        console.error(
                            "LifeLens reminder failed:",
                            error
                        );
                    });
                }, delay);

                activeReminderTimers.push(timerId);
                scheduledCount += 1;
            });

        remindersEnabled = true;
        accountStorage.setItem(
            REMINDERS_STORAGE_KEY,
            "true"
        );
        saveCurrentPlanner();
        return scheduledCount;
    }

    async function enableTaskReminders(button) {
        if (!("Notification" in window)) {
            setPlannerMessage(
                "This browser does not support notifications."
            );
            return;
        }

        if (!window.isSecureContext) {
            setPlannerMessage(
                "Reminders require HTTPS or localhost."
            );
            return;
        }

        button.disabled = true;
        button.textContent = "🔔 Checking permission...";

        try {
            const permission =
                Notification.permission === "default"
                    ? await Notification.requestPermission()
                    : Notification.permission;

            if (permission !== "granted") {
                remindersEnabled = false;
                accountStorage.setItem(
                    REMINDERS_STORAGE_KEY,
                    "false"
                );
                button.textContent = "🔔 Enable Reminders";
                setPlannerMessage(
                    "Notification permission was not granted."
                );
                return;
            }

            const scheduledCount =
                scheduleTaskReminders();

            button.classList.add("reminders-active");
            button.textContent = "🔔 Reminders Active";
            button.setAttribute("aria-pressed", "true");

            await showLifeLensNotification(
                "LifeLens reminders enabled",
                scheduledCount > 0
                    ? `${scheduledCount} upcoming task reminder${scheduledCount === 1 ? "" : "s"} scheduled.`
                    : "Reminders are enabled, but today's listed task times have already passed."
            );

            setPlannerMessage(
                scheduledCount > 0
                    ? `${scheduledCount} task reminder${scheduledCount === 1 ? "" : "s"} scheduled.`
                    : "Reminders are enabled, but no future task times remain today.",
                "success"
            );
        } catch (error) {
            console.error(
                "Could not enable LifeLens reminders:",
                error
            );

            clearTaskReminders();
            button.classList.remove("reminders-active");
            button.textContent = "🔔 Enable Reminders";
            button.setAttribute("aria-pressed", "false");
            setPlannerMessage(
                "LifeLens could not enable reminders."
            );
        } finally {
            button.disabled = false;
        }
    }

    /* ================= SMART RESCHEDULING ================= */

    function getScheduleItemDate(item, useEndTime = false) {
        if (!latestScheduleDate || !item) {
            return null;
        }

        const date = new Date(latestScheduleDate);
        date.setDate(
            date.getDate() +
            Number(item.dateOffset || 0)
        );

        const minutes = useEndTime
            ? item.end
            : item.start;

        date.setHours(
            Math.floor(minutes / 60),
            minutes % 60,
            0,
            0
        );

        return date;
    }

    function formatScheduleDayLabel(dateOffset = 0) {
        if (dateOffset === 0) {
            return "Today";
        }

        if (dateOffset === 1) {
            return "Tomorrow";
        }

        if (!latestScheduleDate) {
            return `Day ${dateOffset + 1}`;
        }

        const date = new Date(latestScheduleDate);
        date.setDate(date.getDate() + dateOffset);

        return date.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric"
        });
    }

    function isScheduleTaskOverdue(item) {
        if (
            !item ||
            item.type !== "task" ||
            isTaskCompleted(getScheduleTaskId(item))
        ) {
            return false;
        }

        const endDate = getScheduleItemDate(
            item,
            true
        );

        return Boolean(
            endDate &&
            Date.now() >= endDate.getTime()
        );
    }

    function getOverdueSignature() {
        if (!latestGeneratedSchedule) {
            return "";
        }

        return latestGeneratedSchedule
            .map((item, index) =>
                isScheduleTaskOverdue(item)
                    ? String(index)
                    : ""
            )
            .filter(Boolean)
            .join("|");
    }

    function roundMinutesUp(minutes, step = 5) {
        return Math.ceil(minutes / step) * step;
    }

    function getBusyIntervals(excludedIndex, dateOffset) {
        if (!latestGeneratedSchedule) {
            return [];
        }

        return latestGeneratedSchedule
            .map((item, index) => ({
                ...item,
                scheduleIndex: index
            }))
            .filter((item) =>
                item.scheduleIndex !== excludedIndex &&
                item.type !== "unscheduled" &&
                Number(item.dateOffset || 0) === dateOffset
            )
            .sort((first, second) =>
                first.start - second.start
            );
    }

    function findAvailableSlotForDay({
        scheduleIndex,
        dateOffset,
        preferredStart,
        duration
    }) {
        const dayStart = Number.isFinite(latestStartMinutes)
            ? latestStartMinutes
            : 0;
        const dayEnd = Number.isFinite(latestEndMinutes)
            ? latestEndMinutes
            : 1440;

        let candidate = Math.max(dayStart, preferredStart);
        const busyIntervals = getBusyIntervals(
            scheduleIndex,
            dateOffset
        );

        for (const busyItem of busyIntervals) {
            if (candidate + duration <= busyItem.start) {
                return {
                    start: candidate,
                    end: candidate + duration,
                    dateOffset
                };
            }

            if (candidate < busyItem.end) {
                candidate = busyItem.end;
            }
        }

        if (candidate + duration <= dayEnd) {
            return {
                start: candidate,
                end: candidate + duration,
                dateOffset
            };
        }

        return null;
    }

    function findSuggestedRescheduleSlot(scheduleIndex) {
        const task = latestGeneratedSchedule?.[scheduleIndex];

        if (!task || task.type !== "task") {
            return null;
        }

        const now = new Date();
        const currentMinutes =
            now.getHours() * 60 + now.getMinutes();

        const todaySlot = findAvailableSlotForDay({
            scheduleIndex,
            dateOffset: 0,
            preferredStart: roundMinutesUp(
                currentMinutes + 2
            ),
            duration: task.duration
        });

        if (todaySlot) {
            return todaySlot;
        }

        return findAvailableSlotForDay({
            scheduleIndex,
            dateOffset: 1,
            preferredStart: Number.isFinite(latestStartMinutes)
                ? latestStartMinutes
                : task.start,
            duration: task.duration
        });
    }

    function slotConflicts(scheduleIndex, slot) {
        return getBusyIntervals(
            scheduleIndex,
            slot.dateOffset
        ).some((item) =>
            slot.start < item.end &&
            slot.end > item.start
        );
    }

    function syncReminderButtonState() {
        const button = scheduleOutput?.querySelector(
            "#enable-reminders-button"
        );

        if (!button) {
            return;
        }

        button.classList.toggle(
            "reminders-active",
            remindersEnabled
        );
        button.textContent = remindersEnabled
            ? "🔔 Reminders Active"
            : "🔔 Enable Reminders";
        button.setAttribute(
            "aria-pressed",
            String(remindersEnabled)
        );
    }

    function updatePlannerInsightsAfterReschedule() {
        if (
            !latestGeneratedSchedule ||
            !Number.isFinite(latestStartMinutes) ||
            !Number.isFinite(latestEndMinutes)
        ) {
            return;
        }

        const tasks = latestGeneratedSchedule.filter(
            (item) => item.type === "task"
        );

        analyzeSchedule({
            schedule: latestGeneratedSchedule,
            tasks,
            startMinutes: latestStartMinutes,
            endMinutes: latestEndMinutes,
            breaksEnabled: latestBreaksEnabled
        });

        updateFocusPrediction({
            schedule: latestGeneratedSchedule,
            startMinutes: latestStartMinutes,
            endMinutes: latestEndMinutes
        });

        updateAssistantContext({
            schedule: latestGeneratedSchedule,
            tasks,
            startMinutes: latestStartMinutes,
            endMinutes: latestEndMinutes,
            breaksEnabled: latestBreaksEnabled,
            breakDuration: latestBreakDuration
        });
    }

    function renderLatestSchedule() {
        if (
            !latestGeneratedSchedule ||
            !Number.isFinite(latestStartMinutes) ||
            !Number.isFinite(latestEndMinutes)
        ) {
            return;
        }

        displaySchedule(
            latestGeneratedSchedule,
            latestStartMinutes,
            latestEndMinutes
        );
        syncReminderButtonState();
    }

    function rescheduleTaskToSlot(
        scheduleIndex,
        slot,
        reason = "suggested"
    ) {
        const task = latestGeneratedSchedule?.[scheduleIndex];

        if (!task || task.type !== "task" || !slot) {
            setPlannerMessage(
                "LifeLens could not reschedule that task."
            );
            return;
        }

        if (slotConflicts(scheduleIndex, slot)) {
            setPlannerMessage(
                "That time overlaps another activity. Choose a different time."
            );
            return;
        }

        const remindersWereEnabled = remindersEnabled;

        if (remindersWereEnabled) {
            clearTaskReminders();
        }

        task.start = slot.start;
        task.end = slot.end;
        task.dateOffset = slot.dateOffset;
        task.rescheduled = true;
        task.rescheduleReason = reason;
        task.rescheduledAt = new Date().toISOString();

        renderLatestSchedule();
        updatePlannerInsightsAfterReschedule();

        if (
            remindersWereEnabled &&
            Notification.permission === "granted"
        ) {
            scheduleTaskReminders();
            syncReminderButtonState();
        }

        lastOverdueSignature = getOverdueSignature();

        setPlannerMessage(
            `"${task.name}" was moved to ${formatScheduleDayLabel(
                slot.dateOffset
            ).toLowerCase()} at ${formatMinutesAsTime(
                slot.start
            )}.`,
            "success"
        );
    }

    function formatMinutesForTimeInput(minutes) {
        const normalizedMinutes =
            ((Number(minutes) % 1440) + 1440) % 1440;

        return `${String(
            Math.floor(normalizedMinutes / 60)
        ).padStart(2, "0")}:${String(
            normalizedMinutes % 60
        ).padStart(2, "0")}`;
    }

    function setCustomRescheduleMessage(
        editor,
        message = "",
        type = "error"
    ) {
        const messageElement = editor?.querySelector(
            ".smart-reschedule-inline-message"
        );

        if (!messageElement) {
            return;
        }

        messageElement.textContent = message;
        messageElement.classList.toggle(
            "success",
            type === "success"
        );
    }

    function openCustomRescheduleEditor(
        scheduleIndex,
        sourceButton
    ) {
        const task = latestGeneratedSchedule?.[scheduleIndex];
        const panel = sourceButton?.closest(
            ".smart-reschedule-panel"
        );
        const editor = panel?.querySelector(
            ".smart-reschedule-editor"
        );

        if (!task || task.type !== "task" || !editor) {
            setPlannerMessage(
                "LifeLens could not open the time editor."
            );
            return;
        }

        const suggested = findSuggestedRescheduleSlot(
            scheduleIndex
        );
        const daySelect = editor.querySelector(
            ".smart-reschedule-day-select"
        );
        const timeInput = editor.querySelector(
            ".smart-reschedule-time-input"
        );

        if (daySelect) {
            daySelect.value = String(
                suggested?.dateOffset ?? 0
            );
        }

        if (timeInput) {
            timeInput.value = formatMinutesForTimeInput(
                suggested?.start ?? task.start
            );
        }

        editor.hidden = false;
        sourceButton.setAttribute("aria-expanded", "true");
        setCustomRescheduleMessage(editor);
        timeInput?.focus();

        if (typeof timeInput?.showPicker === "function") {
            try {
                timeInput.showPicker();
            } catch (error) {
                /* Some browsers block showPicker outside direct gestures. */
            }
        }
    }

    function closeCustomRescheduleEditor(sourceElement) {
        const panel = sourceElement?.closest(
            ".smart-reschedule-panel"
        );
        const editor = panel?.querySelector(
            ".smart-reschedule-editor"
        );
        const openButton = panel?.querySelector(
            '[data-reschedule-action="custom"]'
        );

        if (editor) {
            editor.hidden = true;
            setCustomRescheduleMessage(editor);
        }

        openButton?.setAttribute("aria-expanded", "false");
    }

    function applyCustomRescheduleTime(
        scheduleIndex,
        sourceButton
    ) {
        const task = latestGeneratedSchedule?.[scheduleIndex];
        const editor = sourceButton?.closest(
            ".smart-reschedule-editor"
        );
        const daySelect = editor?.querySelector(
            ".smart-reschedule-day-select"
        );
        const timeInput = editor?.querySelector(
            ".smart-reschedule-time-input"
        );

        if (!task || task.type !== "task" || !editor) {
            setPlannerMessage(
                "LifeLens could not change that task time."
            );
            return;
        }

        const timeValue = timeInput?.value || "";
        const dateOffset = Number(daySelect?.value || 0);

        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeValue)) {
            setCustomRescheduleMessage(
                editor,
                "Choose a valid start time."
            );
            timeInput?.focus();
            return;
        }

        if (![0, 1].includes(dateOffset)) {
            setCustomRescheduleMessage(
                editor,
                "Choose today or tomorrow."
            );
            return;
        }

        const start = convertTimeToMinutes(timeValue);
        const end = start + task.duration;

        if (end > 1440) {
            setCustomRescheduleMessage(
                editor,
                "This task would continue past midnight. Choose an earlier time."
            );
            return;
        }

        if (dateOffset === 0) {
            const now = new Date();
            const currentMinutes =
                now.getHours() * 60 + now.getMinutes();

            if (start <= currentMinutes) {
                setCustomRescheduleMessage(
                    editor,
                    "Choose a future time for today."
                );
                return;
            }
        }

        const slot = {
            start,
            end,
            dateOffset
        };

        if (slotConflicts(scheduleIndex, slot)) {
            setCustomRescheduleMessage(
                editor,
                "That time overlaps another activity."
            );
            return;
        }

        /*
            A manually selected time is allowed outside the original
            availability window. The visible plan range expands when
            the task stays on the same day.
        */
        if (dateOffset === 0) {
            latestStartMinutes = Number.isFinite(
                latestStartMinutes
            )
                ? Math.min(latestStartMinutes, start)
                : start;

            latestEndMinutes = Number.isFinite(
                latestEndMinutes
            )
                ? Math.max(latestEndMinutes, end)
                : end;
        }

        rescheduleTaskToSlot(
            scheduleIndex,
            slot,
            "custom"
        );
    }

    function moveTaskToTomorrow(scheduleIndex) {
        const task = latestGeneratedSchedule?.[scheduleIndex];

        if (!task || task.type !== "task") {
            return;
        }

        const slot = findAvailableSlotForDay({
            scheduleIndex,
            dateOffset: 1,
            preferredStart: Number.isFinite(latestStartMinutes)
                ? Math.max(latestStartMinutes, task.start)
                : task.start,
            duration: task.duration
        });

        if (!slot) {
            setPlannerMessage(
                "This task does not fit inside tomorrow's current planning window."
            );
            return;
        }

        rescheduleTaskToSlot(
            scheduleIndex,
            slot,
            "tomorrow"
        );
    }

    function refreshOverdueTasks(force = false) {
        if (!latestGeneratedSchedule) {
            lastOverdueSignature = "";
            return;
        }

        const signature = getOverdueSignature();

        if (!force && signature === lastOverdueSignature) {
            return;
        }

        lastOverdueSignature = signature;
        renderLatestSchedule();
    }

    /* ================= SCHEDULE DISPLAY ================= */

    function displaySchedule(
        schedule,
        startMinutes,
        endMinutes
    ) {
        if (!scheduleOutput) {
            return;
        }

        const scheduledItems =
            schedule
                .filter(
                    (item) =>
                        item.type !== "unscheduled"
                )
                .slice()
                .sort((first, second) => {
                    const dayDifference =
                        Number(first.dateOffset || 0) -
                        Number(second.dateOffset || 0);

                    if (dayDifference !== 0) {
                        return dayDifference;
                    }

                    return first.start - second.start;
                });

        const unscheduledItems =
            schedule.filter(
                (item) =>
                    item.type === "unscheduled"
            );

        const activityText =
            scheduledItems.length === 1
                ? "1 activity"
                : `${scheduledItems.length} activities`;

        const taskCount = scheduledItems.filter(
    (item) => item.type === "task"
).length;

let scheduleHTML = `
    <div class="generated-schedule">

        <div class="schedule-progress">
            <div class="progress-heading">
                <span>Daily progress</span>

                <strong id="progress-text">
                    0 of ${taskCount} completed
                </strong>
            </div>

            <div
                class="progress-track"
                id="progress-track"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow="0"
            >
                <div
                    class="progress-fill"
                    id="progress-fill"
                ></div>
            </div>
        </div>

                <div class="schedule-heading">
                    <div>
                        <p class="section-label">
                            YOUR DAILY PLAN
                        </p>

                        <h2>
                            ${formatMinutesAsTime(
                                startMinutes
                            )}
                            –
                            ${formatMinutesAsTime(
                                endMinutes
                            )}
                        </h2>
                    </div>

                    <span class="status-badge">
                        ${activityText}
                    </span>
                </div>

                <div class="schedule-list">

                    <div class="schedule-toolbar">
                        <div class="schedule-toolbar-copy">
                            <p class="schedule-toolbar-label">
                                PLAN ACTIONS
                            </p>

                            <p class="schedule-toolbar-text">
                                Enable task alerts or add this plan to your calendar.
                            </p>
                        </div>

                        <div class="schedule-toolbar-actions">
                            <button
                                type="button"
                                class="reminder-button"
                                id="enable-reminders-button"
                                aria-pressed="false"
                            >
                                🔔 Enable Reminders
                            </button>

                            <button
                                type="button"
                                class="export-calendar-button"
                                id="export-calendar-button"
                            >
                                📅 Export Calendar
                            </button>
                        </div>
                    </div>
        `;

        scheduledItems.forEach((item) => {
            if (item.type === "break") {
                scheduleHTML += `
                    <article
                        class="schedule-item break-item"
                    >
                        <div class="schedule-time">
                            ${formatMinutesAsTime(
                                item.start
                            )}
                        </div>

                        <div class="schedule-details">
                            <h3>
                                ${escapeHTML(item.name)}
                            </h3>

                            <p>
                                ${item.duration} minutes ·
                                Ends at
                                ${formatMinutesAsTime(
                                    item.end
                                )}
                            </p>
                        </div>

                        <span
                            class="schedule-tag break-tag"
                        >
                            Break
                        </span>
                    </article>
                `;

                return;
            }

            const scheduleIndex = schedule.indexOf(item);
            const overdue = isScheduleTaskOverdue(item);
            const suggestion = overdue
                ? findSuggestedRescheduleSlot(scheduleIndex)
                : null;

            const warningClass = item.missesDeadline
                ? "deadline-warning-item"
                : "";
            const overdueClass = overdue
                ? "overdue-task"
                : "";
            const rescheduledClass = item.rescheduled
                ? "rescheduled-task"
                : "";
            const dayLabel = formatScheduleDayLabel(
                Number(item.dateOffset || 0)
            );
            const rescheduledText = item.rescheduled
                ? ` · Rescheduled ${dayLabel.toLowerCase()}`
                : Number(item.dateOffset || 0) > 0
                  ? ` · ${dayLabel}`
                  : "";
            const suggestionText = suggestion
                ? `${formatScheduleDayLabel(
                      suggestion.dateOffset
                  )} ${formatMinutesAsTime(
                      suggestion.start
                  )}–${formatMinutesAsTime(
                      suggestion.end
                  )}`
                : "No open slot is available inside this planning window.";
            const customDefaultStart =
                suggestion?.start ?? item.start;
            const customDefaultDay =
                suggestion?.dateOffset ?? 0;

            const deadlineText =
                item.deadline !== null
                    ? ` · Deadline ${formatMinutesAsTime(
                          item.deadline
                      )}`
                    : "";

            const warningHTML =
                item.missesDeadline
                    ? `
                        <p
                            class="deadline-warning-text"
                        >
                            This task is scheduled
                            after its deadline.
                        </p>
                    `
                    : "";

            scheduleHTML += `
                <article
                    class="schedule-item ${warningClass} ${overdueClass} ${rescheduledClass}"
                    data-schedule-index="${scheduleIndex}"
                >
                    <div class="schedule-time">
                        ${Number(item.dateOffset || 0) > 0
                            ? `<span class="schedule-day-label">${dayLabel}</span>`
                            : ""}
                        ${formatMinutesAsTime(
                            item.start
                        )}
                    </div>

                    <div class="schedule-details">
                        <h3>
                            ${escapeHTML(item.name)}
                        </h3>

                        <p>
                            ${item.duration} minutes ·
                            Ends at
                            ${formatMinutesAsTime(
                                item.end
                            )}
                            ${deadlineText}
                            ${rescheduledText}
                        </p>

                        ${warningHTML}
                    </div>

                    <div class="schedule-actions">
    <span
        class="schedule-tag ${item.priority}-priority"
    >
        ${capitalizeWord(item.priority)}
    </span>

    <button
    type="button"
    class="complete-task-button"
    data-task-name="${escapeHTML(item.name)}"
    data-task-id="${escapeHTML(getScheduleTaskId(item))}"
    data-planned-duration="${item.duration}"
    data-task-priority="${item.priority}"
    aria-pressed="false"
>
        Complete
    </button>
</div>

                    ${overdue
                        ? `
                            <div class="smart-reschedule-panel">
                                <div class="smart-reschedule-copy">
                                    <p class="smart-reschedule-label">
                                        MISSED TASK WINDOW
                                    </p>
                                    <p>
                                        This task was not marked complete by its planned end time.
                                        <strong>Suggested: ${suggestionText}</strong>
                                    </p>
                                </div>

                                <div class="smart-reschedule-actions">
                                    ${suggestion
                                        ? `
                                            <button
                                                type="button"
                                                class="smart-reschedule-button primary"
                                                data-reschedule-action="suggested"
                                                data-schedule-index="${scheduleIndex}"
                                            >
                                                Use suggestion
                                            </button>
                                        `
                                        : ""}

                                    <button
                                        type="button"
                                        class="smart-reschedule-button"
                                        data-reschedule-action="custom"
                                        data-schedule-index="${scheduleIndex}"
                                        aria-expanded="false"
                                    >
                                        Choose time
                                    </button>

                                    <button
                                        type="button"
                                        class="smart-reschedule-button"
                                        data-reschedule-action="tomorrow"
                                        data-schedule-index="${scheduleIndex}"
                                    >
                                        Move tomorrow
                                    </button>
                                </div>

                                <div
                                    class="smart-reschedule-editor"
                                    data-custom-time-editor
                                    hidden
                                >
                                    <label>
                                        Day
                                        <select class="smart-reschedule-day-select">
                                            <option value="0" ${customDefaultDay === 0 ? "selected" : ""}>
                                                Today
                                            </option>
                                            <option value="1" ${customDefaultDay === 1 ? "selected" : ""}>
                                                Tomorrow
                                            </option>
                                        </select>
                                    </label>

                                    <label>
                                        Start time
                                        <input
                                            type="time"
                                            class="smart-reschedule-time-input"
                                            value="${formatMinutesForTimeInput(customDefaultStart)}"
                                            step="300"
                                        >
                                    </label>

                                    <div class="smart-reschedule-editor-actions">
                                        <button
                                            type="button"
                                            class="smart-reschedule-button primary"
                                            data-reschedule-action="apply-custom"
                                            data-schedule-index="${scheduleIndex}"
                                        >
                                            Apply time
                                        </button>

                                        <button
                                            type="button"
                                            class="smart-reschedule-button"
                                            data-reschedule-action="cancel-custom"
                                            data-schedule-index="${scheduleIndex}"
                                        >
                                            Cancel
                                        </button>
                                    </div>

                                    <p
                                        class="smart-reschedule-inline-message"
                                        role="status"
                                        aria-live="polite"
                                    ></p>
                                </div>
                            </div>
                        `
                        : ""}
                </article>
            `;
        });

        scheduleHTML += `
                </div>
        `;

        if (unscheduledItems.length > 0) {
            scheduleHTML += `
                <div class="unscheduled-section">
                    <h3>
                        Could not fit into this
                        time period
                    </h3>

                    <ul>
            `;

            unscheduledItems.forEach(
                (item) => {
                    scheduleHTML += `
                        <li>
                            ${escapeHTML(
                                item.name
                            )}
                            —
                            ${item.duration}
                            minutes
                        </li>
                    `;
                }
            );

            scheduleHTML += `
                    </ul>

                    <p>
                        Extend your available time
                        or reduce some task durations.
                    </p>
                </div>
            `;
        }

        scheduleHTML += `
            </div>
        `;

        scheduleOutput.innerHTML =
            scheduleHTML;
            const completeButtons =
    scheduleOutput.querySelectorAll(
        ".complete-task-button"
    );

completeButtons.forEach((button) => {
    const taskId =
        button.dataset.taskId || "";

    const completed =
        isTaskCompleted(taskId);

    button.setAttribute(
        "aria-pressed",
        String(completed)
    );

    button.textContent =
        completed ? "Completed" : "Complete";

    button
        .closest(".schedule-item")
        ?.classList.toggle(
            "task-completed",
            completed
        );
});

updateScheduleProgress();
syncReminderButtonState();
lastOverdueSignature = getOverdueSignature();
    }

    /* ================= RESET OUTPUT ================= */

    function resetGeneratedOutput() {
        if (scheduleOutput) {
            scheduleOutput.innerHTML = `
                <div class="result-placeholder">
                    <div
                        class="result-icon"
                        aria-hidden="true"
                    >
                        ✨
                    </div>

                    <h2>
                        Your schedule will appear here
                    </h2>

                    <p>
                        Complete the form to begin
                        building your personalized
                        daily plan.
                    </p>
                </div>
            `;
        }

        if (analysisSection) {
            analysisSection.hidden = true;
        }

        lastOverdueSignature = "";
        clearPlannerMessage();
    }


    function invalidateGeneratedSchedule() {
        if (!latestGeneratedSchedule) {
            return;
        }

        // Do not restore saved form data here. This function runs while the
        // user is typing, so restoring would overwrite the value they just
        // entered and make every planner control appear unusable.
        clearTaskReminders(true);
        latestGeneratedSchedule = null;
        latestScheduleDate = null;
        latestStartMinutes = null;
        latestEndMinutes = null;
        latestBreaksEnabled = true;
        latestBreakDuration = 0;
        updateAssistantContext(null);
        resetGeneratedOutput();
    }

    /* ================= CLEAR ALL DATA ================= */

    function clearEntirePlanner() {
        const userConfirmed =
            window.confirm(
                "Clear all saved planner information and start again?"
            );

        if (!userConfirmed) {
            return;
        }

        clearPlannerData();
        void clearPlannerFromCloud().catch((error) => {
            console.error("Could not clear cloud planner:", error);
        });
        clearTaskReminders();

        window.clearTimeout(
            automaticSaveTimer
        );

        if (startTimeInput) {
            startTimeInput.value = "";
        }

        if (endTimeInput) {
            endTimeInput.value = "";
        }

        if (breakToggle) {
            breakToggle.checked = true;
        }

        if (breakDurationInput) {
            breakDurationInput.value =
                "10";
        }

        if (naturalTaskInput) {
            naturalTaskInput.value = "";
        }

        clearNaturalTaskMessage();

        taskList.innerHTML = "";

        createTaskItem();

        updateBreakSettings();
        updateRemoveButtons();

        resetGeneratedOutput();

        updateSaveStatus(
            "Saved planner cleared.",
            "is-saved"
        );
    }

    function getScheduleTaskId(item) {
    const baseDate =
        latestScheduleDate instanceof Date &&
        !Number.isNaN(latestScheduleDate.getTime())
            ? new Date(latestScheduleDate)
            : new Date();

    baseDate.setHours(0, 0, 0, 0);
    baseDate.setDate(
        baseDate.getDate() + Number(item.dateOffset || 0)
    );

    const dateKey = [
        baseDate.getFullYear(),
        String(baseDate.getMonth() + 1).padStart(2, "0"),
        String(baseDate.getDate()).padStart(2, "0")
    ].join("-");

    return [
        dateKey,
        Number(item.start || 0),
        Number(item.duration || 0),
        String(item.name || "").trim().toLowerCase()
    ].join("|");
}

function getCompletionStorageKey(taskId) {
    return `lifelens-completed-v2-${encodeURIComponent(taskId)}`;
}

function isTaskCompleted(taskId) {
    return (
        accountStorage.getItem(
            getCompletionStorageKey(taskId)
        ) === "true"
    );
}

const PLANNER_XP_STORAGE_KEY = "lifelens-planner-xp";
const COMPLETION_HISTORY_STORAGE_KEY = "lifelens-completion-history-v1";
const PLANNER_GENERATION_COUNT_KEY = "lifelens-planner-generation-count-v1";
const STREAK_ACTIVITY_STORAGE_KEY =
    "lifelens-streak-activity-v1";

function getTodayDateKey() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function getCompletionDateStorageKey(taskId) {
    return `${getCompletionStorageKey(taskId)}-date`;
}

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

function saveCompletionHistory(history) {
    accountStorage.setItem(
        COMPLETION_HISTORY_STORAGE_KEY,
        JSON.stringify(history)
    );

    window.dispatchEvent(
        new CustomEvent("lifelens-progress-updated")
    );
}

function recordCompletionTimestamp(taskId) {
    const history = loadCompletionHistory();

    history.push({
        taskId,
        completedAt: new Date().toISOString()
    });

    saveCompletionHistory(history);
}

function removeLatestCompletionTimestamp(taskId) {
    const history = loadCompletionHistory();

    for (let index = history.length - 1; index >= 0; index -= 1) {
        if (history[index]?.taskId === taskId) {
            history.splice(index, 1);
            break;
        }
    }

    saveCompletionHistory(history);
}

function incrementPlannerGenerationCount() {
    const currentCount = Math.max(
        0,
        Number(accountStorage.getItem(PLANNER_GENERATION_COUNT_KEY)) || 0
    );

    accountStorage.setItem(
        PLANNER_GENERATION_COUNT_KEY,
        String(currentCount + 1)
    );

    window.dispatchEvent(
        new CustomEvent("lifelens-progress-updated")
    );
}

function loadStreakActivity() {
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

function saveStreakActivity(activity) {
    accountStorage.setItem(
        STREAK_ACTIVITY_STORAGE_KEY,
        JSON.stringify(activity)
    );

    window.dispatchEvent(
        new CustomEvent("lifelens-streak-updated")
    );
}

function changeStreakActivity(dateKey, amount) {
    if (!dateKey || !Number.isFinite(amount)) {
        return;
    }

    const activity = loadStreakActivity();
    const currentCount = Math.max(
        0,
        Number(activity[dateKey]) || 0
    );
    const nextCount = Math.max(
        0,
        currentCount + amount
    );

    if (nextCount > 0) {
        activity[dateKey] = nextCount;
    } else {
        delete activity[dateKey];
    }

    saveStreakActivity(activity);
}

function getPlannerXP() {
    const storedXP = Number(
        accountStorage.getItem(PLANNER_XP_STORAGE_KEY)
    );

    return Number.isFinite(storedXP)
        ? Math.max(0, storedXP)
        : 0;
}

function showXPPopup(amount) {
    const existingPopup =
        document.querySelector(".planner-xp-popup");

    existingPopup?.remove();

    const popup = document.createElement("div");
    popup.className = "planner-xp-popup";
    popup.setAttribute("role", "status");
    popup.textContent = amount >= 0
        ? `+${amount} XP ✨ Nice work!`
        : `${amount} XP`;

    Object.assign(popup.style, {
        position: "fixed",
        right: "24px",
        bottom: "24px",
        zIndex: "9999",
        padding: "12px 18px",
        borderRadius: "999px",
        background: amount >= 0 ? "#16a34a" : "#dc2626",
        color: "#ffffff",
        fontWeight: "800",
        boxShadow: "0 12px 30px rgba(0, 0, 0, 0.25)",
        pointerEvents: "none"
    });

    document.body.appendChild(popup);

    window.setTimeout(() => {
        popup.remove();
    }, 1800);
}

function changePlannerXP(amount) {
    const nextXP = Math.max(
        0,
        getPlannerXP() + amount
    );

    accountStorage.setItem(
        PLANNER_XP_STORAGE_KEY,
        String(nextXP)
    );

    showXPPopup(amount);

    // Lets an open dashboard tab refresh its XP immediately.
    window.dispatchEvent(
        new CustomEvent("lifelens-xp-updated", {
            detail: { plannerXP: nextXP }
        })
    );
}

function saveTaskCompletion(taskId, completed) {
    const storageKey =
        getCompletionStorageKey(taskId);

    const wasCompleted =
        accountStorage.getItem(storageKey) === "true";

    if (completed) {
        accountStorage.setItem(storageKey, "true");
    } else {
        accountStorage.removeItem(storageKey);
    }

    const completionDateKey =
        getCompletionDateStorageKey(taskId);

    if (completed && !wasCompleted) {
        const completedOn = getTodayDateKey();

        accountStorage.setItem(
            completionDateKey,
            completedOn
        );

        changeStreakActivity(completedOn, 1);
        recordCompletionTimestamp(taskId);
        changePlannerXP(10);
    } else if (!completed && wasCompleted) {
        const completedOn =
            accountStorage.getItem(completionDateKey);

        if (completedOn) {
            changeStreakActivity(completedOn, -1);
        }

        accountStorage.removeItem(completionDateKey);
        removeLatestCompletionTimestamp(taskId);
        changePlannerXP(-10);
    }
}

function updateScheduleProgress() {
    const taskButtons =
        scheduleOutput?.querySelectorAll(
            ".complete-task-button"
        );

    const progressText =
        scheduleOutput?.querySelector(
            "#progress-text"
        );

    const progressFill =
        scheduleOutput?.querySelector(
            "#progress-fill"
        );

    const progressTrack =
        scheduleOutput?.querySelector(
            "#progress-track"
        );

    if (
        !taskButtons ||
        !progressText ||
        !progressFill ||
        !progressTrack
    ) {
        return;
    }

    const totalTasks = taskButtons.length;

    const completedTasks = Array.from(
        taskButtons
    ).filter(
        (button) =>
            button.getAttribute("aria-pressed") ===
            "true"
    ).length;

    const percentage =
        totalTasks > 0
            ? Math.round(
                  (completedTasks / totalTasks) * 100
              )
            : 0;

    progressText.textContent =
        `${completedTasks} of ${totalTasks} completed`;

    progressFill.style.width =
        `${percentage}%`;

    progressTrack.setAttribute(
        "aria-valuenow",
        String(percentage)
    );
}

function padNumber(number) {
    return String(number).padStart(2, "0");
}

function formatCalendarDate(date) {
    return [
        date.getFullYear(),
        padNumber(date.getMonth() + 1),
        padNumber(date.getDate())
    ].join("");
}

function formatCalendarDateTime(
    baseDate,
    minutesFromMidnight
) {
    const date = new Date(baseDate);

    const hours =
        Math.floor(minutesFromMidnight / 60);

    const minutes =
        minutesFromMidnight % 60;

    date.setHours(hours, minutes, 0, 0);

    return (
        formatCalendarDate(date) +
        "T" +
        padNumber(date.getHours()) +
        padNumber(date.getMinutes()) +
        "00"
    );
}

function escapeCalendarText(text) {
    return String(text)
        .replace(/\\/g, "\\\\")
        .replace(/\n/g, "\\n")
        .replace(/,/g, "\\,")
        .replace(/;/g, "\\;");
}

function createCalendarEvent(
    item,
    scheduleDate
) {
    const itemDate = new Date(scheduleDate);
    itemDate.setDate(
        itemDate.getDate() +
        Number(item.dateOffset || 0)
    );

    const startDateTime =
        formatCalendarDateTime(
            itemDate,
            item.start
        );

    const endDateTime =
        formatCalendarDateTime(
            itemDate,
            item.end
        );

    const eventTitle =
        item.type === "break"
            ? "LifeLens Break"
            : item.name;

    const description =
        item.type === "break"
            ? `${item.duration}-minute break generated by LifeLens AI.`
            : [
                  `Priority: ${capitalizeWord(
                      item.priority
                  )}`,
                  `Duration: ${item.duration} minutes`,
                  item.deadline !== null
                      ? `Deadline: ${formatMinutesAsTime(
                            item.deadline
                        )}`
                      : "",
                  "Generated by LifeLens AI."
              ]
                  .filter(Boolean)
                  .join("\\n");

    const uniqueIdentifier =
        `${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}@lifelens-ai`;

    return [
        "BEGIN:VEVENT",
        `UID:${uniqueIdentifier}`,
        `DTSTAMP:${formatCalendarDateTime(
            new Date(),
            new Date().getHours() * 60 +
                new Date().getMinutes()
        )}`,
        `DTSTART:${startDateTime}`,
        `DTEND:${endDateTime}`,
        `SUMMARY:${escapeCalendarText(
            eventTitle
        )}`,
        `DESCRIPTION:${escapeCalendarText(
            description
        )}`,
        "END:VEVENT"
    ].join("\r\n");
}

function exportScheduleToCalendar(
    schedule,
    scheduleDate
) {
    const calendarItems = schedule.filter(
        (item) =>
            item.type === "task" ||
            item.type === "break"
    );

    if (calendarItems.length === 0) {
        setPlannerMessage(
            "There are no scheduled activities to export."
        );

        return;
    }

    const events = calendarItems.map((item) =>
        createCalendarEvent(
            item,
            scheduleDate
        )
    );

    const calendarContent = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//LifeLens AI//Daily Planner//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        ...events,
        "END:VCALENDAR"
    ].join("\r\n");

    const calendarBlob = new Blob(
        [calendarContent],
        {
            type:
                "text/calendar;charset=utf-8"
        }
    );

    const calendarURL =
        URL.createObjectURL(calendarBlob);

    const downloadLink =
        document.createElement("a");

    const dateLabel =
        formatCalendarDate(scheduleDate);

    downloadLink.href = calendarURL;

    downloadLink.download =
        `lifelens-schedule-${dateLabel}.ics`;

    document.body.appendChild(
        downloadLink
    );

    downloadLink.click();
    downloadLink.remove();

    URL.revokeObjectURL(calendarURL);

    setPlannerMessage(
        "Calendar file exported successfully.",
        "success"
    );
}
function showLearningSuggestion(
    taskItem
) {
    const nameInput =
        taskItem.querySelector(
            ".task-name"
        );

    const durationSelect =
        taskItem.querySelector(
            ".task-duration"
        );

    const suggestionElement =
        taskItem.querySelector(
            ".learning-suggestion"
        );

    if (
        !nameInput ||
        !durationSelect ||
        !suggestionElement
    ) {
        return;
    }

    const taskName =
        nameInput.value.trim();

    const suggestion =
        getDurationSuggestion(taskName);

    if (!suggestion) {
        suggestionElement.hidden = true;
        suggestionElement.textContent = "";
        return;
    }

    suggestionElement.hidden = false;

    suggestionElement.textContent =
        `LifeLens learned from ${
            suggestion.sampleSize
        } similar task${
            suggestion.sampleSize === 1
                ? ""
                : "s"
        }. Suggested duration: ${
            suggestion.averageMinutes
        } minutes.`;

    const closestDuration = Math.min(
        720,
        Math.max(
            5,
            Math.round(suggestion.averageMinutes / 5) * 5
        )
    );

    /*
        Only automatically select the suggestion
        when the user has not already chosen a duration.
    */
    if (!durationSelect.value) {
        durationSelect.value =
            String(closestDuration);
    }
}
        /* ================= ADD TASK BUTTON ================= */
if (scheduleOutput) {
    scheduleOutput.addEventListener(
        "click",
        (event) => {
            const completeButton =
                event.target.closest(
                    ".complete-task-button"
                );

            if (!completeButton) {
                return;
            }

            const taskName =
                completeButton.dataset.taskName || "";

            const taskId =
                completeButton.dataset.taskId || "";

            const currentlyCompleted =
                completeButton.getAttribute(
                    "aria-pressed"
                ) === "true";

            const newCompletedState =
                !currentlyCompleted;

            completeButton.setAttribute(
                "aria-pressed",
                String(newCompletedState)
            );

            completeButton.textContent =
                newCompletedState
                    ? "Completed"
                    : "Complete";

            completeButton
                .closest(".schedule-item")
                ?.classList.toggle(
                    "task-completed",
                    newCompletedState
                );

            saveTaskCompletion(
    taskId,
    newCompletedState
);

if (newCompletedState) {
    const plannedDuration = Number(
        completeButton.dataset
            .plannedDuration || 0
    );

    const priority =
        completeButton.dataset
            .taskPriority || "medium";

    const actualDurationInput =
        window.prompt(
            `How many minutes did "${taskName}" actually take?`,
            String(plannedDuration)
        );

    if (actualDurationInput !== null) {
        const actualDuration = Number(
            actualDurationInput
        );

        if (
            Number.isFinite(actualDuration) &&
            actualDuration > 0 &&
            actualDuration <= 1440
        ) {
            recordTaskResult({
                name: taskName,
                plannedDuration,
                actualDuration,
                priority
            });

            setPlannerMessage(
                `LifeLens learned from "${taskName}". Future duration suggestions will become more accurate.`,
                "success"
            );
        } else {
            setPlannerMessage(
                "The actual duration was not saved because it was invalid."
            );
        }
    }
}

updateScheduleProgress();
saveCurrentPlanner();
refreshOverdueTasks(true);
        }
    );
}
    if (addTaskButton) {
        addTaskButton.addEventListener("click", () => {
            const newTask = createTaskItem();

            newTask
                .querySelector(".task-name")
                ?.focus();

            saveCurrentPlanner();
        });
    }
if (scheduleOutput) {
    scheduleOutput.addEventListener(
        "click",
        (event) => {
            const rescheduleButton =
                event.target.closest(
                    "[data-reschedule-action]"
                );

            if (rescheduleButton) {
                const scheduleIndex = Number(
                    rescheduleButton.dataset.scheduleIndex
                );
                const action =
                    rescheduleButton.dataset.rescheduleAction;

                if (!Number.isInteger(scheduleIndex)) {
                    setPlannerMessage(
                        "LifeLens could not identify that task."
                    );
                    return;
                }

                if (action === "suggested") {
                    rescheduleTaskToSlot(
                        scheduleIndex,
                        findSuggestedRescheduleSlot(
                            scheduleIndex
                        ),
                        "suggested"
                    );
                } else if (action === "custom") {
                    openCustomRescheduleEditor(
                        scheduleIndex,
                        rescheduleButton
                    );
                } else if (action === "apply-custom") {
                    applyCustomRescheduleTime(
                        scheduleIndex,
                        rescheduleButton
                    );
                } else if (action === "cancel-custom") {
                    closeCustomRescheduleEditor(
                        rescheduleButton
                    );
                } else if (action === "tomorrow") {
                    moveTaskToTomorrow(scheduleIndex);
                }

                return;
            }

            const reminderButton =
                event.target.closest(
                    "#enable-reminders-button"
                );

            if (reminderButton) {
                if (remindersEnabled) {
                    clearTaskReminders();
                    reminderButton.classList.remove(
                        "reminders-active"
                    );
                    reminderButton.textContent =
                        "🔔 Enable Reminders";
                    reminderButton.setAttribute(
                        "aria-pressed",
                        "false"
                    );
                    saveCurrentPlanner();
                    setPlannerMessage(
                        "Task reminders have been disabled.",
                        "success"
                    );
                } else {
                    enableTaskReminders(
                        reminderButton
                    );
                }

                return;
            }

            const exportButton =
                event.target.closest(
                    "#export-calendar-button"
                );

            if (!exportButton) {
                return;
            }

            if (
                !latestGeneratedSchedule ||
                !latestScheduleDate
            ) {
                setPlannerMessage(
                    "Generate a schedule before exporting it."
                );

                return;
            }

            exportScheduleToCalendar(
                latestGeneratedSchedule,
                latestScheduleDate
            );
        }
    );
}
    /* ================= REMOVE TASK BUTTONS ================= */
taskList.addEventListener(
    "focusout",
    (event) => {
        const taskNameInput =
            event.target.closest(
                ".task-name"
            );

        if (!taskNameInput) {
            return;
        }

        const taskItem =
            taskNameInput.closest(
                ".task-item"
            );

        if (!taskItem) {
            return;
        }

        showLearningSuggestion(
            taskItem
        );
    }
);
    taskList.addEventListener("click", (event) => {
        const removeButton =
            event.target.closest(
                ".remove-task-button"
            );

        if (!removeButton) {
            return;
        }

        const taskItem =
            removeButton.closest(".task-item");

        if (!taskItem) {
            return;
        }

        const allTaskItems =
            taskList.querySelectorAll(
                ".task-item"
            );

        if (allTaskItems.length === 1) {
            clearTaskItem(taskItem);
            saveCurrentPlanner();
            return;
        }

        taskItem.remove();

        updateRemoveButtons();
        saveCurrentPlanner();
    });

    /* ================= BREAK TOGGLE ================= */

    if (breakToggle) {
        breakToggle.addEventListener(
            "change",
            () => {
                updateBreakSettings();
                scheduleAutomaticSave();
            }
        );
    }

    /* ================= NATURAL LANGUAGE INPUT ================= */

    if (
        parseTasksButton &&
        naturalTaskInput &&
        naturalTaskMessage
    ) {
        parseTasksButton.addEventListener(
            "click",
            () => {
                const inputText =
                    naturalTaskInput.value.trim();

                clearNaturalTaskMessage();

                if (!inputText) {
                    setNaturalTaskMessage(
                        "Describe at least one task first."
                    );

                    naturalTaskInput.focus();
                    return;
                }

                const parsedTasks =
                    parseNaturalTasks(inputText);

                if (parsedTasks.length === 0) {
                    setNaturalTaskMessage(
                        "No clear tasks were detected. Separate tasks with commas."
                    );

                    return;
                }

                const firstTaskItem =
                    taskList.querySelector(
                        ".task-item"
                    );

                const firstTaskName =
                    firstTaskItem
                        ?.querySelector(".task-name")
                        ?.value.trim() || "";

                const onlyOneTask =
                    taskList.querySelectorAll(
                        ".task-item"
                    ).length === 1;

                if (
                    firstTaskItem &&
                    firstTaskName === "" &&
                    onlyOneTask
                ) {
                    firstTaskItem.remove();
                }

                parsedTasks.forEach((task) => {
    const newTaskItem =
        createTaskItem(task);

    showLearningSuggestion(
        newTaskItem
    );
});

                naturalTaskInput.value = "";

                setNaturalTaskMessage(
                    `${parsedTasks.length} task${
                        parsedTasks.length === 1
                            ? ""
                            : "s"
                    } added successfully.`,
                    "success"
                );

                updateRemoveButtons();
                saveCurrentPlanner();
            }
        );
    }

    /* ================= AUTOMATIC SAVE ================= */

    plannerForm.addEventListener(
        "input",
        () => {
            invalidateGeneratedSchedule();
            scheduleAutomaticSave();
        }
    );

    plannerForm.addEventListener(
        "change",
        () => {
            invalidateGeneratedSchedule();
            scheduleAutomaticSave();
        }
    );

    /* ================= GENERATE SCHEDULE ================= */

    plannerForm.addEventListener(
        "submit",
        (event) => {
            event.preventDefault();

            clearPlannerMessage();

            const startTime =
                startTimeInput?.value || "";

            const endTime =
                endTimeInput?.value || "";

            if (!startTime || !endTime) {
                setPlannerMessage(
                    "Please enter your available starting and ending times."
                );

                return;
            }

            const startMinutes =
                convertTimeToMinutes(startTime);

            const endMinutes =
                convertTimeToMinutes(endTime);

            if (startMinutes >= endMinutes) {
                setPlannerMessage(
                    "Your ending time must be later than your starting time."
                );

                return;
            }

            const taskResult =
                collectTasks();

            if (!taskResult.success) {
    setPlannerMessage(
        taskResult.message ||
        "Please complete every task."
    );

    return;
}

            const tasks =
                sortTasks(taskResult.tasks);

            const breaksEnabled =
                breakToggle?.checked ?? true;

            let breakDuration =
                Number(
                    breakDurationInput?.value ||
                        10
                );

            if (breaksEnabled) {
                const invalidBreakDuration =
                    !Number.isInteger(
                        breakDuration
                    ) ||
                    breakDuration < 5 ||
                    breakDuration > 60;

                if (invalidBreakDuration) {
                    setPlannerMessage(
                        "Break duration must be between 5 and 60 minutes."
                    );

                    return;
                }
            } else {
                breakDuration = 0;
            }

            const schedule =
                createSchedule(
                    tasks,
                    startMinutes,
                    endMinutes,
                    breaksEnabled,
                    breakDuration
                );
clearTaskReminders();
            latestGeneratedSchedule = schedule;
            latestScheduleDate = new Date();
            latestStartMinutes = startMinutes;
            latestEndMinutes = endMinutes;
            latestBreaksEnabled = breaksEnabled;
            latestBreakDuration = breakDuration;
            lastOverdueSignature = "";
            displaySchedule(
                schedule,
                startMinutes,
                endMinutes
            );

           analyzeSchedule({
    schedule,
    tasks,
    startMinutes,
    endMinutes,
    breaksEnabled
});
updateFocusPrediction({
    schedule,
    startMinutes,
    endMinutes
});
updateAssistantContext({
    schedule,
    tasks,
    startMinutes,
    endMinutes,
    breaksEnabled,
    breakDuration
});

            setPlannerMessage(
                "Your schedule has been generated successfully.",
                "success"
            );

            incrementPlannerGenerationCount();
            saveCurrentPlanner();
        }
    );

    /* ================= CLEAR PLANNER BUTTON ================= */

    if (clearPlannerButton) {
        clearPlannerButton.addEventListener(
            "click",
            clearEntirePlanner
        );
    }

        /* ================= INITIALIZATION ================= */

    const restoredGeneratedSchedule =
        restoreSavedPlanner();

    clearTaskReminders();

    if (!restoredGeneratedSchedule) {
        latestGeneratedSchedule = null;
        latestScheduleDate = null;
        latestStartMinutes = null;
        latestEndMinutes = null;
        resetGeneratedOutput();
    }

    async function initializeCloudPlannerSync() {
        try {
            updateSaveStatus(
                navigator.onLine
                    ? "Checking cloud planner..."
                    : "Offline. Using saved planner.",
                "is-saving"
            );

            if (!navigator.onLine) {
                return;
            }

            await flushQueuedPlanner();

            const cloudPlanner = await loadPlannerFromCloud();
            const localPlanner = loadPlannerData();
            const cloudTime = Date.parse(
                cloudPlanner?.cloudUpdatedAt || cloudPlanner?.savedAt || ""
            ) || 0;
            const localTime = Date.parse(localPlanner?.savedAt || "") || 0;

            if (cloudPlanner && cloudTime > localTime) {
                savePlannerData(cloudPlanner);
                restoreSavedPlanner(cloudPlanner);
                updateSaveStatus(
                    "Cloud planner restored.",
                    "is-saved"
                );
                return;
            }

            if (localPlanner && (!cloudPlanner || localTime >= cloudTime)) {
                await savePlannerToCloud(localPlanner);
                updateSaveStatus(
                    "Planner synced with cloud.",
                    "is-saved"
                );
                return;
            }

            updateSaveStatus(
                "Planner ready.",
                "is-saved"
            );
        } catch (error) {
            console.error("Could not initialize planner cloud sync:", error);
            updateSaveStatus(
                "Using local planner. Cloud sync unavailable.",
                "is-saving"
            );
        }
    }

    void initializeCloudPlannerSync();

    window.addEventListener("online", () => {
        void initializeCloudPlannerSync();
    });

    window.addEventListener("offline", () => {
        updateSaveStatus(
            "Offline. Changes will sync later.",
            "is-saving"
        );
    });

    overdueCheckTimer = window.setInterval(
        refreshOverdueTasks,
        15000
    );

    window.addEventListener("beforeunload", () => {
        window.clearInterval(overdueCheckTimer);
    });

    window.addEventListener("pageshow", (event) => {
        if (!event.persisted) {
            return;
        }

        clearTaskReminders();
        latestGeneratedSchedule = null;
        latestScheduleDate = null;
        latestStartMinutes = null;
        latestEndMinutes = null;
        updateAssistantContext(null);
        resetGeneratedOutput();
    });

    updateBreakSettings();
    updateRemoveButtons();


    if (
        taskList.querySelectorAll(".task-item")
            .length === 0
    ) {
        createTaskItem();
    }

    if (analysisSection) {
        analysisSection.hidden = true;
    }
}