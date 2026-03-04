import "./styles.css";
import { state } from "./state";
import { fetchViewTasks } from "./data/viewTasks";
import { renderAll } from "./ui/all";
import { wireEvents } from "./ui/events";
import { ModalController } from "./controllers/modal";
import { LinksModalController } from "./controllers/linksModal";
import { DragController } from "./controllers/drag";

const modal = new ModalController({ state, refresh });
const linksModal = new LinksModalController({ state, refresh });

const drag = new DragController({
    state,
    refresh,
    render: () => renderAll(state),
});

async function refresh(): Promise<void> {
    await fetchViewTasks(state.dbm, state.currentWeekStart)
    .then(data => {

        state.weekTasks    = data.weekTasks;
        state.todayTasks   = data.todayTasks;
        state.ongoingTasks = data.ongoingTasks;

        state.visibleTaskById = data.visibleTaskById;

        state.linkCollections      = data.linkCollections;
        state.linksByCollectionId  = data.linksByCollectionId;
        state.taskLinkMetaByTaskId = data.taskLinkMetaByTaskId;

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
    wireEvents({ state, modal, linksModal, drag, refresh });

    const weekGrid    = document.querySelector<HTMLDivElement>("#week-grid");
    const ongoingList = document.querySelector<HTMLDivElement>("#ongoing-list");
    if (weekGrid)    weekGrid   .innerHTML = `<div class="loading-box">Loading…</div>`;
    if (ongoingList) ongoingList.innerHTML = `<div class="loading-box">Loading…</div>`;

    await refresh();
}

void bootstrap();
