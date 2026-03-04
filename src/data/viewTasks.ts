import type { DBManager } from "../db";
import type { Task } from "../task";
import type { LinkCollection, Link } from "../links";
import { getWeekDateKeys } from "../utils/date";

export type ViewTasks = {
    weekTasks:    Task[];
    todayTasks:   Task[];
    ongoingTasks: Task[];

    visibleTaskById: Map<number, Task>;

    linkCollections:      LinkCollection[];
    linksByCollectionId:  Map<number, Link[]>;
    taskLinkMetaByTaskId: Map<number, { collectionIds: number[]; colors: string[] }>;
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

    const linkCollections = await dbm.getCollections();
    const collectionIds = linkCollections.map((c) => c.id);

    const allLinks = await dbm.getLinksForCollections(collectionIds);
    const linksByCollectionId = new Map<number, Link[]>();
    for (const l of allLinks) {
        const arr = linksByCollectionId.get(l.collection_id) ?? [];
        arr.push(l);
        linksByCollectionId.set(l.collection_id, arr);
    }

    const visibleTaskIds = Array.from(visibleTaskById.keys());
    const joinRows = await dbm.getTaskLinkJoinRowsForTasks(visibleTaskIds);

    const colorByCollectionId = new Map<number, string>();
    for (const c of linkCollections) colorByCollectionId.set(c.id, c.color);

    const taskLinkMetaByTaskId = new Map<number, { collectionIds: number[]; colors: string[] }>();
    for (const row of joinRows) {
        const prev = taskLinkMetaByTaskId.get(row.task_id) ?? { collectionIds: [], colors: [] };

        const last = prev.collectionIds[prev.collectionIds.length - 1];
        if (last !== row.collection_id) {
            prev.collectionIds.push(row.collection_id);
            prev.colors.push(colorByCollectionId.get(row.collection_id) ?? row.collection_color);
        }

        taskLinkMetaByTaskId.set(row.task_id, prev);
    }

    return {
        weekTasks,
        ongoingTasks,
        todayTasks,
        visibleTaskById,

        linkCollections,
        linksByCollectionId,
        taskLinkMetaByTaskId,
    };
}
