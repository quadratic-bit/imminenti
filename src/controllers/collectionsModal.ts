import type { AppState } from "../state";
import type { LinkCollection } from "../links";
import { qs } from "../utils/dom";
import { openExternalUrl } from "../utils/openUrl";
import { renderCollectionsBrowser } from "../ui/collectionsModal";
import type { LinkModalController } from "./linkModal";

type ModalState = { view: "browser" }
                | { view: "create" }
                | { view: "edit"; collection: LinkCollection };

type Deps = {
    state: AppState;
    refresh: () => Promise<void>;
    linkModal: LinkModalController;
    root?: Document;
};

function numId(x: unknown): number | null {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : null;
}

export class CollectionsModalController {
    private root: Document;
    private attached = false;

    private modal: ModalState = { view: "browser" };
    private selectedCollectionId: number | null = null;

    constructor(private deps: Deps) {
        this.root = deps.root ?? document;
    }

    attach(): void {
        if (this.attached) return;
        this.attached = true;

        qs<HTMLButtonElement>("#collections-close-btn", this.root).addEventListener("click", () => this.close());

        qs<HTMLButtonElement>("#collections-add-btn", this.root).addEventListener("click", () => {
            this.modal = { view: "create" };
            this.render();
        });

        qs<HTMLButtonElement>("#collection-cancel-btn", this.root).addEventListener("click", () => {
            this.modal = { view: "browser" };
            this.render();
        });

        qs<HTMLButtonElement>("#collection-delete-btn", this.root).addEventListener("click", async () => {
            try { await this.deleteCurrent(); }
            catch (err) { console.error(err); alert("Delete failed. Check console."); }
        });

        qs<HTMLFormElement>("#collections-form", this.root).addEventListener("submit", async (e) => {
            e.preventDefault();
            try { await this.save(); }
            catch (err) { console.error(err); alert("Save failed. Check console."); }
        });

        const dialog = qs<HTMLDialogElement>("#collections-dialog", this.root);
        dialog.addEventListener("cancel", (e) => { e.preventDefault(); this.close(); });

        qs<HTMLElement>("#collections-browser", this.root).addEventListener("click", (e) => this.onBrowserClick(e as MouseEvent));
    }

    open(): void {
        this.modal = { view: "browser" };
        this.render();

        const dialog = qs<HTMLDialogElement>("#collections-dialog", this.root);
        if (dialog.open) dialog.close();
        dialog.showModal();
    }

    close(): void {
        const dialog = qs<HTMLDialogElement>("#collections-dialog", this.root);
        if (dialog.open) dialog.close();
        this.modal = { view: "browser" };
    }

    renderIfOpen(): void {
        const dialog = this.root.querySelector<HTMLDialogElement>("#collections-dialog");
        if (!dialog?.open) return;
        this.render();
    }

    private render(): void {
        const titleEl = qs<HTMLHeadingElement>("#collections-dialog-title", this.root);
        const contextEl = qs<HTMLDivElement>("#collections-dialog-context", this.root);

        const browser = qs<HTMLElement>("#collections-browser", this.root);
        const editor = qs<HTMLElement>("#collections-editor", this.root);

        const name = qs<HTMLInputElement>("#collection-name-input", this.root);
        const color = qs<HTMLInputElement>("#collection-color-input", this.root);

        const deleteBtn = qs<HTMLButtonElement>("#collection-delete-btn", this.root);
        const saveBtn = qs<HTMLButtonElement>("#collection-save-btn", this.root);

        if (this.modal.view === "browser") {
            titleEl.textContent = "Links";
            contextEl.textContent = "";

            browser.hidden = false;
            editor.hidden = true;

            this.selectedCollectionId = renderCollectionsBrowser(this.deps.state, this.selectedCollectionId, this.root);
            return;
        }

        browser.hidden = true;
        editor.hidden = false;

        name.value = "";
        color.value = "";

        if (this.modal.view === "create") {
            titleEl.textContent = "Add collection";
            contextEl.textContent = "";
            deleteBtn.hidden = true;
            saveBtn.textContent = "Create";
            queueMicrotask(() => name.focus());
            return;
        }

        titleEl.textContent = "Edit collection";
        contextEl.textContent = "";
        deleteBtn.hidden = false;
        saveBtn.textContent = "Save";

        name.value = this.modal.collection.name;
        color.value = this.modal.collection.color;
        queueMicrotask(() => name.focus());
    }

    private onBrowserClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;

        const pick = target.closest<HTMLElement>(".collection-pill");
        if (pick) {
            const cid = numId(pick.dataset.collectionId);
            if (!cid) return;
            this.selectedCollectionId = cid;
            this.render();
            return;
        }

        const addLink = target.closest<HTMLElement>(".collection-add-link-btn");
        if (addLink) {
            const cid = numId(addLink.dataset.collectionId);
            if (!cid) return;
            this.deps.linkModal.openCreate(cid);
            return;
        }

        const editCol = target.closest<HTMLElement>(".collection-edit-btn");
        if (editCol) {
            const cid = numId(editCol.dataset.collectionId);
            if (!cid) return;
            const c = this.deps.state.linkCollections.find(x => x.id === cid);
            if (!c) return;
            this.modal = { view: "edit", collection: c };
            this.render();
            return;
        }

        const editLink = target.closest<HTMLElement>(".link-edit-btn");
        if (editLink) {
            const lid = numId(editLink.dataset.linkId);
            if (!lid) return;
            this.deps.linkModal.openEdit(lid);
            return;
        }

        const openLink = target.closest<HTMLElement>(".link-open-btn");
        if (openLink) {
            const lid = numId(openLink.dataset.linkId);
            if (!lid) return;

            let url: string | null = null;
            for (const links of this.deps.state.linksByCollectionId.values()) {
                const l = links.find(x => x.id === lid);
                if (l) { url = l.url; break; }
            }
            if (!url) return;

            void openExternalUrl(url).catch(err => console.error(err));
        }
    }

    private async save(): Promise<void> {
        const { state, refresh } = this.deps;
        if (this.modal.view === "browser") return;

        const name = qs<HTMLInputElement>("#collection-name-input", this.root).value;
        const color = qs<HTMLInputElement>("#collection-color-input", this.root).value;

        if (this.modal.view === "create") {
            await state.dbm.createCollection(name, color);
            await refresh();

            this.selectedCollectionId = state.linkCollections[state.linkCollections.length - 1]?.id ?? null;
            this.modal = { view: "browser" };
            this.render();
            return;
        }

        const id = this.modal.collection.id;
        await state.dbm.updateCollection(id, name, color);
        await refresh();

        this.selectedCollectionId = id;
        this.modal = { view: "browser" };
        this.render();
    }

    private async deleteCurrent(): Promise<void> {
        const { state, refresh } = this.deps;
        if (this.modal.view !== "edit") return;

        const id = this.modal.collection.id;
        await state.dbm.deleteCollection(id);
        await refresh();

        if (this.selectedCollectionId === id) this.selectedCollectionId = state.linkCollections[0]?.id ?? null;

        this.modal = { view: "browser" };
        this.render();
    }
}
