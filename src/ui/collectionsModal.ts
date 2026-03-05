import type { AppState } from "../state";
import { escapeHtml } from "../utils/dom";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function safeColor(c: string): string {
    const s = c.trim();
    return HEX_RE.test(s) ? s : "#888888";
}

function shortUrl(u: string): string {
    try {
        const x = new URL(u);
        return x.host + x.pathname;
    } catch {
        return u;
    }
}

export function renderCollectionsBrowser(
    state: AppState,
    selectedCollectionId: number | null,
    root: Document = document
): number | null {
    const list = root.querySelector<HTMLDivElement>("#collections-list");
    const detail = root.querySelector<HTMLDivElement>("#collection-links");
    if (!list || !detail) return selectedCollectionId;

    const cols = state.linkCollections;

    if (cols.length === 0) {
        list.innerHTML = `<div class="empty-ongoing">No link collections.</div>`;
        detail.innerHTML = "";
        return null;
    }

    const selected = cols.find(c => c.id === selectedCollectionId) ?? cols[0];

    list.innerHTML = cols.map(c => {
        const color = safeColor(c.color);
        const active = c.id === selected.id ? "active" : "";
        return `
            <button type="button" class="collection-pill ${active}" data-collection-id="${c.id}">
                <span class="collection-swatch" style="background:${color};"></span>
                <span class="collection-pill-name">${escapeHtml(c.name)}</span>
            </button>
        `;
    }).join("");

    const links = state.linksByCollectionId.get(selected.id) ?? [];
    const linksHtml = links.length === 0
        ? `<div class="links-empty">No links.</div>`
        : links.map(l => `
                <div class="link-item" data-link-id="${l.id}" data-collection-id="${selected.id}">
                    <div class="link-main">
                        <div class="link-title">${escapeHtml(l.title)}</div>
                        <div class="link-url">${escapeHtml(shortUrl(l.url))}</div>
                    </div>
                    <div class="link-actions">
                        <button type="button" class="btn tiny link-open-btn" data-link-id="${l.id}">Open</button>
                        <button type="button" class="btn tiny link-edit-btn" data-link-id="${l.id}">Edit</button>
                    </div>
                </div>
            `).join("");

    detail.innerHTML = `
        <div class="collection-detail-head" data-collection-id="${selected.id}">
            <div class="collection-detail-left">
                <div class="collection-swatch" style="background:${safeColor(selected.color)};"></div>
                <div class="collection-name">${escapeHtml(selected.name)}</div>
            </div>
            <div class="collection-actions">
                <button type="button" class="btn tiny collection-add-link-btn" data-collection-id="${selected.id}">Add link</button>
                <button type="button" class="btn tiny collection-edit-btn" data-collection-id="${selected.id}">Edit</button>
            </div>
        </div>
        <div class="links-list" data-collection-id="${selected.id}">
            ${linksHtml}
        </div>
    `;

    return selected.id;
}
