import "./styles.css";
import { state } from "./state";
import { Task } from "./task";
import { getWeekDateKeys } from "./utils/date";
import { renderAll } from "./ui/all";
import { wireEvents } from "./ui/events";
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

async function bootstrap(): Promise<void> {
    wireEvents({ state, modal, drag, refresh });

    const weekGrid    = document.querySelector<HTMLDivElement>("#week-grid");
    const ongoingList = document.querySelector<HTMLDivElement>("#ongoing-list");
    if (weekGrid)    weekGrid   .innerHTML = `<div class="loading-box">Loading…</div>`;
    if (ongoingList) ongoingList.innerHTML = `<div class="loading-box">Loading…</div>`;

    await refresh();
}

void bootstrap();
