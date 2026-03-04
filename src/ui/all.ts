import type { AppState } from "../state";
import { renderWeekGrid } from "./weekGrid";
import { renderOngoingList } from "./ongoingList";
import { renderLinksPanel } from "./linksPanel";

export function renderAll(state: AppState, root: Document = document): void {
    renderWeekGrid(state, root);
    renderOngoingList(state, root);
    renderLinksPanel(state, root);

    const ongoing = root.querySelector<HTMLElement>("#ongoing-list");
    const links   = root.querySelector<HTMLElement>("#links-panel");

    const addOngoing     = root.querySelector<HTMLElement>("#add-ongoing-btn");
    const addCollection  = root.querySelector<HTMLElement>("#add-collection-btn");

    const tabOngoing = root.querySelector<HTMLElement>("#tab-ongoing-btn");
    const tabLinks   = root.querySelector<HTMLElement>("#tab-links-btn");

    const showOngoing = state.rightPanelTab === "ongoing";

    if (ongoing) ongoing.hidden = !showOngoing;
    if (links)   links.hidden   = showOngoing;

    if (addOngoing)    addOngoing.hidden    = !showOngoing;
    if (addCollection) addCollection.hidden =  showOngoing;

    tabOngoing?.classList.toggle("active",  showOngoing);
    tabLinks  ?.classList.toggle("active", !showOngoing);
}
