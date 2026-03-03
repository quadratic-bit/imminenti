export function qs<T extends Element>(selector: string): T {
    const el = document.querySelector<T>(selector);
    if (!el) throw new Error(`Missing element: ${selector}`);
    return el;
}

export function escapeHtml(input: string): string {
    return input.replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
}

export function closestAtPoint<T extends Element>(selector: string, x: number, y: number): T | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return (el?.closest(selector) as T | null) ?? null;
}

export function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return (
        el.tagName === "INPUT"    ||
        el.tagName === "TEXTAREA" ||
        el.isContentEditable === true
    );
}
