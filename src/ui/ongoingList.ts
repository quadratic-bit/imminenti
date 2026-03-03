import type { AppState } from "../state";
import { escapeHtml } from "../utils/dom";

export function renderOngoingList(state: AppState, root: Document = document): void {
    const list = root.querySelector<HTMLDivElement>("#ongoing-list");
    if (!list) return;

    if (state.ongoingTasks.length === 0) {
        list.innerHTML = `<div class="empty-ongoing">No ongoing tasks.</div>`;
        return;
    }

    list.innerHTML = state.ongoingTasks.map((t) => {
        const title = escapeHtml(t.title);
        const notes = t.notes?.trim()
            ? `<div class="ongoing-notes">${escapeHtml(t.notes.trim())}</div>`
            : "";
        return `
            <button type="button" class="ongoing-item" data-task-id="${t.id}" title="Click to edit">
                <div class="ongoing-item-title">${title}</div>
                ${notes}
            </button>
        `;
    }).join("");
}
