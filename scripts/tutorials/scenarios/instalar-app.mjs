// Tutorial: instalar a Unxet no celular (Android e iPhone) e ativar as
// notificações. O celular é desenhado na página: dentro dele roda o app de
// verdade (iframe em largura de celular), e o navegador, o menu, a tela
// inicial e os avisos do sistema são ilustrações genéricas por cima.

export const meta = {
  id: "instalar-app",
  title: "Como instalar a Unxet no celular",
};

const ICON = "/icons/icon-192.png";

const HTML = `
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Unxet</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; overflow: hidden; font-family: Inter, system-ui, sans-serif;
    background: linear-gradient(135deg, #eef4ff, #f8fafc); color: #0f172a; }
  #phone { position: absolute; left: 250px; top: 22px; width: 330px; height: 676px; border-radius: 46px;
    background: #0b1220; padding: 12px; box-shadow: 0 30px 70px rgba(15,23,42,.35); }
  #screen { position: relative; width: 100%; height: 100%; border-radius: 36px; overflow: hidden; background: #fff; }
  .status { position: absolute; top: 0; left: 0; right: 0; height: 30px; display: flex; align-items: center;
    justify-content: space-between; padding: 0 22px; font-size: 12px; font-weight: 700; z-index: 5; }
  .status .dots { letter-spacing: 2px; }
  #frameBox { position: absolute; left: 0; right: 0; overflow: hidden; background: #fff; }
  #frameBox iframe { width: 390px; height: 844px; border: 0; transform-origin: 0 0; transform: scale(.786); }
  /* navegador */
  #topBar { position: absolute; top: 30px; left: 0; right: 0; height: 46px; display: flex; align-items: center;
    gap: 8px; padding: 0 10px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; z-index: 4; }
  #bottomBar { position: absolute; bottom: 0; left: 0; right: 0; height: 70px; background: #f8fafc;
    border-top: 1px solid #e2e8f0; z-index: 4; padding: 8px 14px 0; }
  .url { flex: 1; height: 32px; border-radius: 16px; background: #fff; border: 1px solid #e2e8f0; display: flex;
    align-items: center; gap: 6px; padding: 0 12px; font-size: 13px; color: #334155; }
  .iconBtn { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
  #bottomBar .row { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; color: #2563eb; }
  /* folhas e diálogos */
  .layer { position: absolute; inset: 0; z-index: 8; display: none; }
  .layer.on { display: block; }
  .shade { position: absolute; inset: 0; background: rgba(15,23,42,.35); }
  .menu { position: absolute; top: 72px; right: 8px; width: 200px; background: #fff; border-radius: 14px;
    box-shadow: 0 12px 30px rgba(15,23,42,.3); padding: 6px 0; font-size: 14px; }
  .menu div { padding: 10px 16px; display: flex; align-items: center; gap: 10px; }
  .dialog { position: absolute; left: 22px; right: 22px; top: 210px; background: #fff; border-radius: 20px;
    padding: 20px; box-shadow: 0 16px 40px rgba(15,23,42,.35); }
  .dialog h3 { margin: 0 0 6px; font-size: 17px; }
  .dialog p { margin: 0; font-size: 13px; color: #475569; line-height: 1.4; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  .btn { padding: 9px 16px; border-radius: 999px; font-size: 14px; font-weight: 600; color: #2563eb; }
  .btn.primary { background: #2563eb; color: #fff; }
  .appRow { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
  .appRow img { width: 44px; height: 44px; border-radius: 12px; }
  .sheet { position: absolute; left: 0; right: 0; bottom: 0; background: #f8fafc; border-radius: 22px 22px 0 0;
    padding: 14px 14px 24px; box-shadow: 0 -10px 30px rgba(15,23,42,.25); }
  .sheet .item { background: #fff; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center;
    font-size: 14px; border-bottom: 1px solid #eef2f7; }
  .sheet .group { border-radius: 14px; overflow: hidden; margin-top: 10px; }
  .addPage { position: absolute; inset: 0; background: #f1f5f9; padding: 40px 0 0; }
  .addPage .head { display: flex; justify-content: space-between; align-items: center; padding: 0 14px;
    font-size: 12px; color: #2563eb; }
  .addPage .head b { color: #0f172a; font-size: 12px; white-space: nowrap; }
  .addPage .card { margin: 20px 14px; background: #fff; border-radius: 14px; padding: 12px; display: flex; gap: 12px; align-items: center; }
  .addPage .card img { width: 56px; height: 56px; border-radius: 13px; }
  /* tela inicial */
  #home { position: absolute; inset: 0; z-index: 6; display: none;
    background: linear-gradient(160deg, #1e3a8a, #0ea5e9 70%, #a5f3fc); padding: 70px 22px 0; }
  #home.on { display: block; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 22px 12px; }
  .app { display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 11px; color: #fff; }
  .app i { width: 54px; height: 54px; border-radius: 15px; background: rgba(255,255,255,.28); display: block; }
  .app img { width: 54px; height: 54px; border-radius: 15px; background: #fff; }
  .app.new img { animation: pop .6s ease-out; }
  @keyframes pop { from { transform: scale(.3); opacity: 0 } to { transform: scale(1); opacity: 1 } }
  /* aviso de ativar (igual ao do app) */
  #enable { position: absolute; left: 10px; right: 10px; top: 128px; z-index: 5; display: none; background: #eff6ff;
    border: 1px solid #bfdbfe; border-radius: 12px; padding: 10px 12px; font-size: 12px; color: #1e3a8a; }
  #enable.on { display: block; }
  #enable span { display: inline-block; margin-top: 8px; background: #0A84FF; color: #fff; border-radius: 8px;
    padding: 6px 10px; font-weight: 700; }
  /* passos */
  #steps { position: absolute; left: 650px; top: 120px; width: 470px; }
  #steps .badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px;
    background: #dbeafe; color: #1d4ed8; font-weight: 700; font-size: 15px; }
  #steps h2 { margin: 14px 0 18px; font-size: 30px; }
  #steps ol { list-style: none; margin: 0; padding: 0; counter-reset: s; }
  #steps li { counter-increment: s; display: flex; gap: 12px; align-items: flex-start; font-size: 19px; line-height: 1.35;
    margin-bottom: 14px; opacity: .3; transition: opacity .3s; }
  #steps li.on { opacity: 1; }
  #steps li::before { content: counter(s); flex-shrink: 0; width: 30px; height: 30px; border-radius: 999px; background: #0A84FF;
    color: #fff; font-size: 15px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  #steps .note { margin-top: 18px; font-size: 15px; color: #475569; }
</style></head><body>
  <div id="phone"><div id="screen">
    <div class="status"><span>9:41</span><span class="dots">●●● ▮</span></div>
    <div id="topBar">
      <div class="url">🔒 app.unxet.com.br</div>
      <div class="iconBtn" id="menuBtn">
        <svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2" fill="#334155"/><circle cx="12" cy="12" r="2" fill="#334155"/><circle cx="12" cy="19" r="2" fill="#334155"/></svg>
      </div>
    </div>
    <div id="frameBox"><iframe id="app" src="/inbox"></iframe></div>
    <div id="enable">🔔 Seja avisado de novas mensagens mesmo com o app fechado.<br><span id="enableBtn">Ativar notificações</span></div>
    <div id="bottomBar">
      <div class="url" style="justify-content:center">app.unxet.com.br</div>
      <div class="row">
        <span>‹</span><span>›</span>
        <div class="iconBtn" id="shareBtn">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11v9h12v-9"/></svg>
        </div>
        <span>▢</span><span>⧉</span>
      </div>
    </div>

    <div id="home"><div class="grid">
      ${Array.from({ length: 11 }, () => '<div class="app"><i></i>&nbsp;</div>').join("")}
      <div class="app new" id="homeIcon"><img src="${ICON}" alt=""><span>Unxet</span></div>
    </div></div>

    <div class="layer" id="menu"><div class="menu">
      <div>Nova guia</div><div>Histórico</div><div>Favoritos</div>
      <div id="installItem" style="font-weight:700;color:#1d4ed8">⤓ Instalar app</div><div>Configurações</div>
    </div></div>

    <div class="layer" id="installDialog"><div class="shade"></div><div class="dialog">
      <h3>Instalar app?</h3>
      <div class="appRow"><img src="${ICON}" alt=""><div><b>Unxet</b><p>app.unxet.com.br</p></div></div>
      <div class="actions"><span class="btn">Cancelar</span><span class="btn primary" id="installBtn">Instalar</span></div>
    </div></div>

    <div class="layer" id="shareSheet"><div class="shade"></div><div class="sheet">
      <div class="appRow" style="margin:0 0 4px"><img src="${ICON}" alt=""><div><b>Unxet</b><p style="font-size:12px;color:#64748b;margin:0">app.unxet.com.br</p></div></div>
      <div class="group"><div class="item">Copiar <span>⧉</span></div><div class="item">Adicionar aos Favoritos <span>☆</span></div>
        <div class="item" id="a2hs" style="font-weight:700">Adicionar à Tela de Início <span>⊞</span></div></div>
    </div></div>

    <div class="layer" id="addPage"><div class="addPage">
      <div class="head"><span>Cancelar</span><b>Adicionar à Tela de Início</b><span id="addBtn" style="font-weight:700">Adicionar</span></div>
      <div class="card"><img src="${ICON}" alt=""><div><b>Unxet</b><p style="margin:2px 0 0;font-size:12px;color:#64748b">app.unxet.com.br</p></div></div>
    </div></div>

    <div class="layer" id="permission"><div class="shade"></div><div class="dialog" style="top:240px">
      <h3>Permitir notificações?</h3>
      <p>O Unxet quer enviar notificações para avisar de novas mensagens.</p>
      <div class="actions"><span class="btn">Não permitir</span><span class="btn primary" id="allowBtn">Permitir</span></div>
    </div></div>
  </div></div>

  <div id="steps"><div class="badge" id="platform"></div><h2 id="stepsTitle"></h2><ol id="stepList"></ol>
    <p class="note" id="stepsNote"></p></div>
</body></html>`;

// Estados do celular, controlados pelo roteiro
const UI = () => {
  const $ = (id) => document.getElementById(id);
  const frameBox = $("frameBox");
  window.tut = {
    platform(kind, title, steps, note = "") {
      $("platform").textContent = kind === "android" ? "🤖 Android · Chrome" : " iPhone · Safari";
      $("stepsTitle").textContent = title;
      $("stepList").innerHTML = steps.map((s) => `<li>${s}</li>`).join("");
      $("stepsNote").textContent = note;
      this.browser(kind);
    },
    step(n) {
      document.querySelectorAll("#stepList li").forEach((li, i) => li.classList.toggle("on", i <= n));
    },
    browser(kind) {
      this.closeAll();
      $("home").classList.remove("on");
      $("enable").classList.remove("on");
      const android = kind === "android";
      $("topBar").style.display = android ? "flex" : "none";
      $("bottomBar").style.display = android ? "none" : "block";
      frameBox.style.top = android ? "76px" : "30px";
      frameBox.style.bottom = android ? "0" : "70px";
    },
    standalone() {
      this.closeAll();
      $("home").classList.remove("on");
      $("topBar").style.display = "none";
      $("bottomBar").style.display = "none";
      frameBox.style.top = "30px";
      frameBox.style.bottom = "0";
    },
    home(showIcon) {
      this.closeAll();
      $("home").classList.add("on");
      $("homeIcon").style.visibility = showIcon ? "visible" : "hidden";
    },
    open(id) { $(id).classList.add("on"); },
    closeAll() { document.querySelectorAll(".layer").forEach((l) => l.classList.remove("on")); },
    enable(on) { $("enable").classList.toggle("on", on); },
  };
};

export async function run(page, d) {
  // Página do celular desenhado, no mesmo endereço do app (o iframe usa a
  // mesma sessão). O navegador responde sem passar pelo servidor.
  await page.route("**/__tutorial-celular", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: HTML }),
  );
  await page.goto("/__tutorial-celular", { waitUntil: "load" });
  await page.evaluate(UI);
  // Espera a lista de conversas carregar dentro do celular (não só o esqueleto)
  const inside = page.frameLocator("#app");
  await inside
    .getByText(/^(Cliente Lancamento|Demo .+)$/)
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 30000 });
  await d.wait(800);
  const el = (id) => page.locator(`#${id}`);
  const ui = (fn, ...args) => page.evaluate(([f, a]) => window.tut[f](...a), [fn, args]);

  await page.evaluate(() => window.tut.platform("android", "", []));
  await d.title("Como instalar a Unxet no celular", "Tutorial Unxet · Primeiros passos", 3400);

  // Android
  await ui(
    "platform",
    "android",
    "No Android",
    [
      "Abra app.unxet.com.br no Chrome e entre",
      "Toque nos três pontinhos",
      "Toque em Instalar app",
      "Confirme em Instalar",
      "Abra a Unxet pela tela inicial",
      "Permita as notificações",
    ],
    "Os nomes podem mudar um pouco conforme o celular.",
  );
  await ui("step", 0);
  await d.wait(2400);
  await ui("step", 1);
  await d.click(el("menuBtn"), { before: 800, after: 300 });
  await ui("open", "menu");
  await d.wait(900);
  await ui("step", 2);
  await d.click(el("installItem"), { before: 900, after: 300 });
  await ui("closeAll");
  await ui("open", "installDialog");
  await d.wait(900);
  await ui("step", 3);
  await d.click(el("installBtn"), { before: 900, after: 300 });
  await ui("home", true);
  await d.wait(1200);
  await ui("step", 4);
  await d.click(el("homeIcon"), { before: 1000, after: 300 });
  await ui("standalone");
  await d.wait(1400);
  await ui("step", 5);
  await ui("enable", true);
  await d.wait(900);
  await d.click(el("enableBtn"), { before: 900, after: 300 });
  await ui("enable", false);
  await ui("open", "permission");
  await d.wait(900);
  await d.click(el("allowBtn"), { before: 900, after: 300 });
  await ui("closeAll");
  await d.wait(1800);

  // iPhone
  await ui(
    "platform",
    "iphone",
    "No iPhone",
    [
      "Abra app.unxet.com.br no Safari e entre",
      "Toque em Compartilhar",
      "Toque em Adicionar à Tela de Início",
      "Toque em Adicionar",
      "Abra a Unxet pela tela inicial",
      "Toque em Ativar notificações e em Permitir",
    ],
    "No iPhone, as notificações só funcionam com a Unxet aberta pela tela inicial (iOS 16.4 ou mais novo).",
  );
  await ui("step", 0);
  await d.wait(2600);
  await ui("step", 1);
  await d.click(el("shareBtn"), { before: 800, after: 300 });
  await ui("open", "shareSheet");
  await d.wait(900);
  await ui("step", 2);
  await d.click(el("a2hs"), { before: 900, after: 300 });
  await ui("closeAll");
  await ui("open", "addPage");
  await d.wait(900);
  await ui("step", 3);
  await d.click(el("addBtn"), { before: 900, after: 300 });
  await ui("home", true);
  await d.wait(1200);
  await ui("step", 4);
  await d.click(el("homeIcon"), { before: 1000, after: 300 });
  await ui("standalone");
  await d.wait(1400);
  await ui("step", 5);
  await ui("enable", true);
  await d.wait(900);
  await d.click(el("enableBtn"), { before: 900, after: 300 });
  await ui("enable", false);
  await ui("open", "permission");
  await d.wait(900);
  await d.click(el("allowBtn"), { before: 900, after: 300 });
  await ui("closeAll");
  await d.wait(2200);

  await d.title("Pronto!", "A Unxet no seu celular, com aviso de cada mensagem", 3000, { keep: true });
}
