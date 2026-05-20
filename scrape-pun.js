const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapePUN() {
  const browser = await puppeteer.launch({
    headless: 'new',
  });

  const page = await browser.newPage();

  await page.goto(
    'https://convergenze.it/it/servizi/energia/pun-orario',
    {
      waitUntil: 'networkidle2',
      timeout: 60000,
    }
  );

  console.log('Page loaded...');

  // Wait extra time for chart rendering
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Extract visible page text
  const text = await page.evaluate(() => {
    return document.body.innerText;
  });

  // =========================
  // EXTRACT DATE
  // =========================

  const dateMatch = text.match(
    /Andamento PUN Orario - ([0-9/]+)/
  );

  const date = dateMatch
    ? dateMatch[1]
    : null;

  // =========================
  // EXTRACT AVERAGE PUN
  // =========================

  const avgMatch = text.match(
    /PUN medio di domani\s*([0-9.,]+)/
  );

  const averagePun = avgMatch
    ? parseFloat(
        avgMatch[1].replace(',', '.')
      )
    : null;

  // =========================
  // EXTRACT HOURLY PRICES
  // =========================

  const hourlyPrices = [];

  // Isolate ONLY the pricing table
  const tableMatch = text.match(
    /Ore del giorno([\s\S]*?)PUN medio di domani/
  );

  if (tableMatch) {
    const tableText = tableMatch[1];

    const lines = tableText.split('\n');

    for (const line of lines) {
      const cleanLine = line.trim();

      // Matches:
      // 1       138,04
      // 8       150
      const rowMatch = cleanLine.match(
        /^([0-9]{1,2})\s+([0-9]+(?:,[0-9]+)?)$/
      );

      if (rowMatch) {
        hourlyPrices.push({
          hour: parseInt(rowMatch[1]),
          price: parseFloat(
            rowMatch[2].replace(',', '.')
          ),
        });
      }
    }
  }

  // =========================
  // FINAL JSON
  // =========================

  const data = {
    source: 'Convergenze',
    sourceUrl:
      'https://convergenze.it/it/servizi/energia/pun-orario',
    market: 'PUN',
    unit: '€/MWh',
    date,
    averagePun,
    hourlyPrices,
    updatedAt: new Date().toISOString(),
  };

  // =========================
  // OUTPUT
  // =========================

  console.log('\n===== FINAL JSON =====\n');

  console.log(
    JSON.stringify(data, null, 2)
  );

  // Save locally
  fs.writeFileSync(
    'pun.json',
    JSON.stringify(data, null, 2)
  );

  console.log('\nJSON saved as pun.json');

  await browser.close();
}

scrapePUN();