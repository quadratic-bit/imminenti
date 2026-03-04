export function isHexColor(s: string): boolean {
    return /^#[0-9a-fA-F]{6}$/.test(s);
}

export function assertHexColor(s: string): string {
    if (!isHexColor(s)) throw new Error(`Invalid color: ${s}`);
    return s.toUpperCase();
}

export function normalizeUrl(input: string): string {
    const s = input.trim();
    let u: URL;
    try {
        u = new URL(s);
    } catch {
        u = new URL(`https://${s}`);
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error(`Unsupported URL protocol: ${u.protocol}`);
    }
    return u.toString();
}
