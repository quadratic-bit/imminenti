import { DBManager } from "./db";
import { Task, Location } from "./task";
import { startOfWeek } from "./utils/date";

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
