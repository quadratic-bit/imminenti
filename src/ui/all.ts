import type { AppState } from "../state";
import { renderWeekGrid } from "./weekGrid";
import { renderOngoingList } from "./ongoingList";

export function renderAll(state: AppState, root: Document = document): void {
    renderWeekGrid(state, root);
    renderOngoingList(state, root);
}
