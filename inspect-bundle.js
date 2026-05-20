const axios = require("axios");

const URL =
  "https://convergenze.it/assets/application-cdb6249a6a793e291014e622b37c31f79e8ca3a869a056c9d7a3f035556a10ed.js";

async function main() {
  const response = await axios.get(URL);

  const js = response.data;

  console.log("SIZE:", js.length);

  const keywords = [
    "AmCharts.makeChart",
    "makeChart",
    "dataProvider",
    "SerialChart",
    "categoryField",
    "valueField",
    "115.37",
    "PUN",
    "MWh",
  ];

  for (const keyword of keywords) {
    console.log(`\n\n========== ${keyword} ==========`);

    const index = js.indexOf(keyword);

    if (index === -1) {
      console.log("NOT FOUND");
      continue;
    }

    const start = Math.max(0, index - 2000);
    const end = Math.min(js.length, index + 6000);

    console.log(js.slice(start, end));
  }
}

main().catch(console.error);