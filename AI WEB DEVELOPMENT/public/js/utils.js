"use strict";

export function convertTimeToMinutes(time) {
    if (!time || !time.includes(":")) {
        return 0;
    }

    const [hours, minutes] = time.split(":").map(Number);

    return hours * 60 + minutes;
}


export function formatMinutesAsTime(totalMinutes) {
    const normalizedMinutes =
        ((totalMinutes % 1440) + 1440) % 1440;

    const hours24 = Math.floor(normalizedMinutes / 60);
    const minutes = normalizedMinutes % 60;

    const period = hours24 >= 12 ? "PM" : "AM";
    const hours12 = hours24 % 12 || 12;

    return `${hours12}:${String(minutes).padStart(2, "0")} ${period}`;
}

export function escapeHTML(text) {
    const temporaryElement = document.createElement("div");

    temporaryElement.textContent = String(text ?? "");

    return temporaryElement.innerHTML;
}

export function capitalizeWord(word) {
    if (!word) {
        return "";
    }

    return word.charAt(0).toUpperCase() + word.slice(1);
}