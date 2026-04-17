export function levenshtein(a: string, b: string): number {
    const left = a.toLowerCase().trim();
    const right = b.toLowerCase().trim();
    if (left === right) return 0;
    if (!left.length) return right.length;
    if (!right.length) return left.length;

    const previous = Array.from({ length: right.length + 1 }, (_, i) => i);
    const current = new Array<number>(right.length + 1);

    for (let i = 1; i <= left.length; i++) {
        current[0] = i;
        for (let j = 1; j <= right.length; j++) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            current[j] = Math.min(
                current[j - 1] + 1,
                previous[j] + 1,
                previous[j - 1] + cost,
            );
        }
        for (let j = 0; j <= right.length; j++) previous[j] = current[j];
    }

    return previous[right.length];
}

export function similarity(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length, 1);
    return 1 - levenshtein(a, b) / maxLen;
}
