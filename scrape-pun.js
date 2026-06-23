const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

const BASE_URL =
  process.env.SGR_BASE_URL ||
  'https://api.energyportal.sgrlucegas.com/services';

const USERNAME = process.env.SGR_USERNAME;
const PASSWORD = process.env.SGR_PASSWORD;

const parser = new XMLParser({ ignoreAttributes: false });

function getYesterdayDate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return text;
}

async function createSession() {
  const xml = await request(`${BASE_URL}/rest/portalapi/Core/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      createNewSessionRequest: {
        company: 'SGR',
        locale: 'it',
      },
    }),
  });

  const data = parser.parse(xml);
  return data.createNewSessionResponse.session.id;
}

async function login(sessionId) {
  await request(`${BASE_URL}/rest/portalapi/Core/v1/user/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      sessionId,
    },
    body: JSON.stringify({
      doLoginRequest: {
        username: USERNAME,
        password: PASSWORD,
      },
    }),
  });
}

async function fetchPun(date, sessionId) {
  const url =
    `${BASE_URL}/rest/portalapi/Erp/v1/quotations` +
    `?detailLevel=Day` +
    `&startDate=${date}` +
    `&endDate=${date}` +
    `&quotationType=PUN`;

  const xml = await request(url, {
    method: 'GET',
    headers: { sessionId },
  });

  const data = parser.parse(xml);
  const quotation = data.findQuotationsResponse.quotations.quotation;

  const details = Array.isArray(quotation.details.det)
    ? quotation.details.det
    : [quotation.details.det];

  const hours = details.map((det) => ({
    hour: Number(det.hour),
    value: Number(det.val),
    frameCode: det.frameCode,
    frameCodeBio: det.frameCodeBio,
  }));

  return {
    date,
    source: 'SGR',
    market: 'PUN',
    unit: 'EUR/MWh',

    valueMono: Number(quotation.valueMono),
    min: Number(quotation.valueMonoMin),
    max: Number(quotation.valueMonoMax),
    hours,

    // Old Connextus compatibility
    averagePun: Number(quotation.valueMono),
    hourlyPrices: hours.map((h) => ({
      hour: h.hour,
      price: h.value,
    })),

    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  if (!USERNAME || !PASSWORD) {
    throw new Error('Missing SGR_USERNAME or SGR_PASSWORD');
  }

  const date = process.env.PUN_DATE || getYesterdayDate();

  const sessionId = await createSession();
  await login(sessionId);

  const punData = await fetchPun(date, sessionId);

  fs.writeFileSync('pun.json', JSON.stringify(punData, null, 2));

  console.log('pun.json updated');
  console.log(JSON.stringify(punData, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
