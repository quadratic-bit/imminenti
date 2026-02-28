import Database from "@tauri-apps/plugin-sql";

type SqlDb = Awaited<ReturnType<typeof Database.load>>;

let dbPromise: Promise<SqlDb> | null = null;

export async function getDb(): Promise<SqlDb> {
    if (!dbPromise) dbPromise = initDb();
    return dbPromise;
}

async function initDb(): Promise<SqlDb> {
    const db = await Database.load("sqlite:imminenti.db");

    await db.execute(`
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            notes TEXT DEFAULT '',
            due_date TEXT NULL, -- YYYY-MM-DD or NULL
            is_urgent INTEGER NOT NULL DEFAULT 0 CHECK (is_urgent IN (0,1)),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
