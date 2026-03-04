import type { AppState } from "../state";
import type { DateKey } from "../task";
import { addDays } from "../utils/date";
import { isTypingTarget, qs } from "../utils/dom";
import type { ModalController } from "../controllers/modal";
import type { LinksModalController } from "../controllers/linksModal";
import type { DragController } from "../controllers/drag";
import type { LinkDragController } from "../controllers/linkDrag";
import { renderAll } from "./all";

type Args = {
    state: AppState;
    modal: ModalController;
    linksModal: LinksModalController;
    drag: DragController;
    linkDrag: LinkDragController;
    refresh: () => Promise<void>;
    root?: Document;
};

export function wireEvents({ state, modal, linksModal, drag, linkDrag, refresh, root = document }: Args): void {
    modal.attach();
    linksModal.attach();
    drag.attach();
    linkDrag.attach();

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

    qs<HTMLButtonElement>("#add-collection-btn", root).addEventListener("click", () => {
        linksModal.openCreateCollection();
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

    qs<HTMLDivElement>("#links-panel", root).addEventListener("click", (e) => {
        const target = e.target as HTMLElement;

        const addLink = target.closest<HTMLElement>(".collection-add-link-btn");
        if (addLink) {
            const cid = Number(addLink.dataset.collectionId);
            if (Number.isFinite(cid) && cid > 0) linksModal.openCreateLink(cid);
            return;
        }

        const editCol = target.closest<HTMLElement>(".collection-edit-btn");
        if (editCol) {
            const cid = Number(editCol.dataset.collectionId);
            if (Number.isFinite(cid) && cid > 0) linksModal.openEditCollection(cid);
            return;
        }

        const editLink = target.closest<HTMLElement>(".link-edit-btn");
        if (editLink) {
            const lid = Number(editLink.dataset.linkId);
            if (Number.isFinite(lid) && lid > 0) linksModal.openEditLink(lid);
            return;
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
