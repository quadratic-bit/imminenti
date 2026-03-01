import "./styles.css";
import { DBManager } from "./db";
import { Task, DateKey } from "./task";

type ModalState = { mode: "create"; target: "day";     dateKey: string }
                | { mode: "create"; target: "ongoing"                  }
                | { mode: "create"; target: "today"                    }
                | { mode: "edit";   target: "day";     task: Task      }
                | { mode: "edit";   target: "ongoing"; task: Task      }
                | { mode: "edit";   target: "today";   task: Task      };


const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

let dbm = new DBManager();

let currentWeekStart = startOfWeek(new Date());
let weekTasks: Task[] = [];
let ongoingTasks: Task[] = [];
let visibleTaskById = new Map<number, Task>();
let todayTasks: Task[] = [];

let modalState: ModalState | null = null;

type DragKind = "day" | "ongoing" | "today";

type PendingDrag = {
    taskId:   number;
    kind:     DragKind;
    startX:   number;
    startY:   number;
    sourceEl: HTMLElement;
};

type ActiveDrag = {
    taskId:   number;
    kind:     DragKind;
    sourceEl: HTMLElement;
    ghostEl:  HTMLDivElement;

    startRect:      DOMRect;
    startKind:      DragKind;
    startContainer: HTMLElement | null;
    startIndex:     number;
};

let pendingDrag: PendingDrag | null = null;
let activeDrag:  ActiveDrag  | null = null;
let dragLastY = 0;
let dragMovingDown = true;

let hoveredDayBox: HTMLElement | null = null;
let justDragged = false;

let previewEl:        HTMLElement | null = null;
let previewKind:      DragKind    | null = null;
let previewContainer: HTMLElement | null = null;
let previewIndex = -1;

const baseIdsByContainer = new Map<HTMLElement, number[]>();

function rememberBaseOrder(container: HTMLElement, draggedId: number): void {
    if (baseIdsByContainer.has(container)) return;
    baseIdsByContainer.set(container, idsInGrid(container).filter((id) => id !== draggedId));
}

function repaintBaseOrders(keepSourceHole: boolean): void {
    for (const [container, base] of baseIdsByContainer) {
        let ids = base;

        if (
            keepSourceHole &&
            activeDrag &&
            activeDrag.startKind !== "ongoing" &&
            activeDrag.startContainer === container
        ) {
            ids = base.slice();
            ids.splice(activeDrag.startIndex, 0, -1); // sentinel => empty row
        }

        paintGrid(container, ids, null);
    }
    baseIdsByContainer.clear();
}

function closestAtPoint<T extends Element>(selector: string, x: number, y: number): T | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return (el?.closest(selector) as T | null) ?? null;
}

function setDayHover(dayBox: HTMLElement | null): void {
    if (hoveredDayBox && hoveredDayBox !== dayBox) hoveredDayBox.classList.remove("drop-hover");
    hoveredDayBox = dayBox;
    if (hoveredDayBox) hoveredDayBox.classList.add("drop-hover");
}

function setOngoingHover(on: boolean): void {
    const list = document.querySelector<HTMLElement>("#ongoing-list");
    if (!list) return;
    list.classList.toggle("drop-hover-ongoing", on);
}

function setOngoingPreviewing(on: boolean): void {
    const list = document.querySelector<HTMLElement>("#ongoing-list");
    if (!list) return;
    list.classList.toggle("previewing", on);
}

function updateGhostPosition(ghost: HTMLElement, x: number, y: number): void {
    ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
}

function applyDragSourceVisual(): void {
    if (!activeDrag) return;

    if (activeDrag.kind === "ongoing") {
        activeDrag.sourceEl.classList.add("drag-source");
        activeDrag.sourceEl.style.display = "none";
        return;
    }

    activeDrag.sourceEl.classList.add("drag-source");
    setRowEmpty(activeDrag.sourceEl);
}

function clearDragPreview(keepSourceHole: boolean): void {
    if (previewKind === "ongoing") previewEl?.remove();

    previewEl = null;
    previewKind = null;
    previewContainer = null;
    previewIndex = -1;

    setOngoingPreviewing(false);

    repaintBaseOrders(keepSourceHole);

    if (keepSourceHole) applyDragSourceVisual();
}

function setRowEmpty(el: HTMLElement): void {
    el.className = "task-row empty";
    el.innerHTML = "";
    delete el.dataset.taskId;
    el.title = "";
}

function setRowFilled(el: HTMLElement, task: Task, asPreview: boolean): void {
    el.className = `task-row filled${asPreview ? " drag-preview" : ""}`;
    el.dataset.taskId = String(task.id);
    el.title = "Click to edit";

    const urgentMark = task.ongoing ? `<span class="urgent-pill">urgent</span>` : "";
    const title = escapeHtml(task.title);
    const notesPreview = task.notes?.trim()
        ? `<span class="row-notes">${escapeHtml(task.notes.trim())}</span>`
        : "";

    el.innerHTML = `
        <div class="row-main">
            <span class="row-title">${title}</span>
            ${notesPreview}
        </div>
        ${urgentMark}
    `;
}

function paintGrid(container: HTMLElement, ids: number[], previewId: number | null): void {
    const rows = Array.from(container.querySelectorAll<HTMLElement>(".task-row"));

    while (rows.length < ids.length) {
        const r = document.createElement("div");
        r.className = "task-row empty";
        container.appendChild(r);
        rows.push(r);
    }

    for (let i = 0; i < rows.length; i++) {
        const id = ids[i];
        if (id === undefined) {
            setRowEmpty(rows[i]);
            continue;
        }
        const t = visibleTaskById.get(id);
        if (!t) {
            setRowEmpty(rows[i]);
            continue;
        }
        setRowFilled(rows[i], t, previewId !== null && id === previewId);
    }
}

function idsInGrid(container: HTMLElement): number[] {
    return Array.from(container.querySelectorAll<HTMLElement>(".task-row.filled"))
        .map((el) => Number(el.dataset.taskId))
        .filter((n) => Number.isFinite(n) && n > 0);
}

function indexOfFilledRow(container: HTMLElement, rowEl: HTMLElement): number {
    const filled = Array.from(container.querySelectorAll<HTMLElement>(".task-row.filled"));
    const idx = filled.indexOf(rowEl);
    return idx < 0 ? 0 : idx;
}

function clearPreview(): void {
    previewEl?.remove();
    previewEl        = null;
    previewKind      = null;
    previewContainer = null;
    previewIndex     = -1;

    setOngoingPreviewing(false);
}

function buildPreview(kind: DragKind, taskId: number): HTMLElement {
    const task = visibleTaskById.get(taskId);

    if (kind === "ongoing") {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "ongoing-item drag-preview";
        el.dataset.taskId = String(taskId);

        const title = escapeHtml(task?.title ?? `#${taskId}`);
        const notes = task?.notes?.trim()
            ? `<div class="ongoing-notes">${escapeHtml(task.notes.trim())}</div>`
            : "";

        el.innerHTML = `
            <div class="ongoing-item-title">${title}</div>
            ${notes}
        `;
        return el;
    }

    const el = document.createElement("div");
    el.className = "task-row filled drag-preview";
    el.dataset.taskId = String(taskId);

    const title = escapeHtml(task?.title ?? `#${taskId}`);
    const notes = task?.notes?.trim()
        ? `<span class="row-notes">${escapeHtml(task.notes.trim())}</span>`
        : "";
    const urgentMark = task?.ongoing
        ? `<span class="urgent-pill">urgent</span>`
        : "";

    el.innerHTML = `
        <div class="row-main">
            <span class="row-title">${title}</span>
            ${notes}
        </div>
        ${urgentMark}
    `;
    return el;
}

function ensurePreview(kind: DragKind, container: HTMLElement): void {
    if (!activeDrag) return;

    if (previewKind !== kind || previewContainer !== container) {
        clearDragPreview(true);
    }

    previewKind = kind;
    previewContainer = container;
    previewIndex = -1;

    if (kind === "ongoing") {
        setOngoingPreviewing(true);
        if (!previewEl) {
            previewEl = buildPreview("ongoing", activeDrag.taskId);
            container.appendChild(previewEl);
        }
        return;
    }

    rememberBaseOrder(container, activeDrag.taskId);
}

function computeInsertIndex(
    items: HTMLElement[],
    y: number,
    container: HTMLElement,
    kind: DragKind,
    movingDown: boolean
): number {
    if (activeDrag &&
        activeDrag.startKind      === kind      &&
        activeDrag.startContainer === container &&
        y >= activeDrag.startRect.top &&
        y <= activeDrag.startRect.bottom
    ) {
        return Math.max(0, Math.min(activeDrag.startIndex, items.length));
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

function showGridPreview(
    kind: "day" | "today",
    box: HTMLElement,
    pointerY: number,
    movingDown: boolean
): void {
    if (!activeDrag) return;

    const container = box.querySelector<HTMLElement>(".day-rows");
    if (!container) return;

    ensurePreview(kind, container);

    const items = Array
        .from(container.querySelectorAll<HTMLElement>(".task-row.filled"))
        .filter((el) => Number(el.dataset.taskId) !== activeDrag!.taskId);

    const idx = computeInsertIndex(items, pointerY, container, kind, movingDown);
    if (idx === previewIndex) return;
    previewIndex = idx;

    const base = idsInGrid(container).filter((id) => id !== activeDrag!.taskId);
    base.splice(Math.max(0, Math.min(idx, base.length)), 0, activeDrag!.taskId);

    paintGrid(container, base, activeDrag.taskId);
}

function showOngoingPreview(pointerY: number, movingDown: boolean): void {
    if (!activeDrag) return;
    const container = document.querySelector<HTMLElement>("#ongoing-list");
    if (!container) return;

    ensurePreview("ongoing", container);

    const items = Array
        .from(container.querySelectorAll<HTMLElement>(".ongoing-item"))
        .filter((el) => !el.classList.contains("drag-preview"))
        .filter((el) => !el.classList.contains("drag-source"));

    const idx = computeInsertIndex(items, pointerY, container, "ongoing", movingDown);
    if (idx === previewIndex) return;
    previewIndex = idx;

    const ref = items[idx] ?? null;
    if (previewEl) container.insertBefore(previewEl, ref);
}

function orderFromDom(container: HTMLElement, selector: string, draggedId: number): number[] {
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

function beginDragFromPending(x: number, y: number): void {
    if (!pendingDrag) return;

    const task  = visibleTaskById.get(pendingDrag.taskId);
    const title = task?.title ?? `#${pendingDrag.taskId}`;

    const ghost = document.createElement("div");
    ghost.className   = "drag-ghost";
    ghost.textContent = title;
    document.body.appendChild(ghost);
    updateGhostPosition(ghost, x, y);

    const startRect = pendingDrag.sourceEl.getBoundingClientRect();

    let startContainer: HTMLElement | null = null;
    let startIndex = 0;

    if (pendingDrag.kind !== "ongoing") {
        startContainer = pendingDrag.sourceEl.closest<HTMLElement>(".day-rows");
        if (startContainer) startIndex = indexOfFilledRow(startContainer, pendingDrag.sourceEl);
    } else {
        startContainer = document.querySelector<HTMLElement>("#ongoing-list");
        if (startContainer) {
            const items = Array.from(startContainer.querySelectorAll<HTMLElement>(".ongoing-item"));
            const idx = items.indexOf(pendingDrag.sourceEl);
            startIndex = idx < 0 ? 0 : idx;
        }
    }

    pendingDrag.sourceEl.classList.add("drag-source");

    if (pendingDrag.kind === "ongoing") {
        pendingDrag.sourceEl.style.display = "none";
    } else {
        setRowEmpty(pendingDrag.sourceEl);
    }

    document.body.classList.add("dragging");

    activeDrag = {
        taskId: pendingDrag.taskId,
        kind: pendingDrag.kind,
        sourceEl: pendingDrag.sourceEl,
        ghostEl: ghost,
        startRect,
        startKind: pendingDrag.kind,
        startContainer,
        startIndex,
    };
    dragLastY = y;
    dragMovingDown = true;

    pendingDrag = null;
    justDragged = true;

    if (activeDrag.kind === "ongoing") {
        setOngoingHover(true);
        showOngoingPreview(y, true);
    } else if (activeDrag.kind === "today") {
        const box = closestAtPoint<HTMLElement>(".today-box", x, y)
            ?? activeDrag.sourceEl.closest<HTMLElement>(".today-box");
        if (!box) return;

        setDayHover(box);
        showGridPreview("today", box, y, true);
    } else {
        const box = activeDrag.sourceEl.closest<HTMLElement>(".day-box");
        if (!box) return;

        setDayHover(box);
        showGridPreview("day", box, y, true);
    }
}

function cleanupDragVisuals(): void {
    pendingDrag = null;
    const drag = activeDrag;
    activeDrag = null;

    baseIdsByContainer.clear();

    previewEl?.remove();
    previewEl = null;
    previewKind = null;
    previewContainer = null;
    previewIndex = -1;
    setOngoingPreviewing(false);

    setDayHover(null);
    setOngoingHover(false);
    document.body.classList.remove("dragging");

    if (drag) drag.ghostEl.remove();

    renderAll();
}

function cancelDrag(): void {
    cleanupDragVisuals();
}

async function finishDrag(dropX: number, dropY: number): Promise<void> {
    if (!activeDrag) return;

    const drag = activeDrag;
    const draggedId = drag.taskId;

    const ongoingHit = !!closestAtPoint<HTMLElement>("#ongoing-list", dropX, dropY);
    const todayHit  = !!closestAtPoint<HTMLElement>(".today-box", dropX, dropY);
    const dayBox = ongoingHit ? null : closestAtPoint<HTMLElement>(".day-box", dropX, dropY);
    const dropDateKey = dayBox?.dataset.dayDate ?? null;

    let applyDbChange: (() => Promise<void>) | null = null;

    if (ongoingHit) {
        const list = document.querySelector<HTMLElement>("#ongoing-list");
        if (list) {
            const ids = orderFromDom(list, ".ongoing-item", draggedId);
            if (ids.length) {
                applyDbChange = async () => {
                    await dbm.moveTaskToOngoing(draggedId);
                    await dbm.setSortOrder(ids);
                };
            }
        }
    } else if (todayHit) {
        const box = closestAtPoint<HTMLElement>(".today-box", dropX, dropY);
        const container = box?.querySelector<HTMLElement>(".day-rows");
        if (container) {
            const ids = orderFromDom(container, ".task-row.filled", draggedId);
            if (ids.length) {
                applyDbChange = async () => {
                    await dbm.moveTaskToToday(draggedId);
                    await dbm.setSortOrder(ids);
                };
            }
        }
    } else if (dropDateKey) {
        const container = dayBox?.querySelector<HTMLElement>(".day-rows");
        if (container) {
            const ids = orderFromDom(container, ".task-row.filled", draggedId);
            if (ids.length) {
                applyDbChange = async () => {
                    await dbm.moveTaskToDay(draggedId, dropDateKey);
                    await dbm.setSortOrder(ids);
                };
            }
        }
    }

    if (!applyDbChange) {
        cleanupDragVisuals();
        return;
    }

    pendingDrag = null;
    activeDrag  = null;

    setDayHover   (null);
    setOngoingHover(false);

    drag.ghostEl.remove();
    document.body.classList.remove("dragging");

    previewEl = null;
    previewKind = null;
    previewContainer = null;
    previewIndex = -1;
    baseIdsByContainer.clear();

    try {
        await applyDbChange();
        await refresh();
    } catch (err) {
        activeDrag = drag;
        clearDragPreview(false);
        cleanupDragVisuals();
        throw err;
    }
}

function escapeHtml(input: string): string {
    return input.replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
}

function dateToKey(d: Date): DateKey {
    const y   = d.getFullYear();
    const m   = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function keyToDate(key: string): Date {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function addDays(d: Date, n: number): Date {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() + n);
    return copy;
}

function startOfWeek(d: Date): Date {
    const x    = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow  = x.getDay();
    const diff = dow === 0 ? -6 : 1 - dow; // shift to Monday cuz I'm slav
    x.setDate(x.getDate() + diff);
    return x;
}

function getWeekDateKeys(weekStart: Date): DateKey[] {
    return Array.from({ length: 7 }, (_, i) => dateToKey(addDays(weekStart, i)));
}

function formatWeekRange(weekStart: Date): string {
    const end = addDays(weekStart, 6);
    const fmt = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day:   "numeric",
        year:  "numeric",
    });
    return `${fmt.format(weekStart)} — ${fmt.format(end)}`;
}

function formatLongDate(key: string): string {
    return new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        year:    "numeric",
        month:   "short",
        day:     "numeric",
    }).format(keyToDate(key));
}

function formatMonthDay(key: string): string {
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day:   "numeric",
    }).format(keyToDate(key));
}

function byDueDateMap(tasks: Task[]): Map<string, Task[]> {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
        if (!t.due_date) continue;
        const arr = m.get(t.due_date) ?? [];
        arr.push(t);
        m.set(t.due_date, arr);
    }
    return m;
}

async function loadTasksForCurrentView(): Promise<void> {
    const weekKeys = getWeekDateKeys(currentWeekStart);
    const weekStartKey = weekKeys[0];
    const weekEndKey   = weekKeys[6];

    weekTasks    = await dbm.getWeekTasks(weekStartKey, weekEndKey);
    ongoingTasks = await dbm.getOngoingTasks();
    todayTasks   = await dbm.getTodayTasks();

    visibleTaskById = new Map<number, Task>();
    for (const t of weekTasks)             visibleTaskById.set(t.id, t);
    for (const t of ongoingTasks) visibleTaskById.set(t.id, t);
    for (const t of todayTasks)            visibleTaskById.set(t.id, t);
}

function renderWeekGrid(): void {
    const weekGrid    = document.querySelector<HTMLDivElement>("#week-grid");
    const weekRangeEl = document.querySelector<HTMLDivElement>("#week-range");
    if (!weekGrid || !weekRangeEl) return;

    const weekKeys = getWeekDateKeys(currentWeekStart);
    const todayKey = dateToKey(new Date());
    const grouped  = byDueDateMap(weekTasks);

    weekRangeEl.textContent = `${formatWeekRange(currentWeekStart)}`;

    const renderDayBox = (weekIndex: number): string => {
        const dateKey = weekKeys[weekIndex];
        const tasks   = grouped.get(dateKey) ?? [];
        const slots   = Math.max(6, tasks.length);

        const rows = Array.from({ length: slots }, (_, i) => {
            const task = tasks[i];
            if (!task) return `<div class="task-row empty" data-day-date="${dateKey}" data-empty="1"></div>`;

            const urgentMark = task.ongoing ? `<span class="urgent-pill">urgent</span>` : "";
            const title = escapeHtml(task.title);
            const notesPreview = task.notes?.trim()
                ? `<span class="row-notes">${escapeHtml(task.notes.trim())}</span>`
                : "";

            return `
                <div class="task-row filled" data-task-id="${task.id}" title="Click to edit">
                    <div class="row-main">
                        <span class="row-title">${title}</span>
                        ${notesPreview}
                    </div>
                    ${urgentMark}
                </div>
            `;
        }).join("");

        const isCurrentDay = dateKey === todayKey;
        const isPast       = dateKey < todayKey;

        return `
            <div class="day-box ${isCurrentDay ? "current-day" : ""} ${isPast ? "past" : ""}" data-day-date="${dateKey}" title="Click to add task">
                <div class="day-label-strip">
                    <div class="day-label-rot day-label-week">${DAY_LABELS[weekIndex]}</div>
                    <div class="day-label-rot day-label-date">${escapeHtml(formatMonthDay(dateKey))}</div>
                </div>
                <div class="day-rows" style="grid-template-rows: repeat(${slots}, minmax(0, 1fr));">
                    ${rows}
                </div>
            </div>
        `;
    };

    const renderTodayBox = (): string => {
        const tasks = todayTasks;
        const slots = Math.max(6, tasks.length);

        const rows = Array.from({ length: slots }, (_, i) => {
            const task = tasks[i];
            if (!task) return `<div class="task-row empty" data-empty="1"></div>`;

            const urgentMark = task.ongoing ? `<span class="urgent-pill">urgent</span>` : "";
            const title = escapeHtml(task.title);
            const notesPreview = task.notes?.trim()
                ? `<span class="row-notes">${escapeHtml(task.notes.trim())}</span>`
                : "";

            return `
                <div class="task-row filled" data-task-id="${task.id}" title="Click to edit">
                    <div class="row-main">
                        <span class="row-title">${title}</span>
                        ${notesPreview}
                    </div>
                    ${urgentMark}
                </div>
            `;
        }).join("");

        return `
            <div class="day-box today-box" title="Click to add task">
                <div class="day-label-strip">
                    <div class="day-label-rot day-label-today">Today</div>
                </div>
                <div class="day-rows" style="grid-template-rows: repeat(${slots}, minmax(0, 1fr));">
                    ${rows}
                </div>
            </div>
        `;
    };

    const cells = [
        `<div class="grid-cell">${renderDayBox(0)}</div>`,
        `<div class="grid-cell">${renderDayBox(3)}</div>`,
        `<div class="grid-cell">${renderDayBox(1)}</div>`,
        `<div class="grid-cell">${renderDayBox(4)}</div>`,
        `<div class="grid-cell">${renderDayBox(2)}</div>`,
        `<div class="grid-cell">${renderDayBox(5)}</div>`,
        `<div class="grid-cell">${renderTodayBox()}</div>`,
        `<div class="grid-cell">${renderDayBox(6)}</div>`,
    ].join("");

    weekGrid.innerHTML = `
        <div class="week-grid-4x2">
            ${cells}
        </div>
    `;
}

function renderOngoingList(): void {
    const list = document.querySelector<HTMLDivElement>("#ongoing-list");
    if (!list) return;

    if (ongoingTasks.length === 0) {
        list.innerHTML = `<div class="empty-ongoing">No ongoing tasks.</div>`;
        return;
    }

    list.innerHTML = ongoingTasks.map((t) => {
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

function renderAll(): void {
    renderWeekGrid();
    renderOngoingList();
}

function qs<T extends Element>(selector: string): T {
    const el = document.querySelector<T>(selector);
    if (!el) throw new Error(`Missing element: ${selector}`);
    return el;
}

function openModal(state: ModalState): void {
    modalState = state;

    const dialog       = qs<HTMLDialogElement>  ("#task-dialog");
    const titleEl      = qs<HTMLHeadingElement> ("#dialog-title");
    const contextEl    = qs<HTMLDivElement>     ("#dialog-context");
    const titleInput   = qs<HTMLInputElement>   ("#task-title-input");
    const notesInput   = qs<HTMLTextAreaElement>("#task-notes-input");
    const urgentField  = qs<HTMLLabelElement>   ("#task-urgent-field");
    const urgentInput  = qs<HTMLInputElement>   ("#task-urgent-input");
    const deleteBtn    = qs<HTMLButtonElement>  ("#delete-task-btn");
    const saveBtn      = qs<HTMLButtonElement>  ("#save-task-btn");

    if (state.mode === "create" && state.target === "day") {
        titleEl.textContent = "Add task";
        contextEl.textContent = `Due: ${formatLongDate(state.dateKey)}`;
        titleInput.value = "";
        notesInput.value = "";
        urgentField.hidden = false;
        urgentInput.checked = false;
        deleteBtn.hidden = true;
        saveBtn.textContent = "Create";
    } else if (state.mode === "create" && state.target === "ongoing") {
        titleEl.textContent = "Add ongoing task";
        contextEl.textContent = "Ongoing task";
        titleInput.value = "";
        notesInput.value = "";
        urgentField.hidden = true;
        urgentInput.checked = true;
        deleteBtn.hidden = true;
        saveBtn.textContent = "Create";
    } else if (state.mode === "create" && state.target === "today") {
        titleEl.textContent = "Add today task";
        contextEl.textContent = "Task for Today";
        titleInput.value = "";
        notesInput.value = "";
        urgentField.hidden = false;
        urgentInput.checked = false;
        deleteBtn.hidden = true;
        saveBtn.textContent = "Create";
    } else if (state.mode === "edit" && state.target === "day") {
        titleEl.textContent = "Edit task";
        contextEl.textContent = `Due: ${state.task.due_date
            ? formatLongDate(state.task.due_date)
            : "No due date"}`;
        titleInput.value = state.task.title ?? "";
        notesInput.value = state.task.notes ?? "";
        urgentField.hidden = false;
        urgentInput.checked = state.task.ongoing;
        deleteBtn.hidden = false;
        saveBtn.textContent = "Save";
    } else if (state.mode === "edit" && state.target === "today") {
        titleEl.textContent = "Edit today task";
        contextEl.textContent = "Task for Today";
        titleInput.value = state.task.title ?? "";
        notesInput.value = state.task.notes ?? "";
        urgentField.hidden = false;
        urgentInput.checked = state.task.ongoing;
        deleteBtn.hidden = false;
        saveBtn.textContent = "Save";
    } else {
        titleEl.textContent = "Edit ongoing task";
        contextEl.textContent = "Ongoing task";
        titleInput.value = state.task.title ?? "";
        notesInput.value = state.task.notes ?? "";
        urgentField.hidden = true;
        urgentInput.checked = true;
        deleteBtn.hidden = false;
        saveBtn.textContent = "Save";
    }

    if (dialog.open) dialog.close();
    dialog.showModal();
    queueMicrotask(() => titleInput.focus());
}

function closeModal(): void {
    const dialog = qs<HTMLDialogElement>("#task-dialog");
    if (dialog.open) dialog.close();
    modalState = null;
}

async function saveModal(): Promise<void> {
    if (!modalState) return;

    const titleInput   = qs<HTMLInputElement>("#task-title-input");
    const notesInput   = qs<HTMLTextAreaElement>("#task-notes-input");
    const ongoingInput = qs<HTMLInputElement>("#task-urgent-input");

    const title = titleInput.value.trim();
    const notes = notesInput.value.trim();

    if (!title) {
        titleInput.focus();
        return;
    }

    const db = await dbm.get();

    if (modalState.mode === "create" && modalState.target === "day") {
        await db.execute(
            `
            INSERT INTO tasks (title, notes, due_date, is_urgent, is_today, sort_order)
            VALUES (
                ?, ?, ?, ?, 0,
                (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE due_date = ?)
            )
            `,
            [title, notes, modalState.dateKey, ongoingInput.checked ? 1 : 0, modalState.dateKey]
        );
    } else if (modalState.mode === "create" && modalState.target === "ongoing") {
        await db.execute(
            `
            INSERT INTO tasks (title, notes, due_date, is_urgent, is_today, sort_order)
            VALUES (
                ?, ?, NULL, 1, 0,
                (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE due_date IS NULL AND is_urgent = 1)
            )
            `,
            [title, notes]
        );
    } else if (modalState.mode === "create" && modalState.target === "today") {
        await db.execute(
            `
            INSERT INTO tasks (title, notes, due_date, is_urgent, is_today, sort_order)
            VALUES (
                ?, ?, NULL, ?, 1,
                (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE is_today = 1)
            )
            `,
            [title, notes, ongoingInput.checked ? 1 : 0]
        );
    } else if (modalState.mode === "edit" && modalState.target === "day") {
        await db.execute(
            `
            UPDATE tasks
            SET title = ?, notes = ?, is_urgent = ?, is_today = 0, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [title, notes, ongoingInput.checked ? 1 : 0, modalState.task.id]
        );
    } else if (modalState.mode === "edit" && modalState.target === "ongoing") {
        await db.execute(
            `
            UPDATE tasks
            SET title = ?, notes = ?, due_date = NULL, is_urgent = 1, is_today = 0, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [title, notes, modalState.task.id]
        );
    } else if (modalState.mode === "edit" && modalState.target === "today") {
        await db.execute(
            `
            UPDATE tasks
            SET title = ?, notes = ?, is_urgent = ?, is_today = 1, due_date = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
                `,
            [title, notes, ongoingInput.checked ? 1 : 0, modalState.task.id]
        );
    }

    closeModal();
    await refresh();
}

async function deleteModalTask(): Promise<void> {
    if (!modalState || modalState.mode !== "edit") return;
    await dbm.deleteTask(modalState.task.id);
    closeModal();
    await refresh();
}

async function refresh(): Promise<void> {
    await loadTasksForCurrentView()
    .then(() => {
        setDayHover(null);
        setOngoingHover(false);
        clearPreview();
        renderAll();
    })
    .catch(err => {
        console.error(err);
        const grid = document.querySelector<HTMLDivElement>("#week-grid");
        const list = document.querySelector<HTMLDivElement>("#ongoing-list");
        if (grid) grid.innerHTML = `<div class="error-box">Failed to load data.</div>`;
        if (list) list.innerHTML = `<div class="error-box">Failed to load data.</div>`;
    });
}

function wireEvents(): void {
    justDragged = false;

    qs<HTMLButtonElement>("#prev-week-btn").addEventListener("click", async () => {
        currentWeekStart = addDays(currentWeekStart, -7);
        await refresh();
    });

    qs<HTMLButtonElement>("#next-week-btn").addEventListener("click", async () => {
        currentWeekStart = addDays(currentWeekStart, 7);
        await refresh();
    });

    qs<HTMLDivElement>("#week-grid").addEventListener("click", (e) => {
        if (justDragged) {
            justDragged = false;
            return;
        }

        const target = e.target as HTMLElement;

        const filledRow = target.closest<HTMLElement>(".task-row.filled");
        if (filledRow) {
            const id = Number(filledRow.dataset.taskId);
            const task = visibleTaskById.get(id);
            if (!task) return;

            if (filledRow.closest(".today-box")) openModal({ mode: "edit", target: "today", task });
            else openModal({ mode: "edit", target: "day", task });

            return;
        }

        const todayBox = target.closest<HTMLElement>(".today-box");
        if (todayBox) {
            openModal({ mode: "create", target: "today" });
            return;
        }

        const dayBox = target.closest<HTMLElement>(".day-box");
        if (dayBox) {
            const dateKey = dayBox.dataset.dayDate;
            if (dateKey) openModal({ mode: "create", target: "day", dateKey });
        }
    });

    qs<HTMLButtonElement>("#add-ongoing-btn").addEventListener("click", () => {
        openModal({ mode: "create", target: "ongoing" });
    });

    qs<HTMLDivElement>("#ongoing-list").addEventListener("click", (e) => {
        if (justDragged) {
            justDragged = false;
            return;
        }

        const target = e.target as HTMLElement;
        const item = target.closest<HTMLElement>(".ongoing-item");
        if (!item) return;
        const id = Number(item.dataset.taskId);
        const task = visibleTaskById.get(id);
        if (task) openModal({ mode: "edit", target: "ongoing", task });
    });

    qs<HTMLButtonElement>("#cancel-task-btn").addEventListener("click", () => closeModal());
    qs<HTMLButtonElement>("#delete-task-btn").addEventListener("click", async () => {
        try {
            await deleteModalTask();
        } catch (err) {
            console.error(err);
            alert("Delete failed. Check console.");
        }
    });

    qs<HTMLFormElement>("#task-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            await saveModal();
        } catch (err) {
            console.error(err);
            alert("Save failed. Check console.");
        }
    });

    qs<HTMLDivElement>("#week-grid").addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        const row = target.closest<HTMLElement>(".task-row.filled");
        if (!row) return;

        const id = Number(row.dataset.taskId);
        if (!Number.isFinite(id) || id <= 0) return;

        const inToday = !!row.closest(".today-box");

        pendingDrag = {
            taskId: id,
            kind: inToday ? "today" : "day",
            startX: e.clientX,
            startY: e.clientY,
            sourceEl: row,
        };
    }, { capture: true });

    qs<HTMLDivElement>("#ongoing-list").addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        const item = target.closest<HTMLElement>(".ongoing-item");
        if (!item) return;

        const id = Number(item.dataset.taskId);
        if (!Number.isFinite(id) || id <= 0) return;

        pendingDrag = {
            taskId: id,
            kind: "ongoing",
            startX: e.clientX,
            startY: e.clientY,
            sourceEl: item,
        };
    }, { capture: true });

    window.addEventListener("pointermove", (e) => {
        if (!pendingDrag && !activeDrag) return;

        if (pendingDrag && !activeDrag) {
            const dx = e.clientX - pendingDrag.startX;
            const dy = e.clientY - pendingDrag.startY;
            if ((dx * dx + dy * dy) < 36) return;
            beginDragFromPending(e.clientX, e.clientY);
            return;
        }

        if (!activeDrag) return;

        e.preventDefault();

        updateGhostPosition(activeDrag.ghostEl, e.clientX, e.clientY);
        if (e.clientY !== dragLastY) dragMovingDown = e.clientY > dragLastY;
        dragLastY = e.clientY;

        const ongoingHit = !!closestAtPoint<HTMLElement>("#ongoing-list", e.clientX, e.clientY);
        setOngoingHover(ongoingHit);

        if (ongoingHit) {
            setDayHover(null);
            showOngoingPreview(e.clientY, dragMovingDown);
            return;
        }

        const todayBox = closestAtPoint<HTMLElement>(".today-box", e.clientX, e.clientY);
        if (todayBox) {
            setDayHover(todayBox);
            showGridPreview("today", todayBox, e.clientY, dragMovingDown);
            return;
        }

        const dayBox = closestAtPoint<HTMLElement>(".day-box", e.clientX, e.clientY);
        setDayHover(dayBox);

        if (dayBox) showGridPreview("day", dayBox, e.clientY, dragMovingDown);
        else clearDragPreview(true);
    }, { passive: false });

    window.addEventListener("pointerup", async (e) => {
        if (!pendingDrag && !activeDrag) return;

        if (activeDrag) {
            try {
                await finishDrag(e.clientX, e.clientY);
            } catch (err) {
                console.error(err);
                cancelDrag();
            }
        } else {
            pendingDrag = null;
        }
    });

    window.addEventListener("pointercancel", () => cancelDrag());

    const dialog = qs<HTMLDialogElement>("#task-dialog");
    dialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        closeModal();
    });

    window.addEventListener("keydown", async (e) => {
        const target = e.target as HTMLElement | null;
        const typing = !!target &&
            (target.tagName === "INPUT" ||
             target.tagName === "TEXTAREA" ||
             target.isContentEditable);

        const dialogOpen = qs<HTMLDialogElement>("#task-dialog").open;
        if (typing || dialogOpen) return;

        if (e.key === "h") {
            e.preventDefault();
            currentWeekStart = addDays(currentWeekStart, -7);
            await refresh();
        } else if (e.key === "l") {
            e.preventDefault();
            currentWeekStart = addDays(currentWeekStart, 7);
            await refresh();
        }
    });
}

async function bootstrap(): Promise<void> {
    wireEvents();

    const weekGrid   = document.querySelector<HTMLDivElement>("#week-grid");
    const ongoingList = document.querySelector<HTMLDivElement>("#ongoing-list");
    if (weekGrid)    weekGrid   .innerHTML = `<div class="loading-box">Loading…</div>`;
    if (ongoingList) ongoingList.innerHTML = `<div class="loading-box">Loading…</div>`;

    await refresh();
}

void bootstrap();
