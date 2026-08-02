"use strict";

require("dotenv").config();

const express = require("express");
const path = require("path");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.OPENROUTER_API_KEY) {
    console.warn(
        "OPENROUTER_API_KEY is not configured. AI requests will return a setup error."
    );
}

const openrouter = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
        "HTTP-Referer": process.env.URL || "http://localhost:3000",
        "X-Title": "LifeLens AI"
    }
});

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/test", (req, res) => {
    res.json({
        success: true,
        message: "LifeLens backend is working!"
    });
});

function buildSystemPrompt(context) {
    const privateContext = JSON.stringify(context || {});

    return `
You are LifeLens Coach, a friendly productivity and study assistant.

The data inside <private_lifelens_context> is private application context.
Use it silently to personalize your answer. Never quote, dump, summarize,
inspect, or expose the raw context, JSON keys, field names, calculations,
internal notes, or your reasoning process. Never write phrases such as
"we have", "the context says", "not sure", "we trust the data", or
step-by-step analysis about how you interpreted the data.

Return only a polished final answer for the user. Do not include hidden
reasoning, scratch work, chain-of-thought, internal analysis, or metadata.
Use natural language and readable Markdown. Prefer concise answers.

You can:
- explain the user's daily schedule;
- recommend which task to do next;
- discuss workload, deadlines, and breaks;
- explain XP, ranks, streaks, achievements, and dashboard progress;
- give personalized daily briefings using today and recent analytics;
- identify subject distribution, peak productivity periods, and planning accuracy;
- use planned-versus-actual timing history to recommend realistic durations;
- give one practical next action when the user asks for coaching.

For a daily briefing or progress review:
- greet the user by display name when available;
- use the headings Today, Weekly Pattern, Progress, and Next Action;
- use only evidence in the private context;
- say briefly when there is insufficient data;
- do not confuse scheduled tasks with completed task records;
- avoid excessive workloads.

When the user requests a suggested schedule, daily plan, or planner draft,
include exactly one fenced code block labelled lifelens-plan containing valid
JSON with this shape:
{
  "startTime": "09:00",
  "endTime": "17:00",
  "breaksEnabled": true,
  "breakDuration": 10,
  "tasks": [
    {
      "name": "Task name",
      "duration": 45,
      "priority": "high",
      "deadline": "",
      "recurrence": "once",
      "recurrenceDays": []
    }
  ]
}
Use durations in 5-minute increments from 5 to 720 minutes. Do not put
comments inside the JSON. Do not claim the draft was applied. Tell the user
to click Review in planner, inspect it, and manually click Generate Schedule.

Do not claim that you changed, deleted, added, or completed a task unless the
LifeLens application explicitly confirms it.

<private_lifelens_context>
${privateContext}
</private_lifelens_context>
    `.trim();
}

function removeProviderMetadata(value) {
    return String(value || "")
        .replace(/(?:^|\n)\s*User\s+Safety\s*:\s*(?:safe|unsafe)\s*/gi, "\n")
        .replace(/(?:^|\n)\s*Response\s+Safety\s*:\s*(?:safe|unsafe)\s*/gi, "\n")
        .replace(/^\s*(?:FINAL ANSWER|FINAL RESPONSE)\s*:\s*/i, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function parseStructuredReply(content) {
    const raw = String(content || "").trim();

    if (!raw) {
        return "";
    }

    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.reply === "string") {
            return removeProviderMetadata(parsed.reply);
        }
    } catch {
        // Fall back to plain text for providers that ignore response_format.
    }

    const finalMarker = raw.match(/(?:FINAL ANSWER|FINAL RESPONSE)\s*:\s*([\s\S]*)/i);
    return removeProviderMetadata(finalMarker ? finalMarker[1] : raw);
}

function looksLikeInternalLeak(reply) {
    const value = String(reply || "");
    const leakPatterns = [
        /\bCURRENT LIFELENS CONTEXT\b/i,
        /\bprivate_lifelens_context\b/i,
        /\bdailyReviews\b/i,
        /\btimingHistory\b/i,
        /\bsubjectMinutes\b/i,
        /\bcompletedTasks\s*:/i,
        /\boverallAveragePlannedMinutes\b/i,
        /\bwe trust the data\b/i,
        /\bnot sure\.?\s+but\b/i,
        /\bthe context says\b/i,
        /\bXP\s*:\s*\d+\s*,\s*level\s*:/i,
        /\bplanned\s*:\s*\d+\s*,\s*actual\s*:/i,
        /\bSo today:\s*planned total minutes\b/i
    ];

    return leakPatterns.some((pattern) => pattern.test(value));
}

function isProbablyTruncated(reply, finishReason) {
    if (finishReason === "length") {
        return true;
    }

    const value = String(reply || "").trim();
    if (!value) {
        return true;
    }

    if (/[.!?\]})`*_>]$/.test(value)) {
        return false;
    }

    const lastLine = value.split("\n").pop()?.trim() || "";
    return lastLine.length > 0 && lastLine.length < 12;
}

const TRANSIENT_AI_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const FREE_MODEL_CACHE_MS = 10 * 60 * 1000;
const MODEL_COOLDOWN_MS = 60 * 1000;
const MAX_RETRY_DELAY_MS = 8000;
const REQUEST_TIMEOUT_MS = 45000;

let freeModelCache = {
    expiresAt: 0,
    models: []
};

const modelCooldowns = new Map();

function sleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function getConfiguredModels() {
    return String(process.env.OPENROUTER_MODELS || "")
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean);
}

function isModelCoolingDown(model) {
    const until = Number(modelCooldowns.get(model) || 0);

    if (until <= Date.now()) {
        modelCooldowns.delete(model);
        return false;
    }

    return true;
}

function coolDownModels(models, duration = MODEL_COOLDOWN_MS) {
    const until = Date.now() + Math.max(1000, duration);
    models.forEach((model) => modelCooldowns.set(model, until));
}

async function discoverFreeModels() {
    if (
        freeModelCache.models.length > 0 &&
        Date.now() < freeModelCache.expiresAt
    ) {
        return freeModelCache.models;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch("https://openrouter.ai/api/v1/models", {
            signal: controller.signal,
            headers: {
                Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "HTTP-Referer": process.env.URL || "http://localhost:3000",
                "X-Title": "LifeLens AI"
            }
        }).finally(() => clearTimeout(timeout));

        if (!response.ok) {
            throw new Error(`Model discovery failed with ${response.status}.`);
        }

        const payload = await response.json();
        const discovered = Array.isArray(payload?.data)
            ? payload.data
                .filter((model) => {
                    const promptPrice = Number(model?.pricing?.prompt);
                    const completionPrice = Number(model?.pricing?.completion);
                    const outputModalities = model?.architecture?.output_modalities;
                    const supportsText =
                        !Array.isArray(outputModalities) ||
                        outputModalities.includes("text");

                    return (
                        typeof model?.id === "string" &&
                        promptPrice === 0 &&
                        completionPrice === 0 &&
                        supportsText
                    );
                })
                .sort((first, second) => {
                    const firstContext = Number(first?.context_length || 0);
                    const secondContext = Number(second?.context_length || 0);
                    return secondContext - firstContext;
                })
                .map((model) => model.id)
                .slice(0, 12)
            : [];

        freeModelCache = {
            expiresAt: Date.now() + FREE_MODEL_CACHE_MS,
            models: discovered
        };

        return discovered;
    } catch (error) {
        console.warn(
            "Could not discover OpenRouter free models:",
            error?.message || error
        );
        return [];
    }
}

async function getModelCandidates() {
    const configuredModels = getConfiguredModels();

    const defaultModels = [
        "nvidia/nemotron-3-super-120b-a12b:free",
        "openrouter/free"
    ];

    const candidates = [
        ...new Set([
            ...configuredModels,
            ...defaultModels
        ])
    ];

    const healthyModels = candidates.filter(
        (model) => !isModelCoolingDown(model)
    );

    // OpenRouter currently accepts no more than 3 fallback models.
    return (healthyModels.length > 0 ? healthyModels : candidates).slice(0, 3);
}

function parseRetryAfter(response) {
    const raw = response.headers.get("retry-after");
    const seconds = Number(raw);

    if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    }

    if (raw) {
        const target = Date.parse(raw);
        if (Number.isFinite(target)) {
            return Math.min(
                Math.max(0, target - Date.now()),
                MAX_RETRY_DELAY_MS
            );
        }
    }

    return 900;
}

async function readOpenRouterError(response) {
    try {
        const payload = await response.json();
        return String(
            payload?.error?.message ||
            payload?.message ||
            `OpenRouter request failed with ${response.status}.`
        );
    } catch {
        return `OpenRouter request failed with ${response.status}.`;
    }
}

async function createCoachCompletion({
    systemPrompt,
    history,
    message,
    repair = false,
    models,
    useStructuredOutput = true
}) {
    const repairInstruction = repair
        ? "\n\nIMPORTANT: Return a complete, polished final answer only. Do not expose raw context or reasoning. Keep it under 350 words."
        : "";

    const body = {
         models: models.slice(0, 3),
        messages: [
            {
                role: "system",
                content: systemPrompt + repairInstruction
            },
            ...history,
            {
                role: "user",
                content: message
            }
        ],
        reasoning: {
            exclude: true
        },
        provider: {
            allow_fallbacks: true,
            sort: {
                by: "throughput",
                partition: "none"
            }
        },
        max_tokens: repair ? 1800 : 2400,
        temperature: repair ? 0.25 : 0.55,
        stream: false
    };

    if (useStructuredOutput) {
        body.response_format = {
            type: "json_schema",
            json_schema: {
                name: "lifelens_coach_response",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        reply: {
                            type: "string",
                            description: "Only the polished user-facing Markdown answer."
                        }
                    },
                    required: ["reply"],
                    additionalProperties: false
                }
            }
        };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                method: "POST",
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": process.env.URL || "http://localhost:3000",
                    "X-Title": "LifeLens AI"
                },
                body: JSON.stringify(body)
            }
        );

        if (!response.ok) {
            const error = new Error(await readOpenRouterError(response));
            error.status = response.status;
            error.retryAfterMs = parseRetryAfter(response);
            throw error;
        }

        return response.json();
    } catch (error) {
        if (error?.name === "AbortError") {
            const timeoutError = new Error("OpenRouter request timed out.");
            timeoutError.status = 408;
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function requestWithModelFallback({
    systemPrompt,
    history,
    message,
    repair = false
}) {
    const models = await getModelCandidates();

    if (models.length === 0) {
        const error = new Error("No free OpenRouter models are currently available.");
        error.status = 503;
        throw error;
    }

    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            try {
                const completion = await createCoachCompletion({
                    systemPrompt,
                    history,
                    message,
                    repair,
                    models,
                    useStructuredOutput: true
                });

                return {
                    completion,
                    model: completion?.model || models[0]
                };
            } catch (structuredError) {
                const status = Number(structuredError?.status || 0);
                const unsupportedStructuredOutput =
                    status === 400 &&
                    /(response_format|json_schema|structured)/i.test(
                        String(structuredError?.message || "")
                    );

                if (!unsupportedStructuredOutput) {
                    throw structuredError;
                }

                const completion = await createCoachCompletion({
                    systemPrompt,
                    history,
                    message,
                    repair,
                    models,
                    useStructuredOutput: false
                });

                return {
                    completion,
                    model: completion?.model || models[0]
                };
            }
        } catch (error) {
            lastError = error;
            const status = Number(error?.status || 0);
            const isTransient = TRANSIENT_AI_STATUSES.has(status);

            if (!isTransient) {
                throw error;
            }

            if (attempt === 0) {
                await sleep(
                    Math.min(
                        Number(error?.retryAfterMs || 900),
                        MAX_RETRY_DELAY_MS
                    )
                );
                continue;
            }
        }
    }

    coolDownModels(
        models,
        Number(lastError?.retryAfterMs || MODEL_COOLDOWN_MS)
    );

    const finalError = new Error(
        "All available free AI models are temporarily busy."
    );
    finalError.status = Number(lastError?.status || 503);
    throw finalError;
}

app.post("/api/chat", async (req, res) => {
    try {
        if (!process.env.OPENROUTER_API_KEY) {
            return res.status(503).json({
                error: "OPENROUTER_API_KEY is not configured on the host.",
                code: "AI_NOT_CONFIGURED"
            });
        }

        const message =
            typeof req.body.message === "string"
                ? req.body.message.trim()
                : "";

        const context =
            req.body.context &&
            typeof req.body.context === "object"
                ? req.body.context
                : {};

        const history =
            Array.isArray(req.body.history)
                ? req.body.history.slice(-10)
                : [];

        if (!message) {
            return res.status(400).json({
                error: "Please enter a message."
            });
        }

        if (message.length > 2000) {
            return res.status(400).json({
                error: "Your message is too long."
            });
        }

        const safeHistory = history
            .filter((entry) => {
                return (
                    entry &&
                    ["user", "assistant"].includes(entry.role) &&
                    typeof entry.content === "string"
                );
            })
            .map((entry) => ({
                role: entry.role,
                content: entry.content.slice(0, 2000)
            }));

        const systemPrompt = buildSystemPrompt(context);
        let result = await requestWithModelFallback({
            systemPrompt,
            history: safeHistory,
            message
        });

        let completion = result.completion;
        let usedModel = result.model;
        let choice = completion.choices?.[0];
        let reply = parseStructuredReply(choice?.message?.content);

        if (
            !reply ||
            looksLikeInternalLeak(reply) ||
            isProbablyTruncated(reply, choice?.finish_reason)
        ) {
            result = await requestWithModelFallback({
                systemPrompt,
                history: safeHistory,
                message,
                repair: true
            });

            completion = result.completion;
            usedModel = result.model;
            choice = completion.choices?.[0];
            reply = parseStructuredReply(choice?.message?.content);
        }

        if (!reply) {
            return res.status(502).json({
                error: "The selected free model returned no usable response."
            });
        }

        if (looksLikeInternalLeak(reply)) {
            return res.status(502).json({
                error: "The AI response could not be displayed safely. Please try again."
            });
        }

        if (isProbablyTruncated(reply, choice?.finish_reason)) {
            reply += "\n\nPlease ask me to continue if you need more detail.";
        }

        res.json({
            reply,
            model: usedModel || completion.model || "OpenRouter free model"
        });
    } catch (error) {
        console.error("OpenRouter request failed:", error);

        const status = Number(error?.status) || 500;

        if (status === 401) {
            return res.status(401).json({
                error: "OpenRouter rejected the API key. Check OPENROUTER_API_KEY in .env."
            });
        }

        if (status === 429 || status === 503) {
            return res.status(503).json({
                error: "Online AI is currently busy. LifeLens can still answer using its built-in planner analysis.",
                code: "AI_BUSY"
            });
        }

        res.status(500).json({
            error: "LifeLens Coach is temporarily unavailable.",
            details:
                process.env.NODE_ENV === "development"
                    ? String(error?.message || error)
                    : undefined
        });
    }
});

if (require.main === module) {
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`LifeLens running at http://localhost:${PORT}`);
    });
}

module.exports = app;
