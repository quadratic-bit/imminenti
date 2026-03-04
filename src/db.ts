import Database from "@tauri-apps/plugin-sql";
import { Task, DateKey, Location } from "./task";
import type { LinkCollection, Link } from "./links";
import { assertHexColor, normalizeUrl } from "./utils/validate";

type SqlDb = Awaited<ReturnType<typeof Database.load>>;

type TaskRow = {
    id:         number;
    title:      string;
    notes:      string | null;
    due_date:   string | null; // YYYY-MM-DD
    is_urgent:  number;        // 0/1
    is_today:   number;        // 0/1
    sort_order: number;
    created_at: string;
    updated_at: string;
};

const toTask = (r: TaskRow): Task => {
    const due = (r.due_date as DateKey | null) ?? null;
    const isToday = r.is_today === 1;

    const location: Location =
        isToday ? { kind: "today" } :
        due     ? { kind: "day", dateKey: due } :
                  { kind: "ongoing" };

    return {
        id: r.id,
        title: r.title,
        notes: r.notes ?? "",
        due_date: due,
        urgent: r.is_urgent === 1,
        today: isToday,
        sort_order: r.sort_order,
        created_at: r.created_at,
        updated_at: r.updated_at,
        location
    }
};

type LinkCollectionRow = {
    id:         number;
    name:       string;
    color:      string;
    sort_order: number;
    created_at: string;
    updated_at: string;
};

type LinkRow = {
    id:            number;
    collection_id: number;
    title:         string;
    url:           string;
    sort_order:    number;
    created_at:    string;
    updated_at:    string;
};

const toLinkCollection = (r: LinkCollectionRow): LinkCollection => ({
    id: r.id,
    name: r.name,
    color: r.color,
    sort_order: r.sort_order,
    created_at: r.created_at,
    updated_at: r.updated_at,
});

const toLink = (r: LinkRow): Link => ({
    id: r.id,
    collection_id: r.collection_id,
    title: r.title,
    url: r.url,
    sort_order: r.sort_order,
    created_at: r.created_at,
    updated_at: r.updated_at,
});

export type TaskLinkJoinRow = {
    task_id: number;

    collection_id:         number;
    collection_color:      string;
    collection_sort_order: number;

    link_id:         number;
    link_title:      string;
    link_url:        string;
    link_sort_order: number;
};

export class DBManager {
    private promise: Promise<SqlDb> | null = null;

    private async init(): Promise<SqlDb> {
        const db = await Database.load("sqlite:imminenti.db");
        await db.execute(`PRAGMA foreign_keys = ON`);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS tasks (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT    NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                notes      TEXT             DEFAULT '',
                due_date   TEXT    NULL,                   -- YYYY-MM-DD or NULL
                is_urgent  INTEGER NOT NULL DEFAULT 0 CHECK (is_urgent IN (0,1)),
                is_today   INTEGER NOT NULL DEFAULT 0 CHECK (is_today  IN (0,1)),
                created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CHECK (is_today = 0 OR due_date IS NULL),
                CHECK (NOT (due_date IS NULL AND is_today = 0 AND is_urgent = 0))
            )
        `);

        await db.execute(`
            CREATE INDEX IF NOT EXISTS idx_tasks_due_date
            ON tasks(due_date)
        `);

        await db.execute(`
            CREATE INDEX IF NOT EXISTS idx_tasks_urgent_due
            ON tasks(is_urgent, due_date)
        `);

        await db.execute(`
            CREATE INDEX IF NOT EXISTS idx_tasks_today
            ON tasks(is_today)
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS link_collections (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT    NOT NULL,
                color      TEXT    NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS links (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL,
                title         TEXT    NOT NULL,
                url           TEXT    NOT NULL,
                sort_order    INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (collection_id) REFERENCES link_collections(id) ON DELETE CASCADE
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS task_links (
                task_id   INTEGER NOT NULL,
                link_id   INTEGER NOT NULL,
                created_at TEXT   NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (task_id, link_id),
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
            )
        `);

        await db.execute(`
            CREATE INDEX IF NOT EXISTS idx_link_collections_sort
            ON link_collections(sort_order, id)
        `);

        await db.execute(`
            CREATE INDEX IF NOT EXISTS idx_links_collection_sort
            ON links(collection_id, sort_order, id)
        `);

        await db.execute(`
            CREATE INDEX IF NOT EXISTS idx_task_links_task
            ON task_links(task_id)
        `);

        await db.execute(`
            CREATE INDEX IF NOT EXISTS idx_task_links_link
            ON task_links(link_id)
        `);

        return db;
    }

    async get(): Promise<SqlDb> {
        if (!this.promise) this.promise = this.init();
        return this.promise;
    }

    async getWeekTasks(weekStartKey: DateKey, weekEndKey: DateKey): Promise<Task[]> {
        const db = await this.get();
        const weekTasks = await db.select<TaskRow[]>(
            `
            SELECT id, title, notes, due_date, is_urgent, is_today, sort_order, created_at, updated_at
            FROM tasks
            WHERE due_date >= ? AND due_date <= ? AND is_today = 0
            ORDER BY due_date ASC, sort_order ASC, id ASC
            `,
            [weekStartKey, weekEndKey]
        );
        return weekTasks.map(toTask);
    }

    async getOngoingTasks(): Promise<Task[]> {
        const db = await this.get();
        const ongoingTasks = await db.select<TaskRow[]>(`
            SELECT id, title, notes, due_date, is_urgent, is_today, sort_order, created_at, updated_at
            FROM tasks
            WHERE due_date IS NULL AND is_urgent = 1 AND is_today = 0
            ORDER BY sort_order ASC, id ASC
        `);
        return ongoingTasks.map(toTask);
    }

    async getTodayTasks(): Promise<Task[]> {
        const db = await this.get();
        const rows = await db.select<TaskRow[]>(`
            SELECT id, title, notes, due_date, is_urgent, is_today, sort_order, created_at, updated_at
            FROM tasks
            WHERE is_today = 1
            ORDER BY sort_order ASC, id ASC
        `);
        return rows.map(toTask);
    }

    async setSortOrder(ids: number[]): Promise<void> {
        const db = await this.get();
        await db.execute("BEGIN");
        try {
            for (let i = 0; i < ids.length; i++) {
                await db.execute(`UPDATE tasks SET sort_order = ? WHERE id = ?`, [i + 1, ids[i]]);
            }
            await db.execute("COMMIT");
        } catch (e) {
            await db.execute("ROLLBACK");
            throw e;
        }
    }

    async moveTask(taskId: number, dest: Location): Promise<void> {
        const db = await this.get();

        if (dest.kind === "ongoing") {
            await db.execute(
                `
                UPDATE tasks
                SET due_date = NULL, is_urgent = 1, is_today = 0, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                `,
                [taskId]
            );
            return;
        }

        if (dest.kind === "today") {
            await db.execute(
                `
                UPDATE tasks
                SET due_date = NULL, is_today = 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                `,
                [taskId]
            );
            return;
        }

        await db.execute(
            `
            UPDATE tasks
            SET due_date = ?, is_today = 0, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [dest.dateKey, taskId]
        );
    }

    async deleteTask(taskId: number): Promise<void> {
        const db = await this.get();
        await db.execute(`DELETE FROM tasks WHERE id = ?`, [taskId]);
    }

    async getCollections(): Promise<LinkCollection[]> {
        const db = await this.get();
        const rows = await db.select<LinkCollectionRow[]>(`
            SELECT id, name, color, sort_order, created_at, updated_at
            FROM link_collections
            ORDER BY sort_order ASC, id ASC
        `);
        return rows.map(toLinkCollection);
    }

    async getLinksForCollections(collectionIds: number[]): Promise<Link[]> {
        if (collectionIds.length === 0) return [];
        const db = await this.get();
        const placeholders = collectionIds.map(() => "?").join(",");
        const rows = await db.select<LinkRow[]>(
            `
            SELECT id, collection_id, title, url, sort_order, created_at, updated_at
            FROM links
            WHERE collection_id IN (${placeholders})
            ORDER BY collection_id ASC, sort_order ASC, id ASC
            `,
            collectionIds
        );
        return rows.map(toLink);
    }

    async setTaskLinks(taskId: number, linkIds: number[]): Promise<void> {
        const db = await this.get();

        const seen = new Set<number>();
        const ids: number[] = [];
        for (const id of linkIds) {
            if (!Number.isFinite(id) || id <= 0) continue;
            if (seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
        }

        await db.execute("BEGIN");
        try {
            await db.execute(`DELETE FROM task_links WHERE task_id = ?`, [taskId]);
            for (const linkId of ids) {
                await db.execute(
                    `INSERT INTO task_links (task_id, link_id) VALUES (?, ?)`,
                    [taskId, linkId]
                );
            }
            await db.execute("COMMIT");
        } catch (e) {
            await db.execute("ROLLBACK");
            throw e;
        }
    }

    async getTaskLinkJoinRowsForTasks(taskIds: number[]): Promise<TaskLinkJoinRow[]> {
        if (taskIds.length === 0) return [];
        const db = await this.get();
        const placeholders = taskIds.map(() => "?").join(",");

        return await db.select<TaskLinkJoinRow[]>(
            `
            SELECT
                tl.task_id    AS task_id,
                lc.id         AS collection_id,
                lc.color      AS collection_color,
                lc.sort_order AS collection_sort_order,
                l.id          AS link_id,
                l.title       AS link_title,
                l.url         AS link_url,
                l.sort_order  AS link_sort_order
            FROM task_links tl
            JOIN links            l  ON l.id  = tl.link_id
            JOIN link_collections lc ON lc.id = l.collection_id
            WHERE tl.task_id IN (${placeholders})
            ORDER BY
                tl.task_id    ASC,
                lc.sort_order ASC,
                lc.id         ASC,
                l.sort_order  ASC,
                l.id          ASC
            `,
            taskIds
        );
    }

    async createCollection(name: string, color: string): Promise<void> {
        const db = await this.get();
        const n = name.trim();
        if (!n) throw new Error("Collection name is required.");
        const c = assertHexColor(color);

        await db.execute(
            `
            INSERT INTO link_collections (name, color, sort_order)
            VALUES (
                ?, ?,
                (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM link_collections)
            )
            `,
            [n, c]
        );
    }

    async updateCollection(id: number, name: string, color: string): Promise<void> {
        const db = await this.get();
        const n = name.trim();
        if (!n) throw new Error("Collection name is required.");
        const c = assertHexColor(color);

        await db.execute(
            `
            UPDATE link_collections
            SET name = ?, color = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [n, c, id]
        );
    }

    async deleteCollection(id: number): Promise<void> {
        const db = await this.get();
        await db.execute(`DELETE FROM link_collections WHERE id = ?`, [id]);
    }

    async createLink(collectionId: number, title: string, url: string): Promise<void> {
        const db = await this.get();
        const t = title.trim();
        if (!t) throw new Error("Link title is required.");
        const u = normalizeUrl(url);

        await db.execute(
            `
            INSERT INTO links (collection_id, title, url, sort_order)
            VALUES (
                ?, ?, ?,
                (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM links WHERE collection_id = ?)
            )
            `,
            [collectionId, t, u, collectionId]
        );
    }

    async updateLink(id: number, title: string, url: string): Promise<void> {
        const db = await this.get();
        const t = title.trim();
        if (!t) throw new Error("Link title is required.");
        const u = normalizeUrl(url);

        await db.execute(
            `
            UPDATE links
            SET title = ?, url = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [t, u, id]
        );
    }

    async deleteLink(id: number): Promise<void> {
        const db = await this.get();
        await db.execute(`DELETE FROM links WHERE id = ?`, [id]);
    }

    async setCollectionOrder(ids: number[]): Promise<void> {
        const db = await this.get();
        await db.execute("BEGIN");
        try {
            for (let i = 0; i < ids.length; i++) {
                await db.execute(
                    `UPDATE link_collections SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [i + 1, ids[i]]
                );
            }
            await db.execute("COMMIT");
        } catch (e) {
            await db.execute("ROLLBACK");
            throw e;
        }
    }

    async setLinkOrder(collectionId: number, linkIds: number[]): Promise<void> {
        const db = await this.get();
        await db.execute("BEGIN");
        try {
            for (let i = 0; i < linkIds.length; i++) {
                await db.execute(
                    `UPDATE links SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND collection_id = ?`,
                    [i + 1, linkIds[i], collectionId]
                );
            }
            await db.execute("COMMIT");
        } catch (e) {
            await db.execute("ROLLBACK");
            throw e;
        }
    }

    async moveLinkToCollection(linkId: number, toCollectionId: number): Promise<void> {
        const db = await this.get();
        await db.execute(
            `
            UPDATE links
            SET collection_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [toCollectionId, linkId]
        );
    }
}
