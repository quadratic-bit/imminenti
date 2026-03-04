import type { AppState } from "../state";
import type { LinkCollection, Link } from "../links";
import { qs } from "../utils/dom";

type ModalState = { kind: "collection"; mode: "create"                             }
                | { kind: "collection"; mode: "edit";   collection: LinkCollection }
                | { kind: "link";       mode: "create"; collectionId: number       }
                | { kind: "link";       mode: "edit";   link: Link                 };

type Deps = {
    state: AppState;
    refresh: () => Promise<void>;
    root?: Document;
};

export class LinksModalController {
    private root: Document;
    private attached = false;
    private modal: ModalState | null = null;

    constructor(private deps: Deps) {
        this.root = deps.root ?? document;
    }

    attach(): void {
        if (this.attached) return;
        this.attached = true;

        qs<HTMLButtonElement>("#links-cancel-btn", this.root).addEventListener("click", () => this.close());

        qs<HTMLButtonElement>("#links-delete-btn", this.root).addEventListener("click", async () => {
            try {
                await this.deleteCurrent();
            } catch (err) {
                console.error(err);
                alert("Delete failed. Check console.");
            }
        });

        qs<HTMLFormElement>("#links-form", this.root).addEventListener("submit", async (e) => {
            e.preventDefault();
            try {
                await this.save();
            } catch (err) {
                console.error(err);
                alert("Save failed. Check console.");
            }
        });

        const dialog = qs<HTMLDialogElement>("#links-dialog", this.root);
        dialog.addEventListener("cancel", (e) => {
            e.preventDefault();
            this.close();
        });
    }

    openCreateCollection(): void {
        this.modal = { kind: "collection", mode: "create" };
        this.open();
    }

    openEditCollection(collectionId: number): void {
        const c = this.deps.state.linkCollections.find((x) => x.id === collectionId);
        if (!c) return;
        this.modal = { kind: "collection", mode: "edit", collection: c };
        this.open();
    }

    openCreateLink(collectionId: number): void {
        this.modal = { kind: "link", mode: "create", collectionId };
        this.open();
    }

    openEditLink(linkId: number): void {
        for (const links of this.deps.state.linksByCollectionId.values()) {
            const l = links.find((x) => x.id === linkId);
            if (!l) continue;
            this.modal = { kind: "link", mode: "edit", link: l };
            this.open();
            return;
        }
    }

    private open(): void {
        if (!this.modal) return;
        this.render(this.modal);

        const dialog = qs<HTMLDialogElement>("#links-dialog", this.root);
        if (dialog.open) dialog.close();
        dialog.showModal();
    }

    private render(next: ModalState): void {
        const titleEl   = qs<HTMLHeadingElement>("#links-dialog-title", this.root);
        const contextEl = qs<HTMLDivElement>("#links-dialog-context", this.root);

        const lcNameField  = qs<HTMLLabelElement>("#lc-name-field", this.root);
        const lcColorField = qs<HTMLLabelElement>("#lc-color-field", this.root);
        const lTitleField  = qs<HTMLLabelElement>("#l-title-field", this.root);
        const lUrlField    = qs<HTMLLabelElement>("#l-url-field", this.root);

        const lcName  = qs<HTMLInputElement>("#lc-name-input", this.root);
        const lcColor = qs<HTMLInputElement>("#lc-color-input", this.root);
        const lTitle  = qs<HTMLInputElement>("#l-title-input", this.root);
        const lUrl    = qs<HTMLInputElement>("#l-url-input", this.root);

        const deleteBtn = qs<HTMLButtonElement>("#links-delete-btn", this.root);
        const saveBtn   = qs<HTMLButtonElement>("#links-save-btn", this.root);

        const isCreate = next.mode === "create";
        deleteBtn.hidden = isCreate;
        saveBtn.textContent = isCreate ? "Create" : "Save";

        const showCollection = next.kind === "collection";
        lcNameField.hidden  = !showCollection;
        lcColorField.hidden = !showCollection;
        lTitleField.hidden  = showCollection;
        lUrlField.hidden    = showCollection;

        lcName.value = "";
        lcColor.value = "";
        lTitle.value = "";
        lUrl.value = "";

        if (next.kind === "collection") {
            titleEl.textContent = isCreate ? "Add collection" : "Edit collection";
            contextEl.textContent = "";

            if (!isCreate && next.mode === "edit") {
                lcName.value = next.collection.name;
                lcColor.value = next.collection.color;
            }

            queueMicrotask(() => lcName.focus());
            return;
        }

        titleEl.textContent = isCreate ? "Add link" : "Edit link";

        if (isCreate) {
            const cid = next.collectionId;
            const c = this.deps.state.linkCollections.find((x) => x.id === cid);
            contextEl.textContent = c ? `Collection: ${c.name}` : "";
            queueMicrotask(() => lTitle.focus());
            return;
        }

        contextEl.textContent = "";
        lTitle.value = next.link.title;
        lUrl.value = next.link.url;
        queueMicrotask(() => lTitle.focus());
    }

    close(): void {
        const dialog = qs<HTMLDialogElement>("#links-dialog", this.root);
        if (dialog.open) dialog.close();
        this.modal = null;
    }

    async save(): Promise<void> {
        const { state, refresh } = this.deps;
        if (!this.modal) return;

        const lcName  = qs<HTMLInputElement>("#lc-name-input", this.root);
        const lcColor = qs<HTMLInputElement>("#lc-color-input", this.root);
        const lTitle  = qs<HTMLInputElement>("#l-title-input", this.root);
        const lUrl    = qs<HTMLInputElement>("#l-url-input", this.root);

        if (this.modal.kind === "collection") {
            if (this.modal.mode === "create") {
                await state.dbm.createCollection(lcName.value, lcColor.value);
            } else {
                await state.dbm.updateCollection(this.modal.collection.id, lcName.value, lcColor.value);
            }
            this.close();
            await refresh();
            return;
        }

        if (this.modal.mode === "create") {
            await state.dbm.createLink(this.modal.collectionId, lTitle.value, lUrl.value);
        } else {
            await state.dbm.updateLink(this.modal.link.id, lTitle.value, lUrl.value);
        }

        this.close();
        await refresh();
    }

    async deleteCurrent(): Promise<void> {
        const { state, refresh } = this.deps;
        if (!this.modal) return;

        if (this.modal.kind === "collection") {
            if (this.modal.mode !== "edit") return;
            await state.dbm.deleteCollection(this.modal.collection.id);
        } else {
            if (this.modal.mode !== "edit") return;
            await state.dbm.deleteLink(this.modal.link.id);
        }

        this.close();
        await refresh();
    }
}
