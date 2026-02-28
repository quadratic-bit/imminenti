import Database from "@tauri-apps/plugin-sql";
import { Task, DateKey } from "./task";

type SqlDb = Awaited<ReturnType<typeof Database.load>>;

type TaskRow = {
    id:         number;
    title:      string;
    notes:      string | null;
    due_date:   string | null; // YYYY-MM-DD
    is_urgent:  number;        // 0/1
    sort_order: number;
    created_at: string;
    updated_at: string;
};

const toTask = (r: TaskRow): Task => ({
    id: r.id,
    title: r.title,
    notes: r.notes ?? "",
    due_date: (r.due_date as any) ?? null,
    urgent: r.is_urgent === 1,
    sort_order: r.sort_order,
    created_at: r.created_at,
    updated_at: r.updated_at,
});

export class DBManager {
    private promise: Promise<SqlDb> | null = null;

    private async init(): Promise<SqlDb> {
        const db = await Database.load("sqlite:imminenti.db");

        await db.execute(`
            CREATE TABLE IF NOT EXISTS tasks (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT    NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                notes      TEXT             DEFAULT '',
                due_date   TEXT    NULL,                   -- YYYY-MM-DD or NULL
                is_urgent  INTEGER NOT NULL DEFAULT 0 CHECK (is_urgent IN (0,1)),
                created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
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
            SELECT id, title, notes, due_date, is_urgent, sort_order, created_at, updated_at
            FROM tasks
            WHERE due_date >= ? AND due_date <= ?
            ORDER BY due_date ASC, sort_order ASC, id ASC
            `,
            [weekStartKey, weekEndKey]
        );
        return weekTasks.map(toTask);
    }

    async getUrgentTasks(): Promise<Task[]> {
        const db = await this.get();
        const urgentTasks = await db.select<TaskRow[]>(`
            SELECT id, title, notes, due_date, is_urgent, sort_order, created_at, updated_at
            FROM tasks
            WHERE due_date IS NULL AND is_urgent = 1
            ORDER BY sort_order ASC, id ASC
        `);
        return urgentTasks.map(toTask);
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

    async moveTaskToUrgent(taskId: number): Promise<void> {
        const db = await this.get();
        await db.execute(
            `UPDATE tasks SET due_date = NULL, is_urgent = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [taskId]
        );
    }

    async moveTaskToDay(taskId: number, dateKey: string): Promise<void> {
        const db = await this.get();
        await db.execute(
            `UPDATE tasks SET due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [dateKey, taskId]
        );
    }

    async deleteTask(taskId: number): Promise<void> {
        const db = await this.get();
        await db.execute(`DELETE FROM tasks WHERE id = ?`, [taskId]);
    }
}
