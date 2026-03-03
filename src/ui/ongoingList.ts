import type { AppState } from "../state";
import { renderOngoingItemContent } from "./taskRender";

export function renderOngoingList(state: AppState, root: Document = document): void {
    const list = root.querySelector<HTMLDivElement>("#ongoing-list");
    if (!list) return;

    if (state.ongoingTasks.length === 0) {
        list.innerHTML = `<div class="empty-ongoing">No ongoing tasks.</div>`;
        return;
    }

    list.innerHTML = state.ongoingTasks.map((t) => {
        return `
            <button type="button" class="ongoing-item" data-task-id="${t.id}" title="Click to edit">
                ${renderOngoingItemContent(t)}
            </button>
        `;
    }).join("");
}
