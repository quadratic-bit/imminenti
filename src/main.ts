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
    const dow = x.getDay();                // Sun=0..Sat=6
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
        ORDER BY due_date ASC, id ASC
        `,
        [weekStartKey, weekEndKey]
    );

    urgentNoDeadlineTasks = await db.select<TaskRow[]>(`
        SELECT id, title, notes, due_date, is_urgent, created_at, updated_at
        FROM tasks
        WHERE due_date IS NULL AND is_urgent = 1
        ORDER BY id ASC
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

        return `
            <div class="day-box" data-day-date="${dateKey}" title="Click to add task">
                <div class="day-label-strip">
                    <div class="day-label-rot">${DAY_LABELS[weekIndex]}</div>
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
        urgentInput.checked = true; // forced
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
        urgentInput.checked = true; // forced
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
            `INSERT INTO tasks (title, notes, due_date, is_urgent) VALUES (?, ?, ?, ?)`,
            [title, notes, modalState.dateKey, urgentInput.checked ? 1 : 0]
        );
    } else if (modalState.mode === "create" && modalState.target === "urgent") {
        await db.execute(
            `INSERT INTO tasks (title, notes, due_date, is_urgent) VALUES (?, ?, NULL, 1)`,
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
    qs<HTMLButtonElement>("#prev-week-btn").addEventListener("click", async () => {
        currentWeekStart = addDays(currentWeekStart, -7);
        await refresh();
    });

    qs<HTMLButtonElement>("#next-week-btn").addEventListener("click", async () => {
        currentWeekStart = addDays(currentWeekStart, 7);
        await refresh();
    });

    qs<HTMLDivElement>("#week-grid").addEventListener("click", (e) => {
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
