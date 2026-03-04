export type LinkCollection = {
    id:         number;
    name:       string;
    color:      string;  // validated hex, #RRGGBB
    sort_order: number;
    created_at: string;
    updated_at: string;
};

export type Link = {
    id:            number;
    collection_id: number;
    title:         string;
    url:           string;
    sort_order:    number;
    created_at:    string;
    updated_at:    string;
};
