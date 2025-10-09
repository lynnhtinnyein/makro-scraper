export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cleanUpUrl(url: string): string {
    const urlObj = new URL(url);
    urlObj.search = "";
    return urlObj.toString();
}
