import { DBManager } from "./db";
import { Task } from "./task";
import type { LinkCollection, Link } from "./links";
import { startOfWeek } from "./utils/date";

export type AppState = {
    dbm: DBManager;

    currentWeekStart: Date;

    weekTasks:    Task[];
    todayTasks:   Task[];
    ongoingTasks: Task[];

    visibleTaskById: Map<number, Task>;

    linkCollections:      LinkCollection[];
    linksByCollectionId:  Map<number, Link[]>;
    taskLinkMetaByTaskId: Map<number, { collectionIds: number[]; colors: string[] }>;

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

        linkCollections: [],
        linksByCollectionId:  new Map(),
        taskLinkMetaByTaskId: new Map(),

        suppressNextClick: false,
    };
}

export const state: AppState = createInitialState();
