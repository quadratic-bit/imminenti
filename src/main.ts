import "./styles.css";
import { state } from "./state";
import { Task, DateKey } from "./task";
import { addDays, getWeekDateKeys } from "./utils/date";
import { isTypingTarget, qs } from "./utils/dom";
import { renderAll } from "./ui/all";
import { ModalController } from "./controllers/modal";
import { DragController } from "./controllers/drag";

const modal = new ModalController({ state, refresh });

const drag = new DragController({
    state,
    refresh,
    render: () => renderAll(state),
});

async function loadTasksForCurrentView(): Promise<void> {
    const weekKeys = getWeekDateKeys(state.currentWeekStart);
    const weekStartKey = weekKeys[0];
    const weekEndKey   = weekKeys[6];

    state.weekTasks    = await state.dbm.getWeekTasks(weekStartKey, weekEndKey);
    state.ongoingTasks = await state.dbm.getOngoingTasks();
    state.todayTasks   = await state.dbm.getTodayTasks();

    state.visibleTaskById = new Map<number, Task>();
    for (const t of state.weekTasks)    state.visibleTaskById.set(t.id, t);
    for (const t of state.ongoingTasks) state.visibleTaskById.set(t.id, t);
    for (const t of state.todayTasks)   state.visibleTaskById.set(t.id, t);
}

async function refresh(): Promise<void> {
    await loadTasksForCurrentView()
    .then(() => {
        drag.resetForRender();
        renderAll(state);
    })
    .catch(err => {
        console.error(err);
        const grid = document.querySelector<HTMLDivElement>("#week-grid");
        const list = document.querySelector<HTMLDivElement>("#ongoing-list");
        drag.resetForRender();
        if (grid) grid.innerHTML = `<div class="error-box">Failed to load data.</div>`;
        if (list) list.innerHTML = `<div class="error-box">Failed to load data.</div>`;
    });
}

function wireEvents(): void {
    modal.attach();
    drag.attach();

    qs<HTMLButtonElement>("#prev-week-btn").addEventListener("click", async () => {
        state.currentWeekStart = addDays(state.currentWeekStart, -7);
        await refresh();
    });

    qs<HTMLButtonElement>("#next-week-btn").addEventListener("click", async () => {
        state.currentWeekStart = addDays(state.currentWeekStart, 7);
        await refresh();
    });


    qs<HTMLButtonElement>("#add-ongoing-btn").addEventListener("click", () => {
        modal.openCreate({ kind: "ongoing" });
    });

    qs<HTMLButtonElement>("#ongoing-list").addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        const item = target.closest<HTMLElement>(".ongoing-item");
        if (!item) return;
        const id = Number(item.dataset.taskId);
        const task = state.visibleTaskById.get(id);
        if (task) modal.openEdit(task);
    });

    qs<HTMLDivElement>("#week-grid").addEventListener("click", (e) => {
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

async function bootstrap(): Promise<void> {
    wireEvents();

    const weekGrid    = document.querySelector<HTMLDivElement>("#week-grid");
    const ongoingList = document.querySelector<HTMLDivElement>("#ongoing-list");
    if (weekGrid)    weekGrid   .innerHTML = `<div class="loading-box">Loading…</div>`;
    if (ongoingList) ongoingList.innerHTML = `<div class="loading-box">Loading…</div>`;

    await refresh();
}

void bootstrap();
