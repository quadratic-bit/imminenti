import { DBManager } from "./db";
import { Task, Location } from "./task";

export type ModalState = { mode: "create"; location: Location }
                       | { mode: "edit";   task:     Task     };

export type AppState = {
    dbm: DBManager;

    currentWeekStart: Date;

    weekTasks:    Task[];
    todayTasks:   Task[];
    ongoingTasks: Task[];

    visibleTaskById: Map<number, Task>;

    suppressNextClick: boolean;

    modal: ModalState | null;
};

function startOfWeek(d: Date): Date {
    const x    = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow  = x.getDay();
    const diff = dow === 0 ? -6 : 1 - dow; // maybe make it customizable
    x.setDate(x.getDate() + diff);
    return x;
}

export function createInitialState(now = new Date()): AppState {
    return {
        dbm: new DBManager(),

        currentWeekStart: startOfWeek(now),

        weekTasks: [],
        todayTasks: [],
        ongoingTasks: [],

        visibleTaskById: new Map(),

        suppressNextClick: false,

        modal: null,
    };
}

export const state: AppState = createInitialState();
