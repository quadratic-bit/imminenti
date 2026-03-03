import type { AppState } from "../state";
import type { Task } from "../task";
import { escapeHtml } from "../utils/dom";
import { dateToKey, formatMonthDay, formatWeekRange, getWeekDateKeys } from "../utils/date";
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function byDueDateMap(tasks: Task[]): Map<string, Task[]> {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
        if (!t.due_date) continue;
        const arr = m.get(t.due_date) ?? [];
        arr.push(t);
        m.set(t.due_date, arr);
    }
    return m;
}

export function renderWeekGrid(state: AppState, root: Document = document): void {
    const weekGrid    = root.querySelector<HTMLDivElement>("#week-grid");
    const weekRangeEl = root.querySelector<HTMLDivElement>("#week-range");
    if (!weekGrid || !weekRangeEl) return;

    const weekKeys = getWeekDateKeys(state.currentWeekStart);
    const todayKey = dateToKey(new Date());
    const grouped  = byDueDateMap(state.weekTasks);

    weekRangeEl.textContent = `${formatWeekRange(state.currentWeekStart)}`;

    const renderDayBox = (weekIndex: number): string => {
        const dateKey = weekKeys[weekIndex];
        const tasks   = grouped.get(dateKey) ?? [];
        const slots   = Math.max(6, tasks.length);

        const rows = Array.from({ length: slots }, (_, i) => {
            const task = tasks[i];
            if (!task) return `<div class="task-row empty" data-day-date="${dateKey}" data-empty="1"></div>`;

            const urgentMark = task.urgent ? `<span class="urgent-pill">urgent</span>` : "";
            const title = escapeHtml(task.title);
            const notesPreview = task.notes?.trim()
                ? `<span class="row-notes">${escapeHtml(task.notes.trim())}</span>`
                : "";

            return `
                <div class="task-row filled" data-task-id="${task.id}" title="Click to edit">
                    <div class="row-main">
                        <span class="row-title">${title}</span>
                        ${notesPreview}
                    </div>
                    ${urgentMark}
                </div>
            `;
        }).join("");

        const isCurrentDay = dateKey === todayKey;
        const isPast       = dateKey < todayKey;

        return `
            <div class="day-box ${isCurrentDay ? "current-day" : ""} ${isPast ? "past" : ""}" data-day-date="${dateKey}" title="Click to add task">
                <div class="day-label-strip">
                    <div class="day-label-rot day-label-week">${DAY_LABELS[weekIndex]}</div>
                    <div class="day-label-rot day-label-date">${escapeHtml(formatMonthDay(dateKey))}</div>
                </div>
                <div class="day-rows" style="grid-template-rows: repeat(${slots}, minmax(0, 1fr));">
                    ${rows}
                </div>
            </div>
        `;
    };

    const renderTodayBox = (): string => {
        const tasks = state.todayTasks;
        const slots = Math.max(6, tasks.length);

        const rows = Array.from({ length: slots }, (_, i) => {
            const task = tasks[i];
            if (!task) return `<div class="task-row empty" data-empty="1"></div>`;

            const urgentMark = task.urgent ? `<span class="urgent-pill">urgent</span>` : "";
            const title = escapeHtml(task.title);
            const notesPreview = task.notes?.trim()
                ? `<span class="row-notes">${escapeHtml(task.notes.trim())}</span>`
                : "";

            return `
                <div class="task-row filled" data-task-id="${task.id}" title="Click to edit">
                    <div class="row-main">
                        <span class="row-title">${title}</span>
                        ${notesPreview}
                    </div>
                    ${urgentMark}
                </div>
            `;
        }).join("");

        return `
            <div class="day-box today-box" title="Click to add task">
                <div class="day-label-strip">
                    <div class="day-label-rot day-label-today">Today</div>
                </div>
                <div class="day-rows" style="grid-template-rows: repeat(${slots}, minmax(0, 1fr));">
                    ${rows}
                </div>
            </div>
        `;
    };

    const dayOrder = [0, 3, 1, 4, 2, 5, -1, 6];

    const cells = dayOrder
        .map((i) => `<div class="grid-cell">${i === -1 ? renderTodayBox() : renderDayBox(i)}</div>`)
        .join("");

    weekGrid.innerHTML = `
        <div class="week-grid-4x2">
            ${cells}
        </div>
    `;
}
