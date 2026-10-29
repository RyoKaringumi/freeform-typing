export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** 倍率の表示（整数ならそのまま、そうでなければ小数 1 桁） */
export const fmtMult = (x: number) => (Number.isInteger(x) ? String(x) : (Math.round(x * 10) / 10).toFixed(1));
