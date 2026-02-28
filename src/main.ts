import "./styles.css";
import Database from "@tauri-apps/plugin-sql";

type TaskRow = {
    id: number;
    title: string;
    notes: string | null;
    due_date: string | null; // YYYY-MM-DD
    is_urgent: number;       // 0/1
    created_at: string;
    updated_at: string;
};

type ModalState = { mode: "create"; target: "day";    dateKey: string }
                | { mode: "create"; target: "urgent"                  }
                | { mode: "edit";   target: "day";    task: TaskRow   }
                | { mode: "edit";   target: "urgent"; task: TaskRow   };

type SqlDb = Awaited<ReturnType<typeof Database.load>>;

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

let dbPromise: Promise<SqlDb> | null = null;

let currentWeekStart = startOfWeek(new Date());
let weekTasks: TaskRow[] = [];
let urgentNoDeadlineTasks: TaskRow[] = [];
let visibleTaskById = new Map<number, TaskRow>();

let modalState: ModalState | null = null;

type DragKind = "day" | "urgent";

type PendingDrag = {
    taskId: number;
    kind: DragKind;
    startX: number;
    startY: number;
    sourceEl: HTMLElement;
};

type ActiveDrag = {
    taskId: number;
    kind: DragKind;
    sourceEl: HTMLElement;
    ghostEl: HTMLDivElement;

    startRect: DOMRect;
    startKind: DragKind;
    startContainer: HTMLElement | null;
    startIndex: number;
};

let pendingDrag: PendingDrag | null = null;
let activeDrag: ActiveDrag | null = null;
let dragLastY = 0;
let dragMovingDown = true;

let hoveredDayBox: HTMLElement | null = null;
let justDragged = false;

let previewEl: HTMLElement | null = null;
let previewKind: DragKind | null = null;
let previewContainer: HTMLElement | null = null;
let previewIndex = -1;

let borrowedEmpty: { row: HTMLElement; parent: HTMLElement } | null = null;

function closestAtPoint<T extends Element>(selector: string, x: number, y: number): T | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return (el?.closest(selector) as T | null) ?? null;
}

function setDayHover(dayBox: HTMLElement | null): void {
    if (hoveredDayBox && hoveredDayBox !== dayBox) hoveredDayBox.classList.remove("drop-hover");
    hoveredDayBox = dayBox;
    if (hoveredDayBox) hoveredDayBox.classList.add("drop-hover");
}

function setUrgentHover(on: boolean): void {
    const list = document.querySelector<HTMLElement>("#urgent-list");
    if (!list) return;
    list.classList.toggle("drop-hover-urgent", on);
}

function setUrgentPreviewing(on: boolean): void {
    const list = document.querySelector<HTMLElement>("#urgent-list");
    if (!list) return;
    list.classList.toggle("previewing", on);
}

function updateGhostPosition(ghost: HTMLElement, x: number, y: number): void {
    ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
}

function restoreBorrowedEmpty(): void {
    if (!borrowedEmpty) return;
    if (borrowedEmpty.parent.isConnected) borrowedEmpty.parent.appendChild(borrowedEmpty.row);
    borrowedEmpty = null;
}

function borrowEmptyRow(container: HTMLElement): void {
    if (borrowedEmpty?.parent === container) return;
    restoreBorrowedEmpty();

    const empty = container.querySelector<HTMLElement>(".task-row.empty");
    if (!empty) return;

    borrowedEmpty = { row: empty, parent: container };
    empty.remove();
}

function clearPreview(): void {
    previewEl?.remove();
    previewEl = null;
    previewKind = null;
    previewContainer = null;
    previewIndex = -1;

    restoreBorrowedEmpty();
    setUrgentPreviewing(false);
}

function buildPreview(kind: DragKind, taskId: number): HTMLElement {
    const task = visibleTaskById.get(taskId);

    if (kind === "urgent") {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "urgent-item drag-preview";
        el.dataset.taskId = String(taskId);

        const title = escapeHtml(task?.title ?? `#${taskId}`);
        const notes = task?.notes?.trim()
            ? `<div class="urgent-notes">${escapeHtml(task.notes.trim())}</div>`
            : "";

        el.innerHTML = `
            <div class="urgent-item-title">${title}</div>
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
    const urgentMark = task?.is_urgent ? `<span class="urgent-pill">urgent</span>` : "";

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
    if (previewEl && previewKind === kind && previewContainer === container) return;

    clearPreview();
    previewKind = kind;
    previewContainer = container;
    previewEl = buildPreview(kind, activeDrag.taskId);
    previewIndex = -1;

    if (kind === "day") borrowEmptyRow(container);
    else setUrgentPreviewing(true);

    container.appendChild(previewEl);
}

function computeInsertIndex(
    items: HTMLElement[],
    y: number,
    container: HTMLElement,
    kind: DragKind,
    movingDown: boolean
): number {
    if (
        activeDrag &&
        activeDrag.startKind === kind &&
        activeDrag.startContainer === container &&
        y >= activeDrag.startRect.top &&
        y <= activeDrag.startRect.bottom
    ) {
        return Math.max(0, Math.min(activeDrag.startIndex, items.length));
    }

    if (movingDown) {
        for (let i = 0; i < items.length; i++) {
            const r = items[i].getBoundingClientRect();
            if (y < r.top) return i;
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

function showDayPreview(dayBox: HTMLElement, pointerY: number, movingDown: boolean): void {
    if (!activeDrag) return;
    const container = dayBox.querySelector<HTMLElement>(".day-rows");
    if (!container) return;

    ensurePreview("day", container);

    const items = Array.from(container.querySelectorAll<HTMLElement>(".task-row.filled"))
        .filter((el) => !el.classList.contains("drag-preview"))
        .filter((el) => !el.classList.contains("drag-source"));

    const idx = computeInsertIndex(items, pointerY, container, "day", movingDown);
    if (idx === previewIndex) return;
    previewIndex = idx;

    const ref = items[idx] ?? container.querySelector<HTMLElement>(".task-row.empty") ?? null;
    if (previewEl) container.insertBefore(previewEl, ref);
}

function showUrgentPreview(pointerY: number, movingDown: boolean): void {
    if (!activeDrag) return;
    const container = document.querySelector<HTMLElement>("#urgent-list");
    if (!container) return;

    ensurePreview("urgent", container);

    const items = Array.from(container.querySelectorAll<HTMLElement>(".urgent-item"))
        .filter((el) => !el.classList.contains("drag-preview"))
        .filter((el) => !el.classList.contains("drag-source"));

    const idx = computeInsertIndex(items, pointerY, container, "urgent", movingDown);
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

async function setSortOrder(ids: number[]): Promise<void> {
    const db = await getDb();
    await db.execute("BEGIN");
    try {
        for (let i = 0; i < ids.length; i++) {
            await db.execute(`UPDATE tasks SET sort_order = ? WHERE id = ?`, [i + 1, ids[i]]);
        }
        await db.execute("COMMIT");
    } catch (e) {
        await db.execute("ROLLBACK");
        throw e;
    }
}

async function moveTaskToUrgent(taskId: number): Promise<void> {
    const db = await getDb();
    await db.execute(
        `UPDATE tasks SET due_date = NULL, is_urgent = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [taskId]
    );
}

async function moveTaskToDay(taskId: number, dateKey: string): Promise<void> {
    const db = await getDb();
    await db.execute(
        `UPDATE tasks SET due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [dateKey, taskId]
    );
}

function beginDragFromPending(x: number, y: number): void {
    if (!pendingDrag) return;

    const task = visibleTaskById.get(pendingDrag.taskId);
    const title = task?.title ?? `#${pendingDrag.taskId}`;

    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = title;
    document.body.appendChild(ghost);
    updateGhostPosition(ghost, x, y);

    const startRect = pendingDrag.sourceEl.getBoundingClientRect();

    let startContainer: HTMLElement | null = null;
    let startIndex = 0;

    if (pendingDrag.kind === "day") {
        startContainer = pendingDrag.sourceEl.closest<HTMLElement>(".day-rows");
        if (startContainer) {
            const filled = Array.from(startContainer.querySelectorAll<HTMLElement>(".task-row.filled"));
            startIndex = filled.indexOf(pendingDrag.sourceEl);
        }
    } else {
        startContainer = document.querySelector<HTMLElement>("#urgent-list");
        if (startContainer) {
            const items = Array.from(startContainer.querySelectorAll<HTMLElement>(".urgent-item"));
            startIndex = items.indexOf(pendingDrag.sourceEl);
        }
    }
    if (startIndex < 0) startIndex = 0;

    pendingDrag.sourceEl.classList.add("drag-source");
    pendingDrag.sourceEl.style.display = "none";
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

    if (activeDrag.kind === "urgent") {
        setUrgentHover(true);
        showUrgentPreview(y, true);
    } else {
        const box = activeDrag.sourceEl.closest<HTMLElement>(".day-box");
        if (box) {
            setDayHover(box);
            showDayPreview(box, y, true);
        }
    }
}

function cleanupDragVisuals(): void {
    if (activeDrag) {
        activeDrag.sourceEl.classList.remove("drag-source");
        activeDrag.sourceEl.style.display = "";
        activeDrag.ghostEl.remove();
    }
    pendingDrag = null;
    activeDrag = null;

    setDayHover(null);
    setUrgentHover(false);
    clearPreview();
    document.body.classList.remove("dragging");
}

function cancelDrag(): void {
    cleanupDragVisuals();
}

async function finishDrag(dropX: number, dropY: number): Promise<void> {
    if (!activeDrag) return;

    const drag = activeDrag;
    const draggedId = drag.taskId;

    const urgentHit = !!closestAtPoint<HTMLElement>("#urgent-list", dropX, dropY);
    const dayBox = urgentHit ? null : closestAtPoint<HTMLElement>(".day-box", dropX, dropY);
    const dropDateKey = dayBox?.dataset.dayDate ?? null;

    let applyDbChange: (() => Promise<void>) | null = null;

    if (urgentHit) {
        const list = document.querySelector<HTMLElement>("#urgent-list");
        if (list) {
            const ids = orderFromDom(list, ".urgent-item", draggedId);
            if (ids.length) {
                applyDbChange = async () => {
                    await moveTaskToUrgent(draggedId);
                    await setSortOrder(ids);
                };
            }
        }
    } else if (dropDateKey) {
        const container = dayBox?.querySelector<HTMLElement>(".day-rows");
        if (container) {
            const ids = orderFromDom(container, ".task-row.filled", draggedId);
            if (ids.length) {
                applyDbChange = async () => {
                    await moveTaskToDay(draggedId, dropDateKey);
                    await setSortOrder(ids);
                };
            }
        }
    }

    if (!applyDbChange) {
        cleanupDragVisuals();
        return;
    }

    pendingDrag = null;
    activeDrag = null;

    setDayHover(null);
    setUrgentHover(false);

    drag.ghostEl.remove();
    document.body.classList.remove("dragging");

    try {
        await applyDbChange();
        await refresh();
    } catch (err) {
        if (drag.sourceEl.isConnected) {
            drag.sourceEl.classList.remove("drag-source");
            drag.sourceEl.style.display = "";
        }
        clearPreview();
        throw err;
    } finally {
        clearPreview();
    }
}

function escapeHtml(input: string): string {
    return input.replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
}

function dateToKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
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
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = x.getDay();
    const diff = dow === 0 ? -6 : 1 - dow; // shift to Monday cuz I'm slav
    x.setDate(x.getDate() + diff);
    return x;
}

function getWeekDateKeys(weekStart: Date): string[] {
    return Array.from({ length: 7 }, (_, i) => dateToKey(addDays(weekStart, i)));
}

function formatWeekRange(weekStart: Date): string {
    const end = addDays(weekStart, 6);
    const fmt = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
    return `${fmt.format(weekStart)} — ${fmt.format(end)}`;
}

function formatLongDate(key: string): string {
    return new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        year: "numeric",
        month: "short",
        day: "numeric",
    }).format(keyToDate(key));
}

function formatMonthDay(key: string): string {
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
    }).format(keyToDate(key));
}

function byDueDateMap(tasks: TaskRow[]): Map<string, TaskRow[]> {
    const m = new Map<string, TaskRow[]>();
    for (const t of tasks) {
        if (!t.due_date) continue;
        const arr = m.get(t.due_date) ?? [];
        arr.push(t);
        m.set(t.due_date, arr);
    }
    return m;
}

async function getDb(): Promise<SqlDb> {
    if (!dbPromise) dbPromise = initDb();
    return dbPromise;
}

async function initDb(): Promise<SqlDb> {
    const db = await Database.load("sqlite:imminenti.db");

    await db.execute(`
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            notes TEXT DEFAULT '',
            due_date TEXT NULL, -- YYYY-MM-DD or NULL
            is_urgent INTEGER NOT NULL DEFAULT 0 CHECK (is_urgent IN (0,1)),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_tasks_due_date
        ON tasks(due_date)
    `);

    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_tasks_urgent_due
        ON tasks(is_urgent, due_date)
    `);

    return db;
}

async function loadTasksForCurrentView(): Promise<void> {
    const db = await getDb();
    const weekKeys = getWeekDateKeys(currentWeekStart);
    const weekStartKey = weekKeys[0];
    const weekEndKey = weekKeys[6];

    weekTasks = await db.select<TaskRow[]>(
        `
        SELECT id, title, notes, due_date, is_urgent, created_at, updated_at
        FROM tasks
        WHERE due_date >= ? AND due_date <= ?
        ORDER BY due_date ASC, sort_order ASC, id ASC
        `,
        [weekStartKey, weekEndKey]
    );

    urgentNoDeadlineTasks = await db.select<TaskRow[]>(`
        SELECT id, title, notes, due_date, is_urgent, created_at, updated_at
        FROM tasks
        WHERE due_date IS NULL AND is_urgent = 1
        ORDER BY sort_order ASC, id ASC
    `);

    visibleTaskById = new Map<number, TaskRow>();
    for (const t of weekTasks) visibleTaskById.set(t.id, t);
    for (const t of urgentNoDeadlineTasks) visibleTaskById.set(t.id, t);
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
        const tasks = grouped.get(dateKey) ?? [];
        const slots = Math.max(6, tasks.length);

        const rows = Array.from({ length: slots }, (_, i) => {
            const task = tasks[i];
            if (!task) {
                return `<div class="task-row empty" data-day-date="${dateKey}" data-empty="1"></div>`;
            }
            const urgentMark = task.is_urgent ? `<span class="urgent-pill">urgent</span>` : "";
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

        const isToday = dateKey === todayKey;
        const isPast  = dateKey < todayKey;

        return `
            <div class="day-box ${isToday ? "today" : ""} ${isPast ? "past" : ""}" data-day-date="${dateKey}" title="Click to add task">
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

    const cells = [
        `<div class="grid-cell">${renderDayBox(0)}</div>`,
        `<div class="grid-cell">${renderDayBox(3)}</div>`,
        `<div class="grid-cell">${renderDayBox(1)}</div>`,
        `<div class="grid-cell">${renderDayBox(4)}</div>`,
        `<div class="grid-cell">${renderDayBox(2)}</div>`,
        `<div class="grid-cell">${renderDayBox(5)}</div>`,
        `<div class="grid-cell empty-grid-cell" aria-hidden="true"></div>`,
        `<div class="grid-cell">${renderDayBox(6)}</div>`,
    ].join("");

    weekGrid.innerHTML = `
        <div class="week-grid-4x2">
            ${cells}
        </div>
    `;
}

function renderUrgentList(): void {
    const list = document.querySelector<HTMLDivElement>("#urgent-list");
    if (!list) return;

    if (urgentNoDeadlineTasks.length === 0) {
        list.innerHTML = `<div class="empty-urgent">No urgent tasks without a concrete deadline.</div>`;
        return;
    }

    list.innerHTML = urgentNoDeadlineTasks.map((t) => {
        const title = escapeHtml(t.title);
        const notes = t.notes?.trim()
            ? `<div class="urgent-notes">${escapeHtml(t.notes.trim())}</div>`
            : "";
        return `
            <button type="button" class="urgent-item" data-task-id="${t.id}" title="Click to edit">
                <div class="urgent-item-title">${title}</div>
                ${notes}
            </button>
        `;
    }).join("");
}

function renderAll(): void {
    renderWeekGrid();
    renderUrgentList();
}

function qs<T extends Element>(selector: string): T {
    const el = document.querySelector<T>(selector);
    if (!el) throw new Error(`Missing element: ${selector}`);
    return el;
}

function openModal(state: ModalState): void {
    modalState = state;

    const dialog      = qs<HTMLDialogElement>  ("#task-dialog");
    const titleEl     = qs<HTMLHeadingElement> ("#dialog-title");
    const contextEl   = qs<HTMLDivElement>     ("#dialog-context");
    const titleInput  = qs<HTMLInputElement>   ("#task-title-input");
    const notesInput  = qs<HTMLTextAreaElement>("#task-notes-input");
    const urgentField = qs<HTMLLabelElement>   ("#task-urgent-field");
    const urgentInput = qs<HTMLInputElement>   ("#task-urgent-input");
    const deleteBtn   = qs<HTMLButtonElement>  ("#delete-task-btn");
    const saveBtn     = qs<HTMLButtonElement>  ("#save-task-btn");

    if (state.mode === "create" && state.target === "day") {
        titleEl.textContent = "Add task";
        contextEl.textContent = `Due: ${formatLongDate(state.dateKey)}`;
        titleInput.value = "";
        notesInput.value = "";
        urgentField.hidden = false;
        urgentInput.checked = false;
        deleteBtn.hidden = true;
        saveBtn.textContent = "Create";
    } else if (state.mode === "create" && state.target === "urgent") {
        titleEl.textContent = "Add urgent task";
        contextEl.textContent = "Urgent task without a concrete deadline";
        titleInput.value = "";
        notesInput.value = "";
        urgentField.hidden = true;
        urgentInput.checked = true;
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
        urgentInput.checked = state.task.is_urgent === 1;
        deleteBtn.hidden = false;
        saveBtn.textContent = "Save";
    } else {
        titleEl.textContent = "Edit urgent task";
        contextEl.textContent = "Urgent task without a concrete deadline";
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

    const titleInput = qs<HTMLInputElement>("#task-title-input");
    const notesInput = qs<HTMLTextAreaElement>("#task-notes-input");
    const urgentInput = qs<HTMLInputElement>("#task-urgent-input");

    const title = titleInput.value.trim();
    const notes = notesInput.value.trim();

    if (!title) {
        titleInput.focus();
        return;
    }

    const db = await getDb();

    if (modalState.mode === "create" && modalState.target === "day") {
        await db.execute(
            `
            INSERT INTO tasks (title, notes, due_date, is_urgent, sort_order)
            VALUES (
                ?, ?, ?, ?,
                (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE due_date = ?)
            )
            `,
            [title, notes, modalState.dateKey, urgentInput.checked ? 1 : 0, modalState.dateKey]
        );
    } else if (modalState.mode === "create" && modalState.target === "urgent") {
        await db.execute(
            `
            INSERT INTO tasks (title, notes, due_date, is_urgent, sort_order)
            VALUES (
                ?, ?, NULL, 1,
                (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE due_date IS NULL AND is_urgent = 1)
            )
            `,
            [title, notes]
        );
    } else if (modalState.mode === "edit" && modalState.target === "day") {
        await db.execute(
            `
            UPDATE tasks
            SET title = ?, notes = ?, is_urgent = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [title, notes, urgentInput.checked ? 1 : 0, modalState.task.id]
        );
    } else if (modalState.mode === "edit" && modalState.target === "urgent") {
        await db.execute(
            `
            UPDATE tasks
            SET title = ?, notes = ?, due_date = NULL, is_urgent = 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [title, notes, modalState.task.id]
        );
    }

    closeModal();
    await refresh();
}

async function deleteModalTask(): Promise<void> {
    if (!modalState || modalState.mode !== "edit") return;
    const db = await getDb();
    await db.execute(`DELETE FROM tasks WHERE id = ?`, [modalState.task.id]);
    closeModal();
    await refresh();
}

async function refresh(): Promise<void> {
    try {
        await loadTasksForCurrentView();
        setDayHover(null);
        setUrgentHover(false);
        clearPreview();
        renderAll();
    } catch (err) {
        console.error(err);
        const grid = document.querySelector<HTMLDivElement>("#week-grid");
        const list = document.querySelector<HTMLDivElement>("#urgent-list");
        if (grid) grid.innerHTML = `<div class="error-box">Failed to load data. Check console.</div>`;
        if (list) list.innerHTML = `<div class="error-box">Failed to load data. Check console.</div>`;
    }
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
            if (task) openModal({ mode: "edit", target: "day", task });
            return;
        }

        const dayBox = target.closest<HTMLElement>(".day-box");
        if (dayBox) {
            const dateKey = dayBox.dataset.dayDate;
            if (dateKey) openModal({ mode: "create", target: "day", dateKey });
        }
    });

    qs<HTMLButtonElement>("#add-urgent-btn").addEventListener("click", () => {
        openModal({ mode: "create", target: "urgent" });
    });

    qs<HTMLDivElement>("#urgent-list").addEventListener("click", (e) => {
        if (justDragged) {
            justDragged = false;
            return;
        }

        const target = e.target as HTMLElement;
        const item = target.closest<HTMLElement>(".urgent-item");
        if (!item) return;
        const id = Number(item.dataset.taskId);
        const task = visibleTaskById.get(id);
        if (task) openModal({ mode: "edit", target: "urgent", task });
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

        pendingDrag = {
            taskId: id,
            kind: "day",
            startX: e.clientX,
            startY: e.clientY,
            sourceEl: row,
        };
    }, { capture: true });

    qs<HTMLDivElement>("#urgent-list").addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        const item = target.closest<HTMLElement>(".urgent-item");
        if (!item) return;

        const id = Number(item.dataset.taskId);
        if (!Number.isFinite(id) || id <= 0) return;

        pendingDrag = {
            taskId: id,
            kind: "urgent",
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

        const urgentHit = !!closestAtPoint<HTMLElement>("#urgent-list", e.clientX, e.clientY);
        setUrgentHover(urgentHit);

        if (urgentHit) {
            setDayHover(null);
            showUrgentPreview(e.clientY, dragMovingDown);
            return;
        }

        const dayBox = closestAtPoint<HTMLElement>(".day-box", e.clientX, e.clientY);
        setDayHover(dayBox);

        if (dayBox) showDayPreview(dayBox, e.clientY, dragMovingDown);
        else clearPreview();
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

    const weekGrid = document.querySelector<HTMLDivElement>("#week-grid");
    const urgentList = document.querySelector<HTMLDivElement>("#urgent-list");
    if (weekGrid) weekGrid.innerHTML = `<div class="loading-box">Loading…</div>`;
    if (urgentList) urgentList.innerHTML = `<div class="loading-box">Loading…</div>`;

    await refresh();
}

void bootstrap();
