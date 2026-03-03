import { DBManager } from "./db";
import { Task } from "./task";
import { startOfWeek } from "./utils/date";

export type AppState = {
    dbm: DBManager;

    currentWeekStart: Date;

    weekTasks:    Task[];
    todayTasks:   Task[];
    ongoingTasks: Task[];

    visibleTaskById: Map<number, Task>;

    suppressNextClick: boolean;
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
    };
}

export const state: AppState = createInitialState();
