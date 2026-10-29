// 設定の画面（音の on/off・音量・演出・数え上げの速さ）。
import { sfx, unlockAudio } from "../fx/audio";
import { settings, updateSettings, type MotionPref } from "../fx/settings";
import { $ } from "./dom";
import { closeOverlay, openOverlay } from "./overlay";

const osReduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function showSettings(onDone: () => void) {
  const m = (v: MotionPref, label: string) => `<label class="opt"><input type="radio" name="motion" value="${v}" ${settings.motion === v ? "checked" : ""}/> ${label}</label>`;
  const sp = (v: string, label: string) => `<label class="opt"><input type="radio" name="speed" value="${v}" ${settings.speed === v ? "checked" : ""}/> ${label}</label>`;
  openOverlay(
    `<h2>設定</h2>
    <div class="settings">
      <div class="set-row"><span class="set-name">音</span>
        <label class="opt"><input type="checkbox" id="set-sound" ${settings.sound ? "checked" : ""}/> 鳴らす</label>
        <input type="range" id="set-volume" min="0" max="100" step="5" value="${Math.round(settings.volume * 100)}" aria-label="音量"/>
        <span id="set-volume-n" class="set-n">${Math.round(settings.volume * 100)}</span>
      </div>
      <div class="set-row"><span class="set-name">演出</span>
        ${m("auto", `おまかせ（OS の設定に従う。いまは${osReduced() ? "減らす" : "ふつう"}）`)}${m("full", "ふつう")}${m("reduced", "減らす（動きを止め、点はすぐに出す）")}
      </div>
      <div class="set-row"><span class="set-name">数え上げ</span>${sp("normal", "ふつう")}${sp("fast", "速い")}</div>
      <p class="note">数え上げの途中でも次の文を打てる。空のまま Enter を押すか、点の表示を押すと最後まで飛ばす。</p>
    </div>
    <div class="ov-actions"><button id="ov-close">閉じる</button></div>`,
    { variant: "narrow", onClose: onDone },
  );
  $("set-sound").addEventListener("change", (ev) => {
    updateSettings({ sound: (ev.target as HTMLInputElement).checked });
    unlockAudio();
    sfx.click();
  });
  const vol = $<HTMLInputElement>("set-volume");
  vol.addEventListener("input", () => {
    updateSettings({ volume: Number(vol.value) / 100 });
    $("set-volume-n").textContent = vol.value;
  });
  vol.addEventListener("change", () => {
    unlockAudio();
    sfx.chips(2);
  });
  document.querySelectorAll<HTMLInputElement>('input[name="motion"]').forEach((r) => r.addEventListener("change", () => updateSettings({ motion: r.value as MotionPref })));
  document.querySelectorAll<HTMLInputElement>('input[name="speed"]').forEach((r) => r.addEventListener("change", () => updateSettings({ speed: r.value as "normal" | "fast" })));
  $("ov-close").addEventListener("click", closeOverlay);
  $("ov-close").focus();
}
