const axios = require("axios");
const cheerio = require("cheerio");

const URL = "https://convergenze.it/it/servizi/energia/pun-orario";

async function main() {
  const response = await axios.get(URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 ConnextusMarketBot/0.1",
    },
  });

  const html = response.data;
  const $ = cheerio.load(html);

  console.log("PAGE TITLE:", $("title").text().trim());
  console.log("\nTEXT MATCHES:");
  const text = $("body").text().replace(/\s+/g, " ").trim();

  const titleMatch = text.match(/Andamento PUN Orario\s*-\s*([^€]+?)PUN medio/i);
  const avgMatch = text.match(/PUN medio di domani\s*([\d.,]+)\s*€\/MWh/i);

  console.log("Chart title:", titleMatch?.[1]?.trim());
  console.log("Average:", avgMatch?.[1]);

  console.log("\nSCRIPT SOURCES:");
  $("script[src]").each((_, el) => {
    console.log($(el).attr("src"));
  });

  console.log("\nINLINE SCRIPTS CONTAINING PUN/CHART/DATA:");
  $("script").each((i, el) => {
    const content = $(el).html() || "";
    if (/pun|chart|series|data|mwh|€/i.test(content)) {
      console.log(`\n--- SCRIPT ${i} ---`);
      console.log(content.slice(0, 3000));
    }
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});