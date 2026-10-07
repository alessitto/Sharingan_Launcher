// Descarga los requisitos de Steam de ~110 juegos populares (ES y EN) a
// raw/steam-corpus.json, para medir con coverage.js cuántos nombres de
// CPU y GPU se reconocen. Va despacio a propósito (1,6 s por petición).
//   node tools/hw-db/steam-corpus.js
const fs = require("fs");
const ids = [730,570,1091500,292030,1245620,271590,1174180,413150,367520,504230,105600,252490,578080,1172470,359550,440,4000,620,400,220,8930,289070,1086940,1145360,646570,1593500,1817070,1888930,2050650,883710,1196590,814380,374320,570940,1151640,2420110,990080,1938090,1240440,976730,377160,489830,72850,22380,1716740,238960,2694490,230410,1966720,892970,1623730,251570,346110,108600,294100,427520,526870,255710,949230,1158310,394360,281990,236390,1085660,1203220,2357570,1517290,1238810,1238840,24960,1222670,359320,1203620,1426210,1599340,1063730,39210,1462040,2515020,601150,1446780,582010,2246340,945360,1097150,322330,219740,211820,391540,1794680,588650,268910,257510,1222140,1259420,1659420,1551360,1293830,244210,805550,447040,812140,2208920,1449560,1144200,1328670,1771300,2138330,2399830,1716740,3240220,2622380,1903340];
const out = {};
(async () => {
  for (const id of [...new Set(ids)]) {
    for (const l of ["spanish", "english"]) {
      try {
        const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&l=${l}&filters=basic`);
        const j = await r.json();
        const d = j?.[id]?.data;
        if (d) (out[id] ||= { name: d.name })[l] = d.pc_requirements;
      } catch (e) { console.log("err", id, e.message); }
      await new Promise((r) => setTimeout(r, 1600));
    }
  }
  fs.writeFileSync(require("path").join(__dirname, "raw", "steam-corpus.json"), JSON.stringify(out, null, 1));
  console.log("ok", Object.keys(out).length);
})();
