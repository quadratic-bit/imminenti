import type { AppState } from "../state";
import { closestAtPoint } from "../utils/dom";
import { OrderedDragController, type OrderedDragAdapter, type DragHit } from "./orderedDrag";

type Kind = "collection" | "link";
type Meta = { collectionId?: number };

type Deps = {
    state: AppState;
    refresh: () => Promise<void>;
    render: () => void;
    root?: Document;
};

function numId(x: unknown): number | null {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function orderIdsFromDom(listEl: HTMLElement, selector: string, dataKey: string, draggedId: number): number[] {
    const els = Array.from(listEl.querySelectorAll<HTMLElement>(selector));
    const ids: number[] = [];
    const seen = new Set<number>();

    for (const el of els) {
        if (el.classList.contains("drag-source")) continue;
        if (el.classList.contains("drag-preview")) continue;

        const id = numId((el.dataset as any)[dataKey]);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
    }

    if (!seen.has(draggedId)) ids.push(draggedId);
    return ids;
}

function findCollectionName(state: AppState, id: number): string {
    return state.linkCollections.find((c) => c.id === id)?.name ?? `#${id}`;
}

function findLinkTitle(state: AppState, id: number): string {
    for (const links of state.linksByCollectionId.values()) {
        const l = links.find((x) => x.id === id);
        if (l) return l.title;
    }
    return `#${id}`;
}

function makeCollectionAdapter(state: AppState, root: Document): OrderedDragAdapter<Kind, Meta> {
    let hovered = false;
    let previewEl: HTMLElement | null = null;
    let previewList: HTMLElement | null = null;

    const listEl = () => root.querySelector<HTMLElement>("#collections-list");

    const setHover = (on: boolean) => {
        const el = listEl();
        if (!el) return;
        el.classList.toggle("drop-hover-collections-list", on);
    };

    return {
        pick(target) {
            if (target.closest(".btn")) return null;
            const head = target.closest<HTMLElement>(".collection-pill");
            if (!head) return null;

            const item = head.closest<HTMLElement>(".collection-pill");
            if (!item) return null;

            const id = numId(item.dataset.collectionId);
            if (!id) return null;

            return { kind: "collection", id, sourceEl: item };
        },

        hitTest(x, y) {
            const panel = closestAtPoint<HTMLElement>("#collections-list", x, y);
            if (!panel) return null;

            const at = document.elementFromPoint(x, y) as HTMLElement | null;
            if (at?.closest(".links-list")) return { kind: "collection", dropZoneEl: panel, listEl: panel, meta: {} };

            return { kind: "collection", dropZoneEl: panel, listEl: panel, meta: {} };
        },

        startHit(pick) {
            const panel = pick.sourceEl.closest<HTMLElement>("#collections-list") ?? listEl();
            if (!panel) return null;
            return { kind: "collection", dropZoneEl: panel, listEl: panel, meta: {} };
        },

        sourceIndex(hit, sourceEl) {
            const items = Array.from(hit.listEl.querySelectorAll<HTMLElement>(".collection-pill"));
            const idx = items.indexOf(sourceEl);
            return idx < 0 ? 0 : idx;
        },

        itemsForInsert(hit) {
            return Array.from(hit.listEl.querySelectorAll<HTMLElement>(".collection-pill"))
                .filter((el) => !el.classList.contains("drag-preview"))
                .filter((el) => !el.classList.contains("drag-source"));
        },

        idsInList(listEl) {
            return Array.from(listEl.querySelectorAll<HTMLElement>(".collection-pill"))
                .filter((el) => !el.classList.contains("drag-preview"))
                .filter((el) => !el.classList.contains("drag-source"))
                .map((el) => numId(el.dataset.collectionId))
                .filter((n): n is number => n !== null);
        },

        preview(hit, draggedId, idx) {
            if (!previewEl) {
                const name = findCollectionName(state, draggedId);
                const el = document.createElement("div");
                el.className = "collection-item drag-preview";
                el.dataset.collectionId = String(draggedId);
                el.innerHTML = `
                    <div class="collection-head">
                        <div class="collection-swatch"></div>
                        <div class="collection-name">${name}</div>
                    </div>
                    <div class="links-list"></div>
                `;
                previewEl = el;
            }

            if (!previewList || previewList !== hit.listEl) {
                previewList = hit.listEl;
                hit.listEl.appendChild(previewEl);
            }

            const items = this.itemsForInsert(hit, draggedId);
            const ref = items[idx] ?? null;
            hit.listEl.insertBefore(previewEl, ref);
        },

        clearPreviewDom() {
            previewEl?.remove();
            previewEl = null;
            previewList = null;
        },

        paintBase(listEl, baseIds) {
            this.clearPreviewDom();

            const byId = new Map<number, HTMLElement>();
            for (const el of Array.from(listEl.querySelectorAll<HTMLElement>(".collection-pill"))) {
                const id = numId(el.dataset.collectionId);
                if (id) byId.set(id, el);
            }

            for (const id of baseIds) {
                const el = byId.get(id);
                if (el) listEl.appendChild(el);
            }
        },

        orderFromDom(listEl, draggedId) {
            return orderIdsFromDom(listEl, ".collection-pill", "collectionId", draggedId);
        },

        setHover(hit) {
            const on = !!hit;
            if (on === hovered) return;
            hovered = on;
            setHover(on);
        },

        applySourceVisual(pick) {
            pick.sourceEl.classList.add("drag-source");
            pick.sourceEl.style.display = "none";
        },

        ghostText(id) {
            return findCollectionName(state, id);
        },
    };
}

function makeLinkAdapter(state: AppState, _root: Document): OrderedDragAdapter<Kind, Meta> {
    let hoveredList: HTMLElement | null = null;
    let previewEl: HTMLElement | null = null;
    let previewList: HTMLElement | null = null;

    const setHover = (list: HTMLElement | null) => {
        if (hoveredList && hoveredList !== list) {
            hoveredList.classList.remove("drop-hover-links-list");
            const prevCol = hoveredList.closest<HTMLElement>(".collection-pill");
            prevCol?.classList.remove("drop-hover-collection");
        }

        hoveredList = list;

        if (hoveredList) {
            hoveredList.classList.add("drop-hover-links-list");
            const col = hoveredList.closest<HTMLElement>(".collection-pill");
            col?.classList.add("drop-hover-collection");
        }
    };

    function hitLinksList(x: number, y: number): DragHit<Kind, Meta> | null {
        const list = closestAtPoint<HTMLElement>(".links-list", x, y);
        if (!list) return null;
        const cid = numId(list.dataset.collectionId) ?? null;
        if (!cid) return null;
        const col = list.closest<HTMLElement>(".collection-pill") ?? list;
        return { kind: "link", dropZoneEl: col, listEl: list, meta: { collectionId: cid } };
    }

    return {
        pick(target) {
            if (target.closest(".btn")) return null;
            const item = target.closest<HTMLElement>(".link-item");
            if (!item) return null;

            const id = numId(item.dataset.linkId);
            if (!id) return null;

            return { kind: "link", id, sourceEl: item };
        },

        hitTest(x, y) {
            return hitLinksList(x, y);
        },

        startHit(pick) {
            const list = pick.sourceEl.closest<HTMLElement>(".links-list");
            const cid = numId(list?.dataset.collectionId) ?? null;
            if (!list || !cid) return null;
            const col = list.closest<HTMLElement>(".collection-pill") ?? list;
            return { kind: "link", dropZoneEl: col, listEl: list, meta: { collectionId: cid } };
        },

        sourceIndex(hit, sourceEl) {
            const items = Array.from(hit.listEl.querySelectorAll<HTMLElement>(".link-item"));
            const idx = items.indexOf(sourceEl);
            return idx < 0 ? 0 : idx;
        },

        itemsForInsert(hit) {
            return Array.from(hit.listEl.querySelectorAll<HTMLElement>(".link-item"))
                .filter((el) => !el.classList.contains("drag-preview"))
                .filter((el) => !el.classList.contains("drag-source"));
        },

        idsInList(listEl) {
            return Array.from(listEl.querySelectorAll<HTMLElement>(".link-item"))
                .filter((el) => !el.classList.contains("drag-preview"))
                .filter((el) => !el.classList.contains("drag-source"))
                .map((el) => numId(el.dataset.linkId))
                .filter((n): n is number => n !== null);
        },

        preview(hit, draggedId, idx) {
            if (!previewEl) {
                const title = findLinkTitle(state, draggedId);
                const el = document.createElement("div");
                el.className = "link-item drag-preview";
                el.dataset.linkId = String(draggedId);
                el.innerHTML = `
                    <div class="link-main">
                        <div class="link-title">${title}</div>
                        <div class="link-url"></div>
                    </div>
                `;
                previewEl = el;
            }

            if (!previewList || previewList !== hit.listEl) {
                previewList = hit.listEl;
                hit.listEl.appendChild(previewEl);
            }

            const items = this.itemsForInsert(hit, draggedId);
            const ref = items[idx] ?? null;
            hit.listEl.insertBefore(previewEl, ref);
        },

        clearPreviewDom() {
            previewEl?.remove();
            previewEl = null;
            previewList = null;
        },

        paintBase(listEl, baseIds) {
            this.clearPreviewDom();

            const byId = new Map<number, HTMLElement>();
            for (const el of Array.from(listEl.querySelectorAll<HTMLElement>(".link-item"))) {
                const id = numId(el.dataset.linkId);
                if (id) byId.set(id, el);
            }

            for (const id of baseIds) {
                const el = byId.get(id);
                if (el) listEl.appendChild(el);
            }
        },

        orderFromDom(listEl, draggedId) {
            return orderIdsFromDom(listEl, ".link-item", "linkId", draggedId);
        },

        setHover(hit) {
            setHover(hit ? hit.listEl : null);
        },

        applySourceVisual(pick) {
            pick.sourceEl.classList.add("drag-source");
            pick.sourceEl.style.display = "none";
        },

        ghostText(id) {
            return findLinkTitle(state, id);
        },
    };
}

export class LinkDragController {
    private root: Document;

    private collectionsEngine: OrderedDragController<Kind, Meta>;
    private linksEngine: OrderedDragController<Kind, Meta>;

    constructor(deps: Deps) {
        this.root = deps.root ?? document;

        const swallow = [
            this.root.querySelector<HTMLElement>("#collections-dialog"),
            this.root.querySelector<HTMLElement>("#collections-list"),
            this.root.querySelector<HTMLElement>("#collection-links"),
        ].filter((x): x is HTMLElement => !!x);

        this.collectionsEngine = new OrderedDragController<Kind, Meta>({
            adapters: [makeCollectionAdapter(deps.state, this.root)],
            refresh: deps.refresh,
            render: deps.render,

            onDrop: async ({ to, order }) => {
                if (to.kind !== "collection") return;
                await deps.state.dbm.setCollectionOrder(order);
            },

            getSuppressNextClick: () => deps.state.suppressNextClick,
            setSuppressNextClick: (v) => (deps.state.suppressNextClick = v),
            swallowClickEls: swallow,
            root: this.root,
        });

        this.linksEngine = new OrderedDragController<Kind, Meta>({
            adapters: [makeLinkAdapter(deps.state, this.root)],
            refresh: deps.refresh,
            render: deps.render,

            onDrop: async ({ draggedId, from, to, order }) => {
                if (to.kind !== "link") return;

                const fromCid = (from.meta as Meta | null)?.collectionId ?? null;
                const toCid = (to.meta as Meta).collectionId ?? null;
                if (!toCid) return;

                if (fromCid && fromCid !== toCid) {
                    await deps.state.dbm.moveLinkToCollection(draggedId, toCid);

                    const fromList = this.root.querySelector<HTMLElement>(`.links-list[data-collection-id="${fromCid}"]`);
                    if (fromList) {
                        const srcOrder = orderIdsFromDom(fromList, ".link-item", "linkId", draggedId).filter((id) => id !== draggedId);
                        await deps.state.dbm.setLinkOrder(fromCid, srcOrder);
                    }
                }

                await deps.state.dbm.setLinkOrder(toCid, order);
            },

            getSuppressNextClick: () => deps.state.suppressNextClick,
            setSuppressNextClick: (v) => (deps.state.suppressNextClick = v),
            swallowClickEls: swallow,
            root: this.root,
        });
    }

    attach(): void {
        this.collectionsEngine.attach();
        this.linksEngine.attach();
    }

    resetForRender(): void {
        this.collectionsEngine.resetForRender();
        this.linksEngine.resetForRender();
    }
}
