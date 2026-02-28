export type DateKey = `${number}-${string}-${string}`; // YYYY-MM-DD

export type Task = {
    id:         number;
    title:      string;
    notes:      string;
    due_date:   DateKey | null;
    urgent:     boolean;
    sort_order: number;
    created_at: string;
    updated_at: string;
};
