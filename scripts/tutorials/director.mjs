// Ferramentas para "dirigir" a gravação: cursor visível, legenda e destaque
// no elemento antes do clique. Tudo é desenhado na própria página, por isso
// aparece no vídeo do Playwright.

const OVERLAY_SCRIPT = () => {
  const install = () => {
    if (document.getElementById("__tut-cursor")) return;

    const style = document.createElement("style");
    style.textContent = `
      #__tut-cursor { position: fixed; z-index: 2147483647; pointer-events: none;
        width: 26px; height: 26px; left: -40px; top: -40px;
        filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
      #__tut-cursor.click::after { content: ""; position: absolute; left: -14px; top: -14px;
        width: 28px; height: 28px; border-radius: 9999px; background: rgba(10,132,255,.35);
        animation: __tut-click .45s ease-out forwards; }
      @keyframes __tut-click { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.6); opacity: 0 } }
      #__tut-ring { position: fixed; z-index: 2147483646; pointer-events: none; border-radius: 12px;
        border: 3px solid #0A84FF; box-shadow: 0 0 0 6px rgba(10,132,255,.18);
        opacity: 0; transition: opacity .2s; }
      #__tut-caption { position: fixed; z-index: 2147483647; pointer-events: none;
        left: 50%; bottom: 76px; transform: translate(-50%, 12px); max-width: 82%;
        display: flex; align-items: center; gap: 12px;
        background: rgba(15,23,42,.92); color: #fff; border-radius: 14px;
        padding: 14px 22px; font: 600 20px/1.35 Inter, system-ui, sans-serif;
        box-shadow: 0 10px 30px rgba(0,0,0,.25); opacity: 0;
        transition: opacity .25s, transform .25s; }
      #__tut-caption.show { opacity: 1; transform: translate(-50%, 0); }
      #__tut-caption .step { flex-shrink: 0; display: flex; align-items: center; justify-content: center;
        min-width: 30px; height: 30px; padding: 0 8px; border-radius: 9999px;
        background: #0A84FF; font-size: 15px; }
      #__tut-caption .step:empty { display: none; }
      #__tut-title { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
        background: linear-gradient(135deg, #0A84FF, #0052cc); color: #fff;
        font-family: Inter, system-ui, sans-serif; opacity: 0; transition: opacity .4s; }
      #__tut-title.show { opacity: 1; }
      #__tut-title img { width: 72px; height: 72px; border-radius: 16px; background: #fff; padding: 8px; }
      #__tut-title h1 { margin: 0; font-size: 40px; font-weight: 700; }
      #__tut-title p { margin: 0; font-size: 20px; opacity: .9; }
    `;
    document.head.appendChild(style);

    const cursor = document.createElement("div");
    cursor.id = "__tut-cursor";
    cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.3-3.4-6.9L4 20z" fill="#111827" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const ring = document.createElement("div");
    ring.id = "__tut-ring";
    const caption = document.createElement("div");
    caption.id = "__tut-caption";
    caption.innerHTML = '<span class="step"></span><span class="text"></span>';
    const title = document.createElement("div");
    title.id = "__tut-title";
    title.innerHTML = '<img src="/logo-unxet.png" alt=""><h1></h1><p></p>';
    document.body.append(ring, cursor, caption, title);

    window.addEventListener(
      "mousemove",
      (e) => {
        cursor.style.left = `${e.clientX - 4}px`;
        cursor.style.top = `${e.clientY - 2}px`;
      },
      true,
    );
    window.addEventListener(
      "mousedown",
      () => {
        cursor.classList.remove("click");
        void cursor.offsetWidth;
        cursor.classList.add("click");
      },
      true,
    );
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createDirector(page) {
  let mouse = { x: 640, y: 360 };

  const moveTo = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error("Elemento sem posição na tela");
    const x = box.x + Math.min(box.width / 2, 60);
    const y = box.y + box.height / 2;
    const distance = Math.hypot(x - mouse.x, y - mouse.y);
    await page.mouse.move(x, y, { steps: Math.max(12, Math.round(distance / 14)) });
    mouse = { x, y };
    // Passar o mouse pode mudar o layout (o menu lateral abre e os itens
    // descem): espera a animação e corrige o ponto se o elemento andou
    await sleep(350);
    const after = await locator.boundingBox();
    if (after && (Math.abs(after.y - box.y) > 3 || Math.abs(after.x - box.x) > 3)) {
      const nx = after.x + Math.min(after.width / 2, 60);
      const ny = after.y + after.height / 2;
      await page.mouse.move(nx, ny, { steps: 10 });
      mouse = { x: nx, y: ny };
      return after;
    }
    return box;
  };

  const ring = async (box) => {
    await page.evaluate((b) => {
      const el = document.getElementById("__tut-ring");
      if (!el) return;
      const pad = 6;
      Object.assign(el.style, {
        left: `${b.x - pad}px`,
        top: `${b.y - pad}px`,
        width: `${b.width + pad * 2}px`,
        height: `${b.height + pad * 2}px`,
        opacity: "1",
      });
    }, box);
  };

  const hideRing = () =>
    page.evaluate(() => {
      const el = document.getElementById("__tut-ring");
      if (el) el.style.opacity = "0";
    });

  return {
    install: () => page.addInitScript(OVERLAY_SCRIPT),
    wait: sleep,

    /** Tela de abertura ou de encerramento, sobre a página */
    async title(heading, subtitle, ms = 2800, { keep = false } = {}) {
      await page.evaluate(
        ([h, s]) => {
          const el = document.getElementById("__tut-title");
          el.querySelector("h1").textContent = h;
          el.querySelector("p").textContent = s;
          el.classList.add("show");
        },
        [heading, subtitle],
      );
      await sleep(ms);
      if (keep) return; // encerramento: fica até o fim do vídeo
      await page.evaluate(() =>
        document.getElementById("__tut-title").classList.remove("show"),
      );
      await sleep(500);
    },

    /** Legenda na parte de baixo. `step` vazio esconde o número. */
    async caption(text, { step = "", hold = 1800 } = {}) {
      await page.evaluate(
        ([t, s]) => {
          const el = document.getElementById("__tut-caption");
          el.querySelector(".step").textContent = s;
          el.querySelector(".text").textContent = t;
          el.classList.add("show");
        },
        [text, String(step)],
      );
      await sleep(hold);
    },

    async hideCaption() {
      await page.evaluate(() =>
        document.getElementById("__tut-caption").classList.remove("show"),
      );
      await sleep(300);
    },

    /** Leva o cursor até o elemento e o destaca, sem clicar */
    async point(locator, ms = 1200) {
      const box = await moveTo(locator);
      await ring(box);
      await sleep(ms);
      await hideRing();
    },

    async click(locator, { before = 700, after = 900 } = {}) {
      const box = await moveTo(locator);
      await ring(box);
      await sleep(before);
      await hideRing();
      await page.mouse.down();
      await page.mouse.up();
      await sleep(after);
    },

    async type(locator, text, { delay = 75 } = {}) {
      await this.click(locator, { before: 400, after: 200 });
      await page.keyboard.type(text, { delay });
      await sleep(500);
    },

    /** Lista do navegador (select): destaca e escolhe a opção pelo texto */
    async select(locator, label, { after = 900 } = {}) {
      const box = await moveTo(locator);
      await ring(box);
      await sleep(700);
      await locator.selectOption({ label });
      await sleep(after);
      await hideRing();
    },
  };
}
