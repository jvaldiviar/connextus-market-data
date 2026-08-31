const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

const BASE_URL =
  process.env.SGR_BASE_URL ||
  'https://api.energyportal.sgrlucegas.com/services';

const USERNAME = process.env.SGR_USERNAME;
const PASSWORD = process.env.SGR_PASSWORD;
const OUTPUT_FILE = 'pun.json';
const MAX_ATTEMPTS = 4; // Initial attempt plus three retries.
const RETRY_DELAYS_MS = [15_000, 30_000, 60_000];

const parser = new XMLParser({ ignoreAttributes: false });

function getTodayDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(30_000),
  });
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
  };
}

function validatePunData(punData, expectedDate) {
  if (punData.date !== expectedDate) {
    throw new Error(
      `Unexpected PUN date: expected ${expectedDate}, received ${punData.date}`,
    );
  }

  if (![23, 24, 25].includes(punData.hours.length)) {
    throw new Error(
      `Unexpected number of hourly prices: ${punData.hours.length}`,
    );
  }

  const prices = [
    punData.valueMono,
    punData.min,
    punData.max,
    punData.averagePun,
    ...punData.hours.flatMap(({ hour, value }) => [hour, value]),
    ...punData.hourlyPrices.flatMap(({ hour, price }) => [hour, price]),
  ];

  if (!prices.every(Number.isFinite)) {
    throw new Error('PUN response contains a missing or invalid numeric value');
  }
}

function comparablePunData(punData) {
  const { updatedAt: _updatedAt, ...data } = punData;
  return data;
}

function hasChanged(punData) {
  if (!fs.existsSync(OUTPUT_FILE)) {
    return true;
  }

  try {
    const currentData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    return (
      JSON.stringify(comparablePunData(currentData)) !==
      JSON.stringify(comparablePunData(punData))
    );
  } catch (error) {
    console.warn(`Existing ${OUTPUT_FILE} could not be read: ${error.message}`);
    return true;
  }
}

function writePunData(punData) {
  const temporaryFile = `${OUTPUT_FILE}.tmp`;
  const dataWithTimestamp = {
    ...punData,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(temporaryFile, JSON.stringify(dataWithTimestamp, null, 2));
  fs.renameSync(temporaryFile, OUTPUT_FILE);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchAndValidatePun(date) {
  const sessionId = await createSession();
  await login(sessionId);

  const punData = await fetchPun(date, sessionId);
  validatePunData(punData, date);
  return punData;
}

async function fetchWithRetry(date) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      console.log(`Fetching PUN data (attempt ${attempt}/${MAX_ATTEMPTS})`);
      return await fetchAndValidatePun(date);
    } catch (error) {
      lastError = error;

      if (attempt === MAX_ATTEMPTS) {
        break;
      }

      const delay = RETRY_DELAYS_MS[attempt - 1];
      console.warn(
        `Attempt ${attempt} failed: ${error.message}. Retrying in ${delay / 1000}s...`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

async function main() {
  if (!USERNAME || !PASSWORD) {
    throw new Error('Missing SGR_USERNAME or SGR_PASSWORD');
  }

  const date = process.env.PUN_DATE || getTodayDate();
  const punData = await fetchWithRetry(date);

  if (!hasChanged(punData)) {
    console.log(`${OUTPUT_FILE} already contains the latest PUN data`);
    return;
  }

  writePunData(punData);
  console.log(`${OUTPUT_FILE} updated`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  comparablePunData,
  hasChanged,
  validatePunData,
};
