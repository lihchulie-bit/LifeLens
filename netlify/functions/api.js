"use strict";

const serverless = require("serverless-http");
const app = require("../../server");

const wrappedHandler = serverless(app, {
    request(request, event) {
        let rawBody = event?.body;

        if (
            event?.isBase64Encoded &&
            typeof rawBody === "string"
        ) {
            rawBody = Buffer
                .from(rawBody, "base64")
                .toString("utf8");
        }

        if (
            typeof rawBody === "string" &&
            rawBody.trim()
        ) {
            try {
                request.body = JSON.parse(rawBody);
            } catch {
                request.body = {};
            }
        } else if (
            rawBody &&
            typeof rawBody === "object"
        ) {
            request.body = rawBody;
        }
    }
});

module.exports.handler = wrappedHandler;