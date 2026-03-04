import type { AppState } from "../state";
import type { Location, Task } from "../task";
import { qs, escapeHtml } from "../utils/dom";
import { formatLongDate } from "../utils/date";
import { openExternalUrl } from "../utils/openUrl";

function numId(x: unknown): number | null {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : null;
}

export type ModalState = { mode: "create"; location: Location }
                       | { mode: "edit";   task:     Task     };

type Deps = {
    state: AppState;
    refresh: () => Promise<void>;
    root?: Document;
};

export class ModalController {
    private root: Document;
    private attached = false;
    private modal: ModalState | null = null;

    constructor(private deps: Deps) {
        this.root = deps.root ?? document;
    }

    attach(): void {
        if (this.attached) return;
        this.attached = true;

        qs<HTMLButtonElement>("#cancel-task-btn", this.root).addEventListener("click", () => this.close());

        qs<HTMLButtonElement>("#delete-task-btn", this.root).addEventListener("click", async () => {
            try {
                await this.deleteCurrent();
            } catch (err) {
                console.error(err);
                alert("Delete failed. Check console.");
            }
        });

        qs<HTMLFormElement>("#task-form", this.root).addEventListener("submit", async (e) => {
            e.preventDefault();
            try {
                await this.save();
            } catch (err) {
                console.error(err);
                alert("Save failed. Check console.");
            }
        });

        const dialog = qs<HTMLDialogElement>("#task-dialog", this.root);
        dialog.addEventListener("cancel", (e) => {
            e.preventDefault();
            this.close();
        });

        const linksBox = qs<HTMLDivElement>("#task-links-box", this.root);
        linksBox.addEventListener("click", async (e) => {
            const target = e.target as HTMLElement;

            const btn = target.closest<HTMLElement>(".task-link-open-btn");
            if (!btn) return;

            e.preventDefault();
            e.stopPropagation();

            const id = numId(btn.dataset.linkId);
            if (!id) return;

            let url: string | null = null;
            for (const links of this.deps.state.linksByCollectionId.values()) {
                const l = links.find((x) => x.id === id);
                if (l) { url = l.url; break; }
            }
            if (!url) return;

            try {
                await openExternalUrl(url);
            } catch (err) {
                console.error(err);
                alert("Open failed. Check console.");
            }
        });
    }

    private open(): void {
        const next = this.modal;
        if (!next) return;

        this.render(next);

        const dialog = qs<HTMLDialogElement>("#task-dialog", this.root);
        if (dialog.open) dialog.close();
        dialog.showModal();

        const titleInput = qs<HTMLInputElement>("#task-title-input", this.root);
        queueMicrotask(() => titleInput.focus());
    }

    private render(next: ModalState): void {
        const titleEl      = qs<HTMLHeadingElement> ("#dialog-title",      this.root);
        const contextEl    = qs<HTMLDivElement>     ("#dialog-context",    this.root);
        const titleInput   = qs<HTMLInputElement>   ("#task-title-input",  this.root);
        const notesInput   = qs<HTMLTextAreaElement>("#task-notes-input",  this.root);
        const urgentField  = qs<HTMLLabelElement>   ("#task-urgent-field", this.root);
        const urgentInput  = qs<HTMLInputElement>   ("#task-urgent-input", this.root);
        const deleteBtn    = qs<HTMLButtonElement>  ("#delete-task-btn",   this.root);
        const saveBtn      = qs<HTMLButtonElement>  ("#save-task-btn",     this.root);

        const isCreate = next.mode === "create";
        const task     = next.mode === "edit" ? next.task : null;
        const taskId   = next.mode === "edit" ? next.task.id : null;
        const loc      = isCreate ? next.location : next.task.location;

        titleInput.value = task?.title ?? "";
        notesInput.value = task?.notes ?? "";

        urgentField.hidden  = loc.kind === "ongoing";
        urgentInput.checked = loc.kind === "ongoing" ? true : (task?.urgent ?? false);

        deleteBtn.hidden    = isCreate;
        saveBtn.textContent = isCreate ? "Create" : "Save";

        if (isCreate) {
            if (loc.kind === "day") {
                titleEl.textContent = "Add task";
                contextEl.textContent = `Due: ${formatLongDate(loc.dateKey)}`;
            } else if (loc.kind === "today") {
                titleEl.textContent = "Add today task";
                contextEl.textContent = "Task for Today";
            } else {
                titleEl.textContent = "Add ongoing task";
                contextEl.textContent = "Ongoing task";
            }
        } else {
            if (loc.kind === "day") {
                titleEl.textContent = "Edit task";
                contextEl.textContent = `Due: ${formatLongDate(loc.dateKey)}`;
            } else if (loc.kind === "today") {
                titleEl.textContent = "Edit today task";
                contextEl.textContent = "Task for Today";
            } else {
                titleEl.textContent = "Edit ongoing task";
                contextEl.textContent = "Ongoing task";
            }
        }

        this.renderLinksBox(taskId);
    }

    openCreate(location: Location): void {
        this.modal = { mode: "create", location };
        this.open();
    }

    openEdit(task: Task): void {
        this.modal = { mode: "edit", task };
        this.open();
    }

    close(): void {
        const dialog = qs<HTMLDialogElement>("#task-dialog", this.root);
        if (dialog.open) dialog.close();
        this.modal = null;
    }

    async save(): Promise<void> {
        const { state, refresh } = this.deps;
        if (!this.modal) return;

        const checkedLinkIds = Array.from(
            this.root.querySelectorAll<HTMLInputElement>(`#task-links-box input[type="checkbox"][data-link-id]:checked`)
        ).map((el) => numId(el.dataset.linkId))
         .filter((n): n is number => n !== null);

        const titleInput   = qs<HTMLInputElement>   ("#task-title-input",  this.root);
        const notesInput   = qs<HTMLTextAreaElement>("#task-notes-input",  this.root);
        const ongoingInput = qs<HTMLInputElement>   ("#task-urgent-input", this.root);

        const title = titleInput.value.trim();
        const notes = notesInput.value.trim();

        if (!title) {
            titleInput.focus();
            return;
        }

        const db = await state.dbm.get();

        const loc = this.modal.mode === "create"
                  ? this.modal.location
                  : this.modal.task.location;

        if (this.modal.mode === "create") {
            if (loc.kind === "day") {
                await db.execute(
                    `
                    INSERT INTO tasks (title, notes, due_date, is_urgent, is_today, sort_order)
                    VALUES (
                        ?, ?, ?, ?, 0,
                        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE due_date = ?)
                    )
                    `,
                    [title, notes, loc.dateKey, ongoingInput.checked ? 1 : 0, loc.dateKey]
                );
            } else if (loc.kind === "ongoing") {
                await db.execute(
                    `
                    INSERT INTO tasks (title, notes, due_date, is_urgent, is_today, sort_order)
                    VALUES (
                        ?, ?, NULL, 1, 0,
                        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE due_date IS NULL AND is_urgent = 1)
                    )
                    `,
                    [title, notes]
                );
            } else {
                await db.execute(
                    `
                    INSERT INTO tasks (title, notes, due_date, is_urgent, is_today, sort_order)
                    VALUES (
                        ?, ?, NULL, ?, 1,
                        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE is_today = 1)
                    )
                    `,
                    [title, notes, ongoingInput.checked ? 1 : 0]
                );
            }
            const rows = await db.select<{ id: number }[]>(`SELECT last_insert_rowid() AS id`);
            const newId = rows[0]?.id;
            if (!newId) throw new Error("Failed to read inserted task id.");
            await state.dbm.setTaskLinks(newId, checkedLinkIds);
        } else {
            const id = this.modal.task.id;

            if (loc.kind === "day") {
                await db.execute(
                    `
                    UPDATE tasks
                    SET title = ?, notes = ?, is_urgent = ?, is_today = 0, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    `,
                    [title, notes, ongoingInput.checked ? 1 : 0, id]
                );
            } else if (loc.kind === "ongoing") {
                await db.execute(
                    `
                    UPDATE tasks
                    SET title = ?, notes = ?, due_date = NULL, is_urgent = 1, is_today = 0, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    `,
                    [title, notes, id]
                );
            } else {
                await db.execute(
                    `
                    UPDATE tasks
                    SET title = ?, notes = ?, is_urgent = ?, is_today = 1, due_date = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    `,
                    [title, notes, ongoingInput.checked ? 1 : 0, id]
                );
            }
            await state.dbm.setTaskLinks(id, checkedLinkIds);
        }

        this.close();
        await refresh();
    }

    async deleteCurrent(): Promise<void> {
        const { state, refresh } = this.deps;
        if (!this.modal || this.modal.mode !== "edit") return;

        await state.dbm.deleteTask(this.modal.task.id);
        this.close();
        await refresh();
    }

    private renderLinksBox(taskId: number | null): void {
        const { state } = this.deps;
        const box = qs<HTMLDivElement>("#task-links-box", this.root);

        if (state.linkCollections.length === 0) {
            box.innerHTML = `<div class="empty-ongoing">No link collections.</div>`;
            return;
        }

        const selected = new Set<number>(taskId ? (state.taskLinkIdsByTaskId.get(taskId) ?? []) : []);

        const HEX_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
        const safeColor = (c: string) => (HEX_RE.test(c.trim()) ? c.trim() : "#888888");

        const shortUrl = (u: string) => {
            try {
                const x = new URL(u);
                return x.host + x.pathname;
            } catch {
                return u;
            }
        };

        box.innerHTML = state.linkCollections.map((c) => {
            const links = state.linksByCollectionId.get(c.id) ?? [];
            const swatch = safeColor(c.color);

            const list = links.length === 0
                ? `<div class="links-empty">No links.</div>`
                : links.map((l) => {
                    const checked = selected.has(l.id) ? "checked" : "";
                    return `
                      <div class="task-link-check-row">
                        <label class="task-link-check">
                          <input type="checkbox" data-link-id="${l.id}" ${checked} />
                          <div>
                            <div class="task-link-check-title">${escapeHtml(l.title)}</div>
                            <div class="task-link-check-url">${escapeHtml(shortUrl(l.url))}</div>
                          </div>
                        </label>
                        <button type="button" class="btn tiny task-link-open-btn" data-link-id="${l.id}">Open</button>
                      </div>
                    `;
                }).join("");

            return `
                <div class="task-link-group" data-collection-id="${c.id}">
                    <div class="task-link-group-head">
                        <div class="collection-swatch" style="background:${swatch};"></div>
                        <div class="task-link-group-name">${escapeHtml(c.name)}</div>
                    </div>
                    <div class="task-link-group-list">
                        ${list}
                    </div>
                </div>
            `;
        }).join("");
    }
}
