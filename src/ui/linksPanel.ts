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

export function renderLinksPanel(state: AppState, root: Document = document): void {
    const panel = root.querySelector<HTMLDivElement>("#links-panel");
    if (!panel) return;

    const cols = state.linkCollections;

    if (cols.length === 0) {
        panel.innerHTML = `<div class="empty-ongoing">No link collections.</div>`;
        return;
    }

    panel.innerHTML = cols.map((c) => {
        const color = safeColor(c.color);
        const links = state.linksByCollectionId.get(c.id) ?? [];

        const linksHtml = links.length === 0
            ? `<div class="links-empty">No links.</div>`
            : links.map((l) => `
                <div class="link-item" data-link-id="${l.id}" data-collection-id="${c.id}">
                    <div class="link-main">
                        <div class="link-title">${escapeHtml(l.title)}</div>
                        <div class="link-url">${escapeHtml(shortUrl(l.url))}</div>
                    </div>
                    <button type="button" class="btn tiny link-edit-btn" data-link-id="${l.id}">Edit</button>
                </div>
            `).join("");

        return `
            <div class="collection-item" data-collection-id="${c.id}">
                <div class="collection-head">
                    <div class="collection-swatch" style="background:${color};"></div>
                    <div class="collection-name">${escapeHtml(c.name)}</div>
                    <div class="collection-actions">
                        <button type="button" class="btn tiny collection-add-link-btn" data-collection-id="${c.id}">Add link</button>
                        <button type="button" class="btn tiny collection-edit-btn" data-collection-id="${c.id}">Edit</button>
                    </div>
                </div>
                <div class="links-list" data-collection-id="${c.id}">
                    ${linksHtml}
                </div>
            </div>
        `;
    }).join("");
}
