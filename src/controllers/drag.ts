import type { AppState } from "../state";
import type { Task, DateKey } from "../task";
import { closestAtPoint } from "../utils/dom";
import { renderTaskRowContent, renderOngoingItemContent } from "../ui/taskRender";
import { OrderedDragController, type OrderedDragAdapter, type DragHit } from "./orderedDrag";
import { applyStripesCssVar } from "../ui/taskStripes";

type Kind = "day" | "today" | "ongoing";
type Meta = { dateKey?: DateKey };

type Deps = {
    state: AppState;
    refresh: () => Promise<void>;
    render: () => void;
    root?: Document;
};

function numId(x: unknown): number | null {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function setRowEmpty(el: HTMLElement): void {
    el.className = "task-row empty";
    el.innerHTML = "";
    delete el.dataset.taskId;
    el.title = "";
    el.style.removeProperty("--task-stripes");
}

function setRowFilled(el: HTMLElement, task: Task, asPreview: boolean, stripeColors: string[] | undefined): void {
    el.className = `task-row filled${asPreview ? " drag-preview" : ""}`;
    el.dataset.taskId = String(task.id);
    el.title = "Click to edit";
    el.innerHTML = renderTaskRowContent(task);
    applyStripesCssVar(el, stripeColors);
}

function idsInGrid(listEl: HTMLElement): number[] {
    return Array.from(listEl.querySelectorAll<HTMLElement>(".task-row.filled"))
    .map((el) => numId(el.dataset.taskId))
    .filter((n): n is number => n !== null);
}

function paintGrid(state: AppState, listEl: HTMLElement, ids: number[], previewId: number | null): void {
    const rows = Array.from(listEl.querySelectorAll<HTMLElement>(".task-row"));

    while (rows.length < ids.length) {
        const r = document.createElement("div");
        r.className = "task-row empty";
        listEl.appendChild(r);
        rows.push(r);
    }

    for (let i = 0; i < rows.length; i++) {
        const id = ids[i];

        // -1 is a hole
        if (id === undefined || id === -1) {
            setRowEmpty(rows[i]);
            continue;
        }

        const t = state.visibleTaskById.get(id);
        if (!t) {
            setRowEmpty(rows[i]);
            continue;
        }

        const meta = state.taskLinkMetaByTaskId.get(id);
        setRowFilled(rows[i], t, previewId !== null && id === previewId, meta?.colors);
    }
}

function indexOfFilledRow(listEl: HTMLElement, rowEl: HTMLElement): number {
    const filled = Array.from(listEl.querySelectorAll<HTMLElement>(".task-row.filled"));
    const idx = filled.indexOf(rowEl);
    return idx < 0 ? 0 : idx;
}

function orderFromDom(listEl: HTMLElement, selector: string, draggedId: number): number[] {
    const els = Array.from(listEl.querySelectorAll<HTMLElement>(selector));
    const ids: number[] = [];
    const seen = new Set<number>();

    for (const el of els) {
        if (el.classList.contains("drag-source")) continue;
        const id = numId(el.dataset.taskId);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
    }

    if (!seen.has(draggedId)) ids.push(draggedId);
    return ids;
}

function makeOngoingAdapter(state: AppState): OrderedDragAdapter<Kind, Meta> {
    let hovered = false;

    let previewEl: HTMLElement | null = null;
    let previewList: HTMLElement | null = null;

    const setHover = (on: boolean) => {
        const list = document.querySelector<HTMLElement>("#ongoing-list");
        if (!list) return;
        list.classList.toggle("drop-hover-ongoing", on);
    };

    const setPreviewing = (on: boolean) => {
        const list = document.querySelector<HTMLElement>("#ongoing-list");
        if (!list) return;
        list.classList.toggle("previewing", on);
    };

    return {
        pick(target) {
            const item = target.closest<HTMLElement>(".ongoing-item");
            if (!item) return null;

            const id = numId(item.dataset.taskId);
            if (!id) return null;

            return { kind: "ongoing", id, sourceEl: item };
        },

        hitTest(x, y) {
            const list = closestAtPoint<HTMLElement>("#ongoing-list", x, y);
            if (!list) return null;
            return { kind: "ongoing", dropZoneEl: list, listEl: list, meta: {} };
        },

        startHit(pick) {
            const list = pick.sourceEl.closest<HTMLElement>("#ongoing-list") ?? document.querySelector<HTMLElement>("#ongoing-list");
            if (!list) return null;
            return { kind: "ongoing", dropZoneEl: list, listEl: list, meta: {} };
        },

        sourceIndex(hit, sourceEl) {
            const items = Array.from(hit.listEl.querySelectorAll<HTMLElement>(".ongoing-item"));
            const idx = items.indexOf(sourceEl);
            return idx < 0 ? 0 : idx;
        },

        itemsForInsert(hit) {
            return Array.from(hit.listEl.querySelectorAll<HTMLElement>(".ongoing-item"))
            .filter((el) => !el.classList.contains("drag-preview"))
            .filter((el) => !el.classList.contains("drag-source"));
        },

        idsInList(listEl) {
            return Array.from(listEl.querySelectorAll<HTMLElement>(".ongoing-item"))
            .filter((el) => !el.classList.contains("drag-preview"))
            .filter((el) => !el.classList.contains("drag-source"))
            .map((el) => numId(el.dataset.taskId))
            .filter((n): n is number => n !== null);
        },

        preview(hit, draggedId, idx) {
            setPreviewing(true);

            if (!previewEl) {
                const task = state.visibleTaskById.get(draggedId);
                const el = document.createElement("button");
                el.type = "button";
                el.className = "ongoing-item drag-preview";
                el.dataset.taskId = String(draggedId);
                el.innerHTML = renderOngoingItemContent({
                    title: task?.title ?? `#${draggedId}`,
                    notes: task?.notes ?? "",
                });
                const meta = state.taskLinkMetaByTaskId.get(draggedId);
                applyStripesCssVar(el, meta?.colors);
                previewEl = el;
            }

            if (!previewList || previewList !== hit.listEl) {
                previewList = hit.listEl;
                hit.listEl.appendChild(previewEl);
            }

            const items = this.itemsForInsert(hit, draggedId);
            const ref = items[idx] ?? null;
            hit.listEl.insertBefore(previewEl, ref);
        },

        clearPreviewDom() {
            setPreviewing(false);
            previewEl?.remove();
            previewEl = null;
            previewList = null;
        },

        paintBase() {},

        orderFromDom(listEl, draggedId) {
            return orderFromDom(listEl, ".ongoing-item", draggedId);
        },

        setHover(hit) {
            const on = !!hit;
            if (on === hovered) return;
            hovered = on;
            setHover(on);
        },

        applySourceVisual(pick) {
            pick.sourceEl.classList.add("drag-source");
            pick.sourceEl.style.display = "none";
        },

        ghostText(id) {
            return state.visibleTaskById.get(id)?.title ?? `#${id}`;
        }
    };
}

function makeGridAdapter(state: AppState): OrderedDragAdapter<Kind, Meta> {
    let hoveredBox: HTMLElement | null = null;

    const setHoverBox = (box: HTMLElement | null) => {
        if (hoveredBox && hoveredBox !== box) hoveredBox.classList.remove("drop-hover");
        hoveredBox = box;
        if (hoveredBox) hoveredBox.classList.add("drop-hover");
    };

    function hitToday(x: number, y: number): DragHit<Kind, Meta> | null {
        const box = closestAtPoint<HTMLElement>(".today-box", x, y);
        if (!box) return null;
        const listEl = box.querySelector<HTMLElement>(".day-rows");
        if (!listEl) return null;
        return { kind: "today", dropZoneEl: box, listEl, meta: {} };
    }

    function hitDay(x: number, y: number): DragHit<Kind, Meta> | null {
        const box = closestAtPoint<HTMLElement>(".day-box", x, y);
        if (!box) return null;

        if (box.classList.contains("today-box")) return null;

        const dateKey = box.dataset.dayDate as DateKey | undefined;
        if (!dateKey) return null;

        const listEl = box.querySelector<HTMLElement>(".day-rows");
        if (!listEl) return null;

        return { kind: "day", dropZoneEl: box, listEl, meta: { dateKey } };
    }

    return {
        pick(target) {
            const row = target.closest<HTMLElement>(".task-row.filled");
            if (!row) return null;

            const id = numId(row.dataset.taskId);
            if (!id) return null;

            const inToday = !!row.closest(".today-box");
            return { kind: inToday ? "today" : "day", id, sourceEl: row };
        },

        hitTest(x, y) {
            return hitToday(x, y) ?? hitDay(x, y);
        },

        startHit(pick) {
            if (pick.kind === "today") {
                const box = pick.sourceEl.closest<HTMLElement>(".today-box");
                const listEl = box?.querySelector<HTMLElement>(".day-rows") ?? null;
                if (!box || !listEl) return null;
                return { kind: "today", dropZoneEl: box, listEl, meta: {} };
            }

            const box = pick.sourceEl.closest<HTMLElement>(".day-box");
            if (!box || box.classList.contains("today-box")) return null;

            const dateKey = box.dataset.dayDate as DateKey | undefined;
            const listEl = box.querySelector<HTMLElement>(".day-rows") ?? null;
            if (!dateKey || !listEl) return null;

            return { kind: "day", dropZoneEl: box, listEl, meta: { dateKey } };
        },

        sourceIndex(hit, sourceEl) {
            return indexOfFilledRow(hit.listEl, sourceEl);
        },

        itemsForInsert(hit, draggedId) {
            return Array.from(hit.listEl.querySelectorAll<HTMLElement>(".task-row.filled")).filter(
                (el) => numId(el.dataset.taskId) !== draggedId
            );
        },

        idsInList(listEl) {
            return idsInGrid(listEl);
        },

        preview(hit, draggedId, idx) {
            const base = idsInGrid(hit.listEl).filter((id) => id !== draggedId);
            base.splice(Math.max(0, Math.min(idx, base.length)), 0, draggedId);
            paintGrid(state, hit.listEl, base, draggedId);
        },

        clearPreviewDom() {},

        paintBase(listEl, baseIds, ctx) {
            let ids = baseIds;

            if (ctx.keepSourceHole && ctx.drag.startListEl === listEl) {
                ids = baseIds.slice();
                ids.splice(ctx.drag.startIndex, 0, -1);
            }

            paintGrid(state, listEl, ids, null);
        },

        orderFromDom(listEl, draggedId) {
            return orderFromDom(listEl, ".task-row.filled", draggedId);
        },

        setHover(hit) {
            setHoverBox(hit ? hit.dropZoneEl : null);
        },

        applySourceVisual(pick) {
            setRowEmpty(pick.sourceEl);
        },

        ghostText(id) {
            return state.visibleTaskById.get(id)?.title ?? `#${id}`;
        },
    };
}

export class DragController {
    private root: Document;
    private engine: OrderedDragController<Kind, Meta>;

    constructor(deps: Deps) {
        this.root = deps.root ?? document;

        const weekGridEl = this.root.querySelector<HTMLDivElement>("#week-grid");
        const ongoingEl = this.root.querySelector<HTMLDivElement>("#ongoing-list");

        this.engine = new OrderedDragController<Kind, Meta>({
            adapters: [makeOngoingAdapter(deps.state), makeGridAdapter(deps.state)],

            refresh: deps.refresh,
            render: deps.render,

            onDrop: async ({ draggedId, to, order }) => {
                const { dbm } = deps.state;

                if (to.kind === "ongoing") {
                    await dbm.moveTask(draggedId, { kind: "ongoing" });
                    await dbm.setSortOrder(order);
                    return;
                }

                if (to.kind === "today") {
                    await dbm.moveTask(draggedId, { kind: "today" });
                    await dbm.setSortOrder(order);
                    return;
                }

                const dateKey = to.meta.dateKey as DateKey;
                await dbm.moveTask(draggedId, { kind: "day", dateKey });
                await dbm.setSortOrder(order);
            },

            getSuppressNextClick: () => deps.state.suppressNextClick,
                setSuppressNextClick: (v) => (deps.state.suppressNextClick = v),

                swallowClickEls: [weekGridEl, ongoingEl].filter((x): x is HTMLElement => !!x),

                root: this.root,
        });
    }

    attach(): void {
        this.engine.attach();
    }

    resetForRender(): void {
        this.engine.resetForRender();
    }
}
