import type { Task } from "../task";
import { escapeHtml } from "../utils/dom";

export function renderTaskRowContent(task: Pick<Task, "title" | "notes" | "urgent">): string {
    const title = escapeHtml(task.title);

    const notesPreview = task.notes?.trim()
                       ? `<span class="row-notes">${escapeHtml(task.notes.trim())}</span>`
                       : "";

    const urgentMark = task.urgent
                     ? `<span class="urgent-pill">urgent</span>`
                     : "";

    return `
        <div class="row-main">
            <span class="row-title">${title}</span>
            ${notesPreview}
        </div>
        ${urgentMark}
    `;
}

export function renderOngoingItemContent(task: Pick<Task, "title" | "notes">): string {
    const title = escapeHtml(task.title);

    const notes = task.notes?.trim()
                ? `<div class="ongoing-notes">${escapeHtml(task.notes.trim())}</div>`
                : "";

    return `
        <div class="ongoing-item-title">${title}</div>
        ${notes}
    `;
}
