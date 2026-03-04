import type { AppState } from "../state";
import type { DateKey } from "../task";
import { addDays } from "../utils/date";
import { isTypingTarget, qs } from "../utils/dom";
import type { ModalController } from "../controllers/modal";
import type { DragController } from "../controllers/drag";
import { renderAll } from "./all";

type Args = {
    state: AppState;
    modal: ModalController;
    drag: DragController;
    refresh: () => Promise<void>;
    root?: Document;
};

export function wireEvents({ state, modal, drag, refresh, root = document }: Args): void {
    modal.attach();
    drag.attach();

    qs<HTMLButtonElement>("#prev-week-btn", root).addEventListener("click", async () => {
        state.currentWeekStart = addDays(state.currentWeekStart, -7);
        await refresh();
    });

    qs<HTMLButtonElement>("#next-week-btn", root).addEventListener("click", async () => {
        state.currentWeekStart = addDays(state.currentWeekStart, 7);
        await refresh();
    });

    qs<HTMLButtonElement>("#tab-ongoing-btn", root).addEventListener("click", () => {
        state.rightPanelTab = "ongoing";
        renderAll(state, root);
    });

    qs<HTMLButtonElement>("#tab-links-btn", root).addEventListener("click", () => {
        state.rightPanelTab = "links";
        renderAll(state, root);
    });

    qs<HTMLButtonElement>("#add-ongoing-btn", root).addEventListener("click", () => {
        modal.openCreate({ kind: "ongoing" });
    });

    qs<HTMLButtonElement>("#ongoing-list", root).addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        const item = target.closest<HTMLElement>(".ongoing-item");
        if (!item) return;
        const id = Number(item.dataset.taskId);
        const task = state.visibleTaskById.get(id);
        if (task) modal.openEdit(task);
    });

    qs<HTMLDivElement>("#week-grid", root).addEventListener("click", (e) => {
        const target = e.target as HTMLElement;

        const filledRow = target.closest<HTMLElement>(".task-row.filled");
        if (filledRow) {
            const id = Number(filledRow.dataset.taskId);
            const task = state.visibleTaskById.get(id);
            if (!task) return;
            modal.openEdit(task);
            return;
        }

        const todayBox = target.closest<HTMLElement>(".today-box");
        if (todayBox) {
            modal.openCreate({ kind: "today" });
            return;
        }

        const dayBox = target.closest<HTMLElement>(".day-box");
        if (dayBox) {
            const dateKey = dayBox.dataset.dayDate as DateKey | undefined;
            if (dateKey) modal.openCreate({ kind: "day", dateKey });
        }
    });

    window.addEventListener("keydown", async (e) => {
        const dialogOpen = qs<HTMLDialogElement>("#task-dialog").open;
        if (isTypingTarget(e.target) || dialogOpen) return;

        if (e.key === "h") {
            e.preventDefault();
            state.currentWeekStart = addDays(state.currentWeekStart, -7);
            await refresh();
        } else if (e.key === "l") {
            e.preventDefault();
            state.currentWeekStart = addDays(state.currentWeekStart, 7);
            await refresh();
        }
    });
}
