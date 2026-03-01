export type DateKey = `${number}-${string}-${string}`; // YYYY-MM-DD

export type Location = { kind: "today" }
                     | { kind: "ongoing" }
                     | { kind: "day"; dateKey: DateKey };

export type Task = {
    id:         number;
    title:      string;
    notes:      string;
    due_date:   DateKey | null;

    ongoing:    boolean;
    today:      boolean;

    sort_order: number;

    created_at: string;
    updated_at: string;

    location:   Location;
};
