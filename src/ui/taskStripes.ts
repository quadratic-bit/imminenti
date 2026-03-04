const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function uniq<T>(xs: T[]): T[] {
    const out: T[] = [];
    const seen = new Set<T>();
    for (const x of xs) {
        if (seen.has(x)) continue;
        seen.add(x);
        out.push(x);
    }
    return out;
}

export function stripesGradient(colors: string[] | undefined | null): string | null {
    if (!colors || colors.length === 0) return null;

    const cleaned = uniq(colors)
        .map((c) => c.trim())
        .filter((c) => HEX_RE.test(c))
        .slice(0, 8);

    if (cleaned.length === 0) return null;
    if (cleaned.length === 1) return cleaned[0];

    const n = cleaned.length;
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
        const a = (i * 100) / n;
        const b = ((i + 1) * 100) / n;
        const c = cleaned[i];
        parts.push(`${c} ${a}%`, `${c} ${b}%`);
    }
    return `linear-gradient(90deg, ${parts.join(", ")})`;
}

export function styleAttrForStripes(colors: string[] | undefined | null): string {
    const g = stripesGradient(colors);
    if (!g) return "";
    return ` style="--task-stripes: ${g};"`;
}

export function applyStripesCssVar(el: HTMLElement, colors: string[] | undefined | null): void {
    const g = stripesGradient(colors);
    if (!g) el.style.removeProperty("--task-stripes");
    else el.style.setProperty("--task-stripes", g);
}
