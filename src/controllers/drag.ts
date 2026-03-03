import type { AppState } from "../state";
import type { Task, DateKey } from "../task";
import { closestAtPoint, qs } from "../utils/dom";
import { renderTaskRowContent, renderOngoingItemContent } from "../ui/taskRender";

type DragKind = "day" | "ongoing" | "today";

type DragIdle = { state: "idle" };
type DragPending = {
    state: "pending";
    taskId: number;
    kind: DragKind;
    pointerId: number;
    startX: number;
    startY: number;
    sourceEl: HTMLElement;
}
type DragActive = {
    state: "active";
    taskId: number;
    kind: DragKind;
    pointerId: number;
    sourceEl: HTMLElement;
    ghostEl: HTMLDivElement;

    startRect: DOMRect;
    startKind: DragKind;
    startContainer: HTMLElement | null;
    startIndex: number;

    lastY: number;
    movingDown: boolean;
}

type DragState = DragIdle | DragPending | DragActive;

type ResetPreviewOpts = { keepSourceHole: boolean; removePreviewEl: boolean; };

type Deps = {
    state: AppState;
    refresh: () => Promise<void>;
    render: () => void;
    root?: Document;
};

export class DragController {
    private root: Document;

    private drag: DragState = { state: "idle" };
    private hoveredDayBox: HTMLElement | null = null;

    private previewEl:        HTMLElement | null = null;
    private previewKind:      DragKind    | null = null;
    private previewContainer: HTMLElement | null = null;
    private previewIndex = -1;

    private baseIdsByContainer = new Map<HTMLElement, number[]>();

    private attached = false;

    constructor(private deps: Deps) {
        this.root = deps.root ?? document;
    }

    attach(): void {
        if (this.attached) return;
        this.attached = true;

        const weekGridEl    = qs<HTMLDivElement>("#week-grid",    this.root);
        const ongoingListEl = qs<HTMLDivElement>("#ongoing-list", this.root);

        weekGridEl   .addEventListener("click", this.swallowSuppressedClick, { capture: true });
        ongoingListEl.addEventListener("click", this.swallowSuppressedClick, { capture: true });

        weekGridEl.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement;
            const row = target.closest<HTMLElement>(".task-row.filled");
            if (!row) return;

            const id = Number(row.dataset.taskId);
            if (!Number.isFinite(id) || id <= 0) return;

            const inToday = !!row.closest(".today-box");

            row.setPointerCapture(e.pointerId);

            const kind = (
                this.deps.state.visibleTaskById.get(id)?.location.kind
                ?? (inToday ? "today" : "day")
            ) as DragKind;

            this.drag = {
                state: "pending",
                taskId: id,
                kind,
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                sourceEl: row,
            };
        }, { capture: true });

        ongoingListEl.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement;
            const item = target.closest<HTMLElement>(".ongoing-item");
            if (!item) return;

            const id = Number(item.dataset.taskId);
            if (!Number.isFinite(id) || id <= 0) return;

            item.setPointerCapture(e.pointerId);

            this.drag = {
                state: "pending",
                taskId: id,
                kind: "ongoing",
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                sourceEl: item,
            };
        }, { capture: true });

        window.addEventListener("pointermove", (e) => {
            if (this.drag.state === "idle") return;
            if (e.pointerId !== this.drag.pointerId) return;

            if (this.drag.state === "pending") {
                const dx = e.clientX - this.drag.startX;
                const dy = e.clientY - this.drag.startY;
                if ((dx * dx + dy * dy) < 36) return;
                this.beginDragFromPending(e.clientX, e.clientY);
                return;
            }

            e.preventDefault();

            this.updateGhostPosition(this.drag.ghostEl, e.clientX, e.clientY);
            if (e.clientY !== this.drag.lastY) this.drag.movingDown = e.clientY > this.drag.lastY;
            this.drag.lastY = e.clientY;

            const ongoingHit = !!closestAtPoint<HTMLElement>("#ongoing-list", e.clientX, e.clientY);
            this.setOngoingHover(ongoingHit);

            if (ongoingHit) {
                this.setDayHover(null);
                this.showOngoingPreview(e.clientY, this.drag.movingDown);
                return;
            }

            const todayBox = closestAtPoint<HTMLElement>(".today-box", e.clientX, e.clientY);
            if (todayBox) {
                this.setDayHover(todayBox);
                this.showGridPreview("today", todayBox, e.clientY, this.drag.movingDown);
                return;
            }

            const dayBox = closestAtPoint<HTMLElement>(".day-box", e.clientX, e.clientY);
            this.setDayHover(dayBox);

            if (dayBox) {
                this.showGridPreview("day", dayBox, e.clientY, this.drag.movingDown);
            } else {
                this.resetPreview({ keepSourceHole: true, removePreviewEl: true });
            }
        }, { passive: false });

        window.addEventListener("pointerup", async (e) => {
            if (this.drag.state === "idle") return;
            if (e.pointerId !== this.drag.pointerId) return;

            if (this.drag.state === "active") {
                this.deps.state.suppressNextClick = true;
                setTimeout(() => { this.deps.state.suppressNextClick = false; }, 0);

                try {
                    await this.finishDrag(e.clientX, e.clientY);
                } catch (err) {
                    console.error(err);
                    this.cancelDrag();
                }
            }

            this.drag = { state: "idle" };
        });

        window.addEventListener("pointercancel", (e) => {
            if (this.drag.state === "idle") return;
            if (e.pointerId !== this.drag.pointerId) return;
            this.deps.state.suppressNextClick = false;
            setTimeout(() => { this.deps.state.suppressNextClick = false; }, 0);
            this.cancelDrag();
            this.drag = { state: "idle" };
        });
    }

    resetForRender(): void {
        const prev  = this.drag;
        const ghost = prev.state === "active" ? prev.ghostEl : null;

        this.drag = { state: "idle" };

        this.setDayHover(null);
        this.setOngoingHover(false);
        document.body.classList.remove("dragging");

        if (ghost) ghost.remove();

        this.baseIdsByContainer.clear();
        this.resetPreview({ keepSourceHole: false, removePreviewEl: true });
    }

    private idsInGrid(container: HTMLElement): number[] {
        return Array.from(container.querySelectorAll<HTMLElement>(".task-row.filled"))
            .map((el) => Number(el.dataset.taskId))
            .filter((n) => Number.isFinite(n) && n > 0);
    }

    private rememberBaseOrder(container: HTMLElement, draggedId: number): void {
        if (this.baseIdsByContainer.has(container)) return;
        this.baseIdsByContainer.set(container, this.idsInGrid(container).filter((id) => id !== draggedId));
    }

    private setRowEmpty(el: HTMLElement): void {
        el.className = "task-row empty";
        el.innerHTML = "";
        delete el.dataset.taskId;
        el.title = "";
    }

    private setRowFilled(el: HTMLElement, task: Task, asPreview: boolean): void {
        el.className = `task-row filled${asPreview ? " drag-preview" : ""}`;
        el.dataset.taskId = String(task.id);
        el.title = "Click to edit";
        el.innerHTML = renderTaskRowContent(task);
    }

    private paintGrid(container: HTMLElement, ids: number[], previewId: number | null): void {
        const rows = Array.from(container.querySelectorAll<HTMLElement>(".task-row"));

        while (rows.length < ids.length) {
            const r = this.root.createElement("div");
            r.className = "task-row empty";
            container.appendChild(r);
            rows.push(r);
        }

        for (let i = 0; i < rows.length; i++) {
            const id = ids[i];
            if (id === undefined) {
                this.setRowEmpty(rows[i]);
                continue;
            }
            const t = this.deps.state.visibleTaskById.get(id);
            if (!t) {
                this.setRowEmpty(rows[i]);
                continue;
            }
            this.setRowFilled(rows[i], t, previewId !== null && id === previewId);
        }
    }

    private repaintBaseOrders(keepSourceHole: boolean): void {
        for (const [container, base] of this.baseIdsByContainer) {
            let ids = base;

            if (keepSourceHole                    &&
                this.drag.state === "active"      &&
                this.drag.startKind !== "ongoing" &&
                this.drag.startContainer === container
            ) {
                ids = base.slice();
                ids.splice(this.drag.startIndex, 0, -1);
            }

            this.paintGrid(container, ids, null);
        }
        this.baseIdsByContainer.clear();
    }

    private setDayHover(dayBox: HTMLElement | null): void {
        if (this.hoveredDayBox && this.hoveredDayBox !== dayBox)
            this.hoveredDayBox.classList.remove("drop-hover");

        this.hoveredDayBox = dayBox;
        if (this.hoveredDayBox)
            this.hoveredDayBox.classList.add("drop-hover");
    }

    private setOngoingHover(on: boolean): void {
        const list = this.root.querySelector<HTMLElement>("#ongoing-list");
        if (!list) return;
        list.classList.toggle("drop-hover-ongoing", on);
    }

    private setOngoingPreviewing(on: boolean): void {
        const list = this.root.querySelector<HTMLElement>("#ongoing-list");
        if (!list) return;
        list.classList.toggle("previewing", on);
    }

    private applyDragSourceVisual(): void {
        if (this.drag.state !== "active") return;

        if (this.drag.kind === "ongoing") {
            this.drag.sourceEl.classList.add("drag-source");
            this.drag.sourceEl.style.display = "none";
            return;
        }

        this.drag.sourceEl.classList.add("drag-source");
        this.setRowEmpty(this.drag.sourceEl);
    }

    private resetPreview(opts: ResetPreviewOpts): void {
        if (opts.removePreviewEl) this.previewEl?.remove();

        this.previewEl        = null;
        this.previewKind      = null;
        this.previewContainer = null;
        this.previewIndex     = -1;

        this.setOngoingPreviewing(false);
        this.repaintBaseOrders(opts.keepSourceHole);
        if (opts.keepSourceHole) this.applyDragSourceVisual();
    }

    private updateGhostPosition(ghost: HTMLElement, x: number, y: number): void {
        ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
    }

    // static for obvious reasons
    private swallowSuppressedClick = (e: MouseEvent): void => {
        if (!this.deps.state.suppressNextClick) return;
        this.deps.state.suppressNextClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
    };

    private indexOfFilledRow(container: HTMLElement, rowEl: HTMLElement): number {
        const filled = Array.from(container.querySelectorAll<HTMLElement>(".task-row.filled"));
        const idx = filled.indexOf(rowEl);
        return idx < 0 ? 0 : idx;
    }

    private buildPreview(kind: DragKind, taskId: number): HTMLElement {
        const task = this.deps.state.visibleTaskById.get(taskId);

        if (kind === "ongoing") {
            const el = this.root.createElement("button");
            el.type = "button";
            el.className = "ongoing-item drag-preview";
            el.dataset.taskId = String(taskId);

            el.innerHTML = renderOngoingItemContent({
                title: task?.title ?? `#${taskId}`,
                notes: task?.notes ?? "",
            });
            return el;
        }

        const el = this.root.createElement("div");
        el.className = "task-row filled drag-preview";
        el.dataset.taskId = String(taskId);

        el.innerHTML = renderTaskRowContent({
            title: task?.title ?? `#${taskId}`,
            notes: task?.notes ?? "",
            urgent: !!task?.urgent,
        });
        return el;
    }

    private ensurePreview(kind: DragKind, container: HTMLElement): void {
        if (this.drag.state !== "active") return;

        if (this.previewKind !== kind || this.previewContainer !== container) {
            this.resetPreview({ keepSourceHole: true, removePreviewEl: true });
        }

        this.previewKind      = kind;
        this.previewContainer = container;
        this.previewIndex     = -1;

        if (kind !== "ongoing") {
            this.rememberBaseOrder(container, this.drag.taskId);
            return;
        }

        this.setOngoingPreviewing(true);

        if (this.previewEl) return;
        this.previewEl = this.buildPreview("ongoing", this.drag.taskId);
        container.appendChild(this.previewEl);
    }

    private computeInsertIndex(
        items: HTMLElement[],
        y: number,
        container: HTMLElement,
        kind: DragKind,
        movingDown: boolean
    ): number {
        if (this.drag.state          === "active"  &&
            this.drag.startKind      === kind      &&
            this.drag.startContainer === container &&
            y >= this.drag.startRect.top           &&
            y <= this.drag.startRect.bottom
        ) {
            return Math.max(0, Math.min(this.drag.startIndex, items.length));
        }

        if (movingDown) {
            for (let i = 0; i < items.length; i++) {
                const r = items[i].getBoundingClientRect();
                if (y < r.top)    return i;
                if (y < r.bottom) return i + 1;
            }
            return items.length;
        }

        for (let i = 0; i < items.length; i++) {
            const r = items[i].getBoundingClientRect();
            if (y <= r.bottom) return i;
        }
        return items.length;
    }

    private showGridPreview(
        kind: "day" | "today",
        box: HTMLElement,
        pointerY: number,
        movingDown: boolean
    ): void {
        if (this.drag.state !== "active") return;
        const draggedId = this.drag.taskId;

        const container = box.querySelector<HTMLElement>(".day-rows");
        if (!container) return;

        this.ensurePreview(kind, container);

        const items = Array
            .from(container.querySelectorAll<HTMLElement>(".task-row.filled"))
            .filter((el) => Number(el.dataset.taskId) !== draggedId);

        const idx = this.computeInsertIndex(items, pointerY, container, kind, movingDown);
        if (idx === this.previewIndex) return;
        this.previewIndex = idx;

        const base = this.idsInGrid(container).filter((id) => id !== draggedId);
        base.splice(Math.max(0, Math.min(idx, base.length)), 0, draggedId);

        this.paintGrid(container, base, draggedId);
    }

    private showOngoingPreview(pointerY: number, movingDown: boolean): void {
        if (this.drag.state !== "active") return;

        const container = this.root.querySelector<HTMLElement>("#ongoing-list");
        if (!container) return;

        this.ensurePreview("ongoing", container);

        const items = Array
            .from(container.querySelectorAll<HTMLElement>(".ongoing-item"))
            .filter((el) => !el.classList.contains("drag-preview"))
            .filter((el) => !el.classList.contains("drag-source"));

        const idx = this.computeInsertIndex(items, pointerY, container, "ongoing", movingDown);
        if (idx === this.previewIndex) return;
        this.previewIndex = idx;

        const ref = items[idx] ?? null;
        if (this.previewEl) container.insertBefore(this.previewEl, ref);
    }

    private orderFromDom(container: HTMLElement, selector: string, draggedId: number): number[] {
        const els = Array.from(container.querySelectorAll<HTMLElement>(selector));
        const ids: number[] = [];
        const seen = new Set<number>();

        for (const el of els) {
            if (el.classList.contains("drag-source")) continue;
            const id = Number(el.dataset.taskId);
            if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
        }

        if (!seen.has(draggedId)) ids.push(draggedId);
        return ids;
    }

    private beginDragFromPending(x: number, y: number): void {
        if (this.drag.state !== "pending") return;

        const task  = this.deps.state.visibleTaskById.get(this.drag.taskId);
        const title = task?.title ?? `#${this.drag.taskId}`;

        const ghost = this.root.createElement("div");
        ghost.className   = "drag-ghost";
        ghost.textContent = title;
        this.root.body.appendChild(ghost);
        this.updateGhostPosition(ghost, x, y);

        const startRect = this.drag.sourceEl.getBoundingClientRect();

        let startContainer: HTMLElement | null = null;
        let startIndex = 0;

        if (this.drag.kind !== "ongoing") {
            startContainer = this.drag.sourceEl.closest<HTMLElement>(".day-rows");
            if (startContainer) startIndex = this.indexOfFilledRow(startContainer, this.drag.sourceEl);
        } else {
            startContainer = this.root.querySelector<HTMLElement>("#ongoing-list");
            if (startContainer) {
                const items = Array.from(startContainer.querySelectorAll<HTMLElement>(".ongoing-item"));
                const idx = items.indexOf(this.drag.sourceEl);
                startIndex = idx < 0 ? 0 : idx;
            }
        }

        this.drag.sourceEl.classList.add("drag-source");

        if (this.drag.kind === "ongoing") {
            this.drag.sourceEl.style.display = "none";
        } else {
            this.setRowEmpty(this.drag.sourceEl);
        }

        this.root.body.classList.add("dragging");

        this.drag = {
            state: "active",
            taskId: this.drag.taskId,
            kind: this.drag.kind,
            pointerId: this.drag.pointerId,
            sourceEl: this.drag.sourceEl,
            ghostEl: ghost,
            startRect,
            startKind: this.drag.kind,
            startContainer,
            startIndex,
            lastY: y,
            movingDown: true,
        };

        if (this.drag.kind === "ongoing") {
            this.setOngoingHover(true);
            this.showOngoingPreview(y, true);
        } else if (this.drag.kind === "today") {
            const box = closestAtPoint<HTMLElement>(".today-box", x, y)
                ?? this.drag.sourceEl.closest<HTMLElement>(".today-box");
            if (!box) return;

            this.setDayHover(box);
            this.showGridPreview("today", box, y, true);
        } else {
            const box = this.drag.sourceEl.closest<HTMLElement>(".day-box");
            if (!box) return;

            this.setDayHover(box);
            this.showGridPreview("day", box, y, true);
        }
    }

    private cleanupDragVisuals(): void {
        const prev  = this.drag;
        const ghost = prev.state === "active" ? prev.ghostEl : null;

        this.drag = { state: "idle" };

        this.setDayHover(null);
        this.setOngoingHover(false);
        this.root.body.classList.remove("dragging");

        if (ghost) ghost.remove();

        this.resetPreview({ keepSourceHole: false, removePreviewEl: true });
        this.deps.render();
    }

    private cancelDrag(): void {
        this.cleanupDragVisuals();
    }

    async finishDrag(dropX: number, dropY: number): Promise<void> {
        if (this.drag.state !== "active") return;

        const dragCopy  = this.drag;
        const draggedId = this.drag.taskId;

        const ongoingHit = !!closestAtPoint<HTMLElement>("#ongoing-list", dropX, dropY);
        const todayHit   = !!closestAtPoint<HTMLElement>(".today-box", dropX, dropY);
        const dayBox = ongoingHit ? null : closestAtPoint<HTMLElement>(".day-box", dropX, dropY);
        const dropDateKey = dayBox?.dataset.dayDate ?? null;

        let applyDbChange: (() => Promise<void>) | null = null;

        if (ongoingHit) {
            const list = this.root.querySelector<HTMLElement>("#ongoing-list");
            if (list) {
                const ids = this.orderFromDom(list, ".ongoing-item", draggedId);
                if (ids.length) {
                    applyDbChange = async () => {
                        await this.deps.state.dbm.moveTask(draggedId, { kind: "ongoing" });
                        await this.deps.state.dbm.setSortOrder(ids);
                    };
                }
            }
        } else if (todayHit) {
            const box = closestAtPoint<HTMLElement>(".today-box", dropX, dropY);
            const container = box?.querySelector<HTMLElement>(".day-rows");
            if (container) {
                const ids = this.orderFromDom(container, ".task-row.filled", draggedId);
                if (ids.length) {
                    applyDbChange = async () => {
                        await this.deps.state.dbm.moveTask(draggedId, { kind: "today" });
                        await this.deps.state.dbm.setSortOrder(ids);
                    };
                }
            }
        } else if (dropDateKey) {
            const container = dayBox?.querySelector<HTMLElement>(".day-rows");
            if (container) {
                const ids = this.orderFromDom(container, ".task-row.filled", draggedId);
                if (ids.length) {
                    applyDbChange = async () => {
                        await this.deps.state.dbm.moveTask(draggedId, { kind: "day", dateKey: dropDateKey as DateKey });
                        await this.deps.state.dbm.setSortOrder(ids);
                    };
                }
            }
        }

        if (!applyDbChange) {
            this.cleanupDragVisuals();
            return;
        }

        this.drag = { state: "idle" }

        this.setDayHover(null);
        this.setOngoingHover(false);

        dragCopy.ghostEl.remove();
        this.root.body.classList.remove("dragging");

        this.baseIdsByContainer.clear();

        try {
            await applyDbChange();
            await this.deps.refresh();
        } catch (err) {
            this.drag = dragCopy;
            this.resetPreview({ keepSourceHole: false, removePreviewEl: true });
            this.cleanupDragVisuals();
            throw err;
        }
    }
}
