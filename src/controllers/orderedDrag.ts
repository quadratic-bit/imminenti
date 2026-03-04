export type DragHit<K extends string, M> = {
    kind: K;
    dropZoneEl: HTMLElement;
    listEl: HTMLElement;
    meta: M;
};

export type DragPick<K extends string, _> = {
    kind: K;
    id: number;
    sourceEl: HTMLElement;
};

export type ActiveDrag<K extends string, M> = {
    pick: DragPick<K, M>;
    pointerId: number;

    ghostEl: HTMLDivElement;
    startRect: DOMRect;

    startKind: K;
    startListEl: HTMLElement | null;
    startIndex: number;

    lastY: number;
    movingDown: boolean;
};

export type OrderedDragAdapter<K extends string, M> = {
    pick(target: HTMLElement): DragPick<K, M> | null;
    hitTest(x: number, y: number): DragHit<K, M> | null;
    startHit(pick: DragPick<K, M>): DragHit<K, M> | null;
    sourceIndex(hit: DragHit<K, M>, sourceEl: HTMLElement): number;
    itemsForInsert(hit: DragHit<K, M>, draggedId: number): HTMLElement[];
    idsInList(listEl: HTMLElement): number[];
    preview(hit: DragHit<K, M>, draggedId: number, idx: number): void;
    clearPreviewDom(): void;
    paintBase(
        listEl: HTMLElement,
        baseIds: number[],
        ctx: { keepSourceHole: boolean; drag: ActiveDrag<K, M> }
    ): void;
    orderFromDom(listEl: HTMLElement, draggedId: number): number[];
    setHover(hit: DragHit<K, M> | null): void;
    applySourceVisual(pick: DragPick<K, M>): void;
    ghostText(id: number): string;
};

type DragIdle = { state: "idle" };
type DragPending<K extends string, M> = {
    state: "pending";
    adapter: OrderedDragAdapter<K, M>;
    pick: DragPick<K, M>;
    pointerId: number;
    startX: number;
    startY: number;
};
type DragActive<K extends string, M> = {
    state: "active";
    adapter: OrderedDragAdapter<K, M>;
    drag: ActiveDrag<K, M>;
};

type DragState<K extends string, M> = DragIdle | DragPending<K, M> | DragActive<K, M>;

type BaseEntry<K extends string, M> = {
    adapter: OrderedDragAdapter<K, M>;
    listEl: HTMLElement;
    baseIds: number[];
};

type Deps<K extends string, M> = {
    adapters: OrderedDragAdapter<K, M>[];
    refresh: () => Promise<void>;
    render: () => void;

    onDrop: (args: {
        draggedId: number;
        from: { kind: K; meta: M | null };
        to: { kind: K; meta: M };
        order: number[];
    }) => Promise<void>;

    getSuppressNextClick: () => boolean;
    setSuppressNextClick: (v: boolean) => void;

    swallowClickEls: HTMLElement[];

    root?: Document;
};

export class OrderedDragController<K extends string, M> {
    private root: Document;
    private attached = false;

    private drag: DragState<K, M> = { state: "idle" };

    private previewHit: DragHit<K, M> | null = null;
    private previewAdapter: OrderedDragAdapter<K, M> | null = null;
    private previewIndex = -1;

    private baseByList = new Map<HTMLElement, BaseEntry<K, M>>();

    constructor(private deps: Deps<K, M>) {
        this.root = deps.root ?? document;
    }

    attach(): void {
        if (this.attached) return;
        this.attached = true;

        for (const el of this.deps.swallowClickEls) {
            el.addEventListener("click", this.swallowSuppressedClick, { capture: true });
        }

        this.root.addEventListener(
            "pointerdown",
            (e) => {
                if (e.button !== 0) return;

                const target = e.target as HTMLElement | null;
                if (!target) return;

                for (const adapter of this.deps.adapters) {
                    const pick = adapter.pick(target);
                    if (!pick) continue;

                    pick.sourceEl.setPointerCapture(e.pointerId);

                    this.drag = {
                        state: "pending",
                        adapter,
                        pick,
                        pointerId: e.pointerId,
                        startX: e.clientX,
                        startY: e.clientY,
                    };
                    return;
                }
            },
            { capture: true }
        );

        window.addEventListener(
            "pointermove",
            (e) => {
                if (this.drag.state === "idle") return;

                if (this.drag.state === "pending") {
                    if (e.pointerId !== this.drag.pointerId) return;

                    const dx = e.clientX - this.drag.startX;
                    const dy = e.clientY - this.drag.startY;
                    if ((dx * dx + dy * dy) < 36) return;

                    this.beginDragFromPending(e.clientX, e.clientY);
                    return;
                }

                if (e.pointerId !== this.drag.drag.pointerId) return;

                e.preventDefault();

                this.updateGhostPosition(this.drag.drag.ghostEl, e.clientX, e.clientY);

                if (e.clientY !== this.drag.drag.lastY) {
                    this.drag.drag.movingDown = e.clientY > this.drag.drag.lastY;
                }
                this.drag.drag.lastY = e.clientY;

                const hit = this.hitTestAll(e.clientX, e.clientY);

                for (const a of this.deps.adapters) {
                    a.setHover(hit && this.adapterForHit(hit) === a ? hit : null);
                }

                if (!hit) {
                    this.resetPreview({ keepSourceHole: true, removePreviewDom: true });
                    return;
                }

                const adapter = this.adapterForHit(hit);

                if (!adapter) {
                    this.resetPreview({ keepSourceHole: true, removePreviewDom: true });
                    return;
                }

                if (this.previewHit &&
                    (this.previewAdapter !== adapter || this.previewHit.listEl !== hit.listEl || this.previewHit.kind !== hit.kind)
                ) {
                    this.resetPreview({ keepSourceHole: true, removePreviewDom: true });
                }

                this.previewHit = hit;
                this.previewAdapter = adapter;

                this.rememberBase(adapter, hit.listEl, this.drag.drag.pick.id);

                const items = adapter.itemsForInsert(hit, this.drag.drag.pick.id);
                const idx = this.computeInsertIndex(
                    items,
                    e.clientY,
                    hit.listEl,
                    hit.kind,
                    this.drag.drag.movingDown,
                    this.drag.drag
                );

                if (idx === this.previewIndex) return;
                this.previewIndex = idx;

                adapter.preview(hit, this.drag.drag.pick.id, idx);
            },
            { passive: false }
        );

        window.addEventListener("pointerup", async (e) => {
            if (this.drag.state === "idle") return;

            if (this.drag.state === "pending") {
                if (e.pointerId !== this.drag.pointerId) return;
                this.drag = { state: "idle" };
                return;
            }

            if (e.pointerId !== this.drag.drag.pointerId) return;

            this.deps.setSuppressNextClick(true);
            setTimeout(() => this.deps.setSuppressNextClick(false), 0);

            try {
                await this.finishDrag(e.clientX, e.clientY);
            } catch (err) {
                console.error(err);
                this.cancelDrag();
            }

            this.drag = { state: "idle" };
        });

        window.addEventListener("pointercancel", (e) => {
            if (this.drag.state === "idle") return;

            if (this.drag.state === "pending") {
                if (e.pointerId !== this.drag.pointerId) return;
                this.drag = { state: "idle" };
                return;
            }

            if (e.pointerId !== this.drag.drag.pointerId) return;

            this.deps.setSuppressNextClick(false);
            setTimeout(() => this.deps.setSuppressNextClick(false), 0);

            this.cancelDrag();
            this.drag = { state: "idle" };
        });
    }

    resetForRender(): void {
        const prev = this.drag.state === "active" ? this.drag.drag : null;

        this.drag = { state: "idle" };

        for (const a of this.deps.adapters) a.setHover(null);

        this.root.body.classList.remove("dragging");

        if (prev?.ghostEl) prev.ghostEl.remove();

        this.baseByList.clear();
        this.previewAdapter?.clearPreviewDom();
        this.previewAdapter = null;
        this.previewHit = null;
        this.previewIndex = -1;
    }

    private swallowSuppressedClick = (e: MouseEvent): void => {
        if (!this.deps.getSuppressNextClick()) return;
        this.deps.setSuppressNextClick(false);
        e.preventDefault();
        e.stopImmediatePropagation();
    };

    private adapterForHit(hit: DragHit<K, M>): OrderedDragAdapter<K, M> | null {
        for (const a of this.deps.adapters) {
            const entry = this.baseByList.get(hit.listEl);
            if (entry?.adapter === a) return a;
        }

        const r = hit.dropZoneEl.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        for (const a of this.deps.adapters) {
            const h = a.hitTest(cx, cy);
            if (h && h.listEl === hit.listEl && h.kind === hit.kind) return a;
        }
        return null;
    }

    private hitTestAll(x: number, y: number): DragHit<K, M> | null {
        for (const a of this.deps.adapters) {
            const h = a.hitTest(x, y);
            if (h) return h;
        }
        return null;
    }

    private rememberBase(adapter: OrderedDragAdapter<K, M>, listEl: HTMLElement, draggedId: number): void {
        if (this.baseByList.has(listEl)) return;

        const ids = adapter.idsInList(listEl).filter((id) => id !== draggedId);
        this.baseByList.set(listEl, { adapter, listEl, baseIds: ids });
    }

    private beginDragFromPending(x: number, y: number): void {
        if (this.drag.state !== "pending") return;

        const { adapter, pick, pointerId } = this.drag;

        const ghost = this.root.createElement("div");
        ghost.className = "drag-ghost";
        ghost.textContent = adapter.ghostText(pick.id);
        this.root.body.appendChild(ghost);
        this.updateGhostPosition(ghost, x, y);

        const startRect = pick.sourceEl.getBoundingClientRect();

        const startHit = adapter.startHit(pick);
        const startListEl = startHit?.listEl ?? null;
        const startIndex = startHit ? adapter.sourceIndex(startHit, pick.sourceEl) : 0;

        adapter.applySourceVisual(pick);

        this.root.body.classList.add("dragging");

        this.drag = {
            state: "active",
            adapter,
            drag: {
                pick,
                pointerId,
                ghostEl: ghost,
                startRect,
                startKind: pick.kind,
                startListEl,
                startIndex,
                lastY: y,
                movingDown: true,
            },
        };

        const hit = this.hitTestAll(x, y);
        for (const a of this.deps.adapters) {
            a.setHover(hit && this.adapterForHit(hit) === a ? hit : null);
        }
        if (hit) {
            const dstAdapter = this.adapterForHit(hit);
            if (dstAdapter) {
                this.previewHit = hit;
                this.previewAdapter = dstAdapter;
                this.rememberBase(dstAdapter, hit.listEl, pick.id);

                const items = dstAdapter.itemsForInsert(hit, pick.id);
                const idx = this.computeInsertIndex(
                    items,
                    y,
                    hit.listEl,
                    hit.kind,
                    true,
                    this.drag.drag
                );
                this.previewIndex = idx;
                dstAdapter.preview(hit, pick.id, idx);
            }
        }
    }

    private computeInsertIndex(
        items: HTMLElement[],
        y: number,
        listEl: HTMLElement,
        kind: K,
        movingDown: boolean,
        drag: ActiveDrag<K, M>
    ): number {
        if (
            drag.startKind   === kind   &&
            drag.startListEl === listEl &&
            y >= drag.startRect.top     &&
            y <= drag.startRect.bottom
        ) {
            return Math.max(0, Math.min(drag.startIndex, items.length));
        }

        if (movingDown) {
            for (let i = 0; i < items.length; i++) {
                const r = items[i].getBoundingClientRect();
                if (y < r.top) return i;
                if (y < r.bottom) return i + 1;
            }
            return items.length;
        }

        for (let i = 0; i < items.length; i++) {
            const r = items[i].getBoundingClientRect();
            if (y <= r.bottom) return i;
        }
        return items.length;
    }

    private resetPreview(opts: { keepSourceHole: boolean; removePreviewDom: boolean }): void {
        if (this.drag.state !== "active") {
            this.previewAdapter?.clearPreviewDom();
            this.previewAdapter = null;
            this.previewHit = null;
            this.previewIndex = -1;
            this.baseByList.clear();
            return;
        }

        if (opts.removePreviewDom) this.previewAdapter?.clearPreviewDom();

        this.previewAdapter = null;
        this.previewHit = null;
        this.previewIndex = -1;

        const drag = this.drag.drag;

        for (const entry of this.baseByList.values()) {
            entry.adapter.paintBase(entry.listEl, entry.baseIds, { keepSourceHole: opts.keepSourceHole, drag });
        }
        this.baseByList.clear();

        if (opts.keepSourceHole) {
            this.drag.adapter.applySourceVisual(drag.pick);
        }
    }

    private cleanupDragVisuals(): void {
        if (this.drag.state !== "active") return;

        const drag = this.drag.drag;

        for (const a of this.deps.adapters) a.setHover(null);

        this.root.body.classList.remove("dragging");
        drag.ghostEl.remove();

        this.resetPreview({ keepSourceHole: false, removePreviewDom: true });

        this.deps.render();
    }

    private cancelDrag(): void {
        this.cleanupDragVisuals();
    }

    private updateGhostPosition(ghost: HTMLElement, x: number, y: number): void {
        ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
    }

    private async finishDrag(dropX: number, dropY: number): Promise<void> {
        if (this.drag.state !== "active") return;

        const start = this.drag.drag;

        const hit = this.hitTestAll(dropX, dropY);
        const dstAdapter = hit ? this.adapterForHit(hit) : null;

        if (!hit || !dstAdapter) {
            this.cleanupDragVisuals();
            return;
        }

        const order = dstAdapter.orderFromDom(hit.listEl, start.pick.id);

        for (const a of this.deps.adapters) a.setHover(null);

        this.root.body.classList.remove("dragging");
        start.ghostEl.remove();

        this.baseByList.clear();

        const fromMeta = (() => {
            const sh = this.drag.adapter.startHit(start.pick);
            return sh ? sh.meta : null;
        })();

        await this.deps.onDrop({
            draggedId: start.pick.id,
            from: { kind: start.startKind, meta: fromMeta },
            to: { kind: hit.kind, meta: hit.meta },
            order,
        });

        await this.deps.refresh();
    }
}
