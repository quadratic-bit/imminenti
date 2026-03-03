import type { DBManager } from "../db";
import type { Task } from "../task";
import { getWeekDateKeys } from "../utils/date";

export type ViewTasks = {
    weekTasks:    Task[];
    todayTasks:   Task[];
    ongoingTasks: Task[];

    visibleTaskById: Map<number, Task>;
};

export async function fetchViewTasks(dbm: DBManager, currentWeekStart: Date): Promise<ViewTasks> {
    const weekKeys = getWeekDateKeys(currentWeekStart);
    const weekStartKey = weekKeys[0];
    const weekEndKey   = weekKeys[6];

    const weekTasks    = await dbm.getWeekTasks(weekStartKey, weekEndKey);
    const ongoingTasks = await dbm.getOngoingTasks();
    const todayTasks   = await dbm.getTodayTasks();

    const visibleTaskById = new Map<number, Task>();
    for (const t of weekTasks)    visibleTaskById.set(t.id, t);
    for (const t of ongoingTasks) visibleTaskById.set(t.id, t);
    for (const t of todayTasks)   visibleTaskById.set(t.id, t);

    return { weekTasks, ongoingTasks, todayTasks, visibleTaskById };
}
