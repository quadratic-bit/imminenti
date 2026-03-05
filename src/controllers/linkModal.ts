import type { AppState } from "../state";
import type { Link } from "../links";
import { qs } from "../utils/dom";

type ModalState = { mode: "create"; collectionId: number }
                | { mode: "edit"; link: Link };

type Deps = {
    state: AppState;
    refresh: () => Promise<void>;
    root?: Document;
};

export class LinkModalController {
    private root: Document;
    private attached = false;
    private modal: ModalState | null = null;

    constructor(private deps: Deps) {
        this.root = deps.root ?? document;
    }

    attach(): void {
        if (this.attached) return;
        this.attached = true;

        qs<HTMLButtonElement>("#link-cancel-btn", this.root).addEventListener("click", () => this.close());

        qs<HTMLButtonElement>("#link-delete-btn", this.root).addEventListener("click", async () => {
            try { await this.deleteCurrent(); }
            catch (err) { console.error(err); alert("Delete failed. Check console."); }
        });

        qs<HTMLFormElement>("#link-form", this.root).addEventListener("submit", async (e) => {
            e.preventDefault();
            try { await this.save(); }
            catch (err) { console.error(err); alert("Save failed. Check console."); }
        });

        const dialog = qs<HTMLDialogElement>("#link-dialog", this.root);
        dialog.addEventListener("cancel", (e) => { e.preventDefault(); this.close(); });
    }

    openCreate(collectionId: number): void {
        this.modal = { mode: "create", collectionId };
        this.open();
    }

    openEdit(linkId: number): void {
        for (const links of this.deps.state.linksByCollectionId.values()) {
            const l = links.find(x => x.id === linkId);
            if (!l) continue;
            this.modal = { mode: "edit", link: l };
            this.open();
            return;
        }
    }

    renderIfOpen(): void {
        const dialog = this.root.querySelector<HTMLDialogElement>("#link-dialog");
        if (!dialog?.open || !this.modal) return;
        this.render(this.modal);
    }

    private open(): void {
        if (!this.modal) return;
        this.render(this.modal);

        const dialog = qs<HTMLDialogElement>("#link-dialog", this.root);
        if (dialog.open) dialog.close();
        dialog.showModal();
    }

    private render(next: ModalState): void {
        const titleEl = qs<HTMLHeadingElement>("#link-dialog-title", this.root);
        const contextEl = qs<HTMLDivElement>("#link-dialog-context", this.root);

        const title = qs<HTMLInputElement>("#link-title-input", this.root);
        const url = qs<HTMLInputElement>("#link-url-input", this.root);

        const deleteBtn = qs<HTMLButtonElement>("#link-delete-btn", this.root);
        const saveBtn = qs<HTMLButtonElement>("#link-save-btn", this.root);

        const isCreate = next.mode === "create";
        titleEl.textContent = isCreate ? "Add link" : "Edit link";
        deleteBtn.hidden = isCreate;
        saveBtn.textContent = isCreate ? "Create" : "Save";

        title.value = "";
        url.value = "";

        if (isCreate) {
            const c = this.deps.state.linkCollections.find(x => x.id === next.collectionId);
            contextEl.textContent = c ? `Collection: ${c.name}` : "";
            queueMicrotask(() => title.focus());
            return;
        }

        const cid = next.link.collection_id;
        const c = this.deps.state.linkCollections.find(x => x.id === cid);
        contextEl.textContent = c ? `Collection: ${c.name}` : "";
        title.value = next.link.title;
        url.value = next.link.url;
        queueMicrotask(() => title.focus());
    }

    close(): void {
        const dialog = qs<HTMLDialogElement>("#link-dialog", this.root);
        if (dialog.open) dialog.close();
        this.modal = null;
    }

    async save(): Promise<void> {
        const { state, refresh } = this.deps;
        if (!this.modal) return;

        const title = qs<HTMLInputElement>("#link-title-input", this.root).value;
        const url = qs<HTMLInputElement>("#link-url-input", this.root).value;

        if (this.modal.mode === "create") await state.dbm.createLink(this.modal.collectionId, title, url);
        else await state.dbm.updateLink(this.modal.link.id, title, url);

        this.close();
        await refresh();
    }

    async deleteCurrent(): Promise<void> {
        const { state, refresh } = this.deps;
        if (!this.modal || this.modal.mode !== "edit") return;

        await state.dbm.deleteLink(this.modal.link.id);
        this.close();
        await refresh();
    }
}
