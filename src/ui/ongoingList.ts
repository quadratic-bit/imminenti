import type { AppState } from "../state";
import { renderOngoingItemContent } from "./taskRender";
import { styleAttrForStripes } from "./taskStripes";

export function renderOngoingList(state: AppState, root: Document = document): void {
    const list = root.querySelector<HTMLDivElement>("#ongoing-list");
    if (!list) return;

    if (state.ongoingTasks.length === 0) {
        list.innerHTML = `<div class="empty-ongoing">No ongoing tasks.</div>`;
        return;
    }

    list.innerHTML = state.ongoingTasks.map((t) => {
        const meta = state.taskLinkMetaByTaskId.get(t.id);
        const stripeStyle = styleAttrForStripes(meta?.colors);
        return `
            <button type="button" class="ongoing-item" data-task-id="${t.id}" title="Click to edit"${stripeStyle}>
                ${renderOngoingItemContent(t)}
            </button>
        `;
    }).join("");
}
